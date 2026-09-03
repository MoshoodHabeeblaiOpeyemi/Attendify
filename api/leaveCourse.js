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

    // uid comes from the verified token, never the request body — this
    // endpoint can only ever remove the calling user's own membership,
    // not anyone else's, by construction.
    const decoded = await getAuth().verifyIdToken(header.slice(7));

    const { courseId } = req.body || {};
    if (!courseId || typeof courseId !== "string") {
      return res.status(400).json({ error: "Course ID is required." });
    }

    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric) {
      return res.status(400).json({ error: "Valid user profile required." });
    }
    const matric = String(profile.data().matric).trim().toUpperCase();

    const courseRef = db.collection("courses").doc(courseId);
    const memberRef = courseRef.collection("members").doc(decoded.uid);

    await db.runTransaction(async (tx) => {
      const courseSnap = await tx.get(courseRef);
      if (!courseSnap.exists) return; // course already gone — nothing to clean up

      // Delete the membership record AND scrub the matric out of both
      // legacy arrays, atomically. This is what closes the "dirty data"
      // gap — the old client-side leaveCourse only removed the member
      // doc, leaving enrolled[]/assistants[] permanently stale.
      tx.delete(memberRef);
      tx.update(courseRef, {
        enrolled: FieldValue.arrayRemove(matric),
        assistants: FieldValue.arrayRemove(matric),
      });
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Leave course error:", error);
    return res
      .status(500)
      .json({ error: "Unable to leave course: " + error.message });
  }
};
