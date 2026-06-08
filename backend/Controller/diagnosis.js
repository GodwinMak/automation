const db = require("../Models");
const { Client } = require("ssh2");
const axios = require("axios");
const { exec } = require("child_process");
const { randomUUID } = require("crypto");
const Redis = require("ioredis");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const switches = [
  { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
  { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
  { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
  { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
];

const peSwitches = [
  { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
  { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
];

const iptSwitches =[
  { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
  { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
  { name: "LTZ-P1-DAR", host: "197.155.94.114" }
]

const sshConfig = {
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
};

const diacustomer = db.diacustomers;
const devices = db.devices;
const PING_COUNT = Number(process.env.DIAGNOSIS_PING_COUNT || 20);
const MAX_PING_IPS = Number(process.env.DIAGNOSIS_MAX_PING_IPS || 5);
const PING_CONCURRENCY = Number(process.env.DIAGNOSIS_PING_CONCURRENCY || 3);
const SSH_READY_TIMEOUT_MS = Number(process.env.DIAGNOSIS_SSH_READY_TIMEOUT_MS || 12000);
const DIAGNOSIS_WORKER_TIMEOUT_MS = Number(process.env.DIAGNOSIS_WORKER_TIMEOUT_MS || 60000);
const DIAGNOSIS_REQUEST_CHANNEL = "diagnosis:requests";
const DIAGNOSIS_RESPONSE_CHANNEL_PREFIX = "diagnosis:responses:";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const DIAGNOSIS_TIMING_ENABLED = process.env.DIAGNOSIS_TIMING_ENABLED !== "0";
let diagnosisRedisPublisher = null;
let diagnosisRedisPublisherConnect = null;

// === HELPER FUNCTIONS ===
function logDiagnosisTime(label, startedAt, extra = "") {
  if (!DIAGNOSIS_TIMING_ENABLED) return;
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[Diagnosis Timing] ${label} took ${Date.now() - startedAt}ms${suffix}`);
}

async function timedDiagnosisStep(label, fn, extra = "") {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    logDiagnosisTime(label, startedAt, extra);
  }
}

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
      .connect({ host, readyTimeout: SSH_READY_TIMEOUT_MS, keepaliveInterval: 5000, ...sshConfig });
  });
};

async function runCommandSafe(host, cmd, label = host) {
  const startedAt = Date.now();
  try {
    const output = await runCommand(host, cmd);
    logDiagnosisTime(`SSH ${label}`, startedAt, `host=${host}`);
    return output;
  } catch (error) {
    logDiagnosisTime(`SSH ${label}`, startedAt, `host=${host} failed=${error.message}`);
    console.warn(`[Diagnosis SSH] ${label} failed: ${error.message}`);
    return "";
  }
}

async function getInterfaceMatches(switchList, interfaceName) {
  const startedAt = Date.now();
  const results = await Promise.all(
    switchList.map(async (sw) => {
      const cmd = `show interfaces descriptions | match ${interfaceName}`;
      const output = await runCommandSafe(sw.host, cmd, sw.name);
      return parseInterfaces(output, sw.name, sw.host);
    })
  );

  const matches = results.flat();
  logDiagnosisTime("interface discovery", startedAt, `interface=${interfaceName} matches=${matches.length}`);
  return matches;
}

async function pingIps(host, ips, buildCommand = (ip) => `ping ${ip} rapid count ${PING_COUNT}`) {
  const startedAt = Date.now();
  const limitedIps = ips.slice(0, MAX_PING_IPS);
  const pingResults = [];
  let problematicPing = null;
  const queue = [...limitedIps];

  const workers = Array.from({ length: Math.min(PING_CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !problematicPing) {
      const ip = queue.shift();
      const pingOutput = await runCommandSafe(host, buildCommand(ip), `ping ${ip}`);
      const result = parsePing(ip, pingOutput);
      pingResults.push(result);
      if (result.packetLoss > 20 || result.avgLatency > 25) {
        problematicPing = result;
        break;
      }
    }
  });

  await Promise.all(workers);
  logDiagnosisTime("ping batch", startedAt, `host=${host} attempted=${limitedIps.length}`);
  return { pingResults, problematicPing };
}


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
  const diagnosisStartedAt = Date.now();

  try {
    const customer = await timedDiagnosisStep(
      "dia customer db lookup",
      () => diacustomer.findOne({ where: { interface: interfaceName } }),
      `interface=${interfaceName}`
    );
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const allInterfaces = await getInterfaceMatches(switches, interfaceName);
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });

    const base = interfaceName.split(".")[0];

    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const neighborData = await timedDiagnosisStep(
        "dia neighbor details",
        () => getNeighborDetails(activeIntf.host, base),
        `interface=${interfaceName}`
      );
      logDiagnosisTime("dia diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is down on both BNGs",
        ...neighborData
      });
    }

    // --- CASE: UP ---
    // 2. Get ARP and Ping in parallel (or sequential if logic depends on it)
    const arpCmd = `show arp no-resolve interface ${interfaceName}`;
    const arpOutput = await timedDiagnosisStep(
      "dia arp lookup",
      () => runCommandSafe(activeIntf.host, arpCmd, `arp ${activeIntf.switchName}`),
      `interface=${interfaceName}`
    );
    const ipRegex = /(\d{1,3}(?:\.\d{1,3}){3})/g;
    const customerIps = [...arpOutput.matchAll(ipRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        timedDiagnosisStep("dia neighbor details", () => getNeighborDetails(activeIntf.host, base), `interface=${interfaceName}`),
        timedDiagnosisStep("dia zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
      ]);
      logDiagnosisTime("dia diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        ...neighborData,
        graphData: zabbixData
      });
    }

    const detailsPromise = Promise.all([
      timedDiagnosisStep("dia neighbor details", () => getNeighborDetails(activeIntf.host, base), `interface=${interfaceName}`),
      timedDiagnosisStep("dia zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
    ]);
    const { pingResults, problematicPing } = await timedDiagnosisStep(
      "dia ping phase",
      () => pingIps(activeIntf.host, customerIps),
      `interface=${interfaceName} ips=${customerIps.length}`
    );

    if (problematicPing) {
      const [neighborData, zabbixData] = await detailsPromise;
      logDiagnosisTime("dia diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);

      return res.status(200).json({
        message: "Customer is up but experiencing issues",
        pingResult: problematicPing,
        ...neighborData,
        graphData: zabbixData
      });
    }else{
      const [neighborData, zabbixData] = await detailsPromise;
      logDiagnosisTime("dia diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is healthy",
        pingResults,
        ...neighborData,
        graphData: zabbixData
      });
    }
  } catch (error) {
    logDiagnosisTime("dia diagnosis total", diagnosisStartedAt, `interface=${interfaceName} failed=${error.message}`);
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

exports.l3vpnDiagnosisController = async (req, res) => {
  const { interfaceName } = req.body;
  const diagnosisStartedAt = Date.now();

  try {
    const l3vpncustomerinfo = db.l3vpncustomerinfos;
    const l3vpncustomer = db.l3vpncustomers;

    const customerInfo = await timedDiagnosisStep(
      "l3vpn customer db lookup",
      () => l3vpncustomerinfo.findOne({
        where: { interface: interfaceName },
        include: [{ model: l3vpncustomer, attributes: ["operationalStatus", "switchName"] }],
      }),
      `interface=${interfaceName}`
    );

    if (!customerInfo) return res.status(404).json({ message: "Customer not found" });

    const routeInstance = customerInfo.route_instance;

    const allInterfaces = await getInterfaceMatches(peSwitches, interfaceName);
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });

    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const [neighborData, zabbixData] = await Promise.all([
        timedDiagnosisStep("l3vpn neighbor details", () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]), `interface=${interfaceName}`),
        timedDiagnosisStep("l3vpn zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
      ]);
      logDiagnosisTime("l3vpn diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is down",
        interface: interfaceName,
        switchName: activeIntf.switchName,
        graphData: zabbixData,
        ...neighborData
      });
    }

    // 2. Get ARP using routing-instance
    const arpCmd =`show arp no-resolve interface ${interfaceName}`;

    const arpOutput = await timedDiagnosisStep(
      "l3vpn arp lookup",
      () => runCommandSafe(activeIntf.host, arpCmd, `arp ${activeIntf.switchName}`),
      `interface=${interfaceName}`
    );
    // Match lines: <MAC>  <IP>  <interface>  <flags>
    const arpLineRegex = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}\s+(\d{1,3}(?:\.\d{1,3}){3})/gim;
    const customerIps = [...arpOutput.matchAll(arpLineRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        timedDiagnosisStep("l3vpn neighbor details", () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]), `interface=${interfaceName}`),
        timedDiagnosisStep("l3vpn zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
      ]);
      logDiagnosisTime("l3vpn diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        interface: interfaceName,
        switchName: activeIntf.switchName,
        routeInstance: routeInstance || null,
        graphData: zabbixData,
        ...neighborData
      });
    }

    const detailsPromise = Promise.all([
      timedDiagnosisStep("l3vpn neighbor details", () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]), `interface=${interfaceName}`),
      timedDiagnosisStep("l3vpn zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
    ]);
    const { pingResults, problematicPing } = await timedDiagnosisStep(
      "l3vpn ping phase",
      () => pingIps(
        activeIntf.host,
        customerIps,
        (ip) => routeInstance
          ? `ping routing-instance ${routeInstance} ${ip} rapid count ${PING_COUNT}`
          : `ping ${ip} rapid count ${PING_COUNT}`
      ),
      `interface=${interfaceName} ips=${customerIps.length}`
    );
    const [neighborData, zabbixData] = await detailsPromise;

    if (problematicPing) {
      logDiagnosisTime("l3vpn diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is up but experiencing issues",
        interface: interfaceName,
        switchName: activeIntf.switchName,
        routeInstance: routeInstance || null,
        pingResult: problematicPing,
        graphData: zabbixData,
        ...neighborData
      });
    } else {
      logDiagnosisTime("l3vpn diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is healthy",
        interface: interfaceName,
        switchName: activeIntf.switchName,
        routeInstance: routeInstance || null,
        pingResults,
        graphData: zabbixData,
        ...neighborData
      });
    }
  } catch (error) {
    logDiagnosisTime("l3vpn diagnosis total", diagnosisStartedAt, `interface=${interfaceName} failed=${error.message}`);
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

exports.iptDiagnosisController = async (req, res) => {
  const { interfaceName } = req.body;
  const diagnosisStartedAt = Date.now();

  try {
    const iptcusomter = db.iptcustomers;
    const iptcustomerinfo = db.iptcustomerinfos;

    const customerInfo = await timedDiagnosisStep(
      "ipt customer db lookup",
      () => iptcustomerinfo.findOne({
        where: { interface: interfaceName },
        include: [{ model: iptcusomter, attributes: ["operationalStatus", "switchName"] }],
      }),
      `interface=${interfaceName}`
    );

    if (!customerInfo) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const allInterfaces = await getInterfaceMatches(iptSwitches, interfaceName);
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });


    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const neighborData = await timedDiagnosisStep(
        "ipt neighbor details",
        () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        `interface=${interfaceName}`
      );
      logDiagnosisTime("ipt diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is down on both BNGs",
        ...neighborData
      });
    }

    // --- CASE: UP ---
    // 2. Get ARP IPs
    const arpCmd = `show arp no-resolve interface ${interfaceName}`;
    const arpOutput = await timedDiagnosisStep(
      "ipt arp lookup",
      () => runCommandSafe(activeIntf.host, arpCmd, `arp ${activeIntf.switchName}`),
      `interface=${interfaceName}`
    );
    const ipRegex = /(\d{1,3}(?:\.\d{1,3}){3})/g;
    const customerIps = [...arpOutput.matchAll(ipRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        timedDiagnosisStep("ipt neighbor details", () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]), `interface=${interfaceName}`),
        timedDiagnosisStep("ipt zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
      ]);
      logDiagnosisTime("ipt diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        ...neighborData,
        graphData: zabbixData
      });
    }

    const customerIp = customerIps[0];

    const detailsPromise = Promise.all([
      timedDiagnosisStep("ipt neighbor details", () => getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]), `interface=${interfaceName}`),
      timedDiagnosisStep("ipt zabbix history", () => getZabbixHistory(interfaceName, activeIntf.switchName), `interface=${interfaceName}`)
    ]);

    const bgpSummaryOutput = await timedDiagnosisStep(
      "ipt bgp summary",
      () => runCommandSafe(
        activeIntf.host,
        `show bgp summary | match ${customerIp}`,
        `bgp summary ${activeIntf.switchName}`
      ),
      `interface=${interfaceName} customerIp=${customerIp}`
    );

    // Format: "41.175.44.62   327885   18292   2395901   0   42   5d Establ"
    const bgpFields = bgpSummaryOutput.trim().split(/\s+/);
    const customerAsn = bgpFields.length >= 2 ? bgpFields[1] : null;

    // 4. Get routes received from this BGP peer using the ASN
    let bgpRoutes = [];
    if (customerAsn) {
      const routeOutput = await timedDiagnosisStep(
        "ipt bgp routes",
        () => runCommandSafe(
          activeIntf.host,
          `show route receive-protocol bgp ${customerIp} | match ${customerAsn}`,
          `bgp routes ${activeIntf.switchName}`
        ),
        `interface=${interfaceName} asn=${customerAsn}`
      );
      // Parse prefixes: "* 169.255.184.0/22   41.175.44.62   0   327885 ?"
      bgpRoutes = routeOutput
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .reduce((acc, line) => {
          const prefixMatch = line.match(/(\d{1,3}(?:\.\d{1,3}){3}\/\d+)/);
          if (prefixMatch) acc.push(prefixMatch[1]);
          return acc;
        }, []);
    }

    const [neighborData, zabbixData] = await detailsPromise;
    logDiagnosisTime("ipt diagnosis total", diagnosisStartedAt, `interface=${interfaceName}`);

    return res.status(200).json({
      message: customerAsn ? "Customer BGP session established" : "Customer is up but BGP session not found",
      interface: interfaceName,
      switchName: activeIntf.switchName,
      customerIp,
      customerAsn: customerAsn || null,
      bgpRouteCount: bgpRoutes.length,
      bgpRoutes,
      graphData: zabbixData,
      ...neighborData
    });

  } catch (error) {
    logDiagnosisTime("ipt diagnosis total", diagnosisStartedAt, `interface=${interfaceName} failed=${error.message}`);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
}

exports.ftthDiagnosisController = async (req, res) => {
  const { ip } = req.body;
  const diagnosisStartedAt = Date.now();

  if (!ip) return res.status(400).json({ message: "IP address is required" });

  // Basic IP validation to prevent command injection
  if (!/^[\da-f:.]+$/i.test(ip)) {
    return res.status(400).json({ message: "Invalid IP address" });
  }

  try {
    // Fetch customer record for expiry details
    const FTTHCustomer = db.ftthcustomers;
    const customer = await timedDiagnosisStep(
      "ftth customer db lookup",
      () => FTTHCustomer.findOne({
        where: { ip },
        attributes: ["customerID", "customerName", "pppoeusername", "topUpExpiry", "isExpired", "isFreeCustomer", "notInInfo"],
      }),
      `ip=${ip}`
    );

    // Build expiry info block
    let expiryInfo = null;
    if (customer) {
      const expiry = customer.topUpExpiry ? new Date(customer.topUpExpiry) : null;
      if (!expiry) {
        expiryInfo = { status: "unavailable", message: "No expiry date on record" };
      } else {
        const now = new Date();
        const diffMs = expiry.getTime() - now.getTime();
        const diffDays = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
        if (diffMs > 0) {
          expiryInfo = {
            status: "active",
            topUpExpiry: expiry.toISOString().split("T")[0],
            daysRemaining: diffDays,
            message: `Service active — ${diffDays} day(s) remaining`,
          };
        } else {
          expiryInfo = {
            status: "expired",
            topUpExpiry: expiry.toISOString().split("T")[0],
            daysSinceExpiry: diffDays,
            message: `Service expired ${diffDays} day(s) ago`,
            isFreeCustomer: customer.isFreeCustomer || false,
          };
        }
      }
    }

    const pingOutput = await timedDiagnosisStep(
      "ftth local ping",
      () => new Promise((resolve, reject) => {
        exec(`ping -c 3 -W 1 ${ip}`, (error, stdout, stderr) => {
          // ping exits with code 1 on 100% loss - not a real error
          resolve(stdout + stderr);
        });
      }),
      `ip=${ip}`
    );

    const lossMatch = pingOutput.match(/(\d+)% packet loss/i);
    const packetLoss = lossMatch ? parseFloat(lossMatch[1]) : 100;

    const latMatch = pingOutput.match(
      /rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/i
    );

    let status, message;
    if (packetLoss === 100) {
      status = "no_service";
      message = "IP is not responding — customer may have no active service";
    } else {
      status = "active";
      message = "Customer is up with active service";
    }

    logDiagnosisTime("ftth diagnosis total", diagnosisStartedAt, `ip=${ip}`);
    return res.status(200).json({
      ip,
      status,
      message,
      packetLoss,
      pingResult: {
        packetLoss,
        minLatency: latMatch ? parseFloat(latMatch[1]) : null,
        avgLatency: latMatch ? parseFloat(latMatch[2]) : null,
        maxLatency: latMatch ? parseFloat(latMatch[3]) : null,
        stddevLatency: latMatch ? parseFloat(latMatch[4]) : null,
      },
      rawOutput: pingOutput,
      customerInfo: customer
        ? {
            customerID: customer.customerID,
            customerName: customer.customerName,
            pppoeusername: customer.pppoeusername,
            notInInfo: customer.notInInfo || false,
          }
        : null,
      expiryInfo,
    });
  } catch (error) {
    logDiagnosisTime("ftth diagnosis total", diagnosisStartedAt, `ip=${ip} failed=${error.message}`);
    return res.status(500).json({ message: "Diagnosis failed", error: error.message });
  }
};

// Calculate uptime for a single customer based on Zabbix history
// - User provides a start date (YYYY-MM-DD), end date is "now"
// - Range must not exceed 90 days from now
// - For each sample, if traffic > 0 bps it is considered "up"; if 0 then "down"
// - Uptime percentage = upSamples / totalSamples * 100
exports.getCustomerUptime = async (req, res) => {
  const diagnosisStartedAt = Date.now();
  try {
    const { interfaceName, startDate } = req.body;

    if (!interfaceName || !startDate) {
      return res.status(400).json({ message: "interfaceName and startDate are required" });
    }

    const customer = await timedDiagnosisStep(
      "uptime customer db lookup",
      () => diacustomer.findOne({ where: { interface: interfaceName } }),
      `interface=${interfaceName}`
    );
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

    const data = await timedDiagnosisStep(
      "uptime zabbix history",
      () => getZabbixHistory(interfaceName, customerSwitchName, hours),
      `interface=${interfaceName} hours=${hours}`
    );
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
      logDiagnosisTime("uptime total", diagnosisStartedAt, `interface=${interfaceName}`);
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

    logDiagnosisTime("uptime total", diagnosisStartedAt, `interface=${interfaceName}`);
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
    logDiagnosisTime("uptime total", diagnosisStartedAt, `failed=${error.message}`);
    console.error("Error calculating customer uptime:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

/**
 * Helper to fetch Neighbor, Flaps, and Power in parallel
 */
async function getNeighborDetails(host, base) {
  try {
    const shortIntf = `${base}.0`;
    const neighborOutput = await runCommandSafe(
      host,
      `show l2circuit connections interface ${shortIntf} | match Neighbor`,
      `neighbor lookup ${host}`
    );
    const neighborIp = neighborOutput.match(/Neighbor:\s+(\d{1,3}(?:\.\d{1,3}){3})/i)?.[1];

    if (!neighborIp) return { error: "Neighbor IP not found" };

    const portSearch = await runCommandSafe(
      neighborIp,
      `show interfaces descriptions | match ${base}`,
      `neighbor port ${neighborIp}`
    );
    const customerPort = portSearch.match(/^(ge-\d+\/\d+\/\d+|xe-\d+\/\d+\/\d+)/i)?.[1];

    if (!customerPort) return { error: "Port not found on neighbor" };

    const [flapOutput, powerOutput, media] = await Promise.all([
      runCommandSafe(neighborIp, `show interfaces ${customerPort} | match flapped`, `flaps ${neighborIp}`),
      runCommandSafe(neighborIp, `show interface diagnostics optics ${customerPort} | match power | except off`, `power ${neighborIp}`),
      runCommandSafe(neighborIp, `show interfaces ${customerPort} | match Media`, `media ${neighborIp}`),
    ]);

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
  } catch (error) {
    console.warn(`[Diagnosis SSH] neighbor details failed: ${error.message}`);
    return { error: `Neighbor details failed: ${error.message}` };
  }
}


// Zabbix token cache — re-login only when token expires (30-min TTL)
let _zabbixToken = null;
let _zabbixTokenExpiry = 0;
const _zabbixHostCache = new Map();
const _zabbixGraphCache = new Map();
const ZABBIX_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheValue(cache, key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCacheValue(cache, key, value, ttlMs = ZABBIX_LOOKUP_CACHE_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function getZabbixToken(url, headers) {
  const now = Date.now();
  if (_zabbixToken && now < _zabbixTokenExpiry) {
    if (DIAGNOSIS_TIMING_ENABLED) console.log("[Diagnosis Timing] zabbix token cache hit took 0ms");
    return _zabbixToken;
  }
  const loginRes = await timedDiagnosisStep("zabbix login", () => axios.post(url, {
      jsonrpc: "2.0",
      method: "user.login",
      params: { username: process.env.ZABBIX_USERNAME, password: process.env.ZABBIX_PASSWORD },
      id: 1,
    }, { headers })
  );
  _zabbixToken = loginRes.data.result;
  _zabbixTokenExpiry = now + 30 * 60 * 1000; // 30 minutes
  return _zabbixToken;
}

async function getZabbixHistory(interfaceName, switchName, hours = 6) {
  const startedAt = Date.now();

  const getZabbixHostName = (switchName) => {
    const hostMapping = {
      "LTZ-PE1-RAH": "lo-0.ltz-pe1-rah.liquidtelecom.net",
      "LTZ-P1-DAR": "lo-0.ltz-p1-dar.liquidtelecom.net",
      // Add more mappings here as needed
    };
    return hostMapping[switchName] || switchName;
  };

  try {
    const url = "https://monitoring.liquidtelecom.net/api_jsonrpc.php";
    const headers = { "Content-Type": "application/json", Authorization: undefined };

    // 1. Get cached auth token to avoid re-login on every call
    const authToken = await getZabbixToken(url, headers);

    // 2. Get Host ID
    const zabbixHostName = getZabbixHostName(switchName);
    const hostCacheKey = zabbixHostName;
    let hostId = getCacheValue(_zabbixHostCache, hostCacheKey);

    if (!hostId) {
      const hostRes = await timedDiagnosisStep("zabbix host lookup", () => axios.post(url, {
          jsonrpc: "2.0",
          method: "host.get",
          params: {
            output: ["hostid"],
            filter: { host: [zabbixHostName] },
          },
          id: 1,
          auth: authToken,
        }, { headers }),
        `switch=${switchName}`
      );

      hostId = hostRes.data.result[0]?.hostid;
      if (hostId) setCacheValue(_zabbixHostCache, hostCacheKey, hostId);
    } else if (DIAGNOSIS_TIMING_ENABLED) {
      console.log(`[Diagnosis Timing] zabbix host cache hit took 0ms switch=${switchName}`);
    }
    if (!hostId) {
      logDiagnosisTime("zabbix history total", startedAt, `interface=${interfaceName} switch=${switchName} noHost=1`);
      return null;
    }

    // 3. Get Graph and Items
    const graphCacheKey = `${hostId}:${interfaceName}`;
    let itemids = getCacheValue(_zabbixGraphCache, graphCacheKey);

    if (!itemids) {
      const graphRes = await timedDiagnosisStep("zabbix graph lookup", () => axios.post(url, {
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
        }, { headers }),
        `interface=${interfaceName} switch=${switchName}`
      );

      const graph = graphRes.data.result[0];
      if (!graph || !graph.items) {
        logDiagnosisTime("zabbix history total", startedAt, `interface=${interfaceName} switch=${switchName} noGraph=1`);
        return null;
      }

      itemids = graph.items.map((i) => i.itemid);
      setCacheValue(_zabbixGraphCache, graphCacheKey, itemids);
    } else if (DIAGNOSIS_TIMING_ENABLED) {
      console.log(`[Diagnosis Timing] zabbix graph cache hit took 0ms interface=${interfaceName} switch=${switchName}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const time_from = now - hours * 3600; // Last `hours` hours

    // 4. Get History
    const historyRes = await timedDiagnosisStep("zabbix history fetch", () => axios.post(url, {
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
      }, { headers }),
      `interface=${interfaceName} switch=${switchName} hours=${hours}`
    );

    const result = historyRes.data.result;

    // Split data by item ID (assuming index 0 is Sent and index 1 is Received)
    const payload = {
      sentData: result.filter((d) => d.itemid === itemids[0]),
      recvData: result.filter((d) => d.itemid === itemids[1]),
    };
    logDiagnosisTime(
      "zabbix history total",
      startedAt,
      `interface=${interfaceName} switch=${switchName} samples=${payload.sentData.length + payload.recvData.length}`
    );
    return payload;
  } catch (error) {
    // If the token was rejected, clear cache so next call re-authenticates
    if (error?.response?.data?.error?.code === -32602) {
      _zabbixToken = null;
      _zabbixTokenExpiry = 0;
    }
    logDiagnosisTime("zabbix history total", startedAt, `interface=${interfaceName} switch=${switchName} failed=${error.message}`);
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

const directDiagnosisHandlers = {
  dia: exports.diagnosisController,
  l3vpn: exports.l3vpnDiagnosisController,
  ipt: exports.iptDiagnosisController,
  ftth: exports.ftthDiagnosisController,
  uptime: exports.getCustomerUptime,
};

exports.runDiagnosisDirect = async (type, body) => {
  const startedAt = Date.now();
  const handler = directDiagnosisHandlers[type];
  if (!handler) {
    logDiagnosisTime("worker direct diagnosis", startedAt, `type=${type} unknown=1`);
    return { statusCode: 400, data: { message: "Unknown diagnosis type" } };
  }

  return new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        logDiagnosisTime("worker direct diagnosis", startedAt, `type=${type} status=${this.statusCode}`);
        resolve({ statusCode: this.statusCode, data });
      },
    };

    Promise.resolve(handler(req, res)).catch((error) => {
      logDiagnosisTime("worker direct diagnosis", startedAt, `type=${type} failed=${error.message}`);
      resolve({
        statusCode: 500,
        data: { message: "Internal Server Error", error: error.message },
      });
    });
  });
};

async function getDiagnosisRedisPublisher() {
  if (!diagnosisRedisPublisher) {
    diagnosisRedisPublisher = new Redis(REDIS_URL, { lazyConnect: true });
    diagnosisRedisPublisher.on("error", (error) => {
      console.error("[Diagnosis] Redis publisher error:", error.message);
    });
    diagnosisRedisPublisherConnect = diagnosisRedisPublisher.connect();
  }

  await diagnosisRedisPublisherConnect;
  return diagnosisRedisPublisher;
}

function runDiagnosisInWorker(type, body) {
  return new Promise((resolve, reject) => {
    const queuedAt = Date.now();
    let settled = false;
    const requestId = randomUUID();
    const responseChannel = `${DIAGNOSIS_RESPONSE_CHANNEL_PREFIX}${requestId}`;
    const subscriber = new Redis(REDIS_URL, { lazyConnect: true });

    const cleanup = async () => {
      try {
        await subscriber.unsubscribe(responseChannel);
      } catch (error) {
        // Ignore unsubscribe failures during timeout/error cleanup.
      }
      subscriber.disconnect();
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      logDiagnosisTime("diagnosis queue wait", queuedAt, `type=${type} requestId=${requestId} timeout=1`);
      reject(new Error("Diagnosis worker timed out or is not running"));
    }, DIAGNOSIS_WORKER_TIMEOUT_MS);

    subscriber.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      logDiagnosisTime("diagnosis queue wait", queuedAt, `type=${type} requestId=${requestId} redisError=${error.message}`);
      reject(error);
    });

    subscriber.on("message", (_channel, rawMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      try {
        const parsed = JSON.parse(rawMessage);
        logDiagnosisTime("diagnosis queue wait", queuedAt, `type=${type} requestId=${requestId} status=${parsed.statusCode || 200}`);
        resolve(parsed);
      } catch (error) {
        logDiagnosisTime("diagnosis queue wait", queuedAt, `type=${type} requestId=${requestId} parseError=${error.message}`);
        reject(error);
      }
    });

    subscriber.connect()
      .then(() => subscriber.subscribe(responseChannel))
      .then(() => getDiagnosisRedisPublisher())
      .then((publisher) => publisher.publish(DIAGNOSIS_REQUEST_CHANNEL, JSON.stringify({
        requestId,
        responseChannel,
        type,
        body,
      })))
      .then(() => {
        logDiagnosisTime("diagnosis queue publish", queuedAt, `type=${type} requestId=${requestId}`);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        logDiagnosisTime("diagnosis queue wait", queuedAt, `type=${type} requestId=${requestId} failed=${error.message}`);
        reject(error);
      });
  });
}

function createQueuedDiagnosisController(type) {
  return async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await runDiagnosisInWorker(type, req.body);
      logDiagnosisTime("http diagnosis route", startedAt, `type=${type} status=${result.statusCode || 200}`);
      return res.status(result.statusCode || 200).json(result.data);
    } catch (error) {
      logDiagnosisTime("http diagnosis route", startedAt, `type=${type} failed=${error.message}`);
      return res.status(500).json({ message: "Diagnosis worker failed", error: error.message });
    }
  };
}

if (!process.env.DIAGNOSIS_WORKER_PROCESS) {
  exports.diagnosisController = createQueuedDiagnosisController("dia");
  exports.l3vpnDiagnosisController = createQueuedDiagnosisController("l3vpn");
  exports.iptDiagnosisController = createQueuedDiagnosisController("ipt");
  exports.ftthDiagnosisController = createQueuedDiagnosisController("ftth");
  exports.getCustomerUptime = createQueuedDiagnosisController("uptime");
}
