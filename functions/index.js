/* eslint-disable */
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.submitAttendance = onRequest({cors: true}, async (req, res) => {
  try {
    const {courseId, pin, lat, lon, uid, matric} = req.body;

    if (!uid || !matric) {
      return res.status(401).json({error: "Unauthorized credentials."});
    }

    const secretRef = db.doc(`courses/${courseId}/session/secret`);
    const secretSnap = await secretRef.get();
    if (!secretSnap.exists) {
      return res.status(400).json({error: "No active session found."});
    }
    const session = secretSnap.data();

    const liveSnap = await db.doc(`courses/${courseId}/session/live`).get();
    if (!liveSnap.exists || Date.now() > liveSnap.data().expiresAt) {
      return res.status(400).json({error: "Session expired."});
    }

    if (session.pin !== pin) {
      return res.status(400).json({error: "Incorrect PIN code."});
    }

    if ((session.attendees || []).includes(matric)) {
      return res.status(400).json({error: "Already checked in."});
    }

    const distance = haversineMeters(lat, lon, session.lat, session.lon);
    if (distance > 30) {
      return res.status(400).json({
        error: `Too far (~${Math.round(distance)}m away).`,
      });
    }

    await secretRef.update({
      attendees: admin.firestore.FieldValue.arrayUnion(matric),
    });

    return res.status(200).json({success: true, distance: Math.round(distance)});
  } catch (err) {
    console.error(err);
    return res.status(500).json({error: err.message});
  }
});