/**
 * Audit switch configs for local login users outside the expected baseline
 * (admin, rahaip, remote). Reads every .txt file in backend/SwitchConfigs
 * and reports any additional local users found per device.
 *
 * Usage (from backend/): node scripts/auditSwitchLoginUsers.js
 */
const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "..", "SwitchConfigs");
const OUTPUT_DIR = path.join(__dirname, "output");
const EXPECTED_USERS = ["admin", "rahaip", "remote"];
const USER_LINE_RE = /^set system login user (\S+)/;

const extractUsers = (content) => {
  const users = new Set();
  for (const line of content.split("\n")) {
    const match = line.match(USER_LINE_RE);
    if (match) users.add(match[1]);
  }
  return users;
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

  for (const file of files) {
    const content = fs.readFileSync(path.join(CONFIG_DIR, file), "utf8");
    const users = extractUsers(content);
    const unexpected = [...users].filter((u) => !EXPECTED_USERS.includes(u)).sort();

    if (unexpected.length > 0) {
      report.push({ file, unexpected });
    }
  }

  const lines = [];
  for (const { file, unexpected } of report) {
    lines.push(file);
    lines.push(unexpected.join(", "));
    lines.push("");
  }
  const output = lines.join("\n").trimEnd();

  console.log(`\nSwitch Login User Audit - ${new Date().toISOString()}`);
  console.log(`Expected users: ${EXPECTED_USERS.join(", ")}`);
  console.log(`Scanned ${files.length} config file(s), ${report.length} with unexpected users.\n`);
  console.log(output || "No unexpected users found on any switch.");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputFile = path.join(
    OUTPUT_DIR,
    `switch-login-audit-${new Date().toISOString().slice(0, 10)}.txt`,
  );
  fs.writeFileSync(outputFile, (output || "No unexpected users found on any switch.") + "\n", "utf8");
  console.log(`\nReport saved to ${outputFile}`);
};

run();
