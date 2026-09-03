const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
        /\\n/g,
        "\n",
      ),
    }),
  });
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    const { courseCode } = req.body || {};
    const code = String(courseCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!code)
      return res.status(400).json({ error: "Course code is required." });

    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric)
      return res.status(400).json({ error: "Valid user profile required." });
    const matric = String(profile.data().matric).trim().toUpperCase();
    const matches = await db.collection("courses").get();
    const course = matches.docs.find(
      (item) =>
        String(item.data().code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "") === code,
    );
    if (!course)
      return res.status(404).json({ error: "Course code not found." });

    const memberRef = course.ref.collection("members").doc(decoded.uid);

    // Update the members subcollection AND the legacy `enrolled` array in one
    // transaction. The frontend (course cards, "my courses" filtering,
    // assistant management) still reads `enrolled` directly in a dozen
    // places — letting these two drift apart is exactly what caused counts
    // to freeze at 0 and joined courses to vanish after login before.
    await db.runTransaction(async (tx) => {
      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists) return; // already enrolled — nothing to do

      tx.set(memberRef, {
        uid: decoded.uid,
        matric,
        role: "student",
        joinedAt: FieldValue.serverTimestamp(),
      });
      tx.update(course.ref, {
        enrolled: FieldValue.arrayUnion(matric),
      });
    });

    return res.status(200).json({ success: true, courseId: course.id });
  } catch (error) {
    console.error("Enroll course error:", error);
    return res.status(500).json({ error: "Unable to enroll in course." });
  }
};
