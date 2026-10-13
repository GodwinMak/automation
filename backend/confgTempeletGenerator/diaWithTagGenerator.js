const { Client } = require("ssh2");

/**
 * DIA WITH TAG Configuration Generator
 * 
 * This generator creates configurations for DIA customers WITH VLAN tagging.
 * Key differences from NO TAG:
 * - Metro: flexible-vlan-tagging, encapsulation flexible-ethernet-services
 * - Metro unit: encapsulation vlan-ccc, vlan-id
 * - PE: flexible-vlan-tagging, unit 0 ethernet-ccc, numbered unit with vlan-id
 * - PE L2circuit: encapsulation-type ethernet-vlan, no-vlan-id-validate
 */

/**
 * Calculate network address from an IP with CIDR notation
 * e.g., "154.72.95.133/30" → "154.72.95.132/30"
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
 * - Input CID already has 255 prefix (e.g., "2551900041"):
 *   → vcId = "2551900041" (use as-is)
 *   → cidForDescription = "LTZ1900041" (replace 255 with LTZ)
 * 
 * - Input CID doesn't have 255 prefix (e.g., "1900041"):
 *   → vcId = "2551900041" (add 255 prefix)
 *   → cidForDescription = "LTZ1900041" (add LTZ prefix)
 */
const processCid = (cid) => {
  const digitsOnly = (cid || "").replace(/\D/g, "");
  
  console.log(`[CID] Processing CID: "${cid}" → digits: "${digitsOnly}"`);
  
  let vcId;
  let cidForDescription;
  
  if (digitsOnly.startsWith("255")) {
    vcId = digitsOnly;
    cidForDescription = "LTZ" + digitsOnly.substring(3);
    console.log(`[CID] CID has 255 prefix`);
  } else {
    vcId = "255" + digitsOnly;
    cidForDescription = "LTZ" + digitsOnly;
    console.log(`[CID] CID missing 255 prefix, adding it`);
  }
  
  console.log(`[CID] Virtual Circuit ID: ${vcId}`);
  console.log(`[CID] CID for description: ${cidForDescription}`);
  
  return { vcId, cidForDescription };
};

/**
 * Build commands for Metro Switch (WITH TAG)
 *
 * Key differences from NO TAG:
 * - flexible-vlan-tagging instead of encapsulation ethernet-ccc
 * - encapsulation flexible-ethernet-services
 * - Unit has encapsulation vlan-ccc and vlan-id
 *
 * sharedPort: when the physical Metro interface is already configured for
 * another customer (another VLAN unit already exists on it), the
 * interface-level commands (flexible-vlan-tagging, speed, mtu, encapsulation,
 * gigether-options, description) are skipped — only the new unit is added.
 */
const buildMetroCommands = ({
  intf,
  psUnit,
  vlanId,
  customerName,
  cid,
  mbps,
  primaryPeName,
  primaryPeIp,
  backupPeIp,
  sharedPort
}) => {
  console.log(`\n[BUILD] ===== Building Metro Switch Commands (WITH TAG) =====`);
  console.log(`[BUILD] Interface: ${intf}`);
  console.log(`[BUILD] PS Unit: ${psUnit}`);
  console.log(`[BUILD] VLAN ID: ${vlanId}`);
  console.log(`[BUILD] Customer: ${customerName}`);
  console.log(`[BUILD] CID (input): ${cid}`);
  console.log(`[BUILD] Mbps: ${mbps}`);
  console.log(`[BUILD] Primary PE: ${primaryPeName} (${primaryPeIp})`);
  console.log(`[BUILD] Backup PE IP: ${backupPeIp}`);
  console.log(`[BUILD] Shared Port: ${!!sharedPort}`);

  // Process CID
  const { vcId, cidForDescription } = processCid(cid);

  // Extract common PE/BNG identifier (e.g., LTZ-PE1, LTZ-BNG02)
  const nbrDescription = `${extractPeIdentifier(primaryPeName)} ps${psUnit}`;
  console.log(`[BUILD] NBR description: ${nbrDescription}`);

  const cmds = [];

  if (!sharedPort) {
    // Interface configuration — only needed the first time this physical
    // port is used, i.e. when it isn't already shared with another customer
    cmds.push(
      `set interfaces ${intf} description "<< ${customerName} >>"`,
      `set interfaces ${intf} flexible-vlan-tagging`,
      `set interfaces ${intf} speed auto`,
      `set interfaces ${intf} mtu 9000`,
      `set interfaces ${intf} encapsulation flexible-ethernet-services`,
      `set interfaces ${intf} gigether-options auto-negotiation`
    );
  }

  cmds.push(
    // Unit configuration with VLAN
    `set interfaces ${intf} unit ${psUnit} description "{cat=DIA|nbr=${nbrDescription}|Customer=${customerName}|cid=${cidForDescription}|Mbps=${mbps}}"`,
    `set interfaces ${intf} unit ${psUnit} encapsulation vlan-ccc`,
    `set interfaces ${intf} unit ${psUnit} vlan-id ${vlanId}`,
    `set interfaces ${intf} unit ${psUnit} statistics`,
    `set interfaces ${intf} unit ${psUnit} family ccc`,

    // L2 circuit to PRIMARY PE/BNG
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.${psUnit} virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.${psUnit} control-word`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.${psUnit} mtu 1800`,
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.${psUnit} pseudowire-status-tlv`,

    // Backup neighbor
    `set protocols l2circuit neighbor ${primaryPeIp} interface ${intf}.${psUnit} backup-neighbor ${backupPeIp} virtual-circuit-id ${vcId}`
  );
  
  console.log(`[BUILD] Generated ${cmds.length} Metro Switch commands`);
  cmds.forEach((cmd, idx) => {
    console.log(`[BUILD] Metro CMD ${idx + 1}: ${cmd}`);
  });
  
  return cmds;
};

/**
 * Build commands for PE/BNG (WITH TAG)
 * 
 * Key differences from NO TAG:
 * - PS interface has flexible-vlan-tagging
 * - Unit 0 has encapsulation ethernet-ccc (for L2 circuit)
 * - Numbered unit has vlan-id and family inet
 * - L2circuit has encapsulation-type ethernet-vlan and no-vlan-id-validate
 */
const buildPeCommands = ({
  peIntf,
  psUnit,
  vlanId,
  anchorPoint,
  customerName,
  cid,
  mbps,
  metroName,
  metroIntf,
  metroIp,
  wanIp,
  includeInternalSubnet,
  internalSubnet,
  internalNextHop
}) => {
  console.log(`\n[BUILD] ===== Building PE/BNG Commands (WITH TAG) =====`);
  console.log(`[BUILD] PE Interface: ${peIntf}`);
  console.log(`[BUILD] PS Unit: ${psUnit}`);
  console.log(`[BUILD] VLAN ID: ${vlanId}`);
  console.log(`[BUILD] Anchor Point: ${anchorPoint}`);
  console.log(`[BUILD] Customer: ${customerName}`);
  console.log(`[BUILD] CID (input): ${cid}`);
  console.log(`[BUILD] Mbps: ${mbps}`);
  console.log(`[BUILD] Metro: ${metroName} ${metroIntf} (${metroIp})`);
  console.log(`[BUILD] WAN IP: ${wanIp}`);
  console.log(`[BUILD] Include Internal Subnet: ${includeInternalSubnet}`);
  if (includeInternalSubnet) {
    console.log(`[BUILD] Internal Subnet: ${internalSubnet}`);
    console.log(`[BUILD] Internal Next Hop: ${internalNextHop}`);
  }
  
  // Process CID
  const { vcId, cidForDescription } = processCid(cid);
  
  // Calculate network address from WAN IP
  const networkAddress = getNetworkAddress(wanIp);
  console.log(`[BUILD] Route filter network: ${networkAddress}`);
  
  // Format metro name for description (extract common identifier)
  const metroIdentifier = extractPeIdentifier(metroName);
  
  // Policer name based on Mbps
  const policerName = `${mbps}-MBPS-POLICER`;
  console.log(`[BUILD] Policer name: ${policerName}`);
  
  const cmds = [
    // PS interface configuration
    `set interfaces ps${psUnit} anchor-point ${anchorPoint}`,
    `set interfaces ps${psUnit} flexible-vlan-tagging`,
    `set interfaces ps${psUnit} mtu 9000`,
    
    // Unit 0 for L2 circuit
    `set interfaces ps${psUnit} unit 0 encapsulation ethernet-ccc`,
    
    // Numbered unit with VLAN
    `set interfaces ps${psUnit} unit ${psUnit} description "{cat=DIA|nbr=${metroIdentifier} ${metroIntf}|Customer=${customerName}|cid=${cidForDescription}|Mbps=${mbps}}"`,
    `set interfaces ps${psUnit} unit ${psUnit} vlan-id ${vlanId}`,
    `set interfaces ps${psUnit} unit ${psUnit} layer2-policer input-policer ${policerName}`,
    `set interfaces ps${psUnit} unit ${psUnit} layer2-policer output-policer ${policerName}`,
    `set interfaces ps${psUnit} unit ${psUnit} family inet address ${wanIp}`,
    
    // L2 circuit to Metro Switch
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 control-word`,
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 mtu 1800`,
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 encapsulation-type ethernet-vlan`,
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 no-vlan-id-validate`,
    `set protocols l2circuit neighbor ${metroIp} interface ps${psUnit}.0 pseudowire-status-tlv`,
    
    // Route filter for WAN
    `set policy-options policy-statement RR-BGP-out term CONNECTED from route-filter ${networkAddress} exact`,
  ];
  
  // Add internal subnet routing if enabled
  if (includeInternalSubnet && internalSubnet && internalNextHop) {
    console.log(`[BUILD] Adding internal subnet: ${internalSubnet} via ${internalNextHop}`);
    cmds.push(
      // Static route for internal subnet
      `set routing-options static route ${internalSubnet} next-hop ${internalNextHop}`,
      // Route filter for internal subnet (STATIC term)
      `set policy-options policy-statement RR-BGP-out term STATIC from route-filter ${internalSubnet} exact`
    );
  }
  
  console.log(`[BUILD] Generated ${cmds.length} PE/BNG commands`);
  cmds.forEach((cmd, idx) => {
    console.log(`[BUILD] PE CMD ${idx + 1}: ${cmd}`);
  });
  
  return cmds;
};

/**
 * Main function to push DIA WITH TAG configuration
 * 
 * @param {Object} config - Configuration object
 * @param {Object} config.metroSwitch - { name, host }
 * @param {Array} config.peDevices - [{ name, host }, { name, host }] (min 2, first is primary)
 * @param {string} config.metroIntf - Metro interface (e.g., "ge-0/0/77")
 * @param {string} config.psUnit - PS unit number (e.g., "1853")
 * @param {string} config.vlanId - VLAN ID (e.g., "990")
 * @param {string} config.anchorPoint - Anchor point (e.g., "lt-0/0/0")
 * @param {string} config.customerName - Customer name
 * @param {string} config.cid - Circuit ID
 * @param {string} config.mbps - Bandwidth in Mbps
 * @param {string} config.wanIp - WAN IP with CIDR (e.g., "154.72.95.133/30")
 * @param {string} config.username - SSH username
 * @param {string} config.password - SSH password
 */
const pushDiaWithTagConfig = async (config) => {
  console.log(`\n[CONFIG] ========================================`);
  console.log(`[CONFIG] Starting DIA WITH TAG Configuration Push`);
  console.log(`[CONFIG] ========================================`);
  console.log(`[CONFIG] Configuration received:`);
  console.log(JSON.stringify(config, null, 2));
  
  const {
    metroSwitch,
    peDevices,
    metroIntf,
    psUnit,
    vlanId,
    anchorPoint = "lt-0/0/0",
    customerName,
    cid,
    mbps,
    wanIp,
    sharedPort,
    includeInternalSubnet,
    internalSubnet,
    internalNextHop,
    username,
    password
  } = config;

  // Validation
  console.log(`\n[CONFIG] ===== Validating Input =====`);
  
  if (!metroSwitch?.name || !metroSwitch?.host) {
    console.error(`[CONFIG] ❌ Missing Metro Switch details`);
    throw new Error("Metro Switch name and host are required");
  }
  console.log(`[CONFIG] ✓ Metro Switch: ${metroSwitch.name} (${metroSwitch.host})`);
  
  if (!peDevices || peDevices.length < 2) {
    console.error(`[CONFIG] ❌ Need at least 2 PE/BNG devices`);
    throw new Error("At least 2 PE/BNG devices are required (primary and backup)");
  }
  console.log(`[CONFIG] ✓ PE Devices: ${peDevices.length} provided`);
  
  peDevices.forEach((pe, idx) => {
    if (!pe.name || !pe.host) {
      console.error(`[CONFIG] ❌ PE Device ${idx + 1} missing name or host`);
      throw new Error(`PE Device ${idx + 1} name and host are required`);
    }
    console.log(`[CONFIG] ✓ PE ${idx + 1}: ${pe.name} (${pe.host})`);
  });
  
  if (!metroIntf) {
    console.error(`[CONFIG] ❌ Missing Metro Interface`);
    throw new Error("Metro Interface is required");
  }
  console.log(`[CONFIG] ✓ Metro Interface: ${metroIntf}`);
  
  if (!psUnit) {
    console.error(`[CONFIG] ❌ Missing PS Unit`);
    throw new Error("PS Unit number is required");
  }
  console.log(`[CONFIG] ✓ PS Unit: ${psUnit}`);
  
  if (!vlanId) {
    console.error(`[CONFIG] ❌ Missing VLAN ID`);
    throw new Error("VLAN ID is required");
  }
  console.log(`[CONFIG] ✓ VLAN ID: ${vlanId}`);
  
  if (!customerName || !cid || !mbps || !wanIp) {
    console.error(`[CONFIG] ❌ Missing customer details`);
    throw new Error("Customer name, CID, Mbps, and WAN IP are required");
  }
  console.log(`[CONFIG] ✓ Customer: ${customerName}`);
  console.log(`[CONFIG] ✓ CID: ${cid}`);
  console.log(`[CONFIG] ✓ Mbps: ${mbps}`);
  console.log(`[CONFIG] ✓ WAN IP: ${wanIp}`);
  
  if (!username || !password) {
    console.error(`[CONFIG] ❌ Missing SSH credentials`);
    throw new Error("SSH username and password are required");
  }
  console.log(`[CONFIG] ✓ SSH credentials provided`);

  const sshConfig = { username, password };
  const primaryPe = peDevices[0];
  const backupPe = peDevices[1];
  
  console.log(`\n[CONFIG] Primary PE: ${primaryPe.name} (${primaryPe.host})`);
  console.log(`[CONFIG] Backup PE: ${backupPe.name} (${backupPe.host})`);

  const results = {
    metro: null,
    pe: []
  };

  try {
    // Step 1: Configure Metro Switch
    console.log(`\n[CONFIG] ===== STEP 1: Configure Metro Switch =====`);
    const metroCommands = buildMetroCommands({
      intf: metroIntf,
      psUnit,
      vlanId,
      customerName,
      cid,
      mbps,
      primaryPeName: primaryPe.name,
      primaryPeIp: primaryPe.host,
      backupPeIp: backupPe.host,
      sharedPort
    });

    console.log(`[CONFIG] Pushing configuration to Metro Switch: ${metroSwitch.name}`);
    const metroResult = await runJunosCommands(
      metroSwitch.host,
      sshConfig,
      metroCommands,
      metroSwitch.name
    );
    
    results.metro = {
      device: metroSwitch.name,
      host: metroSwitch.host,
      status: "success",
      commands: metroCommands.length,
      output: metroResult
    };
    console.log(`[CONFIG] ✅ Metro Switch configured successfully`);

    // Step 2: Configure BOTH PE/BNG devices
    console.log(`\n[CONFIG] ===== STEP 2: Configure PE/BNG Devices =====`);
    
    for (let i = 0; i < peDevices.length; i++) {
      const pe = peDevices[i];
      const peLabel = i === 0 ? "Primary" : "Backup";
      
      console.log(`\n[CONFIG] ----- Configuring ${peLabel} PE: ${pe.name} -----`);
      
      const peCommands = buildPeCommands({
        peIntf: `ps${psUnit}`,
        psUnit,
        vlanId,
        anchorPoint,
        customerName,
        cid,
        mbps,
        metroName: metroSwitch.name,
        metroIntf,
        metroIp: metroSwitch.host,
        wanIp,
        includeInternalSubnet,
        internalSubnet,
        internalNextHop
      });
      
      console.log(`[CONFIG] Pushing configuration to ${peLabel} PE: ${pe.name}`);
      const peResult = await runJunosCommands(
        pe.host,
        sshConfig,
        peCommands,
        pe.name
      );
      
      results.pe.push({
        device: pe.name,
        host: pe.host,
        role: peLabel.toLowerCase(),
        status: "success",
        commands: peCommands.length,
        output: peResult
      });
      console.log(`[CONFIG] ✅ ${peLabel} PE configured successfully`);
    }

    console.log(`\n[CONFIG] ========================================`);
    console.log(`[CONFIG] ✅ DIA WITH TAG Configuration Complete!`);
    console.log(`[CONFIG] ========================================`);
    console.log(`[CONFIG] Summary:`);
    console.log(`[CONFIG] - Metro Switch: ${metroSwitch.name} ✅`);
    results.pe.forEach((pe, idx) => {
      console.log(`[CONFIG] - PE ${idx + 1} (${pe.role}): ${pe.device} ✅`);
    });
    
    return {
      success: true,
      message: "DIA WITH TAG configuration pushed successfully to all devices",
      results
    };
    
  } catch (error) {
    console.error(`\n[CONFIG] ========================================`);
    console.error(`[CONFIG] ❌ Configuration Failed!`);
    console.error(`[CONFIG] ========================================`);
    console.error(`[CONFIG] Error: ${error.message}`);
    
    return {
      success: false,
      message: error.message,
      results
    };
  }
};

/**
 * Generate preview of commands (without pushing)
 */
const previewDiaWithTagConfig = (config) => {
  console.log(`\n[PREVIEW] ========================================`);
  console.log(`[PREVIEW] Generating DIA WITH TAG Preview`);
  console.log(`[PREVIEW] ========================================`);
  
  const {
    metroSwitch,
    peDevices,
    metroIntf,
    psUnit,
    vlanId,
    anchorPoint = "lt-0/0/0",
    customerName,
    cid,
    mbps,
    wanIp,
    sharedPort,
    includeInternalSubnet,
    internalSubnet,
    internalNextHop
  } = config;

  const primaryPe = peDevices[0];
  const backupPe = peDevices[1];

  // Build Metro commands
  const metroCommands = buildMetroCommands({
    intf: metroIntf,
    psUnit,
    vlanId,
    customerName,
    cid,
    mbps,
    primaryPeName: primaryPe.name,
    primaryPeIp: primaryPe.host,
    backupPeIp: backupPe.host,
    sharedPort
  });
  
  // Build PE commands (same for both PEs)
  const peCommands = buildPeCommands({
    peIntf: `ps${psUnit}`,
    psUnit,
    vlanId,
    anchorPoint,
    customerName,
    cid,
    mbps,
    metroName: metroSwitch.name,
    metroIntf,
    metroIp: metroSwitch.host,
    wanIp,
    includeInternalSubnet,
    internalSubnet,
    internalNextHop
  });
  
  console.log(`\n[PREVIEW] Preview generated successfully`);
  
  return {
    metro: {
      device: metroSwitch.name,
      host: metroSwitch.host,
      commands: metroCommands
    },
    pe: peDevices.map((pe, idx) => ({
      device: pe.name,
      host: pe.host,
      role: idx === 0 ? "primary" : "backup",
      commands: peCommands
    }))
  };
};

module.exports = {
  pushDiaWithTagConfig,
  previewDiaWithTagConfig,
  buildMetroCommands,
  buildPeCommands,
  processCid,
  getNetworkAddress
};

