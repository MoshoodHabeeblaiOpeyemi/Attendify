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
const verifyAppCheck = require("./_appCheck");

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
    const flaggerUid = decodedToken.uid;

    // 🛡️ App Check (no-op unless ENFORCE_APP_CHECK=true on the server).
    await verifyAppCheck(req);

    const { courseId, targetUid, reason } = req.body || {};
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

    // Only the course rep or an appointed assistant can flag a student absent.
    const flaggerMemberDoc = await courseRef
      .collection("members")
      .doc(flaggerUid)
      .get();
    const flaggerRole = flaggerMemberDoc.exists
      ? flaggerMemberDoc.data().role
      : null;
    const isRep = courseDoc.data().repUid === flaggerUid;
    const isAssistant =
      flaggerRole === "assistant" || flaggerRole === "session_assistant";
    if (!isRep && !isAssistant) {
      return res.status(403).json({
        error:
          "Only the course rep or an assistant can flag a student absent.",
      });
    }

    // The target must be an enrolled student in this course.
    const targetMemberDoc = await courseRef
      .collection("members")
      .doc(targetUid)
      .get();
    if (!targetMemberDoc.exists || targetMemberDoc.data().role !== "student") {
      return res
        .status(403)
        .json({ error: "Target user is not an enrolled student." });
    }
    const targetMatric = String(targetMemberDoc.data().matric || "")
      .trim()
      .toUpperCase();
    if (!targetMatric) {
      return res
        .status(400)
        .json({ error: "Student profile has no valid matric number." });
    }

    // A flag only makes sense inside a live session — this is the "empty seat
    // linked to an active check-in" moment, so require the session to be live.
    const liveRef = courseRef.collection("session").doc("live");
    const liveDoc = await liveRef.get();
    if (!liveDoc.exists || !liveDoc.data().active) {
      return res
        .status(404)
        .json({ error: "No active attendance session found." });
    }
    if (Date.now() > ((liveDoc.data().expiresAt || 0) + 10000)) {
      return res.status(403).json({ error: "Attendance session has expired!" });
    }
    const sessionExpiresAt = liveDoc.data().expiresAt;

    // One flag per student per session — the rep decision is final, so an
    // already-flagged student for THIS session can never be re-flagged here.
    const flagRef = courseRef.collection("absentFlags").doc(targetUid);
    const flagDoc = await flagRef.get();
    if (
      flagDoc.exists &&
      flagDoc.data().sessionExpiresAt === sessionExpiresAt &&
      flagDoc.data().status === "flagged"
    ) {
      return res
        .status(409)
        .json({ error: "This student has already been flagged for this session." });
    }

    const courseName = String(courseDoc.data().name || "");
    const courseCode = String(courseDoc.data().code || "");
    const flaggerRoleLabel = isRep ? "rep" : "assistant";
    const alertMessage = `You have been flagged absent for this lecture (${courseCode}). If you are present, see your Rep immediately.`;

    await db.runTransaction(async (tx) => {
      const freshFlagDoc = await tx.get(flagRef);
      if (
        freshFlagDoc.exists &&
        freshFlagDoc.data().sessionExpiresAt === sessionExpiresAt &&
        freshFlagDoc.data().status === "flagged"
      ) {
        throw new Error("ALREADY_FLAGGED");
      }

      // Permanent, tamper-evident record — attendance itself is NEVER deleted.
      tx.set(flagRef, {
        uid: targetUid,
        matric: targetMatric,
        status: "flagged",
        reason: typeof reason === "string" ? reason.slice(0, 200) : "",
        courseId,
        courseName,
        courseCode,
        sessionExpiresAt,
        flaggedByRole: flaggerRoleLabel,
        flaggedByUid: flaggerUid,
        flaggedAt: FieldValue.serverTimestamp(),
        flagCount: freshFlagDoc.exists
          ? (freshFlagDoc.data().flagCount || 0) + 1
          : 1,
      });

      // Emergency push-style notification to the student's phone.
      tx.set(
        db
          .collection("users")
          .doc(targetUid)
          .collection("notifications")
          .doc(`absentflag_${sessionExpiresAt}_${targetUid}`),
        {
          type: "absent_flag",
          courseId,
          courseName,
          courseCode,
          message: alertMessage,
          sessionExpiresAt,
          flaggedByRole: flaggerRoleLabel,
          flaggedAt: FieldValue.serverTimestamp(),
          read: false,
        },
      );
    });

    // 📲 Real push notification via FCM — reaches the phone's notification
    // tray even when the app is closed. The in-app toast + portal banner have
    // already fired via Firestore listeners; a push failure never blocks the
    // flag itself.
    try {
      const tokensSnap = await db
        .collection("users")
        .doc(targetUid)
        .collection("fcmTokens")
        .get();
      const tokenDocs = tokensSnap.docs
        .map((d) => ({ id: d.id, token: d.data().token }))
        .filter((t) => typeof t.token === "string" && t.token.length > 0);

      if (tokenDocs.length > 0) {
        const { getMessaging } = require("firebase-admin/messaging");
        const push = await getMessaging().sendEachForMulticast({
          tokens: tokenDocs.map((t) => t.token),
          notification: {
            title: "⚠️ Flagged Absent",
            body: alertMessage,
          },
          data: {
            type: "absent_flag",
            courseId,
            link: "/",
          },
          webpush: {
            fcmOptions: { link: "/" },
          },
        });

        // Clean up dead tokens so future emergency sends stay fast.
        const deadDocIds = [];
        push.responses.forEach((r, i) => {
          const msg = `${r.error?.code || ""} ${r.error?.message || ""}`;
          if (!r.success && /not-registered|invalid|unregistered/i.test(msg)) {
            deadDocIds.push(tokenDocs[i].id);
          }
        });
        if (deadDocIds.length > 0) {
          await Promise.all(
            deadDocIds.map((docId) =>
              db
                .collection("users")
                .doc(targetUid)
                .collection("fcmTokens")
                .doc(docId)
                .delete()
                .catch(() => {}),
            ),
          );
        }
      }
    } catch (pushErr) {
      console.warn("FCM push skipped/failed (flag still recorded):", pushErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Student ${targetMatric} flagged absent — emergency alert sent.`,
    });
  } catch (error) {
    if (error.message === "ALREADY_FLAGGED") {
      return res.status(409).json({
        error: "This student has already been flagged for this session.",
      });
    }
    console.error("Flag absent error:", error);
    return res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : "Server error while flagging student." });
  }
};
