const { Client } = require("ssh2");

/**
 * GPON over Enterprise Configuration Generator
 *
 * Generates configurations for GPON-delivered enterprise circuits.
 * Two devices are configured:
 * - BNG (ps interface): flexible-vlan-tagging + auto-configure stacked-vlan-ranges
 *   (dynamic-profile / access-profile), unit 0 ethernet-ccc, single l2circuit neighbor
 *   pointing at the Access Switch (no backup-neighbor here).
 * - Access Switch (physical interface): flexible-vlan-tagging, per-customer VLAN unit
 *   (encapsulation vlan-ccc, vlan-id, input/output vlan-map), l2circuit neighbor +
 *   backup-neighbor pointing at the primary/backup BNG.
 *
 * BNG devices are supplied as an array (primary, backup). The same ps interface
 * commands are pushed to both, matching how diaWithTagGenerator handles PE/BNG pairs.
 */

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

            const lines = output.split("\n").filter((l) => l.trim());
            lines.forEach((line) => {
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

          console.log(`[SSH] Entering configuration mode on ${deviceName}...`);
          stream.write("configure private\n");

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
 * Process CID to get Virtual Circuit ID
 *
 * - Input CID already has 255 prefix (e.g., "255000232") → vcId = "255000232" (as-is)
 * - Input CID doesn't have 255 prefix (e.g., "000232") → vcId = "255000232" (255 prefix added)
 *
 * Note: unlike DIA templates, the account number (e.g. "LHTZ-6779") used in
 * descriptions is a separate field here and is NOT derived from the CID.
 */
const processCid = (cid) => {
  const digitsOnly = (cid || "").replace(/\D/g, "");

  console.log(`[CID] Processing CID: "${cid}" → digits: "${digitsOnly}"`);

  const vcId = digitsOnly.startsWith("255") ? digitsOnly : "255" + digitsOnly;

  console.log(`[CID] Virtual Circuit ID: ${vcId}`);
  return { vcId };
};

/**
 * Build commands for the BNG (ps interface)
 */
const buildBngCommands = ({
  psUnit,
  anchorPoint,
  vlanProfile,
  accessProfile,
  mtu,
  accountName,
  accountNumber,
  accessSwitchName,
  accessIntf,
  accessSwitchIp,
  vcId
}) => {
  console.log(`\n[BUILD] ===== Building BNG Commands (ps${psUnit}) =====`);
  console.log(`[BUILD] Anchor Point: ${anchorPoint}`);
  console.log(`[BUILD] Dynamic Profile: ${vlanProfile}`);
  console.log(`[BUILD] Access Profile: ${accessProfile}`);
  console.log(`[BUILD] Account: ${accountName} (${accountNumber})`);
  console.log(`[BUILD] Access Switch: ${accessSwitchName} ${accessIntf} (${accessSwitchIp})`);
  console.log(`[BUILD] Virtual Circuit ID: ${vcId}`);

  const cmds = [
    `set interfaces ps${psUnit} description "<< ${accountName} >>"`,
    `set interfaces ps${psUnit} anchor-point ${anchorPoint}`,
    `set interfaces ps${psUnit} flexible-vlan-tagging`,
    `set interfaces ps${psUnit} auto-configure stacked-vlan-ranges dynamic-profile ${vlanProfile} accept any`,
    `set interfaces ps${psUnit} auto-configure stacked-vlan-ranges dynamic-profile ${vlanProfile} ranges any,any`,
    `set interfaces ps${psUnit} auto-configure stacked-vlan-ranges access-profile ${accessProfile}`,
    `set interfaces ps${psUnit} mtu ${mtu}`,
    `set interfaces ps${psUnit} unit 0 description "<< cat=GPON|nbr=${accessSwitchName} ${accessIntf}| ${accountName} | ${accountNumber}>>"`,
    `set interfaces ps${psUnit} unit 0 encapsulation ethernet-ccc`,
    `set protocols l2circuit neighbor ${accessSwitchIp} interface ps${psUnit}.0 virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${accessSwitchIp} interface ps${psUnit}.0 control-word`,
    `set protocols l2circuit neighbor ${accessSwitchIp} interface ps${psUnit}.0 mtu ${mtu}`,
    `set protocols l2circuit neighbor ${accessSwitchIp} interface ps${psUnit}.0 no-vlan-id-validate`,
    `set protocols l2circuit neighbor ${accessSwitchIp} interface ps${psUnit}.0 pseudowire-status-tlv`
  ];

  console.log(`[BUILD] Generated ${cmds.length} BNG commands`);
  cmds.forEach((cmd, idx) => console.log(`[BUILD] BNG CMD ${idx + 1}: ${cmd}`));

  return cmds;
};

/**
 * Build commands for the Access Switch (physical interface + VLAN unit)
 */
const buildAccessSwitchCommands = ({
  accessIntf,
  vlanId,
  mtu,
  accountName,
  accountNumber,
  primaryBngIp,
  backupBngIp,
  vcId
}) => {
  console.log(`\n[BUILD] ===== Building Access Switch Commands (${accessIntf}) =====`);
  console.log(`[BUILD] VLAN ID / Unit: ${vlanId}`);
  console.log(`[BUILD] Account: ${accountName} (${accountNumber})`);
  console.log(`[BUILD] Primary BNG: ${primaryBngIp}`);
  console.log(`[BUILD] Backup BNG: ${backupBngIp}`);
  console.log(`[BUILD] Virtual Circuit ID: ${vcId}`);

  const cmds = [
    `set interfaces ${accessIntf} description "${accountName} | ${accountNumber}"`,
    `set interfaces ${accessIntf} flexible-vlan-tagging`,
    `set interfaces ${accessIntf} speed auto`,
    `set interfaces ${accessIntf} mtu 9000`,
    `set interfaces ${accessIntf} encapsulation flexible-ethernet-services`,
    `set interfaces ${accessIntf} gigether-options auto-negotiation`,
    `set interfaces ${accessIntf} unit ${vlanId} description "<< GPON | ${accountName} | ${accountNumber} >>"`,
    `set interfaces ${accessIntf} unit ${vlanId} encapsulation vlan-ccc`,
    `set interfaces ${accessIntf} unit ${vlanId} vlan-id ${vlanId}`,
    `set interfaces ${accessIntf} unit ${vlanId} input-vlan-map push`,
    `set interfaces ${accessIntf} unit ${vlanId} input-vlan-map vlan-id ${vlanId}`,
    `set interfaces ${accessIntf} unit ${vlanId} output-vlan-map pop`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} virtual-circuit-id ${vcId}`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} control-word`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} mtu ${mtu}`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} encapsulation-type ethernet`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} pseudowire-status-tlv`,
    `set protocols l2circuit neighbor ${primaryBngIp} interface ${accessIntf}.${vlanId} backup-neighbor ${backupBngIp} virtual-circuit-id ${vcId}`
  ];

  console.log(`[BUILD] Generated ${cmds.length} Access Switch commands`);
  cmds.forEach((cmd, idx) => console.log(`[BUILD] Access CMD ${idx + 1}: ${cmd}`));

  return cmds;
};

/**
 * Main function to push GPON over Enterprise configuration
 *
 * @param {Object} config
 * @param {Object} config.accessSwitch - { name, host } e.g. { name: "LTZ-ACC1-ITO", host: "41.175.37.14" }
 * @param {string} config.accessIntf - Access switch interface, e.g. "ge-0/0/27"
 * @param {Array} config.bngDevices - [{ name, host }, { name, host }] (min 2, first is primary)
 * @param {string} config.psUnit - ps interface number, e.g. "127"
 * @param {string} config.vlanId - VLAN ID / access switch unit number, e.g. "101"
 * @param {string} config.anchorPoint - Anchor point, default "lt-0/0/0"
 * @param {string} config.profilePrefix - Site profile prefix, e.g. "RAHA" → "RAHA-GPON-VLAN-PROFILE" / "RAHA-GPON"
 * @param {string} config.accountName - Customer account name, e.g. "LYNY SUPPLY AND SERVICES"
 * @param {string} config.accountNumber - Customer account number, e.g. "LHTZ-6779"
 * @param {string} config.cid - Circuit ID used to derive the virtual-circuit-id
 * @param {string} config.mtu - l2circuit MTU, default "1532"
 * @param {string} config.username - SSH username
 * @param {string} config.password - SSH password
 */
const pushGponOverEnterpriseConfig = async (config) => {
  console.log(`\n[CONFIG] ========================================`);
  console.log(`[CONFIG] Starting GPON over Enterprise Configuration Push`);
  console.log(`[CONFIG] ========================================`);
  console.log(JSON.stringify(config, null, 2));

  const {
    accessSwitch,
    accessIntf,
    bngDevices,
    psUnit,
    vlanId,
    anchorPoint = "lt-0/0/0",
    profilePrefix,
    accountName,
    accountNumber,
    cid,
    mtu = "1532",
    username,
    password
  } = config;

  console.log(`\n[CONFIG] ===== Validating Input =====`);

  if (!accessSwitch?.name || !accessSwitch?.host) {
    throw new Error("Access Switch name and host are required");
  }
  if (!accessIntf) {
    throw new Error("Access Switch interface is required");
  }
  if (!bngDevices || bngDevices.length < 2) {
    throw new Error("At least 2 BNG devices are required (primary and backup)");
  }
  bngDevices.forEach((bng, idx) => {
    if (!bng.name || !bng.host) {
      throw new Error(`BNG Device ${idx + 1} name and host are required`);
    }
  });
  if (!psUnit) {
    throw new Error("PS Unit number is required");
  }
  if (!vlanId) {
    throw new Error("VLAN ID is required");
  }
  if (!profilePrefix) {
    throw new Error("Profile prefix is required (used for dynamic-profile / access-profile names)");
  }
  if (!accountName || !accountNumber || !cid) {
    throw new Error("Account name, account number, and CID are required");
  }
  if (!username || !password) {
    throw new Error("SSH username and password are required");
  }

  console.log(`[CONFIG] ✓ Validation passed`);

  const sshConfig = { username, password };
  const primaryBng = bngDevices[0];
  const backupBng = bngDevices[1];
  const vlanProfile = `${profilePrefix}-GPON-VLAN-PROFILE`;
  const accessProfile = `${profilePrefix}-GPON`;
  const { vcId } = processCid(cid);

  const results = { accessSwitch: null, bng: [] };

  try {
    console.log(`\n[CONFIG] ===== STEP 1: Configure Access Switch =====`);
    const accessCommands = buildAccessSwitchCommands({
      accessIntf,
      vlanId,
      mtu,
      accountName,
      accountNumber,
      primaryBngIp: primaryBng.host,
      backupBngIp: backupBng.host,
      vcId
    });

    const accessResult = await runJunosCommands(
      accessSwitch.host,
      sshConfig,
      accessCommands,
      accessSwitch.name
    );

    results.accessSwitch = {
      device: accessSwitch.name,
      host: accessSwitch.host,
      status: "success",
      commands: accessCommands.length,
      output: accessResult
    };
    console.log(`[CONFIG] ✅ Access Switch configured successfully`);

    console.log(`\n[CONFIG] ===== STEP 2: Configure BNG Devices =====`);

    for (let i = 0; i < bngDevices.length; i++) {
      const bng = bngDevices[i];
      const bngLabel = i === 0 ? "Primary" : "Backup";

      console.log(`\n[CONFIG] ----- Configuring ${bngLabel} BNG: ${bng.name} -----`);

      const bngCommands = buildBngCommands({
        psUnit,
        anchorPoint,
        vlanProfile,
        accessProfile,
        mtu,
        accountName,
        accountNumber,
        accessSwitchName: accessSwitch.name,
        accessIntf,
        accessSwitchIp: accessSwitch.host,
        vcId
      });

      const bngResult = await runJunosCommands(bng.host, sshConfig, bngCommands, bng.name);

      results.bng.push({
        device: bng.name,
        host: bng.host,
        role: bngLabel.toLowerCase(),
        status: "success",
        commands: bngCommands.length,
        output: bngResult
      });
      console.log(`[CONFIG] ✅ ${bngLabel} BNG configured successfully`);
    }

    console.log(`\n[CONFIG] ✅ GPON over Enterprise Configuration Complete!`);

    return {
      success: true,
      message: "GPON over Enterprise configuration pushed successfully to all devices",
      results
    };
  } catch (error) {
    console.error(`\n[CONFIG] ❌ Configuration Failed: ${error.message}`);
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
const previewGponOverEnterpriseConfig = (config) => {
  console.log(`\n[PREVIEW] ========================================`);
  console.log(`[PREVIEW] Generating GPON over Enterprise Preview`);
  console.log(`[PREVIEW] ========================================`);

  const {
    accessSwitch,
    accessIntf,
    bngDevices,
    psUnit,
    vlanId,
    anchorPoint = "lt-0/0/0",
    profilePrefix,
    accountName,
    accountNumber,
    cid,
    mtu = "1532"
  } = config;

  const primaryBng = bngDevices[0];
  const backupBng = bngDevices[1];
  const vlanProfile = `${profilePrefix}-GPON-VLAN-PROFILE`;
  const accessProfile = `${profilePrefix}-GPON`;
  const { vcId } = processCid(cid);

  const accessCommands = buildAccessSwitchCommands({
    accessIntf,
    vlanId,
    mtu,
    accountName,
    accountNumber,
    primaryBngIp: primaryBng.host,
    backupBngIp: backupBng.host,
    vcId
  });

  const bngCommands = buildBngCommands({
    psUnit,
    anchorPoint,
    vlanProfile,
    accessProfile,
    mtu,
    accountName,
    accountNumber,
    accessSwitchName: accessSwitch.name,
    accessIntf,
    accessSwitchIp: accessSwitch.host,
    vcId
  });

  console.log(`\n[PREVIEW] Preview generated successfully`);

  return {
    accessSwitch: {
      device: accessSwitch.name,
      host: accessSwitch.host,
      commands: accessCommands
    },
    bng: bngDevices.map((bng, idx) => ({
      device: bng.name,
      host: bng.host,
      role: idx === 0 ? "primary" : "backup",
      commands: bngCommands
    }))
  };
};

module.exports = {
  pushGponOverEnterpriseConfig,
  previewGponOverEnterpriseConfig,
  buildBngCommands,
  buildAccessSwitchCommands,
  processCid
};
