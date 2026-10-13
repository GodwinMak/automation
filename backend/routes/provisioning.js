const express = require("express");
const router = express.Router();
const { configureCustomer } = require("../confgTempeletGenerator/diaNoTagGenerator");
const { pushDiaWithTagConfig, previewDiaWithTagConfig } = require("../confgTempeletGenerator/diaWithTagGenerator");
const { pushGponOverEnterpriseConfig, previewGponOverEnterpriseConfig } = require("../confgTempeletGenerator/gponOverEnterpriseGenerator");
const { verifyToken, requirePermission } = require("../middleware/auth");

/**
 * Calculate network address from an IP with CIDR notation
 * e.g., "154.72.90.49/30" → "154.72.90.48/30"
 */
const getNetworkAddress = (ipWithCidr) => {
  console.log(`[PREVIEW] Calculating network address from: ${ipWithCidr}`);
  
  if (!ipWithCidr || !ipWithCidr.includes("/")) {
    console.log(`[PREVIEW] Invalid IP format, returning as-is`);
    return ipWithCidr;
  }
  
  const [ip, cidrStr] = ipWithCidr.split("/");
  const cidr = parseInt(cidrStr, 10);
  
  const octets = ip.split(".").map(Number);
  const ipInt = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  
  const networkOctets = [
    (networkInt >>> 24) & 255,
    (networkInt >>> 16) & 255,
    (networkInt >>> 8) & 255,
    networkInt & 255
  ];
  
  const result = `${networkOctets.join(".")}/${cidr}`;
  console.log(`[PREVIEW] Network address: ${ipWithCidr} → ${result}`);
  return result;
};

/**
 * @route   POST /provisioning/dia-no-tag
 * @desc    Configure DIA NO TAG customer circuit
 * @access  Private (requires SSH credentials + canConfigureCustomers permission)
 */
router.post("/dia-no-tag", verifyToken, requirePermission("canConfigureCustomers"), (req, res, next) => {
  console.log(`\n`);
  console.log(`[PROVISION] ================================================`);
  console.log(`[PROVISION] DIA NO TAG Configuration Request Received`);
  console.log(`[PROVISION] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PROVISION] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PROVISION] ================================================`);
  next();
}, configureCustomer);

/**
 * @route   POST /provisioning/preview
 * @desc    Preview configuration commands without pushing
 * @access  Private (requires canConfigureCustomers permission)
 */
router.post("/preview", verifyToken, requirePermission("canConfigureCustomers"), (req, res) => {
  console.log(`\n`);
  console.log(`[PREVIEW] ================================================`);
  console.log(`[PREVIEW] Configuration Preview Request`);
  console.log(`[PREVIEW] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PREVIEW] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PREVIEW] ================================================`);
  
  const {
    metroSwitch,
    peDevices,
    metroIntf,
    peIntf,
    anchorPoint,
    customerName,
    cid,
    mbps,
    wanIp,
    includeInternalSubnet,
    internalSubnet,
    internalNextHop
  } = req.body;

  console.log(`\n[PREVIEW] ===== Request Parameters =====`);
  console.log(`[PREVIEW] Metro Switch: ${metroSwitch?.name} (${metroSwitch?.host})`);
  console.log(`[PREVIEW] Metro Interface: ${metroIntf}`);
  console.log(`[PREVIEW] PE Interface: ${peIntf}`);
  console.log(`[PREVIEW] Anchor Point: ${anchorPoint}`);
  console.log(`[PREVIEW] Customer Name: ${customerName}`);
  console.log(`[PREVIEW] CID: ${cid}`);
  console.log(`[PREVIEW] Bandwidth: ${mbps} Mbps`);
  console.log(`[PREVIEW] WAN IP: ${wanIp}`);
  console.log(`[PREVIEW] Include Internal Subnet: ${includeInternalSubnet}`);
  if (includeInternalSubnet) {
    console.log(`[PREVIEW] Internal Subnet: ${internalSubnet}`);
    console.log(`[PREVIEW] Internal Next Hop: ${internalNextHop}`);
  }
  console.log(`[PREVIEW] PE/BNG Devices: ${peDevices?.length || 0}`);
  peDevices?.forEach((pe, idx) => {
    console.log(`[PREVIEW]   ${idx + 1}. ${pe.name} (${pe.host})`);
  });
  console.log(`[PREVIEW] =====================================\n`);

  // Validate
  if (!peDevices || peDevices.length < 2) {
    console.error(`[PREVIEW] ❌ VALIDATION ERROR: At least 2 PE/BNG devices required`);
    return res.status(400).json({ 
      message: "At least 2 PE/BNG devices are required" 
    });
  }

  console.log(`[PREVIEW] ✓ Validation passed`);

  const primaryPe = peDevices[0];
  const backupPe = peDevices[1];
  
  console.log(`[PREVIEW] Primary PE: ${primaryPe.name} (${primaryPe.host})`);
  console.log(`[PREVIEW] Backup PE: ${backupPe.name} (${backupPe.host})`);
  
  // Process CID to get proper vcId and description CID
  // If CID starts with "255", use as-is for vcId and replace "255" with "LTZ" for description
  // If CID doesn't start with "255", add "255" prefix for vcId and "LTZ" prefix for description
  const digitsOnly = (cid || "").replace(/\D/g, "");
  let vcId, cidForMetroDescription;
  
  if (digitsOnly.startsWith("255")) {
    // CID already has 255 prefix (e.g., "2551800766")
    vcId = digitsOnly;
    cidForMetroDescription = "LTZ" + digitsOnly.substring(3); // "LTZ1800766"
    console.log(`[PREVIEW] CID has 255 prefix`);
  } else {
    // CID doesn't have 255 prefix (e.g., "1800766")
    vcId = "255" + digitsOnly;
    cidForMetroDescription = "LTZ" + digitsOnly;
    console.log(`[PREVIEW] CID missing 255 prefix, adding it`);
  }
  
  console.log(`[PREVIEW] Virtual Circuit ID: ${vcId}`);
  console.log(`[PREVIEW] CID for description: ${cidForMetroDescription}`);
  
  // Extract common PE/BNG identifier (e.g., LTZ-PE1, LTZ-BNG02)
  // e.g., "LTZ-BNG02-TIG-DAR" → "LTZ-BNG02"
  const extractPeIdentifier = (name) => {
    if (!name) return "";
    const parts = name.split("-");
    const result = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : name;
    console.log(`[PREVIEW] PE identifier: ${name} → ${result}`);
    return result;
  };
  const nbrDescription = extractPeIdentifier(primaryPe.name);

  // Build Metro commands
  console.log(`\n[PREVIEW] ===== Building Metro Switch Commands =====`);
  const metroCommands = [
    `set interfaces ${metroIntf} description "DIA: ${customerName}| ${cid} "`,
    `set interfaces ${metroIntf} speed auto`,
    `set interfaces ${metroIntf} mtu 9000`,
    `set interfaces ${metroIntf} encapsulation ethernet-ccc`,
    `set interfaces ${metroIntf} gigether-options auto-negotiation`,
    `set interfaces ${metroIntf} unit 0 description "{cat=DIA|nbr=${nbrDescription}|Customer=${customerName}|cid=${cidForMetroDescription}|Mbps=${mbps}}"`,
    `set interfaces ${metroIntf} unit 0 statistics`,
    `set interfaces ${metroIntf} unit 0 family ccc`,
    `set protocols l2circuit neighbor ${primaryPe.host} interface ${metroIntf}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${primaryPe.host} interface ${metroIntf}.0 control-word`,
    `set protocols l2circuit neighbor ${primaryPe.host} interface ${metroIntf}.0 mtu 1500`,
    `set protocols l2circuit neighbor ${primaryPe.host} interface ${metroIntf}.0 pseudowire-status-tlv`,
    `set protocols l2circuit neighbor ${primaryPe.host} interface ${metroIntf}.0 backup-neighbor ${backupPe.host} virtual-circuit-id ${vcId}`
  ];

  if (includeInternalSubnet && internalSubnet && internalNextHop) {
    console.log(`[PREVIEW] Adding internal subnet route: ${internalSubnet} via ${internalNextHop}`);
    metroCommands.push(`set routing-options static route ${internalSubnet} next-hop ${internalNextHop}`);
  }

  console.log(`[PREVIEW] Metro commands built: ${metroCommands.length} commands`);
  metroCommands.forEach((cmd, idx) => {
    console.log(`[PREVIEW] Metro CMD ${idx + 1}: ${cmd}`);
  });

  // Build PE commands (same for both)
  console.log(`\n[PREVIEW] ===== Building PE/BNG Commands =====`);
  // Use the same cidForMetroDescription for PE (they should match)
  const cidForDescription = cidForMetroDescription;
  console.log(`[PREVIEW] CID for PE description: ${cidForDescription}`);
  
  // Calculate network address from WAN IP (gateway → network)
  const networkAddress = getNetworkAddress(wanIp);
  console.log(`[PREVIEW] Route filter network: ${networkAddress}`);
  
  const buildPeCommands = (metroName, metroIp) => [
    `set interfaces ${peIntf} anchor-point ${anchorPoint}`,
    `set interfaces ${peIntf} unit 0 encapsulation ethernet-ccc`,
    `set interfaces ${peIntf} unit 1 description "{cat=DIA|nbr=${metroName}|Customer=${customerName}|cid=${cidForDescription}|Mbps=${mbps}}"`,
    `set interfaces ${peIntf} unit 1 layer2-policer input-policer ${mbps}-MBPS-POLICER`,
    `set interfaces ${peIntf} unit 1 layer2-policer output-policer ${mbps}-MBPS-POLICER`,
    `set interfaces ${peIntf} unit 1 family inet address ${wanIp}`,
    `set interfaces ${peIntf} unit 1 family inet6 dad-disable`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 control-word`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 mtu 1500`,
    `set protocols l2circuit neighbor ${metroIp} interface ${peIntf}.0 pseudowire-status-tlv`,
    // Route filter uses network address (not gateway)
    `set policy-options policy-statement RR-BGP-out term CONNECTED from route-filter ${networkAddress} exact`
  ];

  const peCommands = buildPeCommands(`${metroSwitch?.name} ${metroIntf}`, metroSwitch?.host);
  
  console.log(`[PREVIEW] PE commands built: ${peCommands.length} commands`);
  peCommands.forEach((cmd, idx) => {
    console.log(`[PREVIEW] PE CMD ${idx + 1}: ${cmd}`);
  });

  console.log(`\n[PREVIEW] ===== Preview Generation Complete =====`);
  console.log(`[PREVIEW] Total Metro commands: ${metroCommands.length}`);
  console.log(`[PREVIEW] Total PE commands (per device): ${peCommands.length}`);
  console.log(`[PREVIEW] Devices to configure: 3 (1 Metro + 2 PE/BNG)`);
  console.log(`[PREVIEW] ==========================================\n`);

  res.json({
    preview: {
      metro: {
        device: metroSwitch,
        commands: metroCommands
      },
      primaryPe: {
        device: primaryPe,
        commands: peCommands
      },
      backupPe: {
        device: backupPe,
        commands: peCommands
      }
    }
  });
});

/**
 * ============================================================================
 * DIA WITH TAG ROUTES
 * ============================================================================
 */

/**
 * @route   POST /provisioning/dia-with-tag
 * @desc    Configure DIA WITH TAG (VLAN tagged) customer circuit
 * @access  Private (requires SSH credentials + canConfigureCustomers permission)
 */
router.post("/dia-with-tag", verifyToken, requirePermission("canConfigureCustomers"), async (req, res) => {
  console.log(`\n`);
  console.log(`[PROVISION] ================================================`);
  console.log(`[PROVISION] DIA WITH TAG Configuration Request Received`);
  console.log(`[PROVISION] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PROVISION] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PROVISION] ================================================`);
  
  const {
    metroSwitch,
    peDevices,
    metroIntf,
    psUnit,
    vlanId,
    anchorPoint,
    customerName,
    cid,
    mbps,
    wanIp,
    sharedPort,
    username,
    password
  } = req.body;

  console.log(`\n[PROVISION] ===== Request Parameters (WITH TAG) =====`);
  console.log(`[PROVISION] Metro Switch: ${metroSwitch?.name} (${metroSwitch?.host})`);
  console.log(`[PROVISION] Metro Interface: ${metroIntf}`);
  console.log(`[PROVISION] PS Unit: ${psUnit}`);
  console.log(`[PROVISION] VLAN ID: ${vlanId}`);
  console.log(`[PROVISION] Anchor Point: ${anchorPoint}`);
  console.log(`[PROVISION] Customer Name: ${customerName}`);
  console.log(`[PROVISION] CID: ${cid}`);
  console.log(`[PROVISION] Bandwidth: ${mbps} Mbps`);
  console.log(`[PROVISION] WAN IP: ${wanIp}`);
  console.log(`[PROVISION] PE/BNG Devices: ${peDevices?.length || 0}`);
  peDevices?.forEach((pe, idx) => {
    console.log(`[PROVISION]   ${idx + 1}. ${pe.name} (${pe.host})`);
  });
  console.log(`[PROVISION] =============================================\n`);
  
  try {
    const result = await pushDiaWithTagConfig({
      metroSwitch,
      peDevices,
      metroIntf,
      psUnit,
      vlanId,
      anchorPoint: anchorPoint || "lt-0/0/0",
      customerName,
      cid,
      mbps,
      wanIp,
      sharedPort,
      username,
      password
    });

    if (result.success) {
      console.log(`[PROVISION] ✅ DIA WITH TAG configuration successful`);
      res.json(result);
    } else {
      console.error(`[PROVISION] ❌ DIA WITH TAG configuration failed: ${result.message}`);
      res.status(500).json(result);
    }
  } catch (error) {
    console.error(`[PROVISION] ❌ Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   POST /provisioning/preview-with-tag
 * @desc    Preview DIA WITH TAG configuration commands without pushing
 * @access  Private (requires canConfigureCustomers permission)
 */
router.post("/preview-with-tag", verifyToken, requirePermission("canConfigureCustomers"), (req, res) => {
  console.log(`\n`);
  console.log(`[PREVIEW] ================================================`);
  console.log(`[PREVIEW] DIA WITH TAG Preview Request`);
  console.log(`[PREVIEW] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PREVIEW] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PREVIEW] ================================================`);
  
  const {
    metroSwitch,
    peDevices,
    metroIntf,
    psUnit,
    vlanId,
    anchorPoint,
    customerName,
    cid,
    mbps,
    wanIp,
    sharedPort
  } = req.body;

  console.log(`\n[PREVIEW] ===== Request Parameters (WITH TAG) =====`);
  console.log(`[PREVIEW] Metro Switch: ${metroSwitch?.name} (${metroSwitch?.host})`);
  console.log(`[PREVIEW] Metro Interface: ${metroIntf}`);
  console.log(`[PREVIEW] PS Unit: ${psUnit}`);
  console.log(`[PREVIEW] VLAN ID: ${vlanId}`);
  console.log(`[PREVIEW] Anchor Point: ${anchorPoint}`);
  console.log(`[PREVIEW] Customer Name: ${customerName}`);
  console.log(`[PREVIEW] CID: ${cid}`);
  console.log(`[PREVIEW] Bandwidth: ${mbps} Mbps`);
  console.log(`[PREVIEW] WAN IP: ${wanIp}`);
  console.log(`[PREVIEW] PE/BNG Devices: ${peDevices?.length || 0}`);
  peDevices?.forEach((pe, idx) => {
    console.log(`[PREVIEW]   ${idx + 1}. ${pe.name} (${pe.host})`);
  });
  console.log(`[PREVIEW] ==============================================\n`);

  // Validate
  if (!peDevices || peDevices.length < 2) {
    console.error(`[PREVIEW] ❌ VALIDATION ERROR: At least 2 PE/BNG devices required`);
    return res.status(400).json({ 
      message: "At least 2 PE/BNG devices are required" 
    });
  }
  
  if (!psUnit) {
    console.error(`[PREVIEW] ❌ VALIDATION ERROR: PS Unit is required`);
    return res.status(400).json({ 
      message: "PS Unit number is required" 
    });
  }
  
  if (!vlanId) {
    console.error(`[PREVIEW] ❌ VALIDATION ERROR: VLAN ID is required`);
    return res.status(400).json({ 
      message: "VLAN ID is required" 
    });
  }

  try {
    const preview = previewDiaWithTagConfig({
      metroSwitch,
      peDevices,
      metroIntf,
      psUnit,
      vlanId,
      anchorPoint: anchorPoint || "lt-0/0/0",
      customerName,
      cid,
      mbps,
      wanIp,
      sharedPort
    });

    console.log(`\n[PREVIEW] ===== Preview Generation Complete (WITH TAG) =====`);
    console.log(`[PREVIEW] Metro commands: ${preview.metro.commands.length}`);
    preview.pe.forEach((pe, idx) => {
      console.log(`[PREVIEW] PE ${idx + 1} (${pe.role}) commands: ${pe.commands.length}`);
    });
    console.log(`[PREVIEW] ========================================================\n`);
    
    res.json({ preview });
  } catch (error) {
    console.error(`[PREVIEW] ❌ Error generating preview: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ============================================================================
 * GPON OVER ENTERPRISE ROUTES
 * ============================================================================
 */

/**
 * @route   POST /provisioning/gpon-enterprise
 * @desc    Configure GPON over Enterprise customer circuit
 * @access  Private (requires SSH credentials + canConfigureCustomers permission)
 */
router.post("/gpon-enterprise", verifyToken, requirePermission("canConfigureCustomers"), async (req, res) => {
  console.log(`\n`);
  console.log(`[PROVISION] ================================================`);
  console.log(`[PROVISION] GPON OVER ENTERPRISE Configuration Request Received`);
  console.log(`[PROVISION] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PROVISION] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PROVISION] ================================================`);

  const {
    accessSwitch,
    accessIntf,
    bngDevices,
    psUnit,
    vlanId,
    anchorPoint,
    profilePrefix,
    accountName,
    accountNumber,
    cid,
    mtu,
    username,
    password
  } = req.body;

  console.log(`\n[PROVISION] ===== Request Parameters (GPON OVER ENTERPRISE) =====`);
  console.log(`[PROVISION] Access Switch: ${accessSwitch?.name} (${accessSwitch?.host})`);
  console.log(`[PROVISION] Access Interface: ${accessIntf}`);
  console.log(`[PROVISION] PS Unit: ${psUnit}`);
  console.log(`[PROVISION] VLAN ID: ${vlanId}`);
  console.log(`[PROVISION] Profile Prefix: ${profilePrefix}`);
  console.log(`[PROVISION] Account: ${accountName} (${accountNumber})`);
  console.log(`[PROVISION] CID: ${cid}`);
  console.log(`[PROVISION] BNG Devices: ${bngDevices?.length || 0}`);
  bngDevices?.forEach((bng, idx) => {
    console.log(`[PROVISION]   ${idx + 1}. ${bng.name} (${bng.host})`);
  });
  console.log(`[PROVISION] ==========================================================\n`);

  try {
    const result = await pushGponOverEnterpriseConfig({
      accessSwitch,
      accessIntf,
      bngDevices,
      psUnit,
      vlanId,
      anchorPoint: anchorPoint || "lt-0/0/0",
      profilePrefix,
      accountName,
      accountNumber,
      cid,
      mtu: mtu || "1532",
      username,
      password
    });

    if (result.success) {
      console.log(`[PROVISION] ✅ GPON OVER ENTERPRISE configuration successful`);
      res.json(result);
    } else {
      console.error(`[PROVISION] ❌ GPON OVER ENTERPRISE configuration failed: ${result.message}`);
      res.status(500).json(result);
    }
  } catch (error) {
    console.error(`[PROVISION] ❌ Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   POST /provisioning/preview-gpon-enterprise
 * @desc    Preview GPON over Enterprise configuration commands without pushing
 * @access  Private (requires canConfigureCustomers permission)
 */
router.post("/preview-gpon-enterprise", verifyToken, requirePermission("canConfigureCustomers"), (req, res) => {
  console.log(`\n`);
  console.log(`[PREVIEW] ================================================`);
  console.log(`[PREVIEW] GPON OVER ENTERPRISE Preview Request`);
  console.log(`[PREVIEW] User: ${req.user?.username || 'Unknown'} (${req.user?.role || 'Unknown'})`);
  console.log(`[PREVIEW] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PREVIEW] ================================================`);

  const {
    accessSwitch,
    accessIntf,
    bngDevices,
    psUnit,
    vlanId,
    anchorPoint,
    profilePrefix,
    accountName,
    accountNumber,
    cid,
    mtu
  } = req.body;

  console.log(`\n[PREVIEW] ===== Request Parameters (GPON OVER ENTERPRISE) =====`);
  console.log(`[PREVIEW] Access Switch: ${accessSwitch?.name} (${accessSwitch?.host})`);
  console.log(`[PREVIEW] Access Interface: ${accessIntf}`);
  console.log(`[PREVIEW] PS Unit: ${psUnit}`);
  console.log(`[PREVIEW] VLAN ID: ${vlanId}`);
  console.log(`[PREVIEW] Profile Prefix: ${profilePrefix}`);
  console.log(`[PREVIEW] Account: ${accountName} (${accountNumber})`);
  console.log(`[PREVIEW] CID: ${cid}`);
  console.log(`[PREVIEW] BNG Devices: ${bngDevices?.length || 0}`);
  bngDevices?.forEach((bng, idx) => {
    console.log(`[PREVIEW]   ${idx + 1}. ${bng.name} (${bng.host})`);
  });
  console.log(`[PREVIEW] ==========================================================\n`);

  if (!accessSwitch?.name || !accessSwitch?.host) {
    return res.status(400).json({ message: "Access Switch is required" });
  }
  if (!accessIntf) {
    return res.status(400).json({ message: "Access Switch interface is required" });
  }
  if (!bngDevices || bngDevices.length < 2) {
    return res.status(400).json({ message: "At least 2 BNG devices are required" });
  }
  if (!psUnit) {
    return res.status(400).json({ message: "PS Unit number is required" });
  }
  if (!vlanId) {
    return res.status(400).json({ message: "VLAN ID is required" });
  }
  if (!profilePrefix) {
    return res.status(400).json({ message: "Profile prefix is required" });
  }
  if (!accountName || !accountNumber || !cid) {
    return res.status(400).json({ message: "Account name, account number, and CID are required" });
  }

  try {
    const preview = previewGponOverEnterpriseConfig({
      accessSwitch,
      accessIntf,
      bngDevices,
      psUnit,
      vlanId,
      anchorPoint: anchorPoint || "lt-0/0/0",
      profilePrefix,
      accountName,
      accountNumber,
      cid,
      mtu: mtu || "1532"
    });

    console.log(`\n[PREVIEW] ===== Preview Generation Complete (GPON OVER ENTERPRISE) =====`);
    console.log(`[PREVIEW] Access Switch commands: ${preview.accessSwitch.commands.length}`);
    preview.bng.forEach((bng, idx) => {
      console.log(`[PREVIEW] BNG ${idx + 1} (${bng.role}) commands: ${bng.commands.length}`);
    });
    console.log(`[PREVIEW] ================================================================\n`);

    res.json({ preview });
  } catch (error) {
    console.error(`[PREVIEW] ❌ Error generating preview: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
