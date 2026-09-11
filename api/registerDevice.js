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

// G1 🛡️ SERVER-MINTED DEVICE IDENTITY.
// The browser's localStorage id can be cleared or forged by a determined
// student, so the SERVER mints the device id and pins it in an HttpOnly
// cookie (invisible to JavaScript, ~1 year). submitAttendance cross-checks
// the cookie id against the body id on every check-in: a mismatch = the
// phone is trying to look like a "new device" = denied + flagged. Existing
// flows are fully preserved — clients keep their current id; this endpoint
// just anchors it server-side.

function readCookie(header, name) {
  const hit = String(header || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  if (!hit) return null;
  const raw = hit.split("=", 2)[1] || "";
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

module.exports = async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      try {
        const decoded = await getAuth().verifyIdToken(header.slice(7));
        const u = await db.collection("users").doc(decoded.uid).get();
        if (u.exists) {
          const m = String(u.data().matric || "").trim().toUpperCase();
          if (m) {
            await db.collection("devices").doc(`u_${decoded.uid}`).set(
              {
                uid: decoded.uid,
                matric: m,
                lastSeenAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }
        }
      } catch (_) {
        /* unauthenticated registration still works */
      }
    }

    const existing = readCookie(req.headers.cookie || "", "att_device");
    const deviceId =
      existing && /^[A-Za-z0-9_-]{8,}$/.test(existing)
        ? existing
        : "dev_" +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);

    res.setHeader(
      "Set-Cookie",
      `att_device=${deviceId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
    );

    return res.status(200).json({ deviceId });
  } catch (error) {
    console.error("Register device error:", error);
    return res.status(500).json({ error: "Could not register device." });
  }
};