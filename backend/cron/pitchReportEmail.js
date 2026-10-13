/**
 * Daily "Pitch for Upgrade" report — emails an Excel export + summary of
 * every customer flagged by the most recent run of
 * cron/pitchForUpgradeChecker.js (which runs daily at 02:00) to
 * REPORT_RECIPIENTS.
 *
 * Only the latest run's rows are reported — no multi-day aggregation.
 */
const cron = require("node-cron");
const XLSX = require("xlsx");
const { Op } = require("sequelize");
const db = require("../Models");
const { sendMail } = require("../utils/mailer");

const REPORT_RECIPIENTS = ["lidya.mgeni@liquidtech.co.tz", "erick.mkinga@liquidtelecom.co.tz", "zahid@liquidtelecom.co.tz"];

const buildWorkbookBuffer = (rows) => {
  const excelData = rows.map((r) => ({
    "Customer Name": r.customerName,
    Interface: r.interfaceName,
    CID: r.cid,
    NBR: r.nbr,
    Port: r.port,
    "Up Mbps": r.upmbps,
    "Down Mbps": r.downmbps,
    "% Over 95% (Upload)": r.pctOver95Upload,
    "% Over 95% (Download)": r.pctOver95Download,
    "Flagged At": r.runAt,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(wb, ws, "Pitch For Upgrade");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

const buildSummaryHtml = (rows, runDate) => {
  const total = rows.length;

  const top10 = [...rows]
    .sort((a, b) => Math.max(b.pctOver95Upload, b.pctOver95Download) - Math.max(a.pctOver95Upload, a.pctOver95Download))
    .slice(0, 10);
  const topRowsHtml = top10
    .map(
      (r) => `
    <tr>
      <td>${r.customerName || "-"}</td>
      <td>${r.interfaceName || "-"}</td>
      <td>${r.cid || "-"}</td>
      <td>${r.upmbps ?? "-"}</td>
      <td>${r.downmbps ?? "-"}</td>
      <td>${r.pctOver95Upload}%</td>
      <td>${r.pctOver95Download}%</td>
    </tr>`
    )
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
      <h2>Pitch-for-Upgrade Report</h2>
      <p>Run date: <strong>${runDate.toLocaleDateString()}</strong></p>
      <ul>
        <li>Customers currently flagged: <strong>${total}</strong></li>
      </ul>
      ${
        total
          ? `<p>Top ${top10.length} customers by peak utilization:</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <thead style="background:#f4f4f4;">
          <tr><th>Customer</th><th>Interface</th><th>CID</th><th>Up Mbps</th><th>Down Mbps</th><th>% Up &gt;95%</th><th>% Down &gt;95%</th></tr>
        </thead>
        <tbody>${topRowsHtml}</tbody>
      </table>
      <p style="margin-top:16px;">Full list of ${total} customers attached as Excel.</p>`
          : `<p>No customers are currently flagged as needing an upgrade.</p>`
      }
    </div>
  `;
};

const sendPitchReport = async () => {
  try {
    const latest = await db.pitchForUpgradeReports.findOne({
      order: [["runAt", "DESC"]],
      attributes: ["runAt"],
    });
    if (!latest) {
      console.log("[Pitch Report Email] No pitch-for-upgrade data found — skipping send.");
      return;
    }

    const runDate = new Date(latest.runAt);
    const dayStart = new Date(runDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(runDate);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await db.pitchForUpgradeReports.findAll({
      where: { runAt: { [Op.between]: [dayStart, dayEnd] } },
      raw: true,
    });

    const dateLabel = runDate.toISOString().slice(0, 10);
    const html = buildSummaryHtml(rows, runDate);
    const attachments = rows.length
      ? [
          {
            filename: `pitch-for-upgrade-${dateLabel}.xlsx`,
            content: buildWorkbookBuffer(rows),
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ]
      : [];

    await sendMail({
      to: REPORT_RECIPIENTS,
      subject: `Pitch-for-Upgrade Report — ${dateLabel}`,
      html,
      attachments,
    });

    console.log(`[Pitch Report Email] Sent report (${rows.length} flagged customers, run date ${dateLabel}) to ${REPORT_RECIPIENTS.join(", ")}`);
  } catch (err) {
    console.error("[Pitch Report Email] Failed to send report:", err.message);
  }
};

const schedulePitchReport = () => {
  // Every day at 08:00 East Africa Time. Server clock runs in UTC (3h
  // behind EAT), so the timezone is pinned explicitly rather than using
  // "0 8 * * *" against the server's local time.
  cron.schedule(
    "0 5 * * *",
    () => {
      sendPitchReport();
    },
    { timezone: "Africa/Dar_es_Salaam" }
  );
  console.log("[Pitch Report Email] Cron scheduled (daily 08:00 EAT).");
};

module.exports = { schedulePitchReport, sendPitchReport };
