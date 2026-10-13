#!/usr/bin/env node
/**
 * winback.js — find "winback" FTTH clients:
 *   paid in the CURRENT month, but their previous payment before that
 *   was more than N months earlier (default N=3, i.e. gap >= 4 months).
 *
 * Sources:
 *   - Payments file  -> authoritative transaction history (who paid, when)
 *   - Revenue file   -> customer master data (package, phone, address) for enrichment
 *
 * Usage:
 *   node winback.js <PaymentsFile.xlsx> <RevenueFile.xlsx> [options]
 *
 * Options:
 *   --month=YYYY-MM      Current month to check (default: system current month)
 *   --min-gap=N           Minimum months since last payment to qualify (default: 3)
 *   --include-new          Also include customers with NO payment before this month
 *                           (i.e. first-ever payment). Off by default.
 *   --out=path.csv          Output CSV path (default: ./winback_clients.csv)
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// ---------- CLI args ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const paymentsPath = args._[0];
const revenuePath = args._[1];

if (!paymentsPath || !revenuePath) {
  console.error('Usage: node winback.js <PaymentsFile.xlsx> <RevenueFile.xlsx> [--month=YYYY-MM] [--min-gap=3] [--include-new] [--out=file.csv]');
  process.exit(1);
}

const minGap = args['min-gap'] ? parseInt(args['min-gap'], 10) : 3;
const includeNew = !!args['include-new'];
const outPath = args.out || path.join(process.cwd(), 'winback_clients.csv');

let currentYear, currentMonth; // currentMonth is 1-12
if (args.month) {
  const [y, m] = args.month.split('-').map(Number);
  currentYear = y;
  currentMonth = m;
} else {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;
}
const currentKey = currentYear * 12 + currentMonth;

// ---------- helpers ----------
function parseDate(v) {
  if (!v) return null;
  // handles "7/29/26 0:00" and ISO-ish strings
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

function monthKey(d) {
  return d.getFullYear() * 12 + (d.getMonth() + 1);
}

function readRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
}

// ---------- 1. Load Payments file (transaction history) ----------
// Layout: col0=Customer ID, col4=Amount, col7=Reference Number, col12=Paid Date,
//         col14=First Name, col16=Last Name. Data starts after the header row
//         ("Customer ID" in col0); blank rows separate records.
const paymentRows = readRows(paymentsPath);

/** customerId -> [{date, amount, ref}] */
const paymentHistory = new Map();
/** customerId -> {firstName, lastName} */
const namesFromPayments = new Map();

for (const row of paymentRows) {
  const custId = row[0];
  if (!custId || custId === 'Customer ID') continue; // skip blanks/header
  const amountRaw = row[4];
  const ref = row[7];
  const paidDate = parseDate(row[12]);
  const firstName = row[14] || '';
  const lastName = row[16] || '';
  if (!paidDate) continue;

  const amount = Math.abs(parseFloat(String(amountRaw).replace(/[(),$]/g, '')) || 0);

  if (!paymentHistory.has(custId)) paymentHistory.set(custId, []);
  paymentHistory.get(custId).push({ date: paidDate, amount, ref });
  if (!namesFromPayments.has(custId)) namesFromPayments.set(custId, { firstName, lastName });
}

// ---------- 2. Load Revenue file (customer master for enrichment) ----------
// Layout: col1=Customer ID, col2=Package, col3=Amount, col4=Duration/Type,
//         col6=Payment Date, col8=First Name, col12=Last Name, col14=Address,
//         col16=Address-2, col18=Phone No.
const revenueRows = readRows(revenuePath);

/** customerId -> latest master record */
const customerMaster = new Map();

for (const row of revenueRows) {
  const custId = row[1];
  if (!custId || custId === 'Customer ID') continue;
  const pkg = row[2] || '';
  const payDate = parseDate(row[6]);
  const firstName = row[8] || '';
  const lastName = row[12] || '';
  const address = [row[14], row[16]].filter(Boolean).join(', ');
  const phone = row[18] || '';

  const existing = customerMaster.get(custId);
  if (!existing || (payDate && (!existing.payDate || payDate > existing.payDate))) {
    customerMaster.set(custId, { package: pkg, firstName, lastName, address, phone, payDate });
  }
}

// ---------- 3. Compute winback clients ----------
const results = [];

for (const [custId, history] of paymentHistory.entries()) {
  const thisMonthPayments = history.filter((p) => monthKey(p.date) === currentKey);
  if (thisMonthPayments.length === 0) continue; // didn't pay this month at all

  const priorPayments = history.filter((p) => monthKey(p.date) < currentKey);

  let lastPriorPayment = null;
  if (priorPayments.length > 0) {
    lastPriorPayment = priorPayments.reduce((a, b) => (a.date > b.date ? a : b));
  }

  if (!lastPriorPayment) {
    if (!includeNew) continue; // no payment history at all before this month -> treat as new, skip
  }

  const gapMonths = lastPriorPayment ? currentKey - monthKey(lastPriorPayment.date) : null;

  if (lastPriorPayment && gapMonths <= minGap) continue; // paid recently enough, not a winback

  const paidThisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  const latestThisMonth = thisMonthPayments.reduce((a, b) => (a.date > b.date ? a : b));
  const name = namesFromPayments.get(custId) || {};
  const master = customerMaster.get(custId) || {};

  results.push({
    customerId: custId,
    firstName: name.firstName || master.firstName || '',
    lastName: name.lastName || master.lastName || '',
    package: master.package || '',
    phone: master.phone || '',
    address: master.address || '',
    paidThisMonth,
    thisMonthPaidDate: latestThisMonth.date.toISOString().slice(0, 10),
    lastPriorPaymentDate: lastPriorPayment ? lastPriorPayment.date.toISOString().slice(0, 10) : 'NEVER',
    monthsSinceLastPayment: gapMonths === null ? 'N/A (new)' : gapMonths,
  });
}

// sort worst gap first
results.sort((a, b) => {
  const ag = typeof a.monthsSinceLastPayment === 'number' ? a.monthsSinceLastPayment : 999;
  const bg = typeof b.monthsSinceLastPayment === 'number' ? b.monthsSinceLastPayment : 999;
  return bg - ag;
});

// ---------- 4. Output CSV ----------
const headers = [
  'customerId', 'firstName', 'lastName', 'package', 'phone', 'address',
  'paidThisMonth', 'thisMonthPaidDate', 'lastPriorPaymentDate', 'monthsSinceLastPayment',
];
const csvLines = [headers.join(',')];
for (const r of results) {
  csvLines.push(headers.map((h) => {
    const v = r[h] === undefined || r[h] === null ? '' : String(r[h]);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','));
}
fs.writeFileSync(outPath, csvLines.join('\n'));

console.log(`Current month checked : ${currentYear}-${String(currentMonth).padStart(2, '0')}`);
console.log(`Min gap to qualify    : > ${minGap} months since last payment`);
console.log(`Winback clients found : ${results.length}`);
console.log(`Output written to     : ${outPath}`);
