const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

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

// Recursively delete all documents in a collection reference (batch-safe)
async function deleteCollection(collRef) {
  const snap = await collRef.get();
  if (snap.empty) return;

  // Firestore batch writes are limited to 500 ops; chunk if needed
  const chunks = [];
  for (let i = 0; i < snap.docs.length; i += 490) {
    chunks.push(snap.docs.slice(i, i + 490));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

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

    if (courseSnap.data().repUid !== decoded.uid)
      return res.status(403).json({ error: "Only the course rep can delete this course." });

    // Delete all subcollections first (Firestore won't cascade automatically)
    await deleteCollection(courseRef.collection("members"));
    await deleteCollection(courseRef.collection("session"));
    await deleteCollection(courseRef.collection("attendance"));

    // Now delete the course document itself
    await courseRef.delete();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete course error:", error);
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
};
