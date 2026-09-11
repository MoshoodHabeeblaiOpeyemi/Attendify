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
    // session_assistant = an enrolled student temporarily acting as a
    // session hotspot — they are still a student and MUST be able to
    // check in (they were picked because they are physically present).
    const role = memberDoc.exists ? memberDoc.data().role : null;
    if (!memberDoc.exists || (role !== "student" && role !== "session_assistant")) {
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
    
    // Rotating PIN validation: accept current PIN or previous PIN within grace period
    const currentPin = String(sessionData.pin || "");
    const previousPin = sessionData.previousPin ? String(sessionData.previousPin) : null;
    const pinRotationTime = sessionData.pinRotationTime || 0;
    const gracePeriodMs = 2000; // 2s grace — at 10s rotation a 5s grace would leave the old PIN half-valid for 20s
    const now = Date.now();
    
    const isCurrentPinValid = String(pin) === currentPin;
    const isPreviousPinValid = previousPin && String(pin) === previousPin && (now - pinRotationTime) < gracePeriodMs;
    
    if (!isCurrentPinValid && !isPreviousPinValid) {
      return res.status(400).json({ error: "Invalid attendance PIN. Please ask your Rep for the current PIN." });
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

      // Updated tolerances for realistic indoor GPS while maintaining security
      // Nigerian lecture halls: 150-200m radius accommodates indoor GPS inaccuracy
      // without allowing hostel/different building check-ins
      if (reportedAccuracy > 300) {
        return res.status(400).json({
          error: `GPS signal too weak (±${Math.round(reportedAccuracy)}m). Move near a window, wait 30 seconds, or ask the Rep to use PIN + Device Lock mode.`,
        });
      }

      const hallLat = sessionData.lat;
      const hallLon = sessionData.lon;
      const baseRadius = Number(sessionData.radius) || 80;

      if (hallLat !== undefined && hallLat !== null && hallLon !== undefined && hallLon !== null) {
        distance = calculateDistance(hallLat, hallLon, lat, lon);
        // Allowed radius: 200m max for indoor GPS tolerance while preventing
        // check-ins from different buildings or hostels
        const allowedRadius = Math.min(200, baseRadius + reportedAccuracy);

        if (distance > allowedRadius) {
          const km = (distance / 1000).toFixed(1);

          // 🧠 ANCHOR HEALTH: record the rejected fix so the rep's device can
          // detect a systematically bad anchor (clustered rejections) and
          // re-capture instead of letting students fail silently.
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(secretRef);
              const fixes =
                snap.exists && Array.isArray(snap.data().rejectedFixes)
                  ? snap.data().rejectedFixes
                  : [];
              fixes.push({
                lat,
                lon,
                accuracy: Math.round(reportedAccuracy),
                distance: Math.round(distance),
                at: Date.now(),
              });
              while (fixes.length > 12) fixes.shift();
              tx.update(secretRef, { rejectedFixes: fixes });
            });
          } catch (fixErr) {
            console.warn(
              "Could not record rejected fix:",
              fixErr && fixErr.message,
            );
          }

          return res.status(403).json({
            error: `Too far from lecture hall (~${Math.round(distance)}m / ${km}km). Allowed range is ${Math.round(allowedRadius)}m including GPS uncertainty. If you are in the hall, GPS is wrong — ask the Rep to use PIN + Device Lock.`,
          });
        }
      }
    }

    // 👥 Group lookup: tag every check-in with the student's group (if any).
    // The snapshot survives group deletion — history stays intact.
    let groupName = null;
    try {
      const groupsSnap = await courseRef.collection("groups").get();
      const grp = groupsSnap.docs.find((d) =>
        (d.data().members || [])
          .map((m) => String(m || "").trim().toUpperCase())
          .includes(matric),
      );
      if (grp) groupName = String(grp.data().name || "");
    } catch (groupErr) {
      console.warn("Group lookup skipped:", groupErr && groupErr.message);
    }

    // 🛡️ ATOMIC CHECK-IN: the attendee verification, attendees-array update,
    // and check-in record creation all happen inside one Firestore
    // transaction. Two requests racing on the same student (double-tap,
    // flaky-network retry) can no longer slip past the attendees check, and
    // the attendees list can never desync from the check-in record.
    const sessionTimestamp = liveDoc.data().expiresAt;
    // 🚨 Firestore FORBIDS "/" in document IDs — and every UNILORIN matric
    // is "24/56EA057"-shaped. Building the ID from the matric made the
    // final write throw on EVERY real student's check-in (the generic
    // "Server error during check-in authorization"). uid is always a safe
    // 28-char Firebase key; the matric lives inside the doc.
    const uniqueCheckinId = `session_${sessionTimestamp}_${uid}`;

    try {
      await db.runTransaction(async (tx) => {
        const freshSecretDoc = await tx.get(secretRef);
        if (!freshSecretDoc.exists) {
          throw new Error("SESSION_EXPIRED");
        }
        const freshAttendees = freshSecretDoc.data().attendees || [];
        if (freshAttendees.includes(matric)) {
          throw new Error("ALREADY_CHECKED_IN");
        }

        tx.update(secretRef, {
          attendees: FieldValue.arrayUnion(matric),
        });

        tx.set(courseRef.collection("checkins").doc(uniqueCheckinId), {
          uid,
          matric,
          sessionExpiresAt: sessionTimestamp,
          timestamp: FieldValue.serverTimestamp(),
          status: "Present",
          groupName: groupName || null,
          location: isNoGpsMode
            ? { mode: "no_gps" }
            : { lat, lon, accuracy: accuracy ? Math.round(accuracy) : null },
          distance: Math.round(distance),
        });
      });
    } catch (txError) {
      if (txError.message === "ALREADY_CHECKED_IN") {
        return res
          .status(400)
          .json({ error: "You have already checked in for this session!" });
      }
      if (txError.message === "SESSION_EXPIRED") {
        return res
          .status(404)
          .json({ error: "No active attendance session found." });
      }
      throw txError;
    }

    return res.status(200).json({
      success: true,
      message: groupName
        ? `Attendance marked successfully! (${groupName})`
        : "Attendance marked successfully!",
      distance: Math.round(distance),
    });
  } catch (error) {
    console.error("Submit Attendance Error:", error);
    return res
      .status(500)
      .json({ error: "Server error during check-in authorization." });
  }
};
