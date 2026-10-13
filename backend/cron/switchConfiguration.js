const cron = require("node-cron");
const { Client } = require("ssh2");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const db = require("../Models");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: Number(process.env.SSH_READY_TIMEOUT_MS || 30000),
  };
  const commandTimeoutMs = Number(
    process.env.SWITCH_CONFIG_COMMAND_TIMEOUT_MS || 180000,
  );
  const Device = db.devices;
  const SwitchConfiguration = db.switchConfiguration;
  const { Op } = db.Sequelize;
  const outputDir = path.join(__dirname, "..", "SwitchConfigs");
  let isRunning = false;
  // fileName -> Junos username who last committed that device's config,
  // populated during updateSwitchConfiguration() and read by
  // pushSwitchConfigsToGit() so each git commit is attributed to the
  // person who actually made the change on the device, not the bot.
  let lastCommitAuthors = {};

  // === GIT BACKUP CONFIG ===
  // Requires these vars in backend/.env:
  //   SWITCH_CONFIG_GITHUB_TOKEN  - a GitHub PAT with write access to the backup repo
  //   SWITCH_CONFIG_GITHUB_OWNER  - e.g. "GodwinMak"
  //   SWITCH_CONFIG_GITHUB_REPO   - e.g. "switch-configs-backup"
  //   SWITCH_CONFIG_GITHUB_BRANCH - defaults to "main"
  const gitConfig = {
    token: process.env.SWITCH_CONFIG_GITHUB_TOKEN,
    owner: process.env.SWITCH_CONFIG_GITHUB_OWNER,
    repo: process.env.SWITCH_CONFIG_GITHUB_REPO,
    branch: process.env.SWITCH_CONFIG_GITHUB_BRANCH || "main",
    userName: process.env.SWITCH_CONFIG_GIT_USER_NAME || "Automation Bot",
    userEmail:
      process.env.SWITCH_CONFIG_GIT_USER_EMAIL ||
      "automation-bot@users.noreply.github.com",
  };
  const gitBackupEnabled = Boolean(
    gitConfig.token && gitConfig.owner && gitConfig.repo,
  );

  // === HELPER FUNCTIONS ===
  // Run command over SSH
  const runCommand = (host, cmd) => {
    console.log(host, cmd)
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";
      conn
        .on("ready", () => {
          conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            stream
              .on("data", (data) => {
                result += data.toString();
              })
              .on("close", () => {
                conn.end();
                resolve(result.trim());
              });
          });
        })
        .on("error", (err) => reject(err))
        .connect({ host, ...sshConfig });
    });
  };

  const runCommandWithTimeout = (host, cmd, timeoutMs) => {
    return Promise.race([
      runCommand(host, cmd),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Command timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  };

  const sanitizeFilenamePart = (value) => {
    return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
  };

  // Reads the most recent entry from `show system commit` (index 0) and
  // pulls out who made it, e.g. "0   2026-07-22 15:50:08 EAT by kelvin.mpinzile via cli".
  const getLastCommitAuthor = async (host) => {
    try {
      const output = await runCommandWithTimeout(host, "show system commit", commandTimeoutMs);
      const line = output
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /^0\s/.test(l));
      if (!line) return null;
      const match = line.match(/\bby\s+(\S+)\s+via\b/);
      return match ? match[1] : null;
    } catch (error) {
      console.warn(`[WARN] Could not read commit history from ${host}: ${error.message}`);
      return null;
    }
  };

  const ensureOutputDir = () => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  };

  // === GIT BACKUP HELPERS ===
  // Hides the PAT if git ever echoes the remote URL back in stdout/stderr.
  const sanitizeGitOutput = (text) => {
    if (!text || !gitConfig.token) return text;
    return text.split(gitConfig.token).join("***");
  };

  const runGit = (args, cwd) => {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd, maxBuffer: 1024 * 1024 * 20 },
        (error, stdout, stderr) => {
          if (error) {
            error.message = sanitizeGitOutput(error.message);
            error.stderr = sanitizeGitOutput(stderr);
            return reject(error);
          }
          resolve(stdout.trim());
        },
      );
    });
  };

  const ensureGitRepoInitialized = async () => {
    const gitDir = path.join(outputDir, ".git");

    if (!fs.existsSync(gitDir)) {
      console.log("[GIT] Initializing repository in SwitchConfigs...");
      await runGit(["init"], outputDir);
      await runGit(
        ["symbolic-ref", "HEAD", `refs/heads/${gitConfig.branch}`],
        outputDir,
      );
    }

    await runGit(["config", "user.name", gitConfig.userName], outputDir);
    await runGit(["config", "user.email", gitConfig.userEmail], outputDir);

    const remoteUrl = `https://${gitConfig.token}@github.com/${gitConfig.owner}/${gitConfig.repo}.git`;
    const remotes = await runGit(["remote"], outputDir);
    if (remotes.split("\n").includes("origin")) {
      await runGit(["remote", "set-url", "origin", remoteUrl], outputDir);
    } else {
      await runGit(["remote", "add", "origin", remoteUrl], outputDir);
    }
  };

  // Commits + pushes only when `git status` reports actual file changes.
  const pushSwitchConfigsToGit = async () => {
    if (!gitBackupEnabled) {
      console.log(
        "[GIT] Skipping backup - SWITCH_CONFIG_GITHUB_TOKEN/OWNER/REPO not configured.",
      );
      return;
    }

    try {
      await ensureGitRepoInitialized();

      await runGit(["add", "-A"], outputDir);
      const statusOutput = await runGit(["status", "--porcelain"], outputDir);

      if (statusOutput) {
        // Porcelain lines are "XY <path>" - a 2-char status plus a space.
        const changedFiles = statusOutput
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(3).trim());

        // One commit per file so each device's change is individually
        // attributed to whoever last committed it on the device itself,
        // instead of one bulk commit under the bot's identity.
        for (const file of changedFiles) {
          const deviceName = file.replace(/\.txt$/, "");
          const committedBy = lastCommitAuthors[file];
          const message = committedBy
            ? `${deviceName}: config change by ${committedBy}`
            : `${deviceName}: config snapshot - ${new Date().toISOString()}`;
          const authorArgs = committedBy
            ? ["--author", `${committedBy} <${committedBy}@devices.local>`]
            : [];

          await runGit(["commit", "-m", message, ...authorArgs, "--", file], outputDir);
          console.log(`[GIT] Committed ${file}${committedBy ? ` (by ${committedBy})` : ""}`);
        }
      } else {
        console.log("[GIT] No file changes detected - checking for unpushed commits...");
      }

      // Always attempt the push, even with no new commit this run - a prior
      // run may have committed successfully but failed to push (e.g. an auth
      // error), leaving commits sitting locally. Pushing when already up to
      // date is a harmless no-op.
      await runGit(["push", "-u", "origin", gitConfig.branch], outputDir);
      console.log("[GIT] Pushed switch configuration snapshot to GitHub.");
    } catch (error) {
      console.error(
        `[GIT] Failed to back up switch configs: ${error.message}`,
        error.stderr || "",
      );
    }
  };

  const updateSwitchConfiguration = async () => {
    try {
      ensureOutputDir();
      lastCommitAuthors = {};
      const devices = await Device.findAll({
        attributes: ["id", "name", "ip"],
        where: {
          name: {
            [Op.ne]: "SME-HOME-BM",
          },
        },
      });

      const skipped = [];
      let savedCount = 0;

      for (const dev of devices) {
        try {
          console.log(`[INFO] Fetching config for ${dev.name} (${dev.ip})`);

          const configuration = await runCommandWithTimeout(
            dev.ip,
            "show configuration |display set |no-more",
            commandTimeoutMs,
          );

          const safeName = sanitizeFilenamePart(dev.name);
          const safeIp = sanitizeFilenamePart(dev.ip);
          const fileName = `${safeName}_${safeIp}.txt`;
          const filePath = path.join(outputDir, fileName);
          const newContent = configuration + "\n";

          // "show system commit" is a second full SSH connection, and its
          // result (lastCommitAuthors) is only ever read in
          // pushSwitchConfigsToGit for files `git status --porcelain`
          // reports as changed — fetching it for a device whose config is
          // byte-identical to last run is wasted work that's guaranteed to
          // be thrown away. A missing previous file (first-ever snapshot
          // for this device) counts as "changed" so it still gets attributed.
          let previousContent = null;
          try {
            previousContent = await fs.promises.readFile(filePath, "utf8");
          } catch (readErr) {
            // No previous snapshot for this device yet.
          }
          const configChanged = previousContent !== newContent;

          await fs.promises.writeFile(filePath, newContent, "utf8");

          if (configChanged) {
            const committedBy = await getLastCommitAuthor(dev.ip);
            lastCommitAuthors[fileName] = committedBy;
            if (committedBy) {
              console.log(`[INFO] ${dev.name} last committed by ${committedBy}`);
            }
          } else {
            console.log(`[INFO] ${dev.name} config unchanged — skipping commit-history check.`);
          }

          const existing = await SwitchConfiguration.findOne({
            where: { deviceId: dev.id },
          });

          if (existing) {
            await SwitchConfiguration.update(
              {
                deviceName: dev.name,
                filePath,
                updatedAt: new Date(),
              },
              {
                where: { id: existing.id },
              },
            );
          } else {
            await SwitchConfiguration.create({
              deviceId: dev.id,
              deviceName: dev.name,
              filePath,
            });
          }

          savedCount += 1;
          console.log(`[INFO] Saved config for ${dev.name} to ${filePath}`);
        } catch (error) {
          skipped.push({ name: dev.name, reason: error.message });
          console.warn(
            `[WARN] Skipping ${dev.name} (${dev.ip}): ${error.message}`,
          );
        }
      }

      console.log(`[INFO] Saved ${savedCount} switch configurations.`);

      if (skipped.length > 0) {
        console.warn(
          `[WARN] Skipped switches: ${skipped
            .map((item) => `${item.name} (${item.reason})`)
            .join(", ")}`,
        );
      }
    } catch (error) {
      console.error("[ERROR] Fatal error:", error.message);
    }
  };

//   return updateSwitchConfiguration();
 const runAll = async ()=>{
    if (isRunning) {
      console.warn(
        "[Switch Config] Previous run still in progress. Skipping this schedule tick.",
      );
      return;
    }

    isRunning = true;
    const startedAt = Date.now();
    try {
        await updateSwitchConfiguration();
        await pushSwitchConfigsToGit();
    } catch (error) {
      console.error("[Main Runner] Fatal error:", error.message);
    } finally {
      isRunning = false;
      console.log(`[Switch Config] Run finished in ${Date.now() - startedAt}ms.`);
    }
 }

  if (options.schedule !== false) {
    cron.schedule("*/20 * * * *", () => {
      console.log("[Switch Config] Cron job running every 20 minutes.");
      runAll();
    });
  }

 return {
    updateSwitchConfiguration,
    pushSwitchConfigsToGit,
 };
};
