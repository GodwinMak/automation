const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op } = require("sequelize");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const customer = db.ftthcustomers;
const customerinfo = db.ftthcustomerinfos;


const SSH_READY_TIMEOUT_MS = Number(process.env.DIAGNOSIS_SSH_READY_TIMEOUT_MS || 30000); // raised from 12s → 30s
const SSH_EXEC_TIMEOUT_MS = Number(process.env.DIAGNOSIS_SSH_EXEC_TIMEOUT_MS || 60000);   // new: per-command timeout

const switches = [{ name: "LTZ-BNG01-RAH-DAR", host: "41.175.37.14" }];

const sshConfig = {
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
};

// Run command over SSH
const runCommand = (host, cmd) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let result = "";
    let settled = false;

    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      conn.end();
      fn(val);
    };

    // Hard timeout — kills the whole attempt if SSH hangs mid-exec
    const timer = setTimeout(() => {
      done(reject, new Error(`SSH command timed out after ${SSH_EXEC_TIMEOUT_MS}ms: ${cmd}`));
    }, SSH_EXEC_TIMEOUT_MS);

    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            return done(reject, err);
          }
          stream
            .on("data", (data) => { result += data.toString(); })
            .stderr.on("data", (data) => { result += data.toString(); });

          stream.on("close", () => {
            clearTimeout(timer);
            done(resolve, result.trim());
          });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        done(reject, err);
      })
      .connect({
        host,
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: 5000,
        keepaliveCountMax: 5,
        ...sshConfig,
      });
  });
};

/**
 * Parses the output of `show subscribers | match <username>` and returns
 * an array of PPPoE interface names (e.g. ["pp0.3221498292"]).
 *
 * Expected line format:
 *   pp0.3221498292   2c0f:fe98:8152::/48   user@domain.com   default:PROFILE
 */
const parseSessions = (output) => {
  if (!output) return [];

  const sessions = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // The interface name is the first whitespace-delimited token and starts with "pp"
    const match = trimmed.match(/^(pp\S+)/);
    if (match) {
      sessions.push(match[1]);
    }
  }

  return sessions;
};

/**
 * Clear PPPoE sessions for a single switch, given a pppoeusername.
 * Returns a summary object: { switch, sessionsFound, sessionsCleared, errors }
 */
const clearSessionsOnSwitch = async (sw, pppoeusername) => {
  const summary = {
    switch: sw.name,
    sessionsFound: [],
    sessionsCleared: [],
    errors: [],
  };

  try {
    const showCmd = `show subscribers | match ${pppoeusername}`;
    const output = await runCommand(sw.host, showCmd);
    const sessions = parseSessions(output);

    summary.sessionsFound = sessions;

    if (sessions.length === 0) {
      return summary; // nothing to clear on this switch
    }

    // Clear each discovered session
    await Promise.all(
      sessions.map(async (sessionInterface) => {
        try {
          const clearCmd = `clear pppoe sessions ${sessionInterface}`;
          await runCommand(sw.host, clearCmd);
          summary.sessionsCleared.push(sessionInterface);
        } catch (err) {
          summary.errors.push({
            interface: sessionInterface,
            error: err.message,
          });
        }
      })
    );
  } catch (err) {
    summary.errors.push({ interface: null, error: err.message });
  }

  return summary;
};

// ─── Controllers ─────────────────────────────────────────────────────────────

exports.clearSpecificUpPppoeSession = async (req, res) => {
  try {
    const { pppoeusername } = req.body;

    if (!pppoeusername) {
      return res.status(400).json({ error: "pppoeusername is required." });
    }

    const customerRecord = await customer.findOne({
      where: { pppoeusername },
    });

    if (!customerRecord) {
      return res.status(404).json({
        error: "Customer with the specified PPPoE username not found.",
      });
    }

    // Run show + clear across all switches in parallel
    const results = await Promise.all(
      switches.map((sw) => clearSessionsOnSwitch(sw, pppoeusername))
    );

    const totalCleared = results.reduce(
      (sum, r) => sum + r.sessionsCleared.length,
      0
    );

    return res.status(200).json({
      message: `PPPoE sessions cleared successfully.`,
      pppoeusername,
      totalCleared,
      details: results,
    });
  } catch (error) {
    console.error("clearSpecificUpPppoeSession error:", error);
    return res.status(500).json({
      error: "An error occurred while clearing PPPoE sessions.",
    });
  }
};

exports.clearAllUpIPV6NotExpiredPppoeSession = async (req, res) => {
  try {
    const customers = await customer.findAll({
      where: {
        ip_version: "IPv6",
        status: "up",
        isExpired: false,
        notInInfo: false,
      },
    });

    if (!customers.length) {
      return res.status(200).json({ message: "No matching customers found.", totalCleared: 0 });
    }

    const allResults = [];

    for (const c of customers) {
      const username = c.pppoeusername;
      const switchResults = await Promise.all(
        switches.map((sw) => clearSessionsOnSwitch(sw, username))
      );
      allResults.push({ pppoeusername: username, switches: switchResults });
    }

    const totalCleared = allResults.reduce(
      (sum, r) =>
        sum +
        r.switches.reduce((s, sw) => s + sw.sessionsCleared.length, 0),
      0
    );

    return res.status(200).json({
      message: "IPv6 non-expired PPPoE sessions cleared.",
      totalCleared,
      details: allResults,
    });
  } catch (error) {
    console.error("clearAllUpIPV6NotExpiredPppoeSession error:", error);
    return res.status(500).json({
      error: "An error occurred while clearing PPPoE sessions.",
    });
  }
};


exports.clearAllUpIPV6ExpiredPppoeSession = async (req, res) => {
  try {
    const customers = await customer.findAll({
      where: {
        ip_version: "IPv6",
        status: "up",
        isExpired: true,
        notInInfo: false,
      },
    });

    if (!customers.length) {
      return res.status(200).json({ message: "No matching customers found.", totalCleared: 0 });
    }

    const allResults = [];

    for (const c of customers) {
      const username = c.pppoeusername;
      const switchResults = await Promise.all(
        switches.map((sw) => clearSessionsOnSwitch(sw, username))
      );
      allResults.push({ pppoeusername: username, switches: switchResults });
    }

    const totalCleared = allResults.reduce(
      (sum, r) =>
        sum +
        r.switches.reduce((s, sw) => s + sw.sessionsCleared.length, 0),
      0
    );

    return res.status(200).json({
      message: "IPv6 expired PPPoE sessions cleared.",
      totalCleared,
      details: allResults,
    });
  } catch (error) {
    console.error("clearAllUpIPV6ExpiredPppoeSession error:", error);
    return res.status(500).json({
      error: "An error occurred while clearing PPPoE sessions.",
    });
  }
};
exports.clearAllUpIPV4ExpiredNotFreePppoeSession = async (req, res) => {
  try {
    const customers = await customer.findAll({
      where: {
        ip_version: "IPv4",
        status: "up",
        isExpired: true,
        isFreeCustomer: false,
        notInInfo: false,
      },
    });

    if (!customers.length) {
      return res.status(200).json({ message: "No matching customers found.", totalCleared: 0 });
    }

    const allResults = [];

    for (const c of customers) {
      const username = c.pppoeusername;
      const switchResults = await Promise.all(
        switches.map((sw) => clearSessionsOnSwitch(sw, username))
      );
      allResults.push({ pppoeusername: username, switches: switchResults });
    }

    const totalCleared = allResults.reduce(
      (sum, r) =>
        sum +
        r.switches.reduce((s, sw) => s + sw.sessionsCleared.length, 0),
      0
    );

    return res.status(200).json({
      message: "IPv4 expired non-free PPPoE sessions cleared.",
      totalCleared,
      details: allResults,
    });
  } catch (error) {
    console.error("clearAllUpIPV4ExpiredNotFreePppoeSession error:", error);
    return res.status(500).json({
      error: "An error occurred while clearing PPPoE sessions.",
    });
  }
};