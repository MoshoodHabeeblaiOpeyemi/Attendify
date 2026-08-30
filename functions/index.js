const {onRequest} = require(
    "firebase-functions/v2/https"
);
const logger = require(
    "firebase-functions/logger"
);
const {initializeApp} = require(
    "firebase-admin/app"
);
const {
  getFirestore, 
  FieldValue
} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

/**
 * Calculate distance between two lat/lng coordinates in meters.
 * @param {number} lat1 Latitude 1
 * @param {number} lon1 Longitude 1
 * @param {number} lat2 Latitude 2
 * @param {number} lon2 Longitude 2
 * @return {number} Distance in meters
 */
function calculateDistance(
    lat1, lon1, lat2, lon2
) {
  const R = 6371e3;
  const toRad = (angle) => 
    (angle * Math.PI) / 180;
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * 
    Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * 
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * 
    Math.sin(dLon / 2);
    
  const c = 2 * Math.atan2(
    Math.sqrt(a), 
    Math.sqrt(1 - a)
  );
  return R * c;
}

exports.submitAttendance = onRequest(
    {cors: true}, 
    async (req, res) => {
      try {
        const {
          courseId,
          pin,
          lat,
          lon,
          uid,
          matric,
        } = req.body;

        if (
          !courseId ||
          !pin ||
          lat === undefined ||
          lon === undefined ||
          !uid ||
          !matric
        ) {
          return res.status(400).json({
            error: "Missing required fields.",
          });
        }

        const secretRef = db
            .collection("courses")
            .doc(courseId)
            .collection("session")
            .doc("secret");
            
        const secretDoc = await secretRef.get();

        if (!secretDoc.exists) {
          return res.status(404).json({
            error: "No active attendance session found.",
          });
        }

        const sessionData = secretDoc.data();

        if (String(sessionData.pin) !== String(pin)) {
          return res.status(400).json({
            error: "Invalid attendance PIN.",
          });
        }

        const hallLat = sessionData.lat;
        const hallLon = sessionData.lon;
        let distance = 0;

        if (hallLat !== undefined && hallLon !== undefined) {
          distance = calculateDistance(
              hallLat, 
              hallLon, 
              lat, 
              lon
          );
          if (distance > 30) {
            return res.status(403).json({
              error: `Too far (~${Math.round(distance)}m). Max is 30m.`,
            });
          }
        }

        await secretRef.update({
          attendees: FieldValue.arrayUnion(matric),
        });

        const attRef = db
            .collection("courses")
            .doc(courseId)
            .collection("attendance")
            .doc(`session_${matric}`);

        await attRef.set({
          uid,
          matric,
          timestamp: FieldValue.serverTimestamp(),
          status: "Present",
          location: {lat, lon},
          distance: Math.round(distance),
        });

        return res.status(200).json({
          success: true,
          message: "Attendance marked successfully!",
          distance: Math.round(distance),
        });
      } catch (error) {
        logger.error("Submit Attendance Error:", error);
        return res.status(500).json({
          error: "Server error during check-in.",
        });
      }
    }
);