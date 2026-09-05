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
      return res.status(403).json({ error: "Only the course rep can remove students." });

    const normalizedMatric = String(targetMatric).trim().toUpperCase();
    const membersQuery = courseRef.collection("members");

    await db.runTransaction(async (tx) => {
      // Move the member lookup inside the transaction to close the race condition
      const membersSnap = await tx.get(membersQuery);
      const targetMemberDoc = membersSnap.docs.find(
        (d) =>
          String(d.data().matric || "").trim().toUpperCase() ===
          normalizedMatric,
      );

      tx.update(courseRef, {
        enrolled: FieldValue.arrayRemove(normalizedMatric),
        assistants: FieldValue.arrayRemove(normalizedMatric),
      });

      if (targetMemberDoc) {
        tx.delete(targetMemberDoc.ref);
      }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Remove student error:", error);
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
};
