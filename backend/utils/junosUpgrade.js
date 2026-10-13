const { Client } = require("ssh2");

// === SWITCH INFO ===
// Shared with Controller/upgrade.js (DIA) — kept in sync manually since that
// file intentionally still owns its own copy rather than importing this one.
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
// How long to wait for the device to return one of the expected strings
// ("configuration check succeeds" / "must be a logical interface policer")
// before giving up. Without this, an SSH shell session that opens fine but
// never produces either expected string (unexpected CLI banner/prompt text,
// a policer commit that's a silent no-op, a hung device) leaves the promise
// unresolved forever — and since rescheduleJobs awaits each customer
// sequentially in a for-loop, one hung customer blocks every customer
// behind it in the queue, indefinitely, with no error ever logged.
const SHELL_COMMAND_TIMEOUT_MS = 30000;

// Same problem as SHELL_COMMAND_TIMEOUT_MS above, but for plain exec()
// commands (runCommand below): readyTimeout only bounds the SSH handshake.
// Once conn.exec() opens a channel, nothing bounds how long we wait for its
// "close" event. A device that accepts the exec but never closes the
// channel (busy CPU, paginated/interactive output, a silently stuck CLI
// process) leaves the promise unresolved and the connection open forever —
// which is exactly the kind of leaked session that can exhaust a router's
// limited concurrent SSH session pool and lock out real admins.
const EXEC_COMMAND_TIMEOUT_MS = 30000;

const executeJunosUpgrade = (host, sshConfig, upmbps, downmbps, intfName) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stream;
    let result = "";
    let isDone = false;

    const timeoutTimer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for device response on ${host} (${SHELL_COMMAND_TIMEOUT_MS / 1000}s)`));
      conn.end();
    }, SHELL_COMMAND_TIMEOUT_MS);

    // Ensures resolve/reject only ever fires once and always clears the
    // timeout timer, regardless of which path (success, device error,
    // connection error, or the timeout itself) gets there first.
    const finish = (fn, arg) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeoutTimer);
      fn(arg);
    };

    conn
      .on("ready", () => {
        conn.shell((err, shellStream) => {
          if (err) return finish(reject, err);
          stream = shellStream;

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
              finish(resolve);
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

              finish(resolve); // Resolve after sending all commands
            }
          });

          stream.on("close", (hadError) => {
            conn.end();
            if (hadError && !isDone) {
              finish(reject, new Error("SSH session closed unexpectedly."));
            } else if (!isDone) {
              finish(reject, new Error("No valid response received from device."));
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
      .on("error", (err) =>
        finish(reject, new Error(`SSH connection error to ${host}: ${err.message}`))
      )
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
    let isDone = false;

    const timeoutTimer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for command output from ${host} (${EXEC_COMMAND_TIMEOUT_MS / 1000}s): ${cmd}`));
      conn.end();
    }, EXEC_COMMAND_TIMEOUT_MS);

    const finish = (fn, arg) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeoutTimer);
      fn(arg);
    };

    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            conn.end();
            return finish(reject, new Error(`Command execution error: ${err.message}`));
          }
          stream
            .on("data", (data) => {
              result += data.toString();
            })
            .on("close", () => {
              conn.end();
              // console.log(`Command output for ${cmd}:`, result.trim()); // Debug line
              finish(resolve, result.trim());
            });
        });
      })
      .on("error", (err) =>
        finish(reject, new Error(`SSH connection error to ${host}: ${err.message}`))
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
      descriptionLine,
      newMbps
    );

    console.log(`[Description Change] Old: ${descriptionLine}`);
    console.log(`[Description Change] New: ${newDescCmd}`);

    // 3. Commit the change using a shell stream for the config sequence
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";
      let isDone = false;

      const timeoutTimer = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for device response on ${host} (${SHELL_COMMAND_TIMEOUT_MS / 1000}s)`));
        conn.end();
      }, SHELL_COMMAND_TIMEOUT_MS);

      const finish = (fn, arg) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutTimer);
        fn(arg);
      };

      conn
        .on("ready", () => {
          conn.shell((err, stream) => {
            if (err) return finish(reject, err);

            stream.on("data", (data) => {
              result += data.toString();
              if (isDone) return;
              console.log(result);
              if (result.includes("configuration check succeeds")) {
                console.log(
                  `[Description Change] Commit successful on ${host}.`
                );
                stream.write("commit and-quit\n");
                finish(resolve);
              }
            });

            stream.on("close", (hadError) => {
              conn.end();
              if (hadError && !isDone) {
                finish(
                  reject,
                  new Error(
                    "SSH session closed unexpectedly during config commit."
                  )
                );
              } else if (!isDone) {
                finish(reject, new Error("Config commit failed or timed out."));
              }
            });

            // Write the sequence of commands
            stream.write("configure private\n");
            stream.write(newDescCmd + "\n");
            stream.write("commit check\n");
          });
        })
        .on("error", (err) =>
          finish(reject, new Error(`SSH connection error to ${host}: ${err.message}`))
        )
        .connect({ host, ...sshConfig });
    });
  } catch (error) {
    console.error(
      `[Description Change] Error updating description on ${host}: ${error.message}`
    );
    throw error;
  }
};

const takeNeighborIpFromBNGOrPe = async (host, sshConfig, intfName) => {
  const [intf] = intfName.split(".");
  const showL2CircuitCmd = `show l2circuit connections interface ${intf}.0 | match Neighbor`;

  try {
    const output = await runCommand(host, showL2CircuitCmd, sshConfig);
    console.log(
      `[L2C Neighbor] Raw output from ${host}:`,
      output.split("\n")[0] + "..."
    );

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

  const tokens = customerName.match(/([a-zA-Z0-9]+)|(-)|(\s+)/g) || [];

  return tokens
    .filter((token) => token && token.trim().length > 0 && token.trim() !== " ")
    .map((token) => token.toUpperCase());
};

const buildMatchCommand = (customerName) => {
  const tokens = tokenizeCustomerName(customerName);

  if (tokens.length === 0) {
    return `show configuration interfaces | display set`;
  }

  let command = `show configuration interfaces | display set | match unit | match description`;

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
      descriptionLine,
      newMbps
    );

    console.log(`[Description Change] Old: ${descriptionLine}`);
    console.log(`[Description Change] New: ${newDescCmd}`);
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";
      let isDone = false;

      // Was missing this watchdog (unlike executeJunosUpgrade and
      // excuteJunosChangeDesription above) — a shell that never produces
      // "configuration check succeeds" left this promise, and the
      // connection, hanging forever. See SHELL_COMMAND_TIMEOUT_MS comment.
      const timeoutTimer = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for device response on ${host} (${SHELL_COMMAND_TIMEOUT_MS / 1000}s)`));
        conn.end();
      }, SHELL_COMMAND_TIMEOUT_MS);

      const finish = (fn, arg) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutTimer);
        fn(arg);
      };

      conn
        .on("ready", () => {
          conn.shell((err, stream) => {
            if (err) return finish(reject, err);

            stream.on("data", (data) => {
              result += data.toString();
              if (isDone) return;
              console.log(result);
              if (result.includes("configuration check succeeds")) {
                console.log(
                  `[Description Change] Commit successful on ${host}.`
                );
                stream.write("commit and-quit\n");
                finish(resolve);
              }
            });

            stream.on("close", (hadError) => {
              conn.end();
              if (hadError && !isDone) {
                finish(
                  reject,
                  new Error(
                    "SSH session closed unexpectedly during config commit."
                  )
                );
              } else if (!isDone) {
                finish(reject, new Error("Config commit failed or timed out."));
              }
            });

            stream.write("configure private\n");
            stream.write(newDescCmd + "\n");
            stream.write("commit check\n");
          });
        })
        .on("error", (err) =>
          finish(reject, new Error(`SSH connection error to ${host}: ${err.message}`))
        )
        .connect({ host, ...sshConfig });
    });
  } catch (error) {
    console.error(
      `[Description Change] Error updating description on ${host}: ${error.message}`
    );
    throw error;
  }
};

module.exports = {
  switches,
  pe,
  getTargetSwitches,
  buildPolicerCommands,
  executeJunosUpgrade,
  extractAndReplaceMbps,
  runCommand,
  excuteJunosChangeDesription,
  takeNeighborIpFromBNGOrPe,
  tokenizeCustomerName,
  buildMatchCommand,
  excuteJunusNeighborDescription,
};
