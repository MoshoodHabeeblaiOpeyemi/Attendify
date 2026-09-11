const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\\n"),
      }),
    });
  }
} catch (error) {
  if (!/already exists/.test(error.message)) console.error("Firebase Admin Init Error:", error);
}

const db = getFirestore();

// 🔀 COURSE ACTIONS — enroll, leave, remove, delete.
// Dispatches on \ction\ query param: enroll, leave, remove, delete

const norm = (v) => String(v || "").trim().toUpperCase();

async function handleEnroll(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User profile not found." });

    const userData = userSnap.data();
    const matric = norm(userData.matric);
    if (!matric) return res.status(400).json({ error: "You need a matric number in your profile to enroll." });

    if (courseData.institution && norm(courseData.institution) !== norm(userData.institution)) {
      return res.status(403).json({ error: "This course is for a different institution." });
    }
    if (courseData.department && norm(courseData.department) !== norm(userData.department)) {
      return res.status(403).json({ error: "This course is for a different department." });
    }
    if (courseData.level && norm(courseData.level) !== norm(userData.level)) {
      return res.status(403).json({ error: "This course is for a different level." });
    }

    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const registryInstitution = norm(userData.institution) || "UNKNOWN";
    const registryKey = \\|\\;
    const registryRef = db.collection("matricRegistry").doc(registryKey);

    if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true") {
      if (!decoded.email_verified) return res.status(403).json({ error: "Please verify your email before enrolling.", emailNotVerified: true });
    }

    try {
      await db.runTransaction(async (tx) => {
        const registrySnap = await tx.get(registryRef);
        if (registrySnap.exists && registrySnap.data().uid !== decoded.uid) throw new Error("MATRIC_CLAIMED_BY_ANOTHER");

        tx.set(registryRef, { uid: decoded.uid, matric, institution: registryInstitution, department: norm(userData.department) || null, level: norm(userData.level) || null, claimedAt: FieldValue.serverTimestamp() }, { merge: true });

        const memberSnap = await tx.get(memberRef);
        if (memberSnap.exists) return;

        tx.set(memberRef, { uid: decoded.uid, matric, name: String(userData.name || "").trim() || matric, role: "student", joinedAt: FieldValue.serverTimestamp() });
        tx.update(courseRef, { enrolled: FieldValue.arrayUnion(matric) });
      });
    } catch (txError) {
      if (txError.message === "MATRIC_CLAIMED_BY_ANOTHER") return res.status(409).json({ error: \This matric number (\) is already claimed by another account.\, matricClaimed: true });
      throw txError;
    }

    return res.status(200).json({ success: true, message: "Enrolled successfully!" });
  } catch (error) {
    console.error("Enroll error:", error);
    return res.status(500).json({ error: "Unable to enroll: " + error.message });
  }
}

async function handleLeave(req, res, decoded) {
  try {
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    if (courseData.repUid === decoded.uid) return res.status(403).json({ error: "Rep cannot leave their own course. Transfer ownership or delete the course instead." });

    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) return res.status(404).json({ error: "You are not enrolled in this course." });

    const matric = norm(memberSnap.data().matric);

    await db.runTransaction(async (tx) => {
      tx.delete(memberRef);
      tx.update(courseRef, { enrolled: FieldValue.arrayRemove(matric), assistants: FieldValue.arrayRemove(matric) });
    });

    return res.status(200).json({ success: true, message: "Left the course." });
  } catch (error) {
    console.error("Leave error:", error);
    return res.status(500).json({ error: "Unable to leave course: " + error.message });
  }
}

async function handleRemove(req, res, decoded) {
  try {
    const { courseId, matric } = req.body || {};
    if (!courseId || !matric) return res.status(400).json({ error: "Course ID and matric are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    if (courseData.repUid !== decoded.uid) return res.status(403).json({ error: "Only the course rep can remove students." });

    const liveSnap = await courseRef.collection("session").doc("live").get();
    if (liveSnap.exists) {
      const live = liveSnap.data();
      if (live.expiresAt && live.expiresAt > Date.now()) return res.status(409).json({ error: "Cannot remove students during a live session. Flag absent instead." });
    }

    const normalizedTarget = norm(matric);
    let targetMemberDoc = null;

    try {
      await db.runTransaction(async (tx) => {
        const membersSnap = await tx.get(courseRef.collection("members"));
        const target = membersSnap.docs.find((d) => norm(d.data().matric) === normalizedTarget);
        if (!target) throw new Error("STUDENT_NOT_FOUND");
        targetMemberDoc = target;
        tx.delete(target.ref);
        tx.update(courseRef, { enrolled: FieldValue.arrayRemove(normalizedTarget), assistants: FieldValue.arrayRemove(normalizedTarget) });
      });
    } catch (txError) {
      if (txError.message === "STUDENT_NOT_FOUND") return res.status(404).json({ error: "Student not found." });
      throw txError;
    }

    if (targetMemberDoc) {
      try {
        const removalLogRef = courseRef.collection("removalLog").doc();
        await removalLogRef.set({ matric: normalizedTarget, removedBy: decoded.uid, removedAt: FieldValue.serverTimestamp() });
      } catch (logErr) { console.warn("Could not log removal:", logErr.message); }
    }

    return res.status(200).json({ success: true, message: "Student removed." });
  } catch (error) {
    console.error("Remove error:", error);
    return res.status(500).json({ error: "Unable to remove student: " + error.message });
  }
}
