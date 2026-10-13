/*
 * Enrich Excel rows by CID from DB and add:
 *  - db_cid
 *  - db_exact_name
 *  - db_service_type
 *  - db_capacity
 *  - db_link_status
 *
 * Usage:
 *   node scripts/enrichCidSheetsFromDb.js "./2_Multiple_CID_split.xlsx" "./3_Single_CID.xlsx"
 *
 * Optional:
 *   --out-dir="./spool"
 */

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const db = require("../Models");
const { computeAllL2VPNCircuits } = require("../Controller/l2vpnCircuit");

const args = process.argv.slice(2);
const outDirArg = args.find((a) => a.startsWith("--out-dir="));
let fileArgs = args.filter((a) => !a.startsWith("--"));

// Allow positional output directory as last argument, e.g.:
// node script.js file1.xlsx file2.xlsx .
let positionalOutDir = null;
if (!outDirArg && fileArgs.length >= 2) {
  const last = path.resolve(process.cwd(), fileArgs[fileArgs.length - 1]);
  try {
    if (fs.existsSync(last) && fs.statSync(last).isDirectory()) {
      positionalOutDir = last;
      fileArgs = fileArgs.slice(0, -1);
    }
  } catch (_) {}
}

if (!fileArgs.length) {
  console.error("Provide at least one Excel file path.");
  process.exit(1);
}

const outDir = outDirArg
  ? path.resolve(process.cwd(), outDirArg.split("=").slice(1).join("=").replace(/^"|"$/g, ""))
  : positionalOutDir || process.cwd();

const cidHeaderCandidates = [
  "cid",
  "network_cid",
  "circuit_id",
  "circuit id",
  "virtualcircuitid",
  "virtual circuit id",
];

const normalizeHeader = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeCid = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";

  // Common Excel numeric rendering issue: 2554900405.0 -> 2554900405
  let cleaned = /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;

  cleaned = cleaned.replace(/\s+/g, "").replace(/[-_]/g, "").toUpperCase();

  return cleaned;
};

const cidAliases = (cid) => {
  const n = normalizeCid(cid);
  if (!n) return [];
  const aliases = new Set([n]);

  // Reverse-friendly aliases:
  // 2551901668 <-> LTZ1901668
  // LTZ1901668 <-> 2551901668
  if (/^255\d+$/.test(n)) aliases.add(`LTZ${n.slice(3)}`);
  const ltzMatch = n.match(/^LTZ(\d+)$/);
  if (ltzMatch) aliases.add(`255${ltzMatch[1]}`);

  return [...aliases];
};

const splitCidCandidates = (v) =>
  String(v == null ? "" : v)
    .split(/[;,|\n\r\t]+/)
    .map((x) => normalizeCid(x))
    .filter(Boolean);

const cidTokenRegex = /(LTZ\d+|255\d{5,}|\d{8,})/gi;
const extractCidTokensFromAnyValue = (v) => {
  const s = String(v == null ? "" : v);
  if (!s.trim()) return [];

  const out = new Set();

  // First pass: delimiter-based split
  for (const c of splitCidCandidates(s)) out.add(c);

  // Second pass: regex token harvest inside free text
  const matches = s.match(cidTokenRegex) || [];
  for (const m of matches) {
    const n = normalizeCid(m);
    if (n) out.add(n);
  }

  return [...out];
};

const isCidLikeHeader = (h) => {
  const n = normalizeHeader(h).replace(/\s+/g, "");
  return n.includes("cid") || n.includes("circuitid") || n.includes("virtualcircuitid");
};

const buildCapacity = (serviceType, row) => {
  if (serviceType === "SHARED") return row.capacity ?? null;
  if (serviceType === "L2VPN") {
    if (row.inputMbps != null && row.outputMbps != null) return `${row.inputMbps}/${row.outputMbps}`;
    if (row.outputMbps != null) return row.outputMbps;
    if (row.inputMbps != null) return row.inputMbps;
    return null;
  }
  return row.downmbps ?? row.upmbps ?? null;
};

const toLinkStatus = (value) => {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (s === "up") return "up";
  if (s === "down" || s === "mixed") return "down";
  return "unknown";
};

const matchQualityScore = (m) =>
  (m.db_exact_name ? 2 : 0) +
  (m.db_capacity !== null && m.db_capacity !== undefined && String(m.db_capacity) !== "" ? 2 : 0) +
  (m.db_link_status && m.db_link_status !== "unknown" ? 1 : 0);

const pickBestMatch = (matches) => {
  if (!matches.length) return null;

  // Prefer a match that has both name and capacity.
  const scored = matches
    .map((m) => {
      const score = matchQualityScore(m);
      return { ...m, __score: score };
    })
    .sort((a, b) => b.__score - a.__score);

  return scored[0];
};

const findMatchesByCid = (rowCids, matchesByCid) => {
  if (!rowCids.length) return [];

  // 1) Exact/alias match first
  for (const rawCid of rowCids) {
    for (const alias of cidAliases(rawCid)) {
      const m = matchesByCid.get(alias);
      if (m && m.length) return m;
    }
  }

  return [];
};

(async () => {
  try {
    const [dia, ipt, shared, l3vpn, diaLinks, iptLinks, sharedLinks, l3vpnLinks] = await Promise.all([
      db.customerinfos.findAll({ attributes: ["cid", "interface", "customerName", "downmbps", "upmbps"], raw: true }),
      db.iptcustomerinfos.findAll({ attributes: ["cid", "interface", "customerName", "downmbps", "upmbps"], raw: true }),
      db.sharedcustomerinfos.findAll({ attributes: ["cid", "interface", "customerName", "capacity"], raw: true }),
      db.l3vpncustomerinfos.findAll({ attributes: ["cid", "interface", "customerName", "downmbps", "upmbps"], raw: true }),
      db.diacustomers.findAll({ attributes: ["interface", "operationalStatus"], raw: true }),
      db.iptcustomers.findAll({ attributes: ["interface", "operationalStatus"], raw: true }),
      db.sharedcustomers.findAll({ attributes: ["interface", "operationalStatus"], raw: true }),
      db.l3vpncustomers.findAll({ attributes: ["interface", "operationalStatus"], raw: true }),
    ]);

    const diaStatusByInterface = new Map(diaLinks.map((r) => [r.interface, toLinkStatus(r.operationalStatus)]));
    const iptStatusByInterface = new Map(iptLinks.map((r) => [r.interface, toLinkStatus(r.operationalStatus)]));
    const sharedStatusByInterface = new Map(sharedLinks.map((r) => [r.interface, toLinkStatus(r.operationalStatus)]));
    const l3vpnStatusByInterface = new Map(l3vpnLinks.map((r) => [r.interface, toLinkStatus(r.operationalStatus)]));

    // Keep L2VPN in sync with the page/controller behavior.
    // Primary source: computeAllL2VPNCircuits (same as /l2vpncircuits page).
    // Fallback: raw l2vpncircuits tables if compute fails.
    let l2vpnCidRows = [];
    try {
      const computedCircuits = await computeAllL2VPNCircuits();
      const bestByVcid = new Map();

      for (const circuit of computedCircuits || []) {
        for (const hop of circuit.hops || []) {
          const vcid = hop?.virtualCircuitId;
          if (!vcid) continue;

          const candidate = {
            virtualCircuitId: vcid,
            customerName: circuit.customerName || hop.customerName || "",
            inputMbps: hop.inputMbps ?? null,
            outputMbps: hop.outputMbps ?? null,
            linkStatus: toLinkStatus(circuit.overallOperationalStatus || hop.operationalStatus),
          };

          const prev = bestByVcid.get(vcid);
          const score =
            (candidate.customerName ? 2 : 0) +
            ((candidate.inputMbps != null || candidate.outputMbps != null) ? 2 : 0);
          const prevScore = prev
            ? (prev.customerName ? 2 : 0) + ((prev.inputMbps != null || prev.outputMbps != null) ? 2 : 0)
            : -1;

          if (!prev || score > prevScore) bestByVcid.set(vcid, candidate);
        }
      }

      l2vpnCidRows = [...bestByVcid.values()];
    } catch (err) {
      const [l2interfaces, l2circuits] = await Promise.all([
        db.l2vpninterfaces.findAll({ attributes: ["id", "customerName"], raw: true }),
        db.l2vpncircuits.findAll({ attributes: ["l2vpnInterfaceId", "virtualCircuitId", "inputMbps", "outputMbps"], raw: true }),
      ]);
      const l2NameByInterfaceId = new Map(l2interfaces.map((r) => [r.id, r.customerName || null]));
      l2vpnCidRows = l2circuits.map((r) => ({
        virtualCircuitId: r.virtualCircuitId,
        customerName: l2NameByInterfaceId.get(r.l2vpnInterfaceId) || "",
        inputMbps: r.inputMbps ?? null,
        outputMbps: r.outputMbps ?? null,
        linkStatus: "unknown",
      }));
    }

    const matchesByCid = new Map();
    const dbRowsByCid = new Map();
    const addMatch = (cid, match) => {
      const keys = cidAliases(cid);
      for (const k of keys) {
        if (!matchesByCid.has(k)) matchesByCid.set(k, []);
        matchesByCid.get(k).push(match);
      }

      const canonicalCid = normalizeCid(match.db_cid || cid);
      if (canonicalCid) {
        const nextRow = {
          db_cid: match.db_cid || "",
          db_exact_name: match.db_exact_name || "",
          db_service_type: match.db_service_type || "",
          db_capacity: match.db_capacity ?? "",
          db_link_status: match.db_link_status || "unknown",
        };
        const prevRow = dbRowsByCid.get(canonicalCid);
        if (!prevRow || matchQualityScore(nextRow) > matchQualityScore(prevRow)) {
          dbRowsByCid.set(canonicalCid, nextRow);
        }
      }
    };

    for (const r of dia) {
      addMatch(r.cid, {
        db_cid: r.cid || "",
        db_exact_name: r.customerName || "",
        db_service_type: "DIA",
        db_capacity: buildCapacity("DIA", r),
        db_link_status: diaStatusByInterface.get(r.interface) || "unknown",
      });
    }
    for (const r of ipt) {
      addMatch(r.cid, {
        db_cid: r.cid || "",
        db_exact_name: r.customerName || "",
        db_service_type: "IPT",
        db_capacity: buildCapacity("IPT", r),
        db_link_status: iptStatusByInterface.get(r.interface) || "unknown",
      });
    }
    for (const r of shared) {
      addMatch(r.cid, {
        db_cid: r.cid || "",
        db_exact_name: r.customerName || "",
        db_service_type: "SHARED",
        db_capacity: buildCapacity("SHARED", r),
        db_link_status: sharedStatusByInterface.get(r.interface) || "unknown",
      });
    }
    for (const r of l3vpn) {
      addMatch(r.cid, {
        db_cid: r.cid || "",
        db_exact_name: r.customerName || "",
        db_service_type: "L3VPN",
        db_capacity: buildCapacity("L3VPN", r),
        db_link_status: l3vpnStatusByInterface.get(r.interface) || "unknown",
      });
    }
    for (const r of l2vpnCidRows) {
      addMatch(r.virtualCircuitId, {
        db_cid: r.virtualCircuitId || "",
        db_exact_name: r.customerName || "",
        db_service_type: "L2VPN",
        db_capacity: buildCapacity("L2VPN", r),
        db_link_status: r.linkStatus || "unknown",
      });
    }

    console.log("CID index built:", {
      dia: dia.length,
      ipt: ipt.length,
      shared: shared.length,
      l3vpn: l3vpn.length,
      l2vpnCircuits: l2vpnCidRows.length,
      cidKeys: matchesByCid.size,
    });

    // Track all CIDs discovered in input excel files (normalized aliases),
    // so we can later output DB CIDs that are missing from the input.
    const excelSeenCids = new Set();

    for (const rawFile of fileArgs) {
      const filePath = path.resolve(process.cwd(), rawFile);
      const wb = XLSX.readFile(filePath);
      const outWb = XLSX.utils.book_new();

      let totalRows = 0;
      let matchedRows = 0;
      let rowsWithAnyCidCandidate = 0;

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

        if (!rows.length) {
          const emptyWs = XLSX.utils.json_to_sheet([]);
          XLSX.utils.book_append_sheet(outWb, emptyWs, sheetName);
          continue;
        }

        const headerMap = new Map();
        for (const key of Object.keys(rows[0])) {
          headerMap.set(normalizeHeader(key), key);
        }

        const cidKeys = [];
        for (const candidate of cidHeaderCandidates) {
          const actual = headerMap.get(normalizeHeader(candidate));
          if (actual && !cidKeys.includes(actual)) cidKeys.push(actual);
        }

        if (!cidKeys.length) {
          for (const key of Object.keys(rows[0])) {
            if (isCidLikeHeader(key) && !cidKeys.includes(key)) cidKeys.push(key);
          }
        }

        const enriched = rows.map((row) => {
          totalRows += 1;
          let rowCids = cidKeys.length
            ? cidKeys.flatMap((k) => splitCidCandidates(row[k]))
            : [];

          // Fallback: if header-driven CID extraction yields nothing,
          // scan every cell value in the row for CID-like tokens.
          if (!rowCids.length) {
            const fromAnyCell = [];
            for (const v of Object.values(row)) {
              fromAnyCell.push(...extractCidTokensFromAnyValue(v));
            }
            rowCids = [...new Set(fromAnyCell)];
          }

          for (const raw of rowCids) {
            for (const alias of cidAliases(raw)) {
              excelSeenCids.add(alias);
            }
          }

          if (rowCids.length) rowsWithAnyCidCandidate += 1;

          const matches = findMatchesByCid(rowCids, matchesByCid);

          const best = pickBestMatch(matches);

          if (best) matchedRows += 1;

          return {
            ...row,
            db_cid: best?.db_cid || "",
            db_exact_name: best?.db_exact_name || "",
            db_service_type: best?.db_service_type || "",
            db_capacity: best?.db_capacity ?? "",
            db_link_status: best?.db_link_status || "unknown",
          };
        });

        const outSheet = XLSX.utils.json_to_sheet(enriched);
        XLSX.utils.book_append_sheet(outWb, outSheet, sheetName);
      }

      const parsed = path.parse(filePath);
      const outPath = path.join(outDir, `${parsed.name}_enriched${parsed.ext || ".xlsx"}`);
      XLSX.writeFile(outWb, outPath);

      console.log(`\nFile: ${filePath}`);
      console.log(`Output: ${outPath}`);
      console.log(`Rows processed: ${totalRows}`);
      console.log(`Rows with CID candidate: ${rowsWithAnyCidCandidate}`);
      console.log(`Rows matched by CID: ${matchedRows}`);
      console.log(`Rows not matched: ${totalRows - matchedRows}`);
    }

    // Build a de-duplicated list of DB CIDs not present in any input Excel.
    const dbOnlyRows = [];
    for (const [canonicalCid, row] of dbRowsByCid.entries()) {
      const aliases = cidAliases(canonicalCid);
      const existsInExcel = aliases.some((a) => excelSeenCids.has(a));
      if (!existsInExcel) dbOnlyRows.push(row);
    }

    dbOnlyRows.sort((a, b) => String(a.db_cid).localeCompare(String(b.db_cid)));

    const missingOutPath = path.join(outDir, "db_cids_not_in_input.xlsx");
    const missingWb = XLSX.utils.book_new();
    const missingSheet = XLSX.utils.json_to_sheet(dbOnlyRows);
    XLSX.utils.book_append_sheet(missingWb, missingSheet, "db_only");
    XLSX.writeFile(missingWb, missingOutPath);

    console.log(`\nDB-only CID report: ${missingOutPath}`);
    console.log(`DB-only unique CIDs: ${dbOnlyRows.length}`);

    process.exit(0);
  } catch (err) {
    console.error("Failed to enrich CID sheets:", err);
    process.exit(1);
  }
})();
