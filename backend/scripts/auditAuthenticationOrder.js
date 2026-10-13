/**
 * Audit switch configs for `system authentication-order` entries that still
 * allow local/tacplus fallback instead of radius-only. Reads every .txt file
 * in backend/SwitchConfigs (the snapshots produced by
 * cron/switchConfiguration.js, equivalent to running
 * `show configuration | display set | match order` on each device) and
 * reports any device whose authentication-order includes "tacplus" and/or
 * "password".
 *
 * Usage (from backend/): node scripts/auditAuthenticationOrder.js
 *
 * Output feeds scripts/fixAuthenticationOrder.js, which connects to just the
 * flagged devices and removes tacplus/password from the order.
 */
const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "..", "SwitchConfigs");
const OUTPUT_DIR = path.join(__dirname, "output");
const ORDER_LINE_RE = /^set system authentication-order (\S+)/;
const FLAGGED_METHODS = ["tacplus", "password"];

const extractOrder = (content) => {
  const order = [];
  for (const line of content.split("\n")) {
    const match = line.trim().match(ORDER_LINE_RE);
    if (match && !order.includes(match[1])) order.push(match[1]);
  }
  return order;
};

const run = () => {
  if (!fs.existsSync(CONFIG_DIR)) {
    console.error(`Config directory not found: ${CONFIG_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();

  if (files.length === 0) {
    console.log("No switch config files found.");
    return;
  }

  const report = [];
  let withTacplus = 0;
  let withPassword = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(CONFIG_DIR, file), "utf8");
    const order = extractOrder(content);
    const flagged = FLAGGED_METHODS.filter((m) => order.includes(m));

    if (order.includes("tacplus")) withTacplus += 1;
    if (order.includes("password")) withPassword += 1;

    if (flagged.length > 0) {
      report.push({ file, order, flagged });
    }
  }

  const lines = [];
  for (const { file, flagged } of report) {
    lines.push(file);
    lines.push(flagged.join(", "));
    lines.push("");
  }
  const output = lines.join("\n").trimEnd();

  console.log(`\nAuthentication-Order Audit - ${new Date().toISOString()}`);
  console.log(`Scanned ${files.length} config file(s).`);
  console.log(`  with tacplus in authentication-order: ${withTacplus}`);
  console.log(`  with password in authentication-order: ${withPassword}`);
  console.log(`  with tacplus and/or password (needs fix): ${report.length}\n`);
  console.log(output || "No devices found with tacplus or password in authentication-order.");

  for (const { file, order } of report) {
    console.log(`  ${file}: [${order.join(", ")}]`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputFile = path.join(
    OUTPUT_DIR,
    `auth-order-audit-${new Date().toISOString().slice(0, 10)}.txt`,
  );
  fs.writeFileSync(
    outputFile,
    (output || "No devices found with tacplus or password in authentication-order.") + "\n",
    "utf8",
  );
  console.log(`\nReport saved to ${outputFile}`);
};

run();
