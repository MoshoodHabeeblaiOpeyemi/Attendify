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
    const reviewerUid = decodedToken.uid;

    const { courseId, targetUid } = req.body || {};
    if (typeof courseId !== "string" || !courseId.trim()) {
      return res.status(400).json({ error: "Course ID is required." });
    }
    if (typeof targetUid !== "string" || !targetUid.trim()) {
      return res.status(400).json({ error: "Target student UID is required." });
    }

    const courseRef = db.collection("courses").doc(courseId);
    const courseDoc = await courseRef.get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: "Course not found." });
    }

    // Only the course rep or an appointed assistant can approve manual requests.
    const reviewerMemberDoc = await courseRef
      .collection("members")
      .doc(reviewerUid)
      .get();
    const reviewerRole = reviewerMemberDoc.exists
      ? reviewerMemberDoc.data().role
      : null;
    const isRep = courseDoc.data().repUid === reviewerUid;
    const isAssistant =
      reviewerRole === "assistant" || reviewerRole === "session_assistant";
    if (!isRep && !isAssistant) {
      return res.status(403).json({
        error:
          "Only the course rep or an assistant can approve manual verification requests.",
      });
    }

    // The request must exist and still be pending — rep decision is final,
    // so already-approved/rejected requests can never be flipped here.
    const requestRef = courseRef.collection("manualRequests").doc(targetUid);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      return res
        .status(404)
        .json({ error: "Manual verification request not found." });
    }
    if (requestDoc.data().status !== "pending") {
      return res
        .status(409)
        .json({ error: "This request has already been resolved." });
    }

    // The requesting student must still be an enrolled student.
    // session_assistant (session hotspot) is still an enrolled student.
    const targetMemberDoc = await courseRef
      .collection("members")
      .doc(targetUid)
      .get();
    const targetRole = targetMemberDoc.exists
      ? targetMemberDoc.data().role
      : null;
    if (
      !targetMemberDoc.exists ||
      (targetRole !== "student" && targetRole !== "session_assistant")
    ) {
      return res
        .status(403)
        .json({ error: "Requesting user is not an enrolled student." });
    }
    const targetMatric = String(targetMemberDoc.data().matric || "")
      .trim()
      .toUpperCase();
    if (!targetMatric) {
      return res
        .status(400)
        .json({ error: "Student profile has no valid matric number." });
    }

    // There must be a live, unexpired session to approve attendance into.
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

    // 🔒 SESSION BINDING: a request filed in one session cannot be approved in
    // a later session. Without this, a Monday request could be approved on
    // Wednesday — the student gets marked present for a class they never
    // attended. The request's sessionExpiresAt MUST match the live session's.
    const requestSessionExpiresAt = requestDoc.data().sessionExpiresAt;
    const liveSessionExpiresAt = liveDoc.data().expiresAt;
    if (
      requestSessionExpiresAt &&
      requestSessionExpiresAt !== liveSessionExpiresAt
    ) {
      return res.status(409).json({
        error:
          "This request was for a different session. It cannot be approved during the current session.",
      });
    }

    const secretRef = courseRef.collection("session").doc("secret");
    const secretDoc = await secretRef.get();
    if (!secretDoc.exists) {
      return res
        .status(404)
        .json({ error: "Session security details missing." });
    }
    const sessionData = secretDoc.data();
    const currentAttendees = sessionData.attendees || [];

    await db.runTransaction(async (tx) => {
      const freshRequestDoc = await tx.get(requestRef);
      if (
        !freshRequestDoc.exists ||
        freshRequestDoc.data().status !== "pending"
      ) {
        throw new Error("REQUEST_ALREADY_RESOLVED");
      }
      const freshSecretDoc = await tx.get(secretRef);
      const freshAttendees = freshSecretDoc.exists
        ? freshSecretDoc.data().attendees || []
        : [];
      if (freshAttendees.includes(targetMatric)) {
        throw new Error("ALREADY_CHECKED_IN");
      }

      // Mirror submitAttendance.js: add to secret attendees + write a checkin row.
      tx.update(secretRef, { attendees: FieldValue.arrayUnion(targetMatric) });

      const sessionTimestamp = liveDoc.data().expiresAt;
      // 🚨 Same "/"-in-doc-ID trap as submitAttendance.js — UNILORIN matrics
      // contain a slash, so the ID must be built from the safe uid instead.
      const uniqueCheckinId = `session_${sessionTimestamp}_${targetUid}`;
      tx.set(courseRef.collection("checkins").doc(uniqueCheckinId), {
        uid: targetUid,
        matric: targetMatric,
        sessionExpiresAt: sessionTimestamp,
        timestamp: FieldValue.serverTimestamp(),
        status: "Present",
        checkinMode: "manual_override",
        approvedBy: isRep ? "rep" : "assistant",
        approvedByUid: reviewerUid,
        location: { mode: "manual_override" },
        distance: null,
      });

      // Permanently log the resolution — rep decision is final.
      tx.update(requestRef, {
        status: "approved",
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedByUid: reviewerUid,
        reviewedByRole: isRep ? "rep" : "assistant",
      });
    });

    return res.status(200).json({
      success: true,
      message: `Manual attendance approved for ${targetMatric}.`,
    });
  } catch (error) {
    if (error.message === "REQUEST_ALREADY_RESOLVED") {
      return res
        .status(409)
        .json({ error: "This request has already been resolved." });
    }
    if (error.message === "ALREADY_CHECKED_IN") {
      return res
        .status(409)
        .json({ error: "This student has already checked in." });
    }
    console.error("Approve manual attendance error:", error);
    return res
      .status(500)
      .json({ error: "Server error during manual approval." });
  }
};
