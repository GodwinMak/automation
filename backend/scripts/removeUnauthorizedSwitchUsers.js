/**
 * Remove non-baseline local login accounts found by scripts/auditSwitchLoginUsers.js.
 *
 * Reads a switch-login-audit-*.txt report and, per device, connects over SSH
 * and issues `delete system login user <name>` one at a time - each command
 * is sent and given a short pause to be processed before the next is typed -
 * for every account listed for that device, then `commit check` before ever
 * committing. A device is only committed (`commit and-quit`) if its commit
 * check succeeds; otherwise the change is rolled back and the run moves on
 * to the next device.
 *
 * SAFETY: defaults to a dry run - nothing connects or changes until
 * --execute is passed, and --execute still asks for a y/N confirmation
 * unless --yes is also given. Use --only <substring> to test against a
 * single device before running the whole fleet, --skip to exclude specific
 * usernames (e.g. vendor/support accounts you want the IP team to confirm
 * first) without hand-editing the report, and --delay to change the pause
 * (ms, default 500) between each typed command if a device needs more time.
 *
 * Usage (from backend/):
 *   node scripts/removeUnauthorizedSwitchUsers.js
 *   node scripts/removeUnauthorizedSwitchUsers.js --only LTZ-ACC1-IPS --execute --yes
 *   node scripts/removeUnauthorizedSwitchUsers.js --execute --skip ecoadmin,lnetd,tac-agg,virtual-admin,tzipengineering
 *   node scripts/removeUnauthorizedSwitchUsers.js --report scripts/output/switch-login-audit-2026-07-21.txt --execute
 *   node scripts/removeUnauthorizedSwitchUsers.js --execute --delay 800
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Client } = require("ssh2");

const OUTPUT_DIR = path.join(__dirname, "output");
const NEVER_DELETE = new Set(["admin", "rahaip", "remote"]);
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
const SKIP_USERS = new Set(
  (value("skip") || "").split(",").map((s) => s.trim()).filter(Boolean),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findLatestReport = () => {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => /^switch-login-audit-.*\.txt$/.test(f))
    .sort();
  return files.length > 0 ? path.join(OUTPUT_DIR, files[files.length - 1]) : null;
};

const parseReport = (text) => {
  const blocks = text.trim().split(/\n\s*\n/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const [file, userLine] = lines;
    const users = [...new Set(userLine.split(",").map((u) => u.trim()).filter(Boolean))].filter(
      (u) => !NEVER_DELETE.has(u) && !SKIP_USERS.has(u),
    );
    if (users.length > 0) entries.push({ file, users });
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

// configure private -> delete users (one at a time) -> commit check -> commit and-quit (only on success)
const removeUsersFromDevice = (host, users, deviceName) => {
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

          for (const user of users) {
            if (isDone) break; // an error already surfaced - stop typing further commands
            stream.write(`delete system login user ${user}\n`);
            await sleep(DELAY_MS);
          }

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
      "No audit report found. Run scripts/auditSwitchLoginUsers.js first, or pass --report <path>.",
    );
    process.exit(1);
  }

  let entries = parseReport(fs.readFileSync(reportPath, "utf8"));
  if (ONLY) {
    entries = entries.filter((e) => e.file.toLowerCase().includes(ONLY.toLowerCase()));
  }

  if (entries.length === 0) {
    console.log("Nothing to do - no matching devices with unauthorized users.");
    return;
  }

  console.log(`Report: ${reportPath}`);
  console.log(`Devices targeted: ${entries.length}${ONLY ? ` (filtered by --only ${ONLY})` : ""}`);
  if (SKIP_USERS.size > 0) {
    console.log(`Excluding usernames: ${[...SKIP_USERS].join(", ")}`);
  }
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will commit changes)" : "DRY RUN (no connections made)"}\n`);

  for (const { file, users } of entries) {
    const { name, ip } = parseHostAndIp(file);
    console.log(`${name} (${ip || "no IP parsed"}): delete ${users.join(", ")}`);
  }

  if (!EXECUTE) {
    console.log("\nDry run only - no devices were contacted. Re-run with --execute to apply.");
    return;
  }

  if (!SKIP_CONFIRM) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\nThis will connect to ${entries.length} device(s) and delete the listed accounts. Type "yes" to continue: `,
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

  for (const { file, users } of entries) {
    const { name, ip } = parseHostAndIp(file);
    if (!ip) {
      console.warn(`[SKIP] ${file}: could not parse an IP from the filename.`);
      results.failed.push({ device: file, reason: "could not parse IP from filename" });
      continue;
    }

    console.log(`\n[RUN] ${name} (${ip}): deleting ${users.join(", ")}`);
    try {
      await withTimeout(removeUsersFromDevice(ip, users, name), COMMAND_TIMEOUT_MS, name);
      console.log(`[OK] ${name}: committed.`);
      results.succeeded.push({ device: name, ip, users });
    } catch (error) {
      console.error(`[FAIL] ${name}: ${error.message}`);
      results.failed.push({ device: name, ip, users, reason: error.message });
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
    `user-removal-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
  console.log(`\nRun log saved to ${logFile}`);
};

run();
