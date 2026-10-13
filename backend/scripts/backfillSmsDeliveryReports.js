/**
 * One-off backfill: seed smsDeliveryReport rows for SMS campaigns sent
 * before per-recipient delivery tracking existed, so the Delivery Report
 * page works for historical campaigns too, not just future ones.
 *
 * Best-effort identity recovery by phone number:
 *   - FTTH: ftthcustomers.homeNumber -> customerID/customerName
 *   - DIA/IPT/Shared/L3VPN: client_dbs.phone_number -> network_cid,
 *     matched against each type's info table by cid
 * Numbers that don't match anything are still seeded (phoneNumber only, no
 * customer identity) — the DLR checker cron job will resolve their
 * delivered/not_delivered/unknown status regardless.
 *
 * Usage (from backend/): node scripts/backfillSmsDeliveryReports.js
 */
const db = require("../Models");
const { Op } = require("sequelize");

const buildFtthLookup = async () => {
  const rows = await db.ftthcustomers.findAll({
    attributes: ["customerID", "customerName", "homeNumber"],
    where: { homeNumber: { [Op.ne]: null } },
    raw: true,
  });
  const map = new Map();
  for (const r of rows) {
    if (r.homeNumber && !map.has(r.homeNumber)) {
      map.set(r.homeNumber, { customerId: r.customerID, customerName: r.customerName, customerType: "FTTH" });
    }
  }
  return map;
};

const NON_FTTH_INFO_MODELS = [
  { model: db.customerinfos, type: "DIA" },
  { model: db.iptcustomerinfos, type: "IPT" },
  { model: db.sharedcustomerinfos, type: "SHARED" },
  { model: db.l3vpncustomerinfos, type: "L3VPN" },
];

const buildNonFtthLookup = async () => {
  const clientDbs = await db.client_dbs.findAll({
    attributes: ["network_cid", "phone_number"],
    where: { phone_number: { [Op.ne]: null } },
    raw: true,
  });
  const cidByPhone = new Map();
  for (const c of clientDbs) {
    if (c.phone_number && !cidByPhone.has(c.phone_number)) cidByPhone.set(c.phone_number, c.network_cid);
  }

  const nameByTypeAndCid = new Map(); // `${type}:${cid}` -> customerName
  for (const { model, type } of NON_FTTH_INFO_MODELS) {
    const rows = await model.findAll({
      attributes: ["cid", "customerName"],
      where: { cid: { [Op.ne]: null } },
      raw: true,
    });
    for (const r of rows) {
      if (r.cid) nameByTypeAndCid.set(`${type}:${r.cid}`, r.customerName);
    }
  }

  const map = new Map(); // phoneNumber -> identity
  for (const [phone, cid] of cidByPhone.entries()) {
    for (const { type } of NON_FTTH_INFO_MODELS) {
      const name = nameByTypeAndCid.get(`${type}:${cid}`);
      if (name) {
        map.set(phone, { customerId: cid, customerName: name, customerType: type });
        break;
      }
    }
  }
  return map;
};

const run = async () => {
  await db.sequelize.authenticate();
  console.log("[Backfill] Connected. Building identity lookups...");

  const ftthLookup = await buildFtthLookup();
  const nonFtthLookup = await buildNonFtthLookup();
  console.log(`[Backfill] FTTH lookup: ${ftthLookup.size} numbers. Non-FTTH lookup: ${nonFtthLookup.size} numbers.`);

  const campaigns = await db.smsCampaigns.findAll();
  console.log(`[Backfill] ${campaigns.length} campaign(s) to check.`);

  let totalCreated = 0;
  let campaignsTouched = 0;

  for (const campaign of campaigns) {
    const chunks = campaign.chunks || [];
    const expectedNumbers = chunks.flatMap((c) => c.numbers || []);
    if (expectedNumbers.length === 0) continue;

    const existing = await db.smsDeliveryReports.findAll({
      where: { campaignId: campaign.id },
      attributes: ["phoneNumber"],
      raw: true,
    });
    const existingPhones = new Set(existing.map((r) => r.phoneNumber));
    if (existingPhones.size >= expectedNumbers.length) continue; // already fully seeded

    const rowsToCreate = [];
    for (const chunk of chunks) {
      for (const number of chunk.numbers || []) {
        if (existingPhones.has(number)) continue;
        existingPhones.add(number); // guard against duplicate numbers across chunks
        const identity = ftthLookup.get(number) || nonFtthLookup.get(number) || {};
        rowsToCreate.push({
          campaignId: campaign.id,
          customerId: identity.customerId || null,
          customerName: identity.customerName || null,
          customerType: identity.customerType || campaign.customerType || null,
          phoneNumber: number,
          requestId: chunk.requestId || null,
          status: chunk.requestId ? "pending" : "unknown",
        });
      }
    }

    if (rowsToCreate.length > 0) {
      await db.smsDeliveryReports.bulkCreate(rowsToCreate);
      totalCreated += rowsToCreate.length;
      campaignsTouched += 1;
      console.log(`[Backfill] Campaign ${campaign.id}: seeded ${rowsToCreate.length} row(s).`);
    }
  }

  console.log(`[Backfill] Done. ${campaignsTouched} campaign(s) touched, ${totalCreated} row(s) created.`);
  process.exit(0);
};

run().catch((err) => {
  console.error("[Backfill] Failed:", err);
  process.exit(1);
});
