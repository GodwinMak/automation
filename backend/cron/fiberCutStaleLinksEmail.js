/**
 * Escalation email for fiber-cut / mass-outage incidents that have been
 * open more than 12 hours — long enough that it's worth asking the
 * account/NOC teams to check whether the remaining problem is actually on
 * the customer's end rather than the network's.
 *
 * Runs twice daily (09:00 and 16:00 EAT) and sends up to two emails per
 * run — one for FTTH, one for non-FTTH — each with the affected customer
 * list as an Excel attachment. A type with zero qualifying customers that
 * run sends nothing (this is an alert, not a status report).
 *
 * Filtering is per-incident (status="open" AND startedAt more than 12h
 * ago), not per-member downAt — while an incident is still open, a still-
 * down member's downAt tracks the incident's own age anyway, and the
 * incident is what the responsible team acts on. Every incident that gets
 * successfully emailed is then auto-closed with a comment noting it was
 * escalated — the automated system's job ends once the right team has been
 * notified; from there it's on them.
 */
const cron = require("node-cron");
const XLSX = require("xlsx");
const { Op } = require("sequelize");
const db = require("../Models");
const { sendMail } = require("../utils/mailer");
const { closeIncidentRecord } = require("../Controller/fiberCutIncidents");

const MassOutageIncident = db.massOutageIncidents;
const MassOutageIncidentCustomer = db.massOutageIncidentCustomers;

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 hours

const RECIPIENTS = {
  FTTH: {
    to: [
      "oscar.champuku@liquidtech.co.tz",
      "hafsa.renovatho@liquidtech.co.tz",
      "marcelina.john@liquidtech.co.tz",
      "brenda.magege@liquidtech.co.tz",
    ],
    cc: [
      "noc@liquidtech.co.tz",
      "erick.mkinga@liquidtech.co.tz",
      "afka.charles@liquidtech.co.tz",
      "noel.muya@liquidtech.co.tz",
    ],
  },
  NonFTTH: {
    to: ["noc@liquidtech.co.tz"],
    cc: ["erick.mkinga@liquidtech.co.tz", "afka.charles@liquidtech.co.tz", "noel.muya@liquidtech.co.tz"],
  },
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// Open incidents that started 12h+ ago, with their still-down members —
// required:true makes this an inner join, so an incident with zero members
// currently "down" (fully restored but not yet reconciled to "resolved")
// is excluded.
const collectStaleIncidents = async () => {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  return MassOutageIncident.findAll({
    where: { status: "open", startedAt: { [Op.lte]: cutoff } },
    include: [
      {
        model: MassOutageIncidentCustomer,
        as: "members",
        where: { status: "down" },
        required: true,
      },
    ],
  });
};

const buildWorkbookBuffer = (rows) => {
  const excelData = rows.map((r) => ({
    "Customer Name": r.customerName || "Unknown",
    Interface: r.interface,
    Type: r.customerType,
    CID: r.cid || "",
    NBR: r.nbr || "",
    Switch: r.switchName || "",
    "Incident Location": r.incidentLabel,
    "Down Since": new Date(r.downAt).toLocaleString(),
    Downtime: formatDuration(Math.floor((Date.now() - new Date(r.downAt)) / 1000)),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(wb, ws, "Down 12h+");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

const buildSummaryHtml = (rows, serviceLabel) => {
  const tableRows = rows
    .map(
      (r) => `
    <tr>
      <td>${r.customerName || "Unknown"}</td>
      <td>${r.interface}</td>
      <td>${r.nbr || "-"}</td>
      <td>${r.incidentLabel}</td>
      <td>${new Date(r.downAt).toLocaleString()}</td>
      <td>${formatDuration(Math.floor((Date.now() - new Date(r.downAt)) / 1000))}</td>
    </tr>`
    )
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
      <h2>${serviceLabel} — Fiber Cut Incidents Open More Than 12 Hours</h2>
      <p>The following ${rows.length} ${serviceLabel} customer(s) are still down on a fiber cut incident that has been
      open for more than 12 hours. Kindly check with the customer whether there is a problem on their end.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <thead style="background:#f4f4f4;">
          <tr><th>Customer</th><th>Interface</th><th>NBR</th><th>Incident</th><th>Down Since</th><th>Downtime</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="margin-top:16px;">Full list also attached as Excel. This incident has been closed on our side and
      escalated to your team from here.</p>
    </div>
  `;
};

const sendStaleLinksReport = async () => {
  try {
    const incidents = await collectStaleIncidents();
    if (!incidents.length) {
      console.log("[Fiber Cut Stale Links] No incidents open 12h+ with customers still down — skipping.");
      return;
    }

    const dateLabel = new Date().toISOString().slice(0, 10);

    const rowsByIncidentId = new Map();
    const allRows = [];
    for (const incident of incidents) {
      const incidentLabel = incident.nbr || (incident.scope === "GLOBAL" ? "Network-wide" : "Unknown");
      const rows = incident.members.map((m) => ({
        incidentId: incident.id,
        incidentLabel,
        customerName: m.customerName,
        interface: m.interface,
        customerType: m.customerType,
        cid: m.cid,
        nbr: m.nbr,
        switchName: m.switchName,
        downAt: m.downAt,
      }));
      rowsByIncidentId.set(incident.id, rows);
      allRows.push(...rows);
    }

    const segments = {
      FTTH: allRows.filter((m) => m.customerType === "FTTH"),
      NonFTTH: allRows.filter((m) => m.customerType !== "FTTH"),
    };

    const notifiedIncidentIds = new Set();

    for (const [type, rows] of Object.entries(segments)) {
      if (!rows.length) {
        console.log(`[Fiber Cut Stale Links] No ${type} customers on incidents open 12h+ — skipping send.`);
        continue;
      }

      const serviceLabel = type === "FTTH" ? "FTTH" : "Non-FTTH";
      const { to, cc } = RECIPIENTS[type];

      try {
        await sendMail({
          to,
          cc,
          subject: `[Action Needed] ${serviceLabel} incidents open more than 12 hours — ${dateLabel}`,
          html: buildSummaryHtml(rows, serviceLabel),
          attachments: [
            {
              filename: `${type.toLowerCase()}-incidents-12h-${dateLabel}.xlsx`,
              content: buildWorkbookBuffer(rows),
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ],
        });
        console.log(`[Fiber Cut Stale Links] Sent ${serviceLabel} report (${rows.length} customer(s)) to ${to.join(", ")}`);
        rows.forEach((r) => notifiedIncidentIds.add(r.incidentId));
      } catch (sendErr) {
        console.error(`[Fiber Cut Stale Links] Failed to send ${serviceLabel} report:`, sendErr.message);
      }
    }

    // Only close incidents whose escalation email actually went out — a
    // failed send (e.g. SMTP down) should leave the incident open so the
    // next run tries again instead of silently closing an un-notified one.
    for (const incidentId of notifiedIncidentIds) {
      const incident = incidents.find((i) => i.id === incidentId);
      try {
        await closeIncidentRecord(incident, {
          comment: `Auto-closed: customers still down on this incident were escalated to the responsible team after being open more than 12 hours.`,
          closedByName: "Automated Escalation",
        });
        console.log(`[Fiber Cut Stale Links] Closed incident ${incident.id} (${incident.nbr || incident.scope}) after escalation.`);
      } catch (closeErr) {
        console.error(`[Fiber Cut Stale Links] Failed to close incident ${incident.id}:`, closeErr.message);
      }
    }
  } catch (err) {
    console.error("[Fiber Cut Stale Links] Failed to send report:", err.message);
  }
};

const scheduleFiberCutStaleLinksEmail = () => {
  // 09:00 and 16:00 East Africa Time. Server clock runs in UTC (3h behind
  // EAT), so the timezone is pinned explicitly rather than relying on the
  // server's local time — same convention as cron/pitchReportEmail.js.
  cron.schedule(
    "0 9,16 * * *",
    () => {
      sendStaleLinksReport();
    },
    { timezone: "Africa/Dar_es_Salaam" }
  );
  console.log("[Fiber Cut Stale Links] Cron scheduled (daily 09:00 & 16:00 EAT).");
};

module.exports = { scheduleFiberCutStaleLinksEmail, sendStaleLinksReport };
