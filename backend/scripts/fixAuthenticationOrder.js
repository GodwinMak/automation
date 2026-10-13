/**
 * Fix `system authentication-order` on devices flagged by
 * scripts/auditAuthenticationOrder.js - i.e. devices that still allow
 * tacplus and/or password login instead of radius-only. Connects over SSH
 * and issues:
 *
 *   set system authentication-order radius
 *   delete system authentication-order tacplus
 *   delete system authentication-order password
 *
 * one command at a time - each is sent and given a short pause to be
 * processed before the next is typed - then `commit check` before ever
 * committing. A device is only committed (`commit and-quit`) if its commit
 * check succeeds; otherwise the change is rolled back and the run moves on
 * to the next device. Both delete commands are issued on every targeted
 * device regardless of which method(s) the audit found - deleting an
 * authentication-order value that isn't present is a harmless no-op in
 * Junos - so the on-device result always ends up radius-only.
 *
 * SAFETY: defaults to a dry run - nothing connects or changes until
 * --execute is passed, and --execute still asks for a y/N confirmation
 * unless --yes is also given. Use --only <substring> to test against a
 * single device before running the whole fleet, --skip to exclude specific
 * device names, and --delay to change the pause (ms, default 500) between
 * each typed command if a device needs more time.
 *
 * Usage (from backend/):
 *   node scripts/fixAuthenticationOrder.js
 *   node scripts/fixAuthenticationOrder.js --only LTZ-ACC1-IPS --execute --yes
 *   node scripts/fixAuthenticationOrder.js --execute --skip LTZ-CORE1
 *   node scripts/fixAuthenticationOrder.js --report scripts/output/auth-order-audit-2026-09-16.txt --execute
 *   node scripts/fixAuthenticationOrder.js --execute --delay 800
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Client } = require("ssh2");

const OUTPUT_DIR = path.join(__dirname, "output");
const COMMAND_TIMEOUT_MS = Number(process.env.SWITCH_CONFIG_COMMAND_TIMEOUT_MS || 30000);

const sshConfig = {
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
  readyTimeout: Number(process.env.SSH_READY_TIMEOUT_MS || 30000),
};

// --- CLI args ---
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx === -1 ? null : args[idx + 1];
};

const EXECUTE = flag("execute");
const SKIP_CONFIRM = flag("yes");
const ONLY = value("only");
const DELAY_MS = Number(value("delay") || 500);
const SKIP_DEVICES = new Set(
  (value("skip") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findLatestReport = () => {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => /^auth-order-audit-.*\.txt$/.test(f))
    .sort();
  return files.length > 0 ? path.join(OUTPUT_DIR, files[files.length - 1]) : null;
};

const parseReport = (text) => {
  const blocks = text.trim().split(/\n\s*\n/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const [file, methodsLine] = lines;
    const methods = [...new Set(methodsLine.split(",").map((m) => m.trim()).filter(Boolean))];
    if (methods.length > 0) entries.push({ file, methods });
  }
  return entries;
};

const parseHostAndIp = (filename) => {
  const base = filename.replace(/\.txt$/, "");
  const match = base.match(/^(.+)_(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match ? { name: match[1], ip: match[2] } : { name: base, ip: null };
};

const withTimeout = (promise, ms, label) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
};

// configure private -> set radius, delete tacplus, delete password -> commit check -> commit and-quit (only on success)
const fixAuthOrderOnDevice = (host, deviceName) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let result = "";
    let isDone = false;

    conn.on("error", reject);

    conn.on("ready", () => {
      conn.shell((err, stream) => {
        if (err) return reject(err);

        stream.on("data", (data) => {
          const output = data.toString();
          result += output;
          if (isDone) return;

          if (result.includes("configuration check succeeds")) {
            isDone = true;
            stream.write("commit and-quit\n");
            setTimeout(() => resolve({ device: deviceName, host, output: result }), 2000);
          } else if (result.includes("error:") || result.includes("syntax error")) {
            isDone = true;
            stream.write("rollback\nexit\n");
            const errorLines = result
              .split("\n")
              .filter((l) => l.includes("error"))
              .join(" | ");
            reject(new Error(`Commit check failed on ${deviceName}: ${errorLines}`));
          }
        });

        stream.on("close", () => {
          conn.end();
          if (!isDone) {
            reject(new Error(`SSH session on ${deviceName} closed before a commit check result was seen.`));
          }
        });

        (async () => {
          stream.write("configure private\n");
          await sleep(DELAY_MS);

          stream.write("set system authentication-order radius\n");
          await sleep(DELAY_MS);
          stream.write("delete system authentication-order tacplus\n");
          await sleep(DELAY_MS);
          stream.write("delete system authentication-order password\n");
          await sleep(DELAY_MS);

          if (!isDone) stream.write("commit check\n");
        })();
      });
    });

    conn.connect({ host, ...sshConfig });
  });
};

const run = async () => {
  if (!sshConfig.username || !sshConfig.password) {
    console.error("Missing SSH_USERNAME / SSH_PASSWORD in .env");
    process.exit(1);
  }

  const reportPath = value("report") || findLatestReport();
  if (!reportPath || !fs.existsSync(reportPath)) {
    console.error(
      "No audit report found. Run scripts/auditAuthenticationOrder.js first, or pass --report <path>.",
    );
    process.exit(1);
  }

  let entries = parseReport(fs.readFileSync(reportPath, "utf8"));
  if (ONLY) {
    entries = entries.filter((e) => e.file.toLowerCase().includes(ONLY.toLowerCase()));
  }
  if (SKIP_DEVICES.size > 0) {
    entries = entries.filter((e) => {
      const { name } = parseHostAndIp(e.file);
      return !SKIP_DEVICES.has(name.toLowerCase());
    });
  }

  if (entries.length === 0) {
    console.log("Nothing to do - no matching devices with tacplus/password in authentication-order.");
    return;
  }

  console.log(`Report: ${reportPath}`);
  console.log(`Devices targeted: ${entries.length}${ONLY ? ` (filtered by --only ${ONLY})` : ""}`);
  if (SKIP_DEVICES.size > 0) {
    console.log(`Excluding devices: ${[...SKIP_DEVICES].join(", ")}`);
  }
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will commit changes)" : "DRY RUN (no connections made)"}\n`);

  for (const { file, methods } of entries) {
    const { name, ip } = parseHostAndIp(file);
    console.log(`${name} (${ip || "no IP parsed"}): currently has ${methods.join(", ")} -> will set radius-only`);
  }

  if (!EXECUTE) {
    console.log("\nDry run only - no devices were contacted. Re-run with --execute to apply.");
    return;
  }

  if (!SKIP_CONFIRM) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\nThis will connect to ${entries.length} device(s) and set authentication-order to radius-only. Type "yes" to continue: `,
        resolve,
      );
    });
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  const results = { succeeded: [], failed: [] };

  for (const { file, methods } of entries) {
    const { name, ip } = parseHostAndIp(file);
    if (!ip) {
      console.warn(`[SKIP] ${file}: could not parse an IP from the filename.`);
      results.failed.push({ device: file, reason: "could not parse IP from filename" });
      continue;
    }

    console.log(`\n[RUN] ${name} (${ip}): removing ${methods.join(", ")} from authentication-order`);
    try {
      await withTimeout(fixAuthOrderOnDevice(ip, name), COMMAND_TIMEOUT_MS, name);
      console.log(`[OK] ${name}: committed.`);
      results.succeeded.push({ device: name, ip, methods });
    } catch (error) {
      console.error(`[FAIL] ${name}: ${error.message}`);
      results.failed.push({ device: name, ip, methods, reason: error.message });
    }
  }

  console.log(`\n===== Summary =====`);
  console.log(`Succeeded: ${results.succeeded.length}`);
  console.log(`Failed: ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log("Failed devices:");
    results.failed.forEach((f) => console.log(`  - ${f.device}: ${f.reason}`));
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const logFile = path.join(
    OUTPUT_DIR,
    `auth-order-fix-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
  console.log(`\nRun log saved to ${logFile}`);
};

run();
