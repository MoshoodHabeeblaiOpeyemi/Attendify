const admin = require("firebase-admin");

// Initialize Firebase Admin securely using Vercel Environment Variables
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel handles newlines in private keys weirdly, this fix ensures it works!
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

// Haversine formula to calculate distance in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (angle) => (angle * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  // CORS Headers for secure cross-origin requests
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { courseId, pin, lat, lon, uid, matric } = req.body;

    if (!courseId || !pin || lat === undefined || lon === undefined || !uid || !matric) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const secretRef = db.collection("courses").doc(courseId).collection("session").doc("secret");
    const secretDoc = await secretRef.get();

    if (!secretDoc.exists) {
      return res.status(404).json({ error: "No active attendance session found." });
    }

    const sessionData = secretDoc.data();

    if (String(sessionData.pin) !== String(pin)) {
      return res.status(400).json({ error: "Invalid attendance PIN." });
    }

    const hallLat = sessionData.lat;
    const hallLon = sessionData.lon;
    let distance = 0;

    if (hallLat !== undefined && hallLon !== undefined) {
      distance = calculateDistance(hallLat, hallLon, lat, lon);
      if (distance > 30) {
        return res.status(403).json({ error: `Too far (~${Math.round(distance)}m). Max is 30m.` });
      }
    }

    await secretRef.update({
      attendees: FieldValue.arrayUnion(matric)
    });

    const attRef = db.collection("courses").doc(courseId).collection("attendance").doc(`session_${matric}`);

    await attRef.set({
      uid,
      matric,
      timestamp: FieldValue.serverTimestamp(),
      status: "Present",
      location: { lat, lon },
      distance: Math.round(distance)
    });

    return res.status(200).json({
      success: true,
      message: "Attendance marked successfully!",
      distance: Math.round(distance)
    });
  } catch (error) {
    console.error("Submit Attendance Error:", error);
    return res.status(500).json({ error: "Server error during check-in." });
  }
};