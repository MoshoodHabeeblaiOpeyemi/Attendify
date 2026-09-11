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
const HOTSPOTS_MAX = 5;

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));

    const { courseId, targetMatric } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });
    if (!targetMatric || typeof targetMatric !== "string")
      return res.status(400).json({ error: "Target matric is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });
    if (courseSnap.data().repUid !== decoded.uid)
      return res
        .status(403)
        .json({ error: "Only the course rep can appoint hotspots." });

    const liveSnap = await courseRef.collection("session").doc("live").get();
    if (
      !liveSnap.exists ||
      !liveSnap.data().active ||
      Date.now() > (liveSnap.data().expiresAt || 0) + 10000
    ) {
      return res.status(409).json({
        error:
          "No live session. hotspots can only be appointed during an active class.",
      });
    }
    const sessionExpiresAt = liveSnap.data().expiresAt;

    const secretSnap = await courseRef.collection("session").doc("secret").get();
    const attendees = secretSnap.exists
      ? (secretSnap.data().attendees || []).map((m) =>
          String(m || "").trim().toUpperCase(),
        )
      : [];
    const normalizedTarget = String(targetMatric).trim().toUpperCase();

    const membersSnap = await courseRef.collection("members").get();
    const target = membersSnap.docs.find(
      (d) =>
        String(d.data().matric || "").trim().toUpperCase() === normalizedTarget,
    );
    if (!target)
      return res.status(404).json({ error: "Student not found in this course." });
    if (target.data().role !== "student")
      return res
        .status(409)
        .json({ error: "Only regular students can be appointed hotspots." });
    if (
      membersSnap.docs.some(
        (d) => d.data().role === "session_assistant" && d.id === target.id,
      )
    )
      return res.status(409).json({ error: "Already a hotspot." });

    // 🎯 PROOF-OF-PRESENCE (the strict rule): the candidate must ALREADY have
    // scanned in for THIS session. You cannot scan the rep's screen from
    // home — so an absent friend can never be granted hotspot power, and
    // the rotating code never reaches a device outside the hall via grants.
    if (!attendees.includes(normalizedTarget)) {
      return res.status(403).json({
        error: `Proof-of-presence failed: ${normalizedTarget} has not checked in to this session yet. Only students who already scanned the code can broadcast it.`,
      });
    }

    // Cap the blast radius: the QR lives on at most HOTSPOTS_MAX screens.
    const currenthotspots = membersSnap.docs.filter(
      (d) => d.data().role === "session_assistant",
    );
    if (currenthotspots.length >= HOTSPOTS_MAX) {
      return res.status(409).json({
        error: `Hotspot cap is ${HOTSPOTS_MAX} per class — a QR shown on too many screens multiplies leak risk.`,
      });
    }

    const repMember = membersSnap.docs.find((d) => d.id === decoded.uid);
    const grantedByMatric = repMember
      ? String(repMember.data().matric || "").trim().toUpperCase()
      : "";

    await db.runTransaction(async (tx) => {
      tx.update(target.ref, { role: "session_assistant" });
      tx.update(courseRef, { assistants: FieldValue.arrayUnion(normalizedTarget) });
      // 📡 PUBLIC GRANT LOG — every enrolled student can see who was granted
      // hotspot power, when, and by whom. Accountability is written in data.
      tx.set(
        courseRef
          .collection("hotspotLog")
          .doc(`${sessionExpiresAt}_${normalizedTarget}`),
        {
          matric: normalizedTarget,
          name: String(target.data().name || ""),
          uid: target.id,
          grantedByUid: decoded.uid,
          grantedByMatric,
          sessionExpiresAt,
          grantedAt: FieldValue.serverTimestamp(),
        },
      );
    });

    return res.status(200).json({
      success: true,
      message: `${normalizedTarget} is now a hotspot — power ends when class closes.`,
    });
  } catch (error) {
    console.error("Grant hotspot error:", error);
    return res
      .status(500)
      .json({ error: "Server error while appointing hotspot." });
  }
};