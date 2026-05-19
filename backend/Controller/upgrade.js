const db = require("../Models");
const schedule = require("node-schedule");
const { Client } = require("ssh2");
const ms = require("ms");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });


const customerinfos = db.customerinfos;
const User = db.users;
const Upgradeinfos = db.upgradeinfos;

// === SWITCH INFO ===
const switches = [
  { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
  { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
];

const pe = [
  { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
  { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
];

const getTargetSwitches = (switchName) => {
  if (!switchName) return switches; // default fallback
  const name = String(switchName).toUpperCase();
  const hasBNG = name.includes("BNG");
  const hasPE = name.includes("PE");
  if (hasBNG && hasPE) return [...switches, ...pe];
  if (hasBNG) return switches;
  if (hasPE) return pe;
  return switches; // fallback
};
// Helper to build commands for both directions
const buildPolicerCommands = (interfaceName, upmbps, downmbps) => {
  // Split interface name and unit
  const [intf, unit] = interfaceName.split(".");
  const upCmd = `set interfaces ${intf} unit ${unit} layer2-policer input-policer ${upmbps}-MBPS-POLICER`;
  const downCmd = `set interfaces ${intf} unit ${unit} layer2-policer output-policer ${downmbps}-MBPS-POLICER`;
  return { upCmd, downCmd };
};

// Helper to run a complex sequence of Junos commands
const executeJunosUpgrade = (host, sshConfig, upmbps, downmbps, intfName) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stream;
    let result = "";

    conn
      .on("ready", () => {
        conn.shell((err, shellStream) => {
          if (err) return reject(err);
          stream = shellStream;
          let isDone = false;

          // This helper will contain our command logic
          const runCommands = (commandList, thenCallback) => {
            if (commandList.length === 0) {
              return thenCallback();
            }
            const cmd = commandList.shift();
            stream.write(cmd + "\n");
            stream.once("data", (data) => {
              console.log(data.toString());
              runCommands(commandList, thenCallback);
            });
          };

          // This is the core logic
          stream.on("data", (data) => {
            result += data.toString();
            if (isDone) return;

            if (result.includes("configuration check succeeds")) {
              console.log("Policer is valid. Committing and quitting.");
              stream.write("commit and-quit\n");
              isDone = true; // Set flag to prevent re-processing
              resolve();
            } else if (result.includes("must be a logical interface policer")) {
              console.log("Policer not found. Creating and re-trying.");
              const createPolicerCmds = [
                `set firewall policer ${upmbps}-MBPS-POLICER logical-interface-policer`,
                `set firewall policer ${upmbps}-MBPS-POLICER if-exceeding bandwidth-limit ${upmbps}m`,
                `set firewall policer ${upmbps}-MBPS-POLICER if-exceeding burst-size-limit ${Math.round(
                  upmbps * 0.1
                )}m`,
                `set firewall policer ${upmbps}-MBPS-POLICER then discard`,
                "commit",
              ];
              createPolicerCmds.forEach((cmd) => stream.write(cmd + "\n"));

              const { upCmd, downCmd } = buildPolicerCommands(
                intfName,
                upmbps,
                downmbps
              );
              stream.write(upCmd + "\n");
              stream.write(downCmd + "\n");
              stream.write("commit and-quit\n");

              isDone = true;
              resolve(); // Resolve after sending all commands
            }
          });

          stream.on("close", (hadError) => {
            conn.end();
            if (hadError && !isDone) {
              reject(new Error("SSH session closed unexpectedly."));
            } else if (!isDone) {
              reject(new Error("No valid response received from device."));
            }
          });

          // Initial commands
          const { upCmd, downCmd } = buildPolicerCommands(
            intfName,
            upmbps,
            downmbps
          );
          stream.write("cli\n");
          stream.write("configure private\n");
          stream.write(upCmd + "\n");
          stream.write(downCmd + "\n");
          stream.write("commit check\n");
        });
      })
      .connect({ host, ...sshConfig });
  });
};

const extractAndReplaceMbps = (fullDescription, newValue) => {
  // Regex to find the existing Mbps value and capture the parts before and after it
  const regex = /(.*\|)(M|G)bps=\d+(.*)/;
  const match = fullDescription.match(regex);

  if (match && match.length === 4) {
    const prefix = match[1]; // e.g., "{cat=DIA|...|"
    const unitLetter = match[2]; // 'M' or 'G'
    const suffix = match[3]; // e.g., '}"'

    // Reconstruct the string using the captured parts and the new value
    return `${prefix}${unitLetter}bps=${newValue}${suffix}`;
  }

  // Fallback: if regex fails, return the original command
  return fullDescription;
};

const runCommand = (host, cmd, sshConfig) => {
  // Prefix the command with 'cli ' for Junos devices
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let result = "";
    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            conn.end();
            return reject(new Error(`Command execution error: ${err.message}`));
          }
          stream
            .on("data", (data) => {
              result += data.toString();
            })
            .on("close", () => {
              conn.end();
              // console.log(`Command output for ${cmd}:`, result.trim()); // Debug line
              resolve(result.trim());
            });
        });
      })
      .on("error", (err) =>
        reject(new Error(`SSH connection error to ${host}: ${err.message}`))
      )
      .connect({ host, ...sshConfig });
  });
};

const excuteJunosChangeDesription = async (
  host,
  sshConfig,
  newMbps,
  intfName
) => {
  const [intf] = intfName.split(".");
  const showDescCmd = `show configuration interfaces ${intf} | display set | match description`;

  try {
    // 1. Retrieve the existing description using the simpler runCommand
    const descriptionOutput = await runCommand(host, showDescCmd, sshConfig);

    if (!descriptionOutput || !descriptionOutput.includes("description")) {
      console.log(
        `[Description Change] No description found for ${intfName} on ${host}. Skipping update.`
      );
      return;
    }

    const descriptionLine = descriptionOutput
      .split("\n")
      .find((l) => l.includes("set interfaces") && l.includes("description"))
      .trim();

    // 2. Prepare the new configuration command
    const newDescCmd = extractAndReplaceMbps(
      // Assuming 'extractAndReplaceMbps' is the name of your final helper
      descriptionLine,
      newMbps
    );

    console.log(`[Description Change] Old: ${descriptionLine}`);
    console.log(`[Description Change] New: ${newDescCmd}`);

    // 3. Commit the change using a shell stream for the config sequence
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";

      conn
        .on("ready", () => {
          conn.shell((err, stream) => {
            if (err) return reject(err);
            let isDone = false;

            stream.on("data", (data) => {
              result += data.toString();
              if (isDone) return;
              console.log(result);
              if (result.includes("configuration check succeeds")) {
                console.log(
                  `[Description Change] Commit successful on ${host}.`
                );
                stream.write("commit and-quit\n");
                isDone = true;
                resolve();
              }
            });

            stream.on("close", (hadError) => {
              conn.end();
              if (hadError && !isDone) {
                reject(
                  new Error(
                    "SSH session closed unexpectedly during config commit."
                  )
                );
              } else if (!isDone) {
                reject(new Error("Config commit failed or timed out."));
              }
            });

            // Write the sequence of commands
            // stream.write("cli\n"); // Ensure shell is in operational mode first
            stream.write("configure private\n");
            stream.write(newDescCmd + "\n");
            stream.write("commit check\n");
          });
        })
        .connect({ host, ...sshConfig });
    });
  } catch (error) {
    console.error(
      `[Description Change] Error updating description on ${host}: ${error.message}`
    );
    // Re-throw or resolve depending on desired error handling in upgradeCustomer
    throw error;
  }
};

const takeNeighborIpFromBNGOrPe = async (host, sshConfig, intfName) => {
  const [intf, unit] = intfName.split(".");
  // The command remains the same
  const showL2CircuitCmd = `show l2circuit connections interface ${intf}.0 | match Neighbor`;

  try {
    // 1. Get the raw output using the runCommand helper
    const output = await runCommand(host, showL2CircuitCmd, sshConfig);
    console.log(
      `[L2C Neighbor] Raw output from ${host}:`,
      output.split("\n")[0] + "..."
    ); // Log first line for brevity

    // 2. Perform the regex match on the output
    const match = output.match(
      /Neighbor:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
    );

    if (match) {
      const neighborIP = match[1];
      console.log(`[L2C Neighbor] Extracted Neighbor IP: ${neighborIP}`);
      return neighborIP;
    } else {
      console.log("[L2C Neighbor] Neighbor IP not found in output.");
      return null;
    }
  } catch (error) {
    console.error(
      `[L2C Neighbor] Error running command on ${host}: ${error.message}`
    );
    return null;
  }
};

const tokenizeCustomerName = (customerName) => {
  if (!customerName) return [];

  // Regex explanation:
  // ([a-zA-Z0-9]+)  -> Captures one or more letters/numbers (the words)
  // |               -> OR
  // (-)             -> Captures a single hyphen (the separator)
  // |               -> OR
  // (\s+)           -> Captures one or more spaces (the space separator)
  // The match() function returns an array of ALL matches.
  const tokens = customerName.match(/([a-zA-Z0-9]+)|(-)|(\s+)/g) || [];

  // Filter out spaces and empty tokens, then uppercase the result.
  return tokens
    .filter((token) => token && token.trim().length > 0 && token.trim() !== " ")
    .map((token) => token.toUpperCase());
};

const buildMatchCommand = (customerName) => {
  // 1. Get the tokens (e.g., ["IPSEC", "POC", "FORT", "-", "ASA"] or ["HCI", "FORTNET", "FIREWALL"])
  const tokens = tokenizeCustomerName(customerName);

  if (tokens.length === 0) {
    // Fallback if the name is empty or only contains delimiters
    return `show configuration interfaces | display set`;
  }

  // 2. Define the static part of the command
  let command = `show configuration interfaces | display set | match unit | match description`;

  // 3. Append a '| match' filter for each token, including the hyphen if present.
  tokens.forEach((token) => {
    command += ` | match ${token}`;
  });

  return command;
};
const excuteJunusNeighborDescription = async (
  host,
  sshConfig,
  newMbps,
  customerName
) => {
  const showDescCmd = buildMatchCommand(customerName);

  try {
    const descriptionOutput = await runCommand(host, showDescCmd, sshConfig);

    if (!descriptionOutput || !descriptionOutput.includes("description")) {
      console.log(
        `[Neighbor Description Change] No matching description found for customer ${customerName} on ${host}. Skipping update.`
      );
      return;
    }

    const descriptionLine = descriptionOutput
      .split("\n")
      .find((l) => l.includes("set interfaces") && l.includes("description"))
      .trim();

    const newDescCmd = extractAndReplaceMbps(
      // Assuming 'extractAndReplaceMbps' is the name of your final helper
      descriptionLine,
      newMbps
    );

    console.log(`[Description Change] Old: ${descriptionLine}`);
    console.log(`[Description Change] New: ${newDescCmd}`);
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";

      conn
        .on("ready", () => {
          conn.shell((err, stream) => {
            if (err) return reject(err);
            let isDone = false;

            stream.on("data", (data) => {
              result += data.toString();
              if (isDone) return;
              console.log(result);
              if (result.includes("configuration check succeeds")) {
                console.log(
                  `[Description Change] Commit successful on ${host}.`
                );
                stream.write("commit and-quit\n");
                isDone = true;
                resolve();
              }
            });

            stream.on("close", (hadError) => {
              conn.end();
              if (hadError && !isDone) {
                reject(
                  new Error(
                    "SSH session closed unexpectedly during config commit."
                  )
                );
              } else if (!isDone) {
                reject(new Error("Config commit failed or timed out."));
              }
            });

            // Write the sequence of commands
            // stream.write("cli\n"); // Ensure shell is in operational mode first
            stream.write("configure private\n");
            stream.write(newDescCmd + "\n");
            stream.write("commit check\n");
          });
        })
        .connect({ host, ...sshConfig });
    });
  } catch (error) {
    console.error(
      `[Description Change] Error updating description on ${host}: ${error.message}`
    );
    // Re-throw or resolve depending on desired error handling in upgradeCustomer
    throw error;
  }
};

exports.upgradeCustomer = async (req, res) => {
  const {
    interface: intfName,
    new_upmbps,
    new_downmbps,
    type,
    duration,
    username,
    password,
    approved_by,
    upgrade_type,
    account_manager,
  } = req.body;
  console.log(approved_by)

  try {
    const customer = await customerinfos.findOne({
      where: { interface: intfName },
      include: [
        {
          model: db.diacustomers,
          attributes: ["switchName"],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // New SSH config using the credentials from the request body
    const sshConfigFromRequest = { username, password };

    // read switchName robustly (handles possible different include naming)
    const switchName =
      (customer.diacustomers && customer.diacustomers.switchName) ||
      (customer.diacustomer && customer.diacustomer.switchName) ||
      customer.switchName ||
      "";

    // choose the correct list of devices to iterate over
    const targetSwitches = getTargetSwitches(switchName);

    // Run upgrade on all switches in the array
    for (const sw of targetSwitches) {
      console.log(`[Upgrade] Applying upgrade on ${sw.name} (${sw.host})`);
      // Use the new sshConfigFromRequest
      await executeJunosUpgrade(
        sw.host,
        sshConfigFromRequest,
        new_upmbps,
        new_downmbps,
        intfName,
        type
      );
    }
    // Variable to hold the neighbor IP
    // let neighborSwitchIP = null;
    if (type === "permanent") {
      const old_upmbps = customer.upmbps;
      const old_downmbps = customer.downmbps;
      // 1. Get Neighbor IP from the first switch
      const targetSwitchForL2c = targetSwitches[0];
      if (targetSwitchForL2c) {
        console.log(
          `[L2C Neighbor] Checking neighbor IP on ${targetSwitchForL2c.name} (${targetSwitchForL2c.host})`
        );
        try {
          neighborSwitchIP = await takeNeighborIpFromBNGOrPe(
            targetSwitchForL2c.host,
            sshConfigFromRequest,
            intfName
          );
          // Log the saved IP for confirmation
          console.log(
            `[L2C Neighbor] Neighbor IP saved: ${neighborSwitchIP || "N/A"}`
          );
        } catch (error) {
          console.error(
            `[L2C Neighbor] Error retrieving neighbor IP on ${targetSwitchForL2c.name}:`,
            error.message
          );
        }
      }

      // 2. Run description update on ALL target switches (BNG/PE)
      for (const sw of targetSwitches) {
        console.log(
          `[Description Change] Starting description update on ${sw.name} (${sw.host})`
        );
        try {
          await excuteJunosChangeDesription(
            sw.host,
            sshConfigFromRequest,
            new_upmbps,
            intfName
          );
        } catch (error) {
          console.error(
            `[Description Change] Error during description update on ${sw.name}:`,
            error.message
          );
          // Log the error and allow the customer DB update to proceed.
        }
      }

      // 3 update customer description at neighbor switch if IP was found

      if (neighborSwitchIP) {
        await excuteJunusNeighborDescription(
          neighborSwitchIP,
          sshConfigFromRequest,
          new_upmbps,
          customer.customerName
        );
      }
      if (upgrade_type === "upgrade") {
        await Upgradeinfos.create({
          interface: intfName,
          current_bandwidth: customer.upmbps,
          upgrade_bandwidth: new_upmbps,
          approved_by: approved_by,
          start_date: new Date(),
          account_manager: account_manager,
          done_by: username
        });
      }
      if (upgrade_type === "downgrade") {
        await Upgradeinfos.create({
          interface: intfName,
          current_bandwidth: customer.upmbps,
          downgrade_bandwidth: new_upmbps,
          approved_by: approved_by,
          start_date: new Date(),
          account_manager: account_manager,
          done_by: username

        });
      }
      await customer.update({
        upmbps: new_upmbps,
        downmbps: new_downmbps,
        old_upmbps: old_upmbps,
        old_downmbps: old_downmbps,
        upgrade_type: "permanent",
        expires_at: null,
      });
    } 
    else if (type === "temporary") {
      const old_upmbps = customer.upmbps;
      const old_downmbps = customer.downmbps;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ms(duration));


      if (upgrade_type === "upgrade") {
        console.log(approved_by)
        await Upgradeinfos.create({
          interface: intfName,
          current_bandwidth: customer.upmbps,
          upgrade_bandwidth: new_upmbps,
          approved_by: approved_by,
          start_date: new Date(),
          end_date: expiresAt,
          account_manager: account_manager,
          done_by: username
        });
      }
      if (upgrade_type === "downgrade") {
        await Upgradeinfos.create({
          interface: intfName,
          current_bandwidth: customer.upmbps,
          downgrade_bandwidth: new_upmbps,
          approved_by: approved_by,
          start_date: new Date(),
          end_date: expiresAt,
          approved_by: approved_by,
          account_manager: account_manager,
          done_by: username
        });
      }

      await customer.update({
        upmbps: new_upmbps,
        downmbps: new_downmbps,
        old_upmbps,
        old_downmbps,
        upgrade_type: "temporary",
        expires_at: expiresAt,
      });

      schedule.scheduleJob(expiresAt, async () => {
        console.log(`[Auto-Downgrade] Downgrading ${intfName}`);
        try {
          for (const sw of switches) {
            console.log(`[Downgrade] Reverting on ${sw.name} (${sw.host})`);
            await executeJunosUpgrade(
              sw.host,
              { username: process.env.SSH_USERNAME, password: process.env.SSH_PASSWORD },
              old_upmbps,
              old_downmbps,
              intfName
            );
          }

          await customer.update({
            upmbps: old_upmbps,
            downmbps: old_downmbps,
            old_upmbps: null,
            old_downmbps: null,
            upgrade_type: null,
            expires_at: null,
          });
          console.log(`[Auto-Downgrade] Completed for ${intfName}`);
        } catch (error) {
          console.error(
            `[Auto-Downgrade] Error on ${intfName}:`,
            error.message
          );
        }
      });
    } else {
      return res.status(400).json({ message: "Invalid upgrade type" });
    }

    return res.json({ message: "Upgrade applied successfully" });
  } catch (error) {
    console.error("Error upgrading customer:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.rescheduleJobs = async () => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
  };
  try {
    const temporaryUpgrades = await customerinfos.findAll({
      where: { upgrade_type: "temporary" },
    });

    const now = new Date();

    for (const customer of temporaryUpgrades) {
      const {
        interface: intfName,
        upmbps,
        downmbps,
        old_upmbps,
        old_downmbps,
        expires_at,
      } = customer;

      if (!expires_at) continue;

      if (new Date(expires_at) <= now) {
        // Expired → downgrade immediately
        console.log(`[Fix] Immediate downgrade for expired ${intfName}`);
        try {
          for (const sw of switches) {
            console.log(`[Downgrade] Reverting on ${sw.name} (${sw.host})`);
            await executeJunosUpgrade(
              sw.host,
              sshConfig,
              old_upmbps,
              old_downmbps,
              intfName
            );
          }
          await customer.update({
            upmbps: old_upmbps,
            downmbps: old_downmbps,
            old_upmbps: null,
            old_downmbps: null,
            upgrade_type: null,
            expires_at: null,
          });
          console.log(`[Fix] Completed immediate downgrade for ${intfName}`);
        } catch (error) {
          console.error(
            `[Fix] Error downgrading expired ${intfName}:`,
            error.message
          );
        }
      } else {
        // Future → schedule normally
        console.log(
          `[Rescheduler] Rescheduling downgrade for ${intfName} at ${expires_at}`
        );
        schedule.scheduleJob(expires_at, async () => {
          console.log(`[Auto-Downgrade] Downgrading ${intfName}`);
          try {
            for (const sw of switches) {
              console.log(`[Downgrade] Reverting on ${sw.name} (${sw.host})`);
              await executeJunosUpgrade(
                sw.host,
                sshConfig,
                old_upmbps,
                old_downmbps,
                intfName
              );
            }
            await customer.update({
              upmbps: old_upmbps,
              downmbps: old_downmbps,
              old_upmbps: null,
              old_downmbps: null,
              upgrade_type: null,
              expires_at: null,
            });
            console.log(`[Auto-Downgrade] Completed for ${intfName}`);
          } catch (error) {
            console.error(
              `[Auto-Downgrade] Error on ${intfName}:`,
              error.message
            );
          }
        });
      }
    }
  } catch (error) {
    console.error("Error rescheduling jobs:", error);
  }
};
