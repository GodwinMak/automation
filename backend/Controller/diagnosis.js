const db = require("../Models");
const { Client } = require("ssh2");
const axios = require("axios");

const switches = [
  { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
  { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
];

const sshConfig = {
  username: "godwin.makyao",
  password: "Namwel200148#@!",
};

const diacustomer = db.diacustomers;
const devices = db.devices;
// === HELPER FUNCTIONS ===
// Run command over SSH
const runCommand = (host, cmd) => {
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


const parseInterfaces = (output, switchName, host) => {
  return output

    .split("\n")

    .filter((line) => line.startsWith("ps"))

    .filter((line) => line.trim() !== "")

    .map((line) => {
      const match = line.trim().split(/\s+/);

      return {
        interface: match[0],

        adminStatus: match[1],

        operationalStatus: match[2],

        description: match.slice(3).join(" "),

        switchName,

        host,
      };
    });
};


exports.diagnosisController = async (req, res) => {
  const { interfaceName } = req.body;

  try {
    const customer = await diacustomer.findOne({ where: { interface: interfaceName } });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    // 1. Parallel check across all BNGs
    const bngResults = await Promise.all(
      switches.map(async (sw) => {
        const cmd = `show interfaces descriptions | match ${interfaceName}`;
        const output = await runCommand(sw.host, cmd);
        return parseInterfaces(output, sw.name, sw.host);
      })
    );

    // Flatten and find the best 'up' interface or fallback to 'down'
    const allInterfaces = bngResults.flat();
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });

    const base = interfaceName.split(".")[0];

    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const neighborData = await getNeighborDetails(activeIntf.host, base);
      return res.status(200).json({
        message: "Customer is down on both BNGs",
        ...neighborData
      });
    }

    // --- CASE: UP ---
    // 2. Get ARP and Ping in parallel (or sequential if logic depends on it)
    const arpCmd = `show arp no-resolve interface ${interfaceName}`;
    const arpOutput = await runCommand(activeIntf.host, arpCmd);
    const ipRegex = /(\d{1,3}(?:\.\d{1,3}){3})/g;
    const customerIps = [...arpOutput.matchAll(ipRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, base),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        ...neighborData,
        graphData: zabbixData
      });
    }

    // Optimize: Ping IPs in parallel to save massive time
    const pingResults = await Promise.all(customerIps.map(async (ip) => {
      const pingOutput = await runCommand(activeIntf.host, `ping ${ip} rapid count 100`); // Reduced count for speed
      return parsePing(ip, pingOutput);
    }));

    const problematicPing = pingResults.find(p => p.packetLoss > 20 || p.avgLatency > 25);

    if (problematicPing) {
      // 3. Parallelize Zabbix and Neighbor checks
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, base),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);

      return res.status(200).json({
        message: "Customer is up but experiencing issues",
        pingResult: problematicPing,
        ...neighborData,
        graphData: zabbixData
      });
    }else{
      const zabbixData = await getZabbixHistory(interfaceName, activeIntf.switchName);
      return res.status(200).json({
        message: "Customer is healthy",
        pingResults,
        graphData: zabbixData
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// Calculate uptime for a single customer based on Zabbix history
// Rules:
// - User provides a start date (YYYY-MM-DD), end date is "now"
// - Range must not exceed 90 days from now
// - For each sample, if traffic > 0 bps it is considered "up"; if 0 then "down"
// - Uptime percentage = upSamples / totalSamples * 100
exports.getCustomerUptime = async (req, res) => {
  try {
    const { interfaceName, startDate } = req.body;

    if (!interfaceName || !startDate) {
      return res.status(400).json({ message: "interfaceName and startDate are required" });
    }

    const customer = await diacustomer.findOne({ where: { interface: interfaceName } });
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ message: "Invalid startDate format" });
    }

    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const maxRangeMs = 90 * 24 * 60 * 60 * 1000; // 90 days

    if (diffMs < 0) {
      return res.status(400).json({ message: "startDate cannot be in the future" });
    }

    if (diffMs > maxRangeMs) {
      return res.status(400).json({ message: "Date range cannot exceed 90 days from now" });
    }

    // Convert range to hours for existing Zabbix helper (which fetches last N hours from now)
    let hours = Math.ceil(diffMs / (60 * 60 * 1000));
    if (hours <= 0) hours = 1;

    // Determine which BNG to use from the customer record
    const customerSwitchName = customer.switchName;
    if (!customerSwitchName) {
      return res.status(400).json({ message: "Customer switchName not found" });
    }

    // Fetch history for this specific BNG only.
    // Use only ONE traffic direction for uptime calculation (prefer Received, fallback to Sent).
    let allSentData = [];
    let allRecvData = [];

    const data = await getZabbixHistory(interfaceName, customerSwitchName, hours);
    if (data) {
      if (Array.isArray(data.sentData)) {
        allSentData = allSentData.concat(data.sentData);
      }
      if (Array.isArray(data.recvData)) {
        allRecvData = allRecvData.concat(data.recvData);
      }
    }

    if (!allRecvData.length && !allSentData.length) {
      return res.status(500).json({ message: "Failed to fetch Zabbix history for customer's BNG" });
    }

    // Choose the direction to use: prefer Received, otherwise fall back to Sent
    const sourceData = allRecvData.length ? allRecvData : allSentData;

    // Merge samples by timestamp using the chosen direction only
    const samplesByClock = {};

    sourceData.forEach((d) => {
      const clock = d.clock;
      const value = parseFloat(d.value || "0");
      if (!samplesByClock[clock] || value > samplesByClock[clock]) {
        samplesByClock[clock] = value;
      }
    });

    const values = Object.values(samplesByClock).map((v) => (typeof v === "number" ? v : parseFloat(v)));
    const totalSamples = values.length;

    if (totalSamples === 0) {
      return res.status(200).json({
        interfaceName,
        switchName: customerSwitchName,
        startDate,
        endDate: now.toISOString(),
        totalSamples: 0,
        upSamples: 0,
        downSamples: 0,
        uptimePercentage: 0,
        downtimePercentage: 0,
        message: "No Zabbix data found for the selected period",
      });
    }

    let upSamples = 0;
    values.forEach((v) => {
      if (v > 0) upSamples += 1;
    });

    const downSamples = totalSamples - upSamples;
    const uptimePercentage = Number(((upSamples / totalSamples) * 100).toFixed(2));
    const downtimePercentage = Number(((downSamples / totalSamples) * 100).toFixed(2));

    return res.status(200).json({
      interfaceName,
      switchName: customerSwitchName,
      startDate,
      endDate: now.toISOString(),
      totalSamples,
      upSamples,
      downSamples,
      uptimePercentage,
      downtimePercentage,
    });
  } catch (error) {
    console.error("Error calculating customer uptime:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

/**
 * Helper to fetch Neighbor, Flaps, and Power in parallel
 */
async function getNeighborDetails(host, base) {
  const shortIntf = `${base}.0`;
  const neighborOutput = await runCommand(host, `show l2circuit connections interface ${shortIntf} | match Neighbor`);
  const neighborIp = neighborOutput.match(/Neighbor:\s+(\d{1,3}(?:\.\d{1,3}){3})/i)?.[1];

  if (!neighborIp) return { error: "Neighbor IP not found" };

  // Run Port search, Flaps, and Power in ONE SSH session if possible, or parallel
  const portSearch = await runCommand(neighborIp, `show interfaces descriptions | match ${base}`);
  const customerPort = portSearch.match(/^(ge-\d+\/\d+\/\d+|xe-\d+\/\d+\/\d+)/i)?.[1];

  if (!customerPort) return { error: "Port not found on neighbor" };

  // Parallelize the diagnostic commands
  const [flapOutput, powerOutput, media] = await Promise.all([
    runCommand(neighborIp, `show interfaces ${customerPort} | match flapped`),
    runCommand(neighborIp, `show interface diagnostics optics ${customerPort} | match power | except off`),
    runCommand(neighborIp, `show interfaces ${customerPort} | match Media`),
  ]);
  // Look up neighbor switch details from devices table
  let neighborSwitch = { ip: neighborIp };
  try {
    const device = await devices.findOne({ where: { ip: neighborIp } });
    if (device) {
      neighborSwitch = {
        ip: device.ip,
        name:
          device.name ||
          device.switchName ||
          device.hostname ||
          device.deviceName ||
          device.description ||
          neighborIp,
      };
    }
  } catch (e) {
    console.error("Error fetching neighbor device from DB:", e.message);
  }

  return {
    flappedInfo: parseFlaps(flapOutput),
    powerInfo: parsePower(powerOutput),
    mediaType: parseMedia(media),
    customerPort,
    neighborSwitch,
  };
}


async function getZabbixHistory(interfaceName, switchName, hours = 6) {
  try {
    const url = "https://monitoring.liquidtelecom.net/api_jsonrpc.php";
    const headers = { "Content-Type": "application/json", Authorization: undefined, };

    // 1. Login
    const loginRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "user.login",
      params: { username: "godwin.makyao@liquidtech.co.tz", password: "Namwel200148#@!" },
      id: 1,
    }, { headers });

    const authToken = loginRes.data.result;

    // 2. Get Host ID
    const hostRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "host.get",
      params: {
        output: ["hostid"],
        filter: { host: [switchName] },
      },
      id: 1,
      auth: authToken,
    }, { headers });

    const hostId = hostRes.data.result[0]?.hostid;
    if (!hostId) return null;

    // 3. Get Graph and Items
    const graphRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "graph.get",
      params: {
        hostids: [hostId],
        search: { name: interfaceName },
        output: "extend",
        selectItems: "extend",
      },
      id: 1,
      auth: authToken,
    }, { headers });

    const graph = graphRes.data.result[0];
    if (!graph || !graph.items) return null;

    const itemids = graph.items.map((i) => i.itemid);
    const now = Math.floor(Date.now() / 1000);
    const time_from = now - hours * 3600; // Last `hours` hours

    // 4. Get History
    const historyRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "history.get",
      params: {
        history: 3, // 3 = Numeric Float
        itemids,
        time_from,
        time_till: now,
        output: "extend",
        sortfield: "clock",
        sortorder: "ASC",
      },
      id: 1,
      auth: authToken,
    }, { headers });

    const result = historyRes.data.result;

    // Split data by item ID (assuming index 0 is Sent and index 1 is Received)
    return {
      sentData: result.filter((d) => d.itemid === itemids[0]),
      recvData: result.filter((d) => d.itemid === itemids[1]),
    };
  } catch (error) {
    console.error("Zabbix API Error:", error.message);
    return null; // Return null so the main controller doesn't crash
  }
}

// Export Zabbix helper for reuse in cron jobs and other controllers
exports.getZabbixHistory = getZabbixHistory;

/**
 * Parses interface flap output
 * Expected input: "Last flapped: 2024-05-20 10:00:00 UTC (02:45:12 ago)"
 */
function parseFlaps(flapOutput) {
  if (!flapOutput) return "No flap data available";

  const flapRegex = /Last flapped\s*:\s*([\d\-: ]+\w*) \(([^)]+) ago\)/i;
  const match = flapOutput.match(flapRegex);

  return match ? {
    lastFlapped: match[1].trim(),
    durationAgo: match[2].trim(),
  } : flapOutput.trim();
}

/**
 * Parses optical diagnostic power output
 * Expected input lines: "Receiver signal average optical power: 0.123 mW / -9.10 dBm"
 */
function parsePower(powerOutput) {
  if (!powerOutput) return "No power data available";

  const powerInfo = [];
  const powerRegex = /^\s*([^:]+):\s+([\d.]+) mW \/ ([\-\d.]+) dBm$/gm;
  
  let match;
  while ((match = powerRegex.exec(powerOutput)) !== null) {
    powerInfo.push({
      label: match[1].trim(),
      mW: parseFloat(match[2]),
      dBm: parseFloat(match[3]),
    });
  }

  return powerInfo.length > 0 ? powerInfo : powerOutput.trim();
}

/**
 * Parses media type output
 * Expected input: "Media type: Fiber" or "Media type: Copper"
 */
function parseMedia(mediaOutput) {
  if (!mediaOutput) return "Unknown";

  const match = mediaOutput.match(/Media type:\s*(\w+)/i);
  return match ? match[1] : mediaOutput.trim();
}

/**
 * Parses ping results for packet loss and latency
 */
function parsePing(ip, pingOutput) {
  const packetLossRegex = /(\d+)% packet loss/i;
  const latencyRegex = /round-trip min\/avg\/max\/stddev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/i;

  const lossMatch = pingOutput.match(packetLossRegex);
  const latMatch = pingOutput.match(latencyRegex);

  return {
    ip,
    packetLoss: lossMatch ? parseFloat(lossMatch[1]) : 100, // Assume 100% loss if no match
    minLatency: latMatch ? parseFloat(latMatch[1]) : null,
    avgLatency: latMatch ? parseFloat(latMatch[2]) : null,
    maxLatency: latMatch ? parseFloat(latMatch[3]) : null,
    stddevLatency: latMatch ? parseFloat(latMatch[4]) : null,
  };
}