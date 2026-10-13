const { Client } = require("ssh2");

/**
 * Calculate network address from an IP with CIDR notation
 * e.g., "154.72.90.49/30" → "154.72.90.48/30"
 * @param {string} ipWithCidr - IP address with CIDR (e.g., "154.72.90.49/30")
 * @returns {string} Network address with CIDR (e.g., "154.72.90.48/30")
 */
const getNetworkAddress = (ipWithCidr) => {
  console.log(`[CALC] Calculating network address from: ${ipWithCidr}`);
  
  if (!ipWithCidr || !ipWithCidr.includes("/")) {
    console.log(`[CALC] Invalid IP format, returning as-is: ${ipWithCidr}`);
    return ipWithCidr;
  }
  
  const [ip, cidrStr] = ipWithCidr.split("/");
  const cidr = parseInt(cidrStr, 10);
  
  // Convert IP to 32-bit integer
  const octets = ip.split(".").map(Number);
  const ipInt = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  
  // Create subnet mask (e.g., /30 → 0xFFFFFFFC)
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  
  // Calculate network address
  const networkInt = (ipInt & mask) >>> 0;
  
  // Convert back to dotted decimal
  const networkOctets = [
    (networkInt >>> 24) & 255,
    (networkInt >>> 16) & 255,
    (networkInt >>> 8) & 255,
    networkInt & 255
  ];
  
  const result = `${networkOctets.join(".")}/${cidr}`;
  console.log(`[CALC] Network address calculated: ${ipWithCidr} → ${result}`);
  return result;
};

// Helper to run commands on Junos via SSH
const runJunosCommands = (host, sshConfig, commands, deviceName = "device") => {
  console.log(`\n[SSH] ========================================`);
  console.log(`[SSH] Connecting to ${deviceName} at ${host}...`);
  console.log(`[SSH] Username: ${sshConfig.username}`);
  console.log(`[SSH] Commands to execute: ${commands.length}`);
  console.log(`[SSH] ========================================`);
  
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let result = "";
    
    conn.on("error", (err) => {
      console.error(`[SSH] ❌ Connection error to ${deviceName} (${host}):`, err.message);
      reject(err);
    });
    
    conn
      .on("ready", () => {
        console.log(`[SSH] ✅ Connected to ${deviceName} (${host})`);
        console.log(`[SSH] Opening shell...`);
        
        conn.shell((err, stream) => {
          if (err) {
            console.error(`[SSH] ❌ Shell error:`, err.message);
            return reject(err);
          }

          console.log(`[SSH] ✅ Shell opened on ${deviceName}`);
          let isDone = false;
          let commandsSent = false;

          stream.on("data", (data) => {
            const output = data.toString();
            result += output;
            
            // Log output (truncate if too long)
            const lines = output.split('\n').filter(l => l.trim());
            lines.forEach(line => {
              if (line.trim()) {
                console.log(`[SSH] [${deviceName}] ${line.substring(0, 200)}`);
              }
            });
            
            if (isDone) return;

            if (result.includes("configuration check succeeds")) {
              console.log(`[SSH] ✅ Commit check PASSED on ${deviceName}`);
              console.log(`[SSH] Executing 'commit and-quit'...`);
              stream.write("commit and-quit\n");
              isDone = true;
              
              // Wait a bit for commit to complete
              setTimeout(() => {
                console.log(`[SSH] ✅ Configuration committed on ${deviceName}`);
                resolve(result);
              }, 2000);
            } else if (result.includes("error:") || result.includes("syntax error")) {
              console.error(`[SSH] ❌ Configuration error detected on ${deviceName}`);
              isDone = true;
              reject(new Error(`Configuration error on ${deviceName}: Check command syntax`));
            }
          });

          stream.on("close", (hadError) => {
            console.log(`[SSH] Stream closed on ${deviceName} (hadError: ${hadError})`);
            conn.end();
            if (hadError && !isDone) {
              reject(new Error(`SSH session closed unexpectedly on ${deviceName}.`));
            } else if (!isDone) {
              reject(new Error(`No valid commit confirmation on ${deviceName}.`));
            }
          });

          // Start configuration
          console.log(`[SSH] Entering configuration mode on ${deviceName}...`);
          stream.write("configure private\n");
          
          // Send each command with a small delay
          console.log(`[SSH] Sending ${commands.length} commands to ${deviceName}...`);
          commands.forEach((cmd, idx) => {
            console.log(`[SSH] [${deviceName}] CMD ${idx + 1}/${commands.length}: ${cmd}`);
            stream.write(cmd + "\n");
          });
          
          console.log(`[SSH] Running commit check on ${deviceName}...`);
          stream.write("commit check\n");
          commandsSent = true;
        });
      })
      .connect({ host, ...sshConfig });
  });
};

/**
 * Extract common PE/BNG identifier from full name
 * e.g., "LTZ-BNG02-TIG-DAR" → "LTZ-BNG02"
 * e.g., "LTZ-PE1-RAH" → "LTZ-PE1"
 */
const extractPeIdentifier = (peName) => {
  if (!peName) return "";
  
  // Split by dash and take first two parts (e.g., LTZ-PE1 or LTZ-BNG02)
  const parts = peName.split("-");
  if (parts.length >= 2) {
    const result = `${parts[0]}-${parts[1]}`;
    console.log(`[EXTRACT] PE identifier: ${peName} → ${result}`);
    return result;
  }
  console.log(`[EXTRACT] PE identifier unchanged: ${peName}`);
  return peName;
};

/**
 * Process CID to get Virtual Circuit ID and Description CID
 * 
 * Logic:
 * - Input CID already has 255 prefix (e.g., "2551800766"):
 *   → vcId = "2551800766" (use as-is)
 *   → cidForDescription = "LTZ1800766" (replace 255 with LTZ)
 * 
 * - Input CID doesn't have 255 prefix (e.g., "1800766"):
 *   → vcId = "2551800766" (add 255 prefix)
 *   → cidForDescription = "LTZ1800766" (add LTZ prefix)
 * 
 * @param {string} cid - Circuit ID (e.g., "2551800766" or "1800766")
 * @returns {{ vcId: string, cidForDescription: string }}
 */
const processCid = (cid) => {
  // Remove any non-digit characters
  const digitsOnly = (cid || "").replace(/\D/g, "");
  
  console.log(`[CID] Processing CID: "${cid}" → digits: "${digitsOnly}"`);
  
  let vcId;
  let cidForDescription;
  
  if (digitsOnly.startsWith("255")) {
    // CID already has 255 prefix
    // e.g., "2551800766" → vcId="2551800766", description="LTZ1800766"
    vcId = digitsOnly;
    cidForDescription = "LTZ" + digitsOnly.substring(3); // Remove "255", add "LTZ"
    console.log(`[CID] CID has 255 prefix`);
  } else {
    // CID doesn't have 255 prefix, add it
    // e.g., "1800766" → vcId="2551800766", description="LTZ1800766"
    vcId = "255" + digitsOnly;
    cidForDescription = "LTZ" + digitsOnly;
    console.log(`[CID] CID missing 255 prefix, adding it`);
  }
  
  console.log(`[CID] Virtual Circuit ID: ${vcId}`);
  console.log(`[CID] CID for description: ${cidForDescription}`);
  
  return { vcId, cidForDescription };
};

/**
 * Build commands for Metro Switch
 */
const buildMetroCommands = ({
  intf,
  customerName,
  cid,
  mbps,
  primaryPeName,
  primaryPeIp,
  backupPeName,
  backupPeIp,
  includeInternalSubnet,
  internalSubnet,
  internalNextHop
}) => {
  console.log(`\n[BUILD] ===== Building Metro Switch Commands =====`);
  console.log(`[BUILD] Interface: ${intf}`);
  console.log(`[BUILD] Customer: ${customerName}`);
  console.log(`[BUILD] CID (input): ${cid}`);
  console.log(`[BUILD] Mbps: ${mbps}`);
  console.log(`[BUILD] Primary PE: ${primaryPeName} (${primaryPeIp})`);
  console.log(`[BUILD] Backup PE: ${backupPeName} (${backupPeIp})`);
  
  // Process CID to get proper vcId and description CID
  const { vcId, cidForDescription } = processCid(cid);
  
  // Extract common PE/BNG identifier (e.g., LTZ-PE1, LTZ-BNG02)
  const nbrDescription = extractPeIdentifier(primaryPeName);
  
  const cmds = [
    `set interfaces ${intf} description "DIA: ${customerName}| ${cid} "`,
    `set interfaces ${intf} speed auto`,
    `set interfaces ${intf} mtu 9000`,
    `set interfaces ${intf} encapsulation ethernet-ccc`,
    `set interfaces ${intf} gigether-options auto-negotiation`,
    `set interfaces ${intf} unit 0 description "{cat=DIA|nbr=${nbrDescription}|Customer=${customerName}|cid=${cidForDescription}|Mbps=${mbps}}"`,
    `set interfaces ${intf} unit 0 statistics`,
    `set interfaces ${intf} unit 0 family ccc`,
    // L2 circuit to PRIMARY PE/BNG
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.0 control-word`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.0 mtu 1500`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.0 pseudowire-status-tlv`
  ];

  // Add backup neighbor if second PE/BNG exists
  if (backupPeIp) {
    console.log(`[BUILD] Adding backup neighbor: ${backupPeIp}`);
    cmds.push(
      `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.0 backup-neighbor ${backupPeIp} virtual-circuit-id ${vcId}`
    );
  }

  if (includeInternalSubnet && internalSubnet && internalNextHop) {
    console.log(`[BUILD] Adding internal subnet route: ${internalSubnet} via ${internalNextHop}`);
    cmds.push(`set routing-options static route ${internalSubnet} next-hop ${internalNextHop}`);
  }

  console.log(`[BUILD] Metro commands built: ${cmds.length} commands`);
  return cmds;
};

/**
 * Build commands for PE/BNG device
 */
const buildPeCommands = ({ 
  peIntf, 
  anchorPoint, 
  customerName, 
  cid, 
  mbps, 
  metroName, 
  metroIp, 
  wanIp 
}) => {
  console.log(`\n[BUILD] ===== Building PE/BNG Commands =====`);
  console.log(`[BUILD] PE Interface: ${peIntf}`);
  console.log(`[BUILD] Anchor Point: ${anchorPoint}`);
  console.log(`[BUILD] Customer: ${customerName}`);
  console.log(`[BUILD] CID (input): ${cid}`);
  console.log(`[BUILD] Mbps: ${mbps}`);
  console.log(`[BUILD] Metro: ${metroName} (${metroIp})`);
  console.log(`[BUILD] WAN IP: ${wanIp}`);
  
  // Process CID to get proper vcId and description CID
  const { vcId, cidForDescription } = processCid(cid);
  
  // Calculate network address from WAN IP (gateway → network)
  // e.g., 154.72.90.49/30 → 154.72.90.48/30
  const networkAddress = getNetworkAddress(wanIp);
  console.log(`[BUILD] Route filter network: ${networkAddress}`);
  
  const cmds = [
    `set interfaces ${peIntf} anchor-point ${anchorPoint}`,
    `set interfaces ${peIntf} unit 0 encapsulation ethernet-ccc`,
    `set interfaces ${peIntf} unit 1 description "{cat=DIA|nbr=${metroName}|Customer=${customerName}|cid=${cidForDescription}|Mbps=${mbps}}"`,
    `set interfaces ${peIntf} unit 1 layer2-policer input-policer ${mbps}-MBPS-POLICER`,
    `set interfaces ${peIntf} unit 1 layer2-policer output-policer ${mbps}-MBPS-POLICER`,
    `set interfaces ${peIntf} unit 1 family inet address ${wanIp}`,
    `set interfaces ${peIntf} unit 1 family inet6 dad-disable`,
    // L2 circuit to Metro switch
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 control-word`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 mtu 1500`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 pseudowire-status-tlv`,
    // Route filter uses network address (not gateway)
    `set policy-options policy-statement RR-BGP-out term CONNECTED from route-filter ${networkAddress} exact`
  ];
  
  console.log(`[BUILD] PE commands built: ${cmds.length} commands`);
  return cmds;
};

/**
 * API handler to configure customer circuit
 */
exports.configureCustomer = async (req, res) => {
  console.log(`\n`);
  console.log(`╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║        DIA NO TAG CUSTOMER CONFIGURATION STARTED              ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝`);
  console.log(`[CONFIG] Timestamp: ${new Date().toISOString()}`);
  
  const {
    metroSwitch,    // { name, host }
    peDevices,      // [{ name, host }, { name, host }] - Primary and Backup
    metroIntf,
    peIntf,
    anchorPoint,
    customerName,
    cid,
    mbps,
    wanIp,
    includeInternalSubnet,
    internalSubnet,
    internalNextHop,
    username,
    password
  } = req.body;

  console.log(`\n[CONFIG] ===== Request Parameters =====`);
  console.log(`[CONFIG] Metro Switch: ${metroSwitch?.name} (${metroSwitch?.host})`);
  console.log(`[CONFIG] Metro Interface: ${metroIntf}`);
  console.log(`[CONFIG] PE Interface: ${peIntf}`);
  console.log(`[CONFIG] Anchor Point: ${anchorPoint}`);
  console.log(`[CONFIG] Customer Name: ${customerName}`);
  console.log(`[CONFIG] CID: ${cid}`);
  console.log(`[CONFIG] Bandwidth: ${mbps} Mbps`);
  console.log(`[CONFIG] WAN IP: ${wanIp}`);
  console.log(`[CONFIG] Include Internal Subnet: ${includeInternalSubnet}`);
  if (includeInternalSubnet) {
    console.log(`[CONFIG] Internal Subnet: ${internalSubnet}`);
    console.log(`[CONFIG] Internal Next Hop: ${internalNextHop}`);
  }
  console.log(`[CONFIG] PE/BNG Devices: ${peDevices?.length || 0}`);
  peDevices?.forEach((pe, idx) => {
    console.log(`[CONFIG]   ${idx + 1}. ${pe.name} (${pe.host})`);
  });
  console.log(`[CONFIG] SSH Username: ${username}`);
  console.log(`[CONFIG] =====================================\n`);

  const sshConfig = { username, password };

  // Validate: Need at least 2 PE/BNG devices for backup
  if (!peDevices || peDevices.length < 2) {
    console.error(`[CONFIG] ❌ VALIDATION ERROR: At least 2 PE/BNG devices required`);
    console.error(`[CONFIG] Provided: ${peDevices?.length || 0} devices`);
    return res.status(400).json({ 
      message: "At least 2 PE/BNG devices are required (primary + backup)" 
    });
  }

  // Extract primary and backup PE/BNG
  const primaryPe = peDevices[0];  // First = Primary
  const backupPe = peDevices[1];   // Second = Backup

  console.log(`[CONFIG] ✓ Validation passed`);
  console.log(`[CONFIG] Primary PE/BNG: ${primaryPe.name} (${primaryPe.host})`);
  console.log(`[CONFIG] Backup PE/BNG: ${backupPe.name} (${backupPe.host})`);

  try {
    // =========================================
    // STEP 1: Configure Metro Switch
    // =========================================
    console.log(`\n`);
    console.log(`┌────────────────────────────────────────────────────────────────┐`);
    console.log(`│  STEP 1/3: CONFIGURING METRO SWITCH                           │`);
    console.log(`│  Device: ${metroSwitch.name.padEnd(52)}│`);
    console.log(`│  Host: ${metroSwitch.host.padEnd(54)}│`);
    console.log(`└────────────────────────────────────────────────────────────────┘`);
    
    const metroCommands = buildMetroCommands({
      intf: metroIntf,
      customerName,
      cid,
      mbps,
      primaryPeName: primaryPe.name,
      primaryPeIp: primaryPe.host,
      backupPeName: backupPe.name,
      backupPeIp: backupPe.host,
      includeInternalSubnet,
      internalSubnet,
      internalNextHop
    });

    console.log(`\n[CONFIG] Metro Switch Commands Preview:`);
    metroCommands.forEach((cmd, idx) => {
      console.log(`[CONFIG]   ${idx + 1}. ${cmd}`);
    });
    
    console.log(`\n[CONFIG] Pushing configuration to Metro Switch...`);
    await runJunosCommands(metroSwitch.host, sshConfig, metroCommands, metroSwitch.name);
    console.log(`[CONFIG] ✅ STEP 1 COMPLETE: Metro Switch configured successfully!`);

    // =========================================
    // STEP 2: Configure Primary PE/BNG
    // =========================================
    console.log(`\n`);
    console.log(`┌────────────────────────────────────────────────────────────────┐`);
    console.log(`│  STEP 2/3: CONFIGURING PRIMARY PE/BNG                         │`);
    console.log(`│  Device: ${primaryPe.name.padEnd(52)}│`);
    console.log(`│  Host: ${primaryPe.host.padEnd(54)}│`);
    console.log(`└────────────────────────────────────────────────────────────────┘`);

    const primaryPeCommands = buildPeCommands({
      peIntf,
      anchorPoint,
      customerName,
      cid,
      mbps,
      wanIp,
      metroName: `${metroSwitch.name} ${metroIntf}`,
      metroIp: metroSwitch.host
    });

    console.log(`\n[CONFIG] Primary PE Commands Preview:`);
    primaryPeCommands.forEach((cmd, idx) => {
      console.log(`[CONFIG]   ${idx + 1}. ${cmd}`);
    });

    console.log(`\n[CONFIG] Pushing configuration to Primary PE/BNG...`);
    await runJunosCommands(primaryPe.host, sshConfig, primaryPeCommands, primaryPe.name);
    console.log(`[CONFIG] ✅ STEP 2 COMPLETE: Primary PE/BNG configured successfully!`);

    // =========================================
    // STEP 3: Configure Backup PE/BNG
    // =========================================
    console.log(`\n`);
    console.log(`┌────────────────────────────────────────────────────────────────┐`);
    console.log(`│  STEP 3/3: CONFIGURING BACKUP PE/BNG                          │`);
    console.log(`│  Device: ${backupPe.name.padEnd(52)}│`);
    console.log(`│  Host: ${backupPe.host.padEnd(54)}│`);
    console.log(`└────────────────────────────────────────────────────────────────┘`);

    const backupPeCommands = buildPeCommands({
      peIntf,
      anchorPoint,
      customerName,
      cid,
      mbps,
      wanIp,
      metroName: `${metroSwitch.name} ${metroIntf}`,
      metroIp: metroSwitch.host
    });

    console.log(`\n[CONFIG] Backup PE Commands Preview:`);
    backupPeCommands.forEach((cmd, idx) => {
      console.log(`[CONFIG]   ${idx + 1}. ${cmd}`);
    });

    console.log(`\n[CONFIG] Pushing configuration to Backup PE/BNG...`);
    await runJunosCommands(backupPe.host, sshConfig, backupPeCommands, backupPe.name);
    console.log(`[CONFIG] ✅ STEP 3 COMPLETE: Backup PE/BNG configured successfully!`);

    // =========================================
    // SUCCESS!
    // =========================================
    console.log(`\n`);
    console.log(`╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ ALL CONFIGURATIONS COMPLETED SUCCESSFULLY!                 ║`);
    console.log(`╠════════════════════════════════════════════════════════════════╣`);
    console.log(`║  Customer: ${customerName.substring(0, 50).padEnd(50)}║`);
    console.log(`║  CID: ${cid.padEnd(55)}║`);
    console.log(`║  Bandwidth: ${(mbps + ' Mbps').padEnd(49)}║`);
    console.log(`║  WAN IP: ${wanIp.padEnd(52)}║`);
    console.log(`╠════════════════════════════════════════════════════════════════╣`);
    console.log(`║  Devices Configured:                                           ║`);
    console.log(`║    • Metro: ${metroSwitch.name.padEnd(49)}║`);
    console.log(`║    • Primary PE: ${primaryPe.name.padEnd(44)}║`);
    console.log(`║    • Backup PE: ${backupPe.name.padEnd(45)}║`);
    console.log(`╚════════════════════════════════════════════════════════════════╝`);
    console.log(`\n`);

    res.json({ 
      message: "Customer configuration pushed successfully",
      details: {
        metroSwitch: {
          name: metroSwitch.name,
          host: metroSwitch.host,
          status: "success"
        },
        primaryPe: {
          name: primaryPe.name,
          host: primaryPe.host,
          status: "success"
        },
        backupPe: {
          name: backupPe.name,
          host: backupPe.host,
          status: "success"
        }
      }
    });

  } catch (error) {
    console.log(`\n`);
    console.log(`╔════════════════════════════════════════════════════════════════╗`);
    console.log(`║  ❌ CONFIGURATION FAILED!                                      ║`);
    console.log(`╠════════════════════════════════════════════════════════════════╣`);
    console.log(`║  Error: ${error.message.substring(0, 53).padEnd(53)}║`);
    console.log(`╚════════════════════════════════════════════════════════════════╝`);
    console.error(`[CONFIG] Full error:`, error);
    console.log(`\n`);
    
    res.status(500).json({ 
      message: "Configuration failed", 
      error: error.message 
    });
  }
};
