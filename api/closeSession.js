const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n",
        ),
      }),
    });
  }
} catch (error) {
  if (!/already exists/.test(error.message)) {
    console.error("Firebase Admin Init Error:", error);
  }
}

const db = getFirestore();

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });

    const decoded = await getAuth().verifyIdToken(header.slice(7));

    const { courseId } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists)
      return res.status(404).json({ error: "Course not found." });

    // Only rep or assistants can close a session
    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && memberSnap.data().role === "assistant";

    if (!isRep && !isAssistant)
      return res.status(403).json({ error: "Only course staff can close a session." });

    // Read the live session secret to get attendees
    const secretRef = courseRef.collection("session").doc("secret");
    const secretSnap = await secretRef.get();

    const attendees = secretSnap.exists ? (secretSnap.data().attendees || []) : [];
    const now = new Date();
    const dateLabel =
      now.toLocaleDateString("en-GB") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    // Write the session record to the attendance/ subcollection
    // Key by timestamp so records are naturally ordered and never collide
    const sessionKey = `session_${now.getTime()}`;
    await courseRef.collection("attendance").doc(sessionKey).set({
      date: dateLabel,
      closedAt: FieldValue.serverTimestamp(),
      closedBy: decoded.uid,
      attendees,
    });

    // Clear the live session docs and wipe activeSession on the course doc
    const batch = db.batch();
    batch.delete(courseRef.collection("session").doc("live"));
    batch.delete(secretRef);
    batch.update(courseRef, { activeSession: null });
    await batch.commit();

    return res.status(200).json({ success: true, sessionKey, attendeesCount: attendees.length });
  } catch (error) {
    console.error("Close session error:", error);
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
};
