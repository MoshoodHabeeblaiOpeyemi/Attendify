const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

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

module.exports = async (req, res) => {
  const allowedOrigins = [
    "https://attendify-two-green.vercel.app",
    "http://localhost:3000"
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  try {
    // 🔐 1. Verify Cryptographic Bearer Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing authentication token." });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 👤 2. Get User Profile from Database (Never Trust Client Body)
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User profile not found." });
    }
    const matric = userDoc.data().matric;

    // 📥 3. Check Body Parameters
    const { courseId, pin, lat, lon, accuracy } = req.body;
    if (!courseId || !pin || lat === undefined || lon === undefined) {
      return res.status(400).json({ error: "Missing required check-in fields." });
    }

    // 🎯 4. GPS Accuracy Filter
    if (accuracy !== undefined && accuracy > 50) {
      return res.status(400).json({ error: `GPS accuracy too low (±${Math.round(accuracy)}m). Move to an open space!` });
    }

    // 📚 5. Check Enrollment
    const courseRef = db.collection("courses").doc(courseId);
    const courseDoc = await courseRef.get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: "Course not found." });
    }
    const courseData = courseDoc.data();
    const enrolled = courseData.enrolled || [];
    if (!enrolled.includes(matric)) {
      return res.status(403).json({ error: "You are not enrolled in this course." });
    }

    // ⏱️ 6. Server-Side Session & Expiry Check
    const liveRef = courseRef.collection("session").doc("live");
    const liveDoc = await liveRef.get();
    if (!liveDoc.exists || !liveDoc.data().active) {
      return res.status(404).json({ error: "No active attendance session found." });
    }
    if (Date.now() > liveDoc.data().expiresAt) {
      return res.status(403).json({ error: "Attendance session has expired!" });
    }

    // 🔑 7. PIN Validation
    const secretRef = courseRef.collection("session").doc("secret");
    const secretDoc = await secretRef.get();
    if (!secretDoc.exists) {
      return res.status(404).json({ error: "Session security details missing." });
    }
    const sessionData = secretDoc.data();
    if (String(sessionData.pin) !== String(pin)) {
      return res.status(400).json({ error: "Invalid attendance PIN." });
    }

    // 🚫 8. Duplicate Check
    const currentAttendees = sessionData.attendees || [];
    if (currentAttendees.includes(matric)) {
      return res.status(400).json({ error: "You have already checked in for this session!" });
    }

    // 📍 9. Server Geofence Distance Calculation
    const hallLat = sessionData.lat;
    const hallLon = sessionData.lon;
    let distance = 0;
    if (hallLat !== undefined && hallLon !== undefined) {
      distance = calculateDistance(hallLat, hallLon, lat, lon);
      if (distance > 30) {
        return res.status(403).json({ error: `Too far (~${Math.round(distance)}m). Max radius is 30m.` });
      }
    }

    // ✅ 10. Record Attendance Safely
    await secretRef.update({
      attendees: FieldValue.arrayUnion(matric)
    });

    const sessionTimestamp = liveDoc.data().expiresAt;
    const uniqueAttendanceId = `session_${sessionTimestamp}_${matric}`;
    const attRef = courseRef.collection("attendance").doc(uniqueAttendanceId);
    
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
    return res.status(500).json({ error: "Server error during check-in authorization." });
  }
};