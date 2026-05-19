const db = require("../Models");
const { Client } = require("ssh2");
const axios = require("axios");
const { exec } = require("child_process");
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
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);
      return res.status(200).json({
        message: "Customer is healthy",
        pingResults,
        ...neighborData,
        graphData: zabbixData
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

exports.l3vpnDiagnosisController = async (req, res) => {
  const { interfaceName } = req.body;

  try {
    const l3vpncustomerinfo = db.l3vpncustomerinfos;
    const l3vpncustomer = db.l3vpncustomers;

    const customerInfo = await l3vpncustomerinfo.findOne({
      where: { interface: interfaceName },
      include: [{ model: l3vpncustomer, attributes: ["operationalStatus", "switchName"] }],
    });

    if (!customerInfo) return res.status(404).json({ message: "Customer not found" });

    const routeInstance = customerInfo.route_instance;

    // 1. Parallel check across all PEs
    const peResults = await Promise.all(
      peSwitches.map(async (sw) => {
        const cmd = `show interfaces descriptions | match ${interfaceName}`;
        const output = await runCommand(sw.host, cmd);
        return parseInterfaces(output, sw.name, sw.host);
      })
    );

    const allInterfaces = peResults.flat();
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });

    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);
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

    const arpOutput = await runCommand(activeIntf.host, arpCmd);
    // Match lines: <MAC>  <IP>  <interface>  <flags>
    const arpLineRegex = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}\s+(\d{1,3}(?:\.\d{1,3}){3})/gim;
    const customerIps = [...arpOutput.matchAll(arpLineRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        interface: interfaceName,
        switchName: activeIntf.switchName,
        routeInstance: routeInstance || null,
        graphData: zabbixData,
        ...neighborData
      });
    }

    // 3. Ping IPs in parallel using routing-instance
    const pingResults = await Promise.all(customerIps.map(async (ip) => {
      const pingCmd = routeInstance
        ? `ping routing-instance ${routeInstance} ${ip} rapid count 100`
        : `ping ${ip} rapid count 100`;
      const pingOutput = await runCommand(activeIntf.host, pingCmd);
      return parsePing(ip, pingOutput);
    }));

    const problematicPing = pingResults.find(p => p.packetLoss > 20 || p.avgLatency > 25);

    const [neighborData, zabbixData] = await Promise.all([
      getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
      getZabbixHistory(interfaceName, activeIntf.switchName)
    ]);

    if (problematicPing) {
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
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

exports.iptDiagnosisController = async (req, res) => {
  const { interfaceName } = req.body;

  try {
    const iptcusomter = db.iptcustomers;
    const iptcustomerinfo = db.iptcustomerinfos;

    const customerInfo = await iptcustomerinfo.findOne({
      where: { interface: interfaceName },
      include: [{ model: iptcusomter, attributes: ["operationalStatus", "switchName"] }],
    });

    if (!customerInfo) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // 1. Parallel check across all IPT PEs
    const iptSwitchesResults = await Promise.all(
      iptSwitches.map(async (sw) => {
        const cmd = `show interfaces descriptions | match ${interfaceName}`;
        const output = await runCommand(sw.host, cmd);
        return parseInterfaces(output, sw.name, sw.host);
      })
    );

    const allInterfaces = iptSwitchesResults.flat();
    const activeIntf = allInterfaces.find(i => i.operationalStatus === "up") || allInterfaces[0];

    if (!activeIntf) return res.status(404).json({ message: "No interface data found" });


    // --- CASE: DOWN ---
    if (activeIntf.operationalStatus === "down") {
      const neighborData = await getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]);
      return res.status(200).json({
        message: "Customer is down on both BNGs",
        ...neighborData
      });
    }

    // --- CASE: UP ---
    // 2. Get ARP IPs
    const arpCmd = `show arp no-resolve interface ${interfaceName}`;
    const arpOutput = await runCommand(activeIntf.host, arpCmd);
    const ipRegex = /(\d{1,3}(?:\.\d{1,3}){3})/g;
    const customerIps = [...arpOutput.matchAll(ipRegex)].map(m => m[1]);

    if (customerIps.length === 0) {
      const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);
      return res.status(200).json({
        message: "Customer is up but no IPs found in ARP",
        ...neighborData,
        graphData: zabbixData
      });
    }

    const customerIp = customerIps[0];

    // 3. Get BGP summary to extract ASN
    const bgpSummaryOutput = await runCommand(
      activeIntf.host,
      `show bgp summary | match ${customerIp}`
    );

    // Format: "41.175.44.62   327885   18292   2395901   0   42   5d Establ"
    const bgpFields = bgpSummaryOutput.trim().split(/\s+/);
    const customerAsn = bgpFields.length >= 2 ? bgpFields[1] : null;

    // 4. Get routes received from this BGP peer using the ASN
    let bgpRoutes = [];
    if (customerAsn) {
      const routeOutput = await runCommand(
        activeIntf.host,
        `show route receive-protocol bgp ${customerIp} | match ${customerAsn}`
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

    const [neighborData, zabbixData] = await Promise.all([
        getNeighborDetails(activeIntf.host, interfaceName.split(".")[0]),
        getZabbixHistory(interfaceName, activeIntf.switchName)
      ]);

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
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
}

exports.ftthDiagnosisController = async (req, res) => {
  const { ip } = req.body;

  if (!ip) return res.status(400).json({ message: "IP address is required" });

  // Basic IP validation to prevent command injection
  if (!/^[\da-f:.]+$/i.test(ip)) {
    return res.status(400).json({ message: "Invalid IP address" });
  }

  try {
    // Fetch customer record for expiry details
    const FTTHCustomer = db.ftthcustomers;
    const customer = await FTTHCustomer.findOne({
      where: { ip },
      attributes: ["customerID", "customerName", "pppoeusername", "topUpExpiry", "isExpired", "isFreeCustomer", "notInInfo"],
    });

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

    const pingOutput = await new Promise((resolve, reject) => {
      // -c 5: 5 packets, -W 2: 2s timeout per packet
      exec(`ping -c 5 -W 2 ${ip}`, (error, stdout, stderr) => {
        // ping exits with code 1 on 100% loss — not a real error
        resolve(stdout + stderr);
      });
    });

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
    return res.status(500).json({ message: "Diagnosis failed", error: error.message });
  }
};

// Calculate uptime for a single customer based on Zabbix history
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
    const headers = { "Content-Type": "application/json", Authorization: undefined, };

    // 1. Login
    const loginRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "user.login",
      params: { username: process.env.ZABBIX_USERNAME, password: process.env.ZABBIX_PASSWORD },
      id: 1,
    }, { headers });

    const authToken = loginRes.data.result;

    // 2. Get Host ID
    const hostRes = await axios.post(url, {
      jsonrpc: "2.0",
      method: "host.get",
      params: {
        output: ["hostid"],
        filter: { host: [getZabbixHostName(switchName)] },
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