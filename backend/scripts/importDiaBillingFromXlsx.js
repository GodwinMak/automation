/*
 * One-off import: upsert DIA client billing contacts from an Excel sheet.
 *
 * Why this script:
 * - Controller/client_db.uploadBillingFile bulk-inserts rows and can duplicate CIDs.
 * - This script MATCHES by CID (network_cid) and updates existing records.
 * - By default, it only applies rows whose CID exists in DIA customerinfo.
 *
 * Usage (on remote, from backend/):
 *   node scripts/importDiaBillingFromXlsx.js "/home/automation/DIA_Customers up and down (1).xlsx"
 *
 * Options:
 *   --sheet="Sheet Name"   Use a specific worksheet
 *   --all-sheets           Process every worksheet in the workbook
 *   --dry-run              Preview only, no DB writes
 *   --all-cids             Do not restrict to DIA CIDs
 *   --audit-skipped        Export skipped rows (missing CID / not DIA) to CSV
 *   --skipped-missing-file="/path/file.csv"   Custom path for missing-CID report
 *   --skipped-not-dia-file="/path/file.csv"   Custom path for CID-not-DIA report
 */

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const db = require("../Models");

const ClientDb = db.client_dbs;
const DiaInfo = db.customerinfos;

const args = process.argv.slice(2);

const fileArg = args.find((a) => !a.startsWith("--"));
const sheetArg = args.find((a) => a.startsWith("--sheet="));
const allSheets = args.includes("--all-sheets");
const dryRun = args.includes("--dry-run");
const allCids = args.includes("--all-cids");
const auditNotUpdated = args.includes("--audit-not-updated");
const auditSkipped = args.includes("--audit-skipped");
const reportArg = args.find((a) => a.startsWith("--report-file="));
const skippedMissingArg = args.find((a) => a.startsWith("--skipped-missing-file="));
const skippedNotDiaArg = args.find((a) => a.startsWith("--skipped-not-dia-file="));

if (!fileArg) {
  console.error("Missing Excel path. Example:");
  console.error('node scripts/importDiaBillingFromXlsx.js "./DIA_Customers up and down (1).xlsx"');
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), fileArg);
const sheetNameFromArg = sheetArg ? sheetArg.split("=").slice(1).join("=").replace(/^"|"$/g, "") : null;
const customReportPath = reportArg
  ? path.resolve(process.cwd(), reportArg.split("=").slice(1).join("=").replace(/^"|"$/g, ""))
  : null;
const customSkippedMissingPath = skippedMissingArg
  ? path.resolve(process.cwd(), skippedMissingArg.split("=").slice(1).join("=").replace(/^"|"$/g, ""))
  : null;
const customSkippedNotDiaPath = skippedNotDiaArg
  ? path.resolve(process.cwd(), skippedNotDiaArg.split("=").slice(1).join("=").replace(/^"|"$/g, ""))
  : null;

const norm = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const firstNonEmpty = (obj, keys) => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return null;
};

const normalizeCid = (cid) => String(cid || "").trim();

const normForCompare = (value) => String(value || "").trim().toLowerCase();

const csvEscape = (value) => {
  const s = String(value == null ? "" : value);
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

(async () => {
  let touched = 0;
  let created = 0;
  let updated = 0;
  let skippedNoCid = 0;
  let skippedNotDia = 0;
  let unchanged = 0;
  let rowsRead = 0;
  const perSheet = [];
  const excelContactByCid = new Map();
  const skippedMissingRows = [];
  const skippedNotDiaRows = [];

  try {
    const workbook = XLSX.readFile(filePath);
    const selectedSheets = sheetNameFromArg
      ? [sheetNameFromArg]
      : allSheets
      ? workbook.SheetNames
      : workbook.SheetNames;

    if (sheetNameFromArg && !workbook.SheetNames.includes(sheetNameFromArg)) {
      throw new Error(`Sheet not found: ${sheetNameFromArg}`);
    }

    for (const sheetName of selectedSheets) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      rowsRead += rawRows.length;

      let sheetTouched = 0;
      let sheetCreated = 0;
      let sheetUpdated = 0;
      let sheetUnchanged = 0;
      let sheetSkippedNoCid = 0;
      let sheetSkippedNotDia = 0;

      const diaCidSet = new Set();
      if (!allCids) {
        const diaRows = await DiaInfo.findAll({ attributes: ["cid"], raw: true });
        for (const row of diaRows) {
          const cid = normalizeCid(row.cid);
          if (cid) diaCidSet.add(cid);
        }
      }

      for (const raw of rawRows) {
        const row = {};
        for (const [k, v] of Object.entries(raw)) {
          row[norm(k)] = v;
        }

        const cid = normalizeCid(
          firstNonEmpty(row, [
            "network_cid",
            "cid",
            "customer_cid",
            "circuit_id",
          ])
        );

        if (!cid) {
          skippedNoCid += 1;
          sheetSkippedNoCid += 1;
          if (auditSkipped) {
            skippedMissingRows.push({
              sheetName,
              rowNumber: skippedNoCid + skippedNotDia + touched + unchanged,
              raw: JSON.stringify(raw),
            });
          }
          continue;
        }

        if (!allCids && !diaCidSet.has(cid)) {
          skippedNotDia += 1;
          sheetSkippedNotDia += 1;
          if (auditSkipped) {
            skippedNotDiaRows.push({
              sheetName,
              cid,
              email: firstNonEmpty(row, ["email_address", "email", "e_mail"]) || "",
              phone: firstNonEmpty(row, ["phone_number", "phone", "phone_no", "mobile", "msisdn"]) || "",
              customer_name: firstNonEmpty(row, ["customer_name_pastel", "customer_name", "company_name"]) || "",
              raw: JSON.stringify(raw),
            });
          }
          continue;
        }

        const patch = {
          network_cid: cid,
          email_address: firstNonEmpty(row, ["email_address", "email", "e_mail"]),
          phone_number: firstNonEmpty(row, ["phone_number", "phone", "phone_no", "mobile", "msisdn"]),
          first_name: firstNonEmpty(row, ["first_name", "contact_person", "contact_name", "customer_contact_person"]),
          customer_name_pastel: firstNonEmpty(row, ["customer_name_pastel", "customer_name", "company_name"]),
        };

        // Track only rows that have BOTH email and phone in Excel for mismatch auditing.
        if (patch.email_address && patch.phone_number) {
          excelContactByCid.set(cid, {
            cid,
            sheetName,
            email_address: patch.email_address,
            phone_number: patch.phone_number,
            first_name: patch.first_name || null,
          });
        }

        // Remove nullish keys so we don't overwrite existing data with blanks.
        Object.keys(patch).forEach((k) => {
          if (patch[k] === null || patch[k] === undefined || String(patch[k]).trim() === "") {
            delete patch[k];
          }
        });

        if (Object.keys(patch).length <= 1) {
          // only network_cid present
          unchanged += 1;
          sheetUnchanged += 1;
          continue;
        }

        touched += 1;
        sheetTouched += 1;

        if (dryRun) {
          continue;
        }

        const existing = await ClientDb.findOne({ where: { network_cid: cid } });

        if (!existing) {
          await ClientDb.create(patch);
          created += 1;
          sheetCreated += 1;
        } else {
          const delta = {};
          for (const [k, v] of Object.entries(patch)) {
            if (k === "network_cid") continue;
            if (v !== undefined && v !== null && String(v) !== String(existing[k] || "")) {
              delta[k] = v;
            }
          }

          if (Object.keys(delta).length > 0) {
            await existing.update(delta);
            updated += 1;
            sheetUpdated += 1;
          } else {
            unchanged += 1;
            sheetUnchanged += 1;
          }
        }
      }

      perSheet.push({
        sheetName,
        rows: rawRows.length,
        touched: sheetTouched,
        created: sheetCreated,
        updated: sheetUpdated,
        unchanged: sheetUnchanged,
        skippedNoCid: sheetSkippedNoCid,
        skippedNotDia: sheetSkippedNotDia,
      });
    }

    console.log("\n=== DIA Billing Import Summary ===");
    console.log(`File: ${filePath}`);
    console.log(`Sheets processed: ${selectedSheets.join(", ")}`);
    console.log(`Mode: ${dryRun ? "DRY RUN" : "WRITE"}`);
    console.log(`CID scope: ${allCids ? "ALL CIDs" : "DIA-only"}`);
    console.log(`Rows read: ${rowsRead}`);
    console.log(`Rows with CID and fields to apply: ${touched}`);
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Skipped (missing CID): ${skippedNoCid}`);
    console.log(`Skipped (CID not DIA): ${skippedNotDia}`);

    console.log("\nPer-sheet:");
    for (const s of perSheet) {
      console.log(
        `- ${s.sheetName}: rows=${s.rows}, touched=${s.touched}, created=${s.created}, updated=${s.updated}, unchanged=${s.unchanged}, skippedNoCid=${s.skippedNoCid}, skippedNotDia=${s.skippedNotDia}`
      );
    }

    if (auditNotUpdated) {
      const cids = [...excelContactByCid.keys()];
      const dbRows = cids.length
        ? await ClientDb.findAll({ where: { network_cid: cids }, raw: true })
        : [];
      const dbByCid = new Map(dbRows.map((r) => [normalizeCid(r.network_cid), r]));

      const mismatches = [];
      for (const [cid, excelRow] of excelContactByCid.entries()) {
        const dbRow = dbByCid.get(cid);
        if (!dbRow) {
          mismatches.push({
            cid,
            sheetName: excelRow.sheetName,
            reason: "missing_in_db",
            excel_email: excelRow.email_address,
            excel_phone: excelRow.phone_number,
            db_email: "",
            db_phone: "",
          });
          continue;
        }

        const emailMatch = normForCompare(excelRow.email_address) === normForCompare(dbRow.email_address);
        const phoneMatch = normForCompare(excelRow.phone_number) === normForCompare(dbRow.phone_number);

        if (!emailMatch || !phoneMatch) {
          mismatches.push({
            cid,
            sheetName: excelRow.sheetName,
            reason: !emailMatch && !phoneMatch ? "email_and_phone_mismatch" : !emailMatch ? "email_mismatch" : "phone_mismatch",
            excel_email: excelRow.email_address,
            excel_phone: excelRow.phone_number,
            db_email: dbRow.email_address || "",
            db_phone: dbRow.phone_number || "",
          });
        }
      }

      const reportPath =
        customReportPath ||
        path.join(process.cwd(), "spool", `dia-billing-not-updated-${Date.now()}.csv`);

      const header = [
        "cid",
        "sheetName",
        "reason",
        "excel_email",
        "excel_phone",
        "db_email",
        "db_phone",
      ];

      const csvLines = [header.join(",")];
      for (const row of mismatches) {
        csvLines.push(
          [
            row.cid,
            row.sheetName,
            row.reason,
            row.excel_email,
            row.excel_phone,
            row.db_email,
            row.db_phone,
          ]
            .map(csvEscape)
            .join(",")
        );
      }

      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${csvLines.join("\n")}\n`, "utf8");

      console.log("\nAudit (email+phone in Excel vs DB):");
      console.log(`Excel rows with email+phone (unique CID): ${excelContactByCid.size}`);
      console.log(`Not updated / mismatched in DB: ${mismatches.length}`);
      console.log(`Report file: ${reportPath}`);
    }

    if (auditSkipped) {
      const ts = Date.now();
      const missingPath =
        customSkippedMissingPath ||
        path.join(process.cwd(), "spool", `dia-billing-skipped-missing-cid-${ts}.csv`);
      const notDiaPath =
        customSkippedNotDiaPath ||
        path.join(process.cwd(), "spool", `dia-billing-skipped-not-dia-${ts}.csv`);

      fs.mkdirSync(path.dirname(missingPath), { recursive: true });
      fs.mkdirSync(path.dirname(notDiaPath), { recursive: true });

      const missingHeader = ["sheetName", "rowNumber", "raw"];
      const missingLines = [missingHeader.join(",")];
      for (const row of skippedMissingRows) {
        missingLines.push([
          row.sheetName,
          row.rowNumber,
          row.raw,
        ].map(csvEscape).join(","));
      }

      const notDiaHeader = ["sheetName", "cid", "email", "phone", "customer_name", "raw"];
      const notDiaLines = [notDiaHeader.join(",")];
      for (const row of skippedNotDiaRows) {
        notDiaLines.push([
          row.sheetName,
          row.cid,
          row.email,
          row.phone,
          row.customer_name,
          row.raw,
        ].map(csvEscape).join(","));
      }

      fs.writeFileSync(missingPath, `${missingLines.join("\n")}\n`, "utf8");
      fs.writeFileSync(notDiaPath, `${notDiaLines.join("\n")}\n`, "utf8");

      console.log("\nAudit (skipped rows):");
      console.log(`Skipped missing CID rows: ${skippedMissingRows.length}`);
      console.log(`Skipped CID not DIA rows: ${skippedNotDiaRows.length}`);
      console.log(`Missing CID report: ${missingPath}`);
      console.log(`CID not DIA report: ${notDiaPath}`);
    }

    await db.sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error("Import failed:", error.message || error);
    try {
      await db.sequelize.close();
    } catch (_err) {
      // ignore close errors
    }
    process.exit(1);
  }
})();
