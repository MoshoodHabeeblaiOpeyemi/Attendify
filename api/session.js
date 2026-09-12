const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const verifyAppCheck = require("../utils/appCheck");

try {
  if (getApps().length === 0) {
    initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }) });
  }
} catch (error) { if (!/already exists/.test(error.message)) console.error("Firebase Admin Init Error:", error); }

const db = getFirestore();

function readCookie(header, name) {
  const hit = String(header || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  if (!hit) return null;
  const raw = hit.split("=", 2)[1] || "";
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}


async function handleClose(req, res, decoded) {
  try {
    const { courseId, physicalHeadcount } = req.body || {};
    if (!courseId || typeof courseId !== "string")
      return res.status(400).json({ error: "Course ID is required." });

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) return res.status(404).json({ error: "Course not found." });

    const courseData = courseSnap.data();
    const memberSnap = await courseRef.collection("members").doc(decoded.uid).get();
    const isRep = courseData.repUid === decoded.uid;
    const isAssistant = memberSnap.exists && memberSnap.data().role === "assistant";

    if (!isRep && !isAssistant) return res.status(403).json({ error: "Only course staff can close a session." });

    const secretRef = courseRef.collection("session").doc("secret");
    const secretSnap = await secretRef.get();
    const attendees = secretSnap.exists ? (secretSnap.data().attendees || []) : [];
    const now = new Date();
    const dateLabel = now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const rawHeadcount = physicalHeadcount;
    const headcount = typeof rawHeadcount === "number" && Number.isInteger(rawHeadcount) && rawHeadcount >= 0 ? rawHeadcount : null;

    const liveSnap = await courseRef.collection("session").doc("live").get();
    const sessionExpiresAt = liveSnap.exists ? liveSnap.data().expiresAt || null : null;

    let flaggedAbsent = [];
    if (sessionExpiresAt) {
      const flagsSnap = await courseRef.collection("absentFlags").where("sessionExpiresAt", "==", sessionExpiresAt).get();
      flaggedAbsent = flagsSnap.docs.map((d) => d.data().matric).filter(Boolean);
    }

    let attendeeGroups = {};
    try {
      const groupsSnap = await courseRef.collection("groups").get();
      groupsSnap.docs.forEach((g) => {
        const members = g.data().members || [];
        members.forEach((m) => { if (m.matric) attendeeGroups[String(m.matric).toUpperCase()] = g.data().name; });
      });
    } catch (_) { }

    const secretManagerMatric = secretSnap.exists ? String(secretSnap.data().managerMatric || "").trim().toUpperCase() || null : null;
    const autoMarked = secretManagerMatric ? [{ matric: secretManagerMatric, reason: "session_creator" }] : [];

    let sessionhotspots = [];
    if (sessionExpiresAt) {
      try {
        const rlSnap = await courseRef.collection("hotspotLog").where("sessionExpiresAt", "==", sessionExpiresAt).get();
        sessionhotspots = rlSnap.docs.map((d) => {
          const v = d.data();
          return { matric: v.matric || "", name: v.name || "", grantedByMatric: v.grantedByMatric || "", grantedAt: v.grantedAt && v.grantedAt.toDate ? v.grantedAt.toDate().toISOString() : null };
        });
      } catch (_) { }
    }

    const sessionKey = `session_${now.getTime()}`;
    await courseRef.collection("attendance").doc(sessionKey).set({
      date: dateLabel, closedAt: FieldValue.serverTimestamp(), closedBy: decoded.uid,
      attendees, attendeeGroups, systemCount: attendees.length, physicalHeadcount: headcount,
      flaggedAbsent, autoMarked, hotspots: sessionhotspots,
    });

    const sessionAssistantsSnap = await courseRef.collection("members").where("role", "==", "session_assistant").get();
    const sessionAssistants = sessionAssistantsSnap.docs;

    const batch = db.batch();
    batch.delete(courseRef.collection("session").doc("live"));
    batch.delete(secretRef);
    batch.update(courseRef, { activeSession: null });
    sessionAssistants.forEach((d) => batch.update(d.ref, { role: "student" }));
    await batch.commit();

    if (sessionAssistants.length > 0) {
      const revokedMatrics = sessionAssistants.map((d) => String(d.data().matric || "").trim().toUpperCase());
      await courseRef.update({ assistants: FieldValue.arrayRemove(...revokedMatrics) });
    }

    return res.status(200).json({ success: true, sessionKey, attendeesCount: attendees.length, revokedSessionAssistants: sessionAssistants.length });
  } catch (error) {
    console.error("Close session error:", error);
    return res.status(500).json({ error: "Unable to close session: " + error.message });
  }
}

async function handleRegisterDevice(req, res) {
  try {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      try {
        const decoded = await getAuth().verifyIdToken(header.slice(7));
        const u = await db.collection("users").doc(decoded.uid).get();
        if (u.exists) {
          const m = String(u.data().matric || "").trim().toUpperCase();
          if (m) {
            await db.collection("devices").doc(`u_${decoded.uid}`).set({ uid: decoded.uid, matric: m, lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
          }
        }
      } catch (_) { }
    }

    const existing = readCookie(req.headers.cookie || "", "att_device");
    const deviceId = existing && /^[A-Za-z0-9_-]{8,}$/.test(existing) ? existing : "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

    res.setHeader("Set-Cookie", `att_device=${deviceId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`);
    return res.status(200).json({ deviceId });
  } catch (error) {
    console.error("Register device error:", error);
    return res.status(500).json({ error: "Could not register device." });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await verifyAppCheck(req);
    const action = req.query.action;
    if (action === "registerDevice") return handleRegisterDevice(req, res);
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    switch (action) {
      case "close": return handleClose(req, res, decoded);
      default: return res.status(400).json({ error: "Invalid action. Use: close, registerDevice" });
    }
  } catch (error) {
    console.error("Session API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
