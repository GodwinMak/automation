/**
 * One-off trigger for cron/pitchReportEmail.js — sends the
 * pitch-for-upgrade report immediately instead of waiting for the
 * daily 08:00 schedule. Useful for testing the email/Excel output.
 *
 * Usage (from backend/): node scripts/sendPitchReportEmailNow.js
 */
const { sendPitchReport } = require("../cron/pitchReportEmail");

sendPitchReport()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
