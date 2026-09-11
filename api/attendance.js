const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
} catch (e) { if (!/already exists/.test(e.message)) console.error("Init error:", e); }

const db = getFirestore();
const norm = (v) => String(v || "").trim().toUpperCase();

async function handleSubmitAttendance(req, res, decoded) {
  try {
    const { courseId, pin, lat, lon, accuracy } = req.body || {};
    if (!courseId || !pin) return res.status(400).json({ error: "Course ID and PIN are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const memberRef = courseRef.collection("members").doc(decoded.uid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) return res.status(403).json({ error: "You are not enrolled in this course." });

    const profile = await db.collection("users").doc(decoded.uid).get();
    const matric = norm(profile.data().matric);

    const liveRef = courseRef.collection("session").doc("live");
    const liveSnap = await liveRef.get();
    if (!liveSnap.exists) return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    const now = Date.now();
    if (live.expiresAt && now > live.expiresAt) return res.status(403).json({ error: "Session expired." });

    const pinAge = now - (live.pinRotationTime || live.createdAt || 0);
    const pinRotationIntervalMs = (live.pinRotationInterval || 10) * 1000;
    const isCurrentPinFresh = pinAge < pinRotationIntervalMs * 2;

    const submittedPin = String(pin).trim();
    const isCurrentPinValid = submittedPin === live.pin && isCurrentPinFresh;
    const isPreviousPinValid = submittedPin === live.previousPin && pinAge < pinRotationIntervalMs * 3;

    if (!isCurrentPinValid && !isPreviousPinValid) {
      if (!isCurrentPinFresh && submittedPin === live.pin) {
        return res.status(401).json({ error: "PIN has expired. Use the latest PIN displayed on the projector/hotspot.", pinExpired: true });
      }
      return res.status(401).json({ error: "Invalid PIN." });
    }

    const secretRef = courseRef.collection("session").doc("secret");
    const checkinRef = courseRef.collection("checkins").doc(`${decoded.uid}_${now}`);

    try {
      await db.runTransaction(async (tx) => {
        const secretSnap = await tx.get(secretRef);
        if (secretSnap.exists && (secretSnap.data().attendees || []).includes(matric)) {
          throw new Error("ALREADY_CHECKED_IN");
        }
        tx.set(checkinRef, { uid: decoded.uid, matric, checkedInAt: FieldValue.serverTimestamp(), lat: lat || null, lon: lon || null, accuracy: accuracy || null });
        tx.update(secretRef, { attendees: FieldValue.arrayUnion(matric) });
      });
    } catch (txError) {
      if (txError.message === "ALREADY_CHECKED_IN") return res.status(409).json({ error: "You have already checked in for this session." });
      throw txError;
    }

    return res.status(200).json({ success: true, message: "Checked in successfully!" });
  } catch (error) {
    console.error("Submit attendance error:", error);
    return res.status(500).json({ error: "Unable to submit attendance: " + error.message });
  }
}

async function handleFlagAbsent(req, res, decoded) {
  try {
    const { courseId, matric: targetMatric, reason } = req.body || {};
    if (!courseId || !targetMatric) return res.status(400).json({ error: "Course ID and target matric are required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && (memberSnap.data().role === "assistant" || memberSnap.data().role === "session_assistant");
    if (!isRep && !isAssistant) return res.status(403).json({ error: "Only course staff can flag absent." });

    const liveSnap = await courseRef.collection("session").doc("live").get();
    if (!liveSnap.exists) return res.status(403).json({ error: "No live session." });

    const live = liveSnap.data();
    const sessionExpiresAt = live.expiresAt;
    const normalizedTarget = norm(targetMatric);

    const targetMemberSnap = await courseRef.collection("members").where("matric", "==", normalizedTarget).limit(1).get();
    if (targetMemberSnap.empty) return res.status(404).json({ error: "Student not found in this course." });

    const flagRef = courseRef.collection("absentFlags").doc(`${normalizedTarget}_${sessionExpiresAt}`);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(flagRef);
      if (existing.exists && existing.data().status === "flagged") throw new Error("ALREADY_FLAGGED");
      tx.set(flagRef, { matric: normalizedTarget, status: "flagged", flaggedBy: decoded.uid, flaggedAt: FieldValue.serverTimestamp(), reason: reason || "", sessionExpiresAt });
    });

    return res.status(200).json({ success: true, message: `${normalizedTarget} flagged as absent.` });
  } catch (error) {
    if (error.message === "ALREADY_FLAGGED") return res.status(409).json({ error: "Student already flagged." });
    console.error("Flag absent error:", error);
    return res.status(500).json({ error: "Unable to flag student: " + error.message });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    const action = req.query.action;
    switch (action) {
      case "submit": return handleSubmitAttendance(req, res, decoded);
      case "flagAbsent": return handleFlagAbsent(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: submit, flagAbsent" });
    }
  } catch (error) {
    console.error("Attendance API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
