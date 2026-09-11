const { getAppCheck } = require("firebase-admin/app-check");

// 🛡️ App Check verification helper for API endpoints.
//
// SOFT MODE (default): when ENFORCE_APP_CHECK env var is not "true", this
// is a no-op so the app keeps working before App Check is configured.
//
// To enforce: Console → App Check → register the web app (reCAPTCHA v3),
// fill APP_CHECK_SITE_KEY in app.js, and set ENFORCE_APP_CHECK=true.
module.exports = async function verifyAppCheck(req) {
  if (String(process.env.ENFORCE_APP_CHECK || "").toLowerCase() !== "true") {
    return;
  }
  const token = req.headers["x-firebase-appcheck"];
  if (!token) {
    const err = new Error("App Check verification failed: token missing.");
    err.status = 401;
    throw err;
  }
  await getAppCheck().verifyToken(token);
};
