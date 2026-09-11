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

// Subcollections that must be wiped when a rep-owned course is deleted.
const COURSE_SUBCOLLECTIONS = [
  "members", "session", "attendance", "checkins", "deviceFlags",
  "absentFlags", "manualRequests", "hotspotLog", "removalLog",
  "exemptions", "exemptionReasons", "securityEvents", "notifications",
];

async function deleteSubcollectionDocs(subcollectionRef) {
  const snap = await subcollectionRef.limit(500).get();
  if (snap.empty) return 0;
  let batch = db.batch();
  let count = 0;
  let total = 0;
  snap.docs.forEach((d) => {
    batch.delete(d.ref);
    count++; total++;
    if (count === 500) { batch.commit(); batch = db.batch(); count = 0; }
  });
  if (count > 0) await batch.commit();
  if (snap.size === 500) total += await deleteSubcollectionDocs(subcollectionRef);
  return total;
}

async function deleteCourseCompletely(courseId) {
  const courseRef = db.collection("courses").doc(courseId);
  let total = 0;
  for (const sub of COURSE_SUBCOLLECTIONS) {
    try { total += await deleteSubcollectionDocs(courseRef.collection(sub)); }
    catch (err) { /* subcollection may not exist */ }
  }
  await courseRef.delete();
  return total + 1;
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });

    const decoded = await getAuth().verifyIdToken(header.slice(7));
    const uid = decoded.uid;

    const profileRef = db.collection("users").doc(uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists)
      return res.status(404).json({ error: "User profile not found." });

    const profile = profileSnap.data();
    const matric = String(profile.matric || "").trim().toUpperCase();
    const institution = String(profile.institution || "").trim().toUpperCase() || "UNKNOWN";

    const memberships = await db.collectionGroup("members").where("uid", "==", uid).get();
    const courseIds = new Set();
    memberships.docs.forEach((d) => courseIds.add(d.ref.parent.parent.id));

    let coursesLeft = 0;
    let coursesDeleted = 0;

    for (const courseId of courseIds) {
      const courseRef = db.collection("courses").doc(courseId);
      const courseSnap = await courseRef.get();
      if (!courseSnap.exists) continue;

      if (courseSnap.data().repUid === uid) {
        await deleteCourseCompletely(courseId);
        coursesDeleted++;
      } else {
        const memberRef = courseRef.collection("members").doc(uid);
        await db.runTransaction(async (tx) => {
          tx.delete(memberRef);
          tx.update(courseRef, {
            enrolled: FieldValue.arrayRemove(matric),
            assistants: FieldValue.arrayRemove(matric),
          });
        });
        coursesLeft++;
      }
    }

    if (matric) {
      const registryKey = `${institution}|${matric}`;
      const registryRef = db.collection("matricRegistry").doc(registryKey);
      const registrySnap = await registryRef.get();
      if (registrySnap.exists && registrySnap.data().uid === uid)
        await registryRef.delete();
    }

    await profileRef.delete();

    try { await getAuth().deleteUser(uid); }
    catch (authErr) { console.warn(`Auth deletion note for ${uid}: ${authErr.message}`); }

    return res.status(200).json({
      success: true,
      message: "Account and all associated data have been deleted.",
      coursesLeft, coursesDeleted,
    });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ error: "Unable to delete account: " + error.message });
  }
};
