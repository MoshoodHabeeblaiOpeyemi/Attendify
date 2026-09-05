const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
          : undefined,
      }),
    });
  }
} catch (error) {
  if (!/already exists/.test(error.message)) {
    console.error("Firebase Admin Init Error:", error);
  }
}

const db = getFirestore();

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (angle) => (angle * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Missing authentication token." });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User profile not found." });
    }
    const matric = String(userDoc.data().matric || "")
      .trim()
      .toUpperCase();
    if (!matric) {
      return res
        .status(400)
        .json({ error: "User profile has no valid matric number." });
    }

    const { courseId, pin, lat, lon, accuracy, deviceId } = req.body || {};
    if (
      typeof courseId !== "string" ||
      !courseId.trim() ||
      pin === undefined
    ) {
      return res
        .status(400)
        .json({ error: "Missing required check-in fields." });
    }

    const courseRef = db.collection("courses").doc(courseId);
    const courseDoc = await courseRef.get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: "Course not found." });
    }

    const memberRef = courseRef.collection("members").doc(uid);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists || memberDoc.data().role !== "student") {
      return res
        .status(403)
        .json({ error: "You are not enrolled in this course." });
    }

    // One-phone binding. A website cannot make this unbreakable (clearing
    // site data mints a new id). On mismatch we deny AND leave a flag the
    // rep can review — not a silent drop.
    if (deviceId && typeof deviceId === "string" && deviceId.length >= 8) {
      const deviceRef = db.collection("devices").doc(deviceId);
      const deviceDoc = await deviceRef.get();
      if (deviceDoc.exists) {
        const boundMatric = String(deviceDoc.data().matric || "")
          .trim()
          .toUpperCase();
        if (boundMatric && boundMatric !== matric) {
          await courseRef.collection("deviceFlags").add({
            deviceId,
            attemptedMatric: matric,
            boundMatric,
            uid,
            createdAt: FieldValue.serverTimestamp(),
          });
          return res.status(403).json({
            error: `Device Locked: This phone is registered to matric [${boundMatric}]. Proxy attendance is strictly prohibited.`,
          });
        }
      } else {
        await deviceRef.set({
          matric,
          uid,
          boundAt: FieldValue.serverTimestamp(),
          userAgent: req.headers["user-agent"] || "",
        });
      }
    }

    const liveRef = courseRef.collection("session").doc("live");
    const liveDoc = await liveRef.get();
    if (!liveDoc.exists || !liveDoc.data().active) {
      return res
        .status(404)
        .json({ error: "No active attendance session found." });
    }
    if (Date.now() > liveDoc.data().expiresAt + 10000) {
      return res.status(403).json({ error: "Attendance session has expired!" });
    }

    const secretRef = courseRef.collection("session").doc("secret");
    const secretDoc = await secretRef.get();
    if (!secretDoc.exists) {
      return res
        .status(404)
        .json({ error: "Session security details missing." });
    }
    const sessionData = secretDoc.data();
    if (String(sessionData.pin) !== String(pin)) {
      return res.status(400).json({ error: "Invalid attendance PIN." });
    }

    const currentAttendees = sessionData.attendees || [];
    if (currentAttendees.includes(matric)) {
      return res
        .status(400)
        .json({ error: "You have already checked in for this session!" });
    }

    const isNoGpsMode = sessionData.locationMode === "no_gps";
    let distance = 0;

    if (!isNoGpsMode) {
      if (lat === undefined || lon === undefined) {
        return res.status(400).json({
          error: "GPS location is required for this lecture session.",
        });
      }

      const reportedAccuracy =
        typeof accuracy === "number" && Number.isFinite(accuracy)
          ? accuracy
          : 999;

      // Indoor phones often report ±400–900m. That is uncertainty, not proof
      // the student is kilometres away. Only reject readings that are unusable.
      if (reportedAccuracy > 1500) {
        return res.status(400).json({
          error: `GPS signal unusable (±${Math.round(reportedAccuracy)}m). Move near a window, wait a few seconds, or ask the Rep to start PIN + Device Lock mode.`,
        });
      }

      const hallLat = sessionData.lat;
      const hallLon = sessionData.lon;
      const baseRadius = Number(sessionData.radius) || 80;

      if (hallLat !== undefined && hallLat !== null && hallLon !== undefined && hallLon !== null) {
        distance = calculateDistance(hallLat, hallLon, lat, lon);
        // Allowed radius must include GPS uncertainty, otherwise a student
        // standing in the hall with ±700m accuracy can never pass a 180m fence.
        const allowedRadius = Math.min(900, baseRadius + reportedAccuracy);

        if (distance > allowedRadius) {
          const km = (distance / 1000).toFixed(1);
          return res.status(403).json({
            error: `Too far from lecture hall (~${Math.round(distance)}m / ${km}km). Allowed range is ${Math.round(allowedRadius)}m including GPS uncertainty. If you are in the hall, GPS is wrong — ask the Rep to use PIN + Device Lock.`,
          });
        }
      }
    }

    await secretRef.update({
      attendees: FieldValue.arrayUnion(matric),
    });

    const sessionTimestamp = liveDoc.data().expiresAt;
    const uniqueCheckinId = `session_${sessionTimestamp}_${matric}`;
    await courseRef.collection("checkins").doc(uniqueCheckinId).set({
      uid,
      matric,
      sessionExpiresAt: sessionTimestamp,
      timestamp: FieldValue.serverTimestamp(),
      status: "Present",
      location: isNoGpsMode
        ? { mode: "no_gps" }
        : { lat, lon, accuracy: accuracy ? Math.round(accuracy) : null },
      distance: Math.round(distance),
    });

    return res.status(200).json({
      success: true,
      message: "Attendance marked successfully!",
      distance: Math.round(distance),
    });
  } catch (error) {
    console.error("Submit Attendance Error:", error);
    return res
      .status(500)
      .json({ error: "Server error during check-in authorization." });
  }
};
