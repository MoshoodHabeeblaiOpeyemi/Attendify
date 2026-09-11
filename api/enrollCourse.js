const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Claude + Gemini Ultimate Initialization
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

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });

    const decoded = await getAuth().verifyIdToken(header.slice(7));

    const { courseCode } = req.body || {};
    const code = String(courseCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!code)
      return res.status(400).json({ error: "Course code is required." });

    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists || !profile.data().matric)
      return res.status(400).json({ error: "Valid user profile required." });

    const matric = String(profile.data().matric).trim().toUpperCase();
    const matches = await db.collection("courses").get();
    const course = matches.docs.find(
      (item) =>
        String(item.data().code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "") === code,
    );

    if (!course)
      return res.status(404).json({ error: "Course code not found." });

    // 🔒 SCHOOL / DEPARTMENT / LEVEL ENCLOSURE: a course belongs to ONE
    // institution • department • level. A student must match all three to join.
    // A course created with "GENERAL" (or empty) for any of these fields is
    // treated as a wildcard — it accepts that dimension from any student, which
    // keeps faculty-wide seminars possible while still blocking cross-colony
    // clashes for courses that DO declare a school, department or level.
    const courseData = course.data();
    const userData = profile.data();
    const norm = (v) => String(v || "").trim().toUpperCase();
    const enclosedMatch = (userV, courseV) => {
      const c = norm(courseV);
      return c === "" || c === "GENERAL" || norm(userV) === c;
    };
    if (
      !enclosedMatch(userData.institution, courseData.institution) ||
      !enclosedMatch(userData.department, courseData.department) ||
      !enclosedMatch(userData.level, courseData.level)
    ) {
      return res.status(403).json({
        error:
          `This course is enclosed for ${courseData.institution || "a specific School"} • ${courseData.department || "a specific Department"} • ${courseData.level || "a specific Level"}. Your profile is ${userData.institution || "?"} • ${userData.department || "?"} • ${userData.level || "?"} — students can only join courses that match their School, Department and Level.`,
      });
    }

    const memberRef = course.ref.collection("members").doc(decoded.uid);

    // 🔒 MATRIC REGISTRY: a student identity = institution + matric. The first
    // uid to claim a given combination owns it forever. This blocks identity
    // theft where an attacker registers with the victim's matric (+ matching
    // institution/department/level) to check in first — the victim would then
    // get "already checked in" for a session they never attended.
    //
    // Firestore rules already lock the matric at profile creation time (it
    // cannot be changed on update), so this claim is the final anchor.
    // The registry is server-written only — clients can never forge a claim.
    const registryInstitution = norm(userData.institution) || "UNKNOWN";
    const registryKey = `${registryInstitution}|${matric}`;
    const registryRef = db.collection("matricRegistry").doc(registryKey);

    // Optional: require email verification (enable via env var). Adds a
    // barrier against scripted signups with throwaway emails.
    if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true") {
      if (!decoded.email_verified) {
        return res.status(403).json({
          error:
            "Please verify your email before enrolling in courses. Check your inbox for the verification link.",
          emailNotVerified: true,
        });
      }
    }

    try {
      await db.runTransaction(async (tx) => {
        // Check if this matric is already claimed by another uid
        const registrySnap = await tx.get(registryRef);
        if (registrySnap.exists && registrySnap.data().uid !== decoded.uid) {
          throw new Error("MATRIC_CLAIMED_BY_ANOTHER");
        }

        // Claim the matric (idempotent merge — safe if same uid re-enrolls)
        tx.set(
          registryRef,
          {
            uid: decoded.uid,
            matric,
            institution: registryInstitution,
            department: norm(userData.department) || null,
            level: norm(userData.level) || null,
            claimedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        // Proceed with enrollment
        const memberSnap = await tx.get(memberRef);
        if (memberSnap.exists) return;

        tx.set(memberRef, {
          uid: decoded.uid,
          matric,
          // Names power the roster, hotspot picker and flag badges — write
          // it at join time so the rep always sees who the student is.
          name: String(userData.name || "").trim() || matric,
          role: "student",
          joinedAt: FieldValue.serverTimestamp(),
        });
        tx.update(course.ref, {
          enrolled: FieldValue.arrayUnion(matric),
        });
      });
    } catch (txError) {
      if (txError.message === "MATRIC_CLAIMED_BY_ANOTHER") {
        return res.status(409).json({
          error: `This matric number (${matric}) is already claimed by another account. If you believe this is an error, contact your course rep or support.`,
          matricClaimed: true,
        });
      }
      throw txError;
    }

    // 🧹 Bulk-import cleanup: reps can pre-load a class list, which creates
    // TEMP placeholder members (ids starting with "temp_") for matrics that
    // have not registered yet. Now that the real student has joined with
    // their proper uid-keyed member doc, remove the placeholder so the
    // roster never shows the same matric twice.
    try {
      const tempSnap = await course.ref
        .collection("members")
        .where("matric", "==", matric)
        .get();
      const staleTemps = tempSnap.docs.filter(
        (d) => d.id !== decoded.uid && d.data().pendingRegistration === true,
      );
      if (staleTemps.length > 0) {
        const cleanup = db.batch();
        staleTemps.forEach((d) => cleanup.delete(d.ref));
        await cleanup.commit();
      }
    } catch (cleanupErr) {
      // Non-fatal — the placeholder is cosmetic clutter, not a security issue.
      console.warn("Temp member cleanup skipped:", cleanupErr.message);
    }

    return res.status(200).json({ success: true, courseId: course.id });
  } catch (error) {
    console.error("Enroll course error:", error);
    // v0's suggestion to send back the actual error string for easier debugging
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
};
