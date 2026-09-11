const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

try {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n",
        ),
      }),
    });
  }
} catch (error) {
  if (!/already exists/.test(error.message)) {
    console.error("Firebase Admin Init Error:", error);
  }
}

const db = getFirestore();

// 🔒 MATRIC REGISTRY — standalone claim endpoint.
//
// A student identity = institution + matric. The first uid to claim a given
// combination owns it forever. This blocks identity theft where an attacker
// registers with the victim's matric to check in first.
//
// Use this endpoint when a user sets/updates their profile matric, or as a
// pre-check before enrollment. The enrollment flow also checks the registry
// as a backstop, but claiming early gives the user immediate feedback if
// their matric is already taken.
//
// The registry is server-written only — clients can never forge a claim.

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });

    const decoded = await getAuth().verifyIdToken(header.slice(7));

    // Optional: require email verification (enable via env var)
    if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true") {
      if (!decoded.email_verified) {
        return res.status(403).json({
          error:
            "Please verify your email before claiming a matric number.",
          emailNotVerified: true,
        });
      }
    }

    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric)
      return res.status(400).json({ error: "Valid user profile with matric required." });

    const norm = (v) => String(v || "").trim().toUpperCase();
    const matric = norm(profile.data().matric);
    const institution = norm(profile.data().institution) || "UNKNOWN";

    const registryKey = `${institution}|${matric}`;
    const registryRef = db.collection("matricRegistry").doc(registryKey);

    try {
      await db.runTransaction(async (tx) => {
        const registrySnap = await tx.get(registryRef);
        if (registrySnap.exists && registrySnap.data().uid !== decoded.uid) {
          throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
        }

        tx.set(
          registryRef,
          {
            uid: decoded.uid,
            matric,
            institution,
            department: norm(profile.data().department) || null,
            level: norm(profile.data().level) || null,
            claimedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    } catch (txError) {
      if (txError.message === "MATRIC_CLAIMED_BY_ANOTHER") {
        return res.status(409).json({
          error: `This matric number (${matric}) is already claimed by another account. If you believe this is an error, contact support.`,
          matricClaimed: true,
        });
      }
      throw txError;
    }

    return res.status(200).json({
      success: true,
      message: `Matric ${matric} is secured to your account.`,
      registryKey,
    });
  } catch (error) {
    console.error("Claim matric error:", error);
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
};
