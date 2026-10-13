/**
 * Check every device in the devices table for whether NETCONF-over-SSH
 * (`set system services netconf ssh`, port 830) is already enabled, and
 * optionally push that one line of config to the devices that don't have
 * it yet. Needed for cron/isisAdjacentNetconf.js (see its file header) to
 * be able to connect to a device at all - it showed up as
 * ECONNREFUSED/timeout on port 830 for every device that hasn't had this
 * enabled.
 *
 * Check phase (always runs, read-only): SSH exec
 * "show configuration system services | match netconf" on each device
 * (bounded concurrency, ping pre-check to skip dead devices fast - same as
 * cron/isisAdjacent.js's isReachable) and reports which devices already
 * have it vs which don't - confirmed on live hardware that a configured
 * device returns the "netconf {" opening line and an unconfigured one
 * returns nothing at all.
 *
 * Apply phase (--execute only): for devices missing it, one at a time -
 * configure private -> set system services netconf ssh -> commit check ->
 * commit and-quit only if the check succeeds, otherwise rollback + exit.
 * Same pattern as scripts/removeUnauthorizedSwitchUsers.js.
 *
 * SAFETY: defaults to a dry run - nothing is configured until --execute is
 * passed, and --execute still asks for a y/N confirmation unless --yes is
 * also given. Use --only <substring, matched against name or IP> to pilot
 * on a single device before running the whole fleet, --skip
 * <comma-separated names or IPs> to exclude specific devices, and --delay
 * to change the pause (ms, default 500) between each typed config command
 * if a device needs more time.
 *
 * Usage (from backend/):
 *   node scripts/enableNetconfSsh.js
 *   node scripts/enableNetconfSsh.js --only LTZ-ACC1-IPS --execute --yes
 *   node scripts/enableNetconfSsh.js --execute --skip LTZ-ACC1-FOO,41.175.39.1
 *   node scripts/enableNetconfSsh.js --execute --delay 800
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Client } = require("ssh2");
const { execFile } = require("child_process");
const pLimit = require("p-limit").default;
const db = require("../Models");

const Devices = db.devices;

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
const SKIP = new Set(
  (value("skip") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

// Cheap reachability check before paying for a full SSH connection - same
// rationale as cron/isisAdjacent.js's isReachable().
const isReachable = (host) =>
  new Promise((resolve) => {
    execFile("ping", ["-c", "1", "-W", "2", host], { timeout: 5000 }, (err) => resolve(!err));
  });

// Single non-interactive read-only command.
const runCommand = (host, command) =>
  new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let data = "";
          stream
            .on("data", (d) => {
              data += d.toString();
            })
            .on("close", () => {
              conn.end();
              resolve(data);
            });
        });
      })
      .on("error", reject)
      .connect({ host, ...sshConfig });
  });

const checkNetconf = async (device) => {
  const reachable = await isReachable(device.ip);
  if (!reachable) return { device, status: "unreachable" };
  try {
    const output = await withTimeout(
      runCommand(device.ip, "show configuration system services | match netconf"),
      COMMAND_TIMEOUT_MS,
      device.name,
    );
    // "| match netconf" filters line-by-line, so a configured device only
    // ever surfaces the "netconf {" opening brace - the "ssh;" line inside
    // the block doesn't contain the word "netconf" and never shows up on
    // its own. A device with nothing configured returns no output at all.
    // Confirmed against live hardware, so presence of any output is enough.
    const enabled = output.trim().length > 0;
    return { device, status: enabled ? "enabled" : "disabled" };
  } catch (err) {
    return { device, status: "error", reason: err.message };
  }
};

// configure private -> set netconf ssh -> commit check -> commit and-quit
// (rollback + exit on any error) - same shell-scraping pattern as
// scripts/removeUnauthorizedSwitchUsers.js's removeUsersFromDevice().
const enableOnDevice = (host, deviceName) =>
  new Promise((resolve, reject) => {
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
          stream.write("set system services netconf ssh\n");
          await sleep(DELAY_MS);
          stream.write("commit check\n");
        })();
      });
    });

    conn.connect({ host, ...sshConfig });
  });

const run = async () => {
  if (!sshConfig.username || !sshConfig.password) {
    console.error("Missing SSH_USERNAME / SSH_PASSWORD in .env");
    process.exit(1);
  }

  let devices = await Devices.findAll();
  if (ONLY) {
    const needle = ONLY.toLowerCase();
    devices = devices.filter(
      (d) => (d.name || "").toLowerCase().includes(needle) || (d.ip || "").includes(ONLY),
    );
  }
  devices = devices.filter(
    (d) => !SKIP.has((d.name || "").toLowerCase()) && !SKIP.has((d.ip || "").toLowerCase()),
  );

  if (devices.length === 0) {
    console.log("No matching devices.");
    return;
  }

  console.log(`Checking ${devices.length} device(s) for NETCONF-over-SSH...\n`);

  const limit = pLimit(10);
  const checks = await Promise.all(devices.map((d) => limit(() => checkNetconf(d))));

  const enabled = checks.filter((c) => c.status === "enabled");
  const disabled = checks.filter((c) => c.status === "disabled");
  const unreachable = checks.filter((c) => c.status === "unreachable");
  const errored = checks.filter((c) => c.status === "error");

  console.log(`Already enabled: ${enabled.length}`);
  console.log(`Not enabled:     ${disabled.length}`);
  console.log(`Unreachable:     ${unreachable.length}`);
  console.log(`Check errors:    ${errored.length}\n`);

  if (disabled.length > 0) {
    console.log("Devices missing NETCONF:");
    disabled.forEach((c) => console.log(`  - ${c.device.name} (${c.device.ip})`));
  }
  if (errored.length > 0) {
    console.log("\nDevices whose check failed (left untouched):");
    errored.forEach((c) => console.log(`  - ${c.device.name} (${c.device.ip}): ${c.reason}`));
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const checkLogFile = path.join(
    OUTPUT_DIR,
    `netconf-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(
    checkLogFile,
    JSON.stringify(
      checks.map((c) => ({
        name: c.device.name,
        ip: c.device.ip,
        status: c.status,
        reason: c.reason,
      })),
      null,
      2,
    ),
  );
  console.log(`\nCheck results saved to ${checkLogFile}`);

  if (disabled.length === 0) {
    console.log("\nNothing to configure - every reachable, checkable device already has NETCONF enabled.");
    return;
  }

  console.log(`\nMode: ${EXECUTE ? "EXECUTE (will commit changes)" : "DRY RUN (no config pushed)"}`);
  if (!EXECUTE) {
    console.log('Re-run with --execute to push "set system services netconf ssh" to the devices listed above.');
    return;
  }

  if (!SKIP_CONFIRM) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\nThis will connect to ${disabled.length} device(s) and enable NETCONF-over-SSH. Type "yes" to continue: `,
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

  for (const { device } of disabled) {
    console.log(`\n[RUN] ${device.name} (${device.ip}): set system services netconf ssh`);
    try {
      await withTimeout(enableOnDevice(device.ip, device.name), COMMAND_TIMEOUT_MS, device.name);
      console.log(`[OK] ${device.name}: committed.`);
      results.succeeded.push({ device: device.name, ip: device.ip });
    } catch (error) {
      console.error(`[FAIL] ${device.name}: ${error.message}`);
      results.failed.push({ device: device.name, ip: device.ip, reason: error.message });
    }
  }

  console.log(`\n===== Summary =====`);
  console.log(`Succeeded: ${results.succeeded.length}`);
  console.log(`Failed: ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log("Failed devices:");
    results.failed.forEach((f) => console.log(`  - ${f.device}: ${f.reason}`));
  }

  const runLogFile = path.join(
    OUTPUT_DIR,
    `netconf-enable-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(runLogFile, JSON.stringify(results, null, 2));
  console.log(`\nRun log saved to ${runLogFile}`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
