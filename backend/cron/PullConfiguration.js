const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");

require("dotenv").config({ path: "../.env" });

const sshConfig = {
  username: "godwin.makyao",
  password: "Namwel@842001!@#",
  // OPTIMIZATION 1: Add timeouts for connection stability
  readyTimeout: 10000, 
  keepaliveInterval: 10000,
  keepaliveCountMax: 2, 
};

const switches = [
  { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
  { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
];

const pe = [
  { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
  { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
];

const getTargetSwitches = (switchName) => {
  if (!switchName) return switches;
  const name = String(switchName).toUpperCase();
  const hasBNG = name.includes("BNG");
  const hasPE = name.includes("PE");
  if (hasBNG && hasPE) return [...switches, ...pe];
  if (hasBNG) return switches;
  if (hasPE) return pe;
  return switches;
};

/**
 * Helper function to execute a command over SSH. (Optimized error handling)
 */
const runSshCommand = (host, command, intfName) => {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = "";

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            console.error(
              `[${intfName}] SSH EXEC Error on ${host}: ${err.message}`
            );
            return resolve("");
          }
          stream
            .on("close", (code, signal) => {
              conn.end();
              resolve(output.trim());
            })
            .on("data", (data) => {
              output += data;
            })
            .stderr.on("data", (data) => {
              // OPTIMIZATION 2: Do not append STDERR to main output, just log it.
              console.error(`[${intfName}] STDERR from ${host}: ${data.toString().trim()}`);
            });
        });
      })
      .on("error", (err) => {
        console.error(
          `[${intfName}] SSH Connection Error to ${host}: ${err.message}`
        );
        // Resolve with empty string to allow batch processing to continue
        resolve("");
      })
      .connect({ ...sshConfig, host });
  });
};

// --- CORE PER-CUSTOMER LOGIC ---

/**
 * Handles the full configuration pull and persistence for a single customer record.
 */
const processCustomer = async (customer) => {
  const ConfigurationData = db.configurationdata;

  const cust = customer;
  // Use ID as fallback for logging context
  const intfName = cust.interface || `Customer ID ${cust.id}`; 
  const custId = cust.id;

  try {
    const switchName = cust.diacustomer?.switchName || "";

    if (!cust.interface || !cust.port) {
      console.warn(
        `[${intfName}] SKIPPING: Missing interface or port data.`
      );
      return { id: custId, status: "Skipped", reason: "Missing data" };
    }

    const [intf] = cust.interface.split(".");

    // --- 1. Pull BNG/PE Configuration and Extract NBR IP & Unit ---
    let bng_pe_configurations = [];
    let nbr_switch_configurations = [];
    let nbr_ip = null;
    let nbr_filter_unit = null;

    const targetSwitches = getTargetSwitches(switchName);
    const bngPeDevice = targetSwitches.find(
      (d) => d.name.includes("BNG") || d.name.includes("PE")
    );

    if (bngPeDevice) {
      const command = `show configuration | display set | match ${intf}`;
      const output = await runSshCommand(bngPeDevice.host, command, intfName);

      bng_pe_configurations = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // --- Parsing Configuration ---
      
      const descriptionLine = bng_pe_configurations.find(
        (line) => line.includes(`set interfaces ${intf}`) && line.includes("description")
      );
      
      if (descriptionLine) {
        // Regex to find the unit number
        const unitMatch = descriptionLine.match(/unit\s+(\d+)\s+description/);
        nbr_filter_unit = unitMatch ? unitMatch[1] : null;
      }

      const neighborLine = bng_pe_configurations.find(
        (line) =>
          line.includes("set protocols l2circuit neighbor") &&
          line.includes(intf)
      );

      if (neighborLine) {
        const match = neighborLine.match(/neighbor\s+(\S+)\s+interface/);
        nbr_ip = match ? match[1] : null;
      }

    } else {
      console.warn(
        `[${intfName}] No BNG/PE device found for switchName: ${switchName}`
      );
    }

    // --- 2. Pull NBR Switch Configuration ---
    if (nbr_ip) {
      let nbrCommand;
      const baseCommand = `show configuration | display set | match ${cust.port}`;

      if (nbr_filter_unit) {
        nbrCommand = `${baseCommand} | match ${nbr_filter_unit}`;
      } else {
        nbrCommand = baseCommand;
      }

      const output = await runSshCommand(nbr_ip, nbrCommand, intfName);

      nbr_switch_configurations = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } else {
      console.warn(
        `[${intfName}] Could not determine NBR IP. Skipping NBR config pull.`
      );
    }

    // --- 3. Save Configuration Data (Optimized Query) ---
    const updatePayload = {
      bng_pe_configurations: bng_pe_configurations,
      nbr_switch_configurations: nbr_switch_configurations,
    };

    // OPTIMIZATION 3: Fetch only the ID for the existence check
    let configData = await ConfigurationData.findOne({
      where: { customerinfo_id: custId },
      attributes: ['id'] 
    });

    if (configData) {
      await configData.update(updatePayload);
    } else {
      await ConfigurationData.create({
        customerinfo_id: custId,
        ...updatePayload,
      });
    }

    const finalStatus = 
        bng_pe_configurations.length > 0 && nbr_switch_configurations.length > 0
        ? "Success" 
        : "Partial/Failure";
        
    return { id: custId, interface: intfName, status: finalStatus };
  } catch (error) {
    console.error(
      `[${intfName}] FATAL Error during processing:`,
      error.message
    );
    return {
      id: custId,
      interface: intfName,
      status: "Failed",
      error: error.message,
    };
  }
};

// --- MAIN EXPORTED FUNCTION (Runnable) ---

const PullAllConfigurations = async () => {
  console.log("Starting bulk configuration pull for all customers...");

  const customerinfos = db.customerinfos;
  
  // OPTIMIZATION 4: Increase P_LIMIT for faster execution. 
  // If 5 was stable, try 10, 15, or 20 for a major time reduction.
  const P_LIMIT = 5; 

  try {
    // 1. Fetch ALL customers (Optimized attributes)
    const allCustomers = await customerinfos.findAll({
      attributes: ['id', 'interface', 'port'], // Fetch only required columns
      include: [
        {
          model: db.diacustomers,
          attributes: ["switchName"],
        },
      ],
    });

    if (allCustomers.length === 0) {
      console.log("No customers found in the database. Exiting.");
      return [];
    }

    console.log(
      `Found ${allCustomers.length} customers. Starting batched pull with limit ${P_LIMIT}...`
    );

    // 2. Batched Concurrent Processing Loop (Optimized for execution time)
    const results = [];
    const totalBatches = Math.ceil(allCustomers.length / P_LIMIT);
    
    for (let i = 0; i < allCustomers.length; i += P_LIMIT) {
        const batch = allCustomers.slice(i, i + P_LIMIT);
        console.log(`Processing batch ${Math.floor(i/P_LIMIT) + 1} of ${totalBatches} (${batch.length} items)...`);
        
        const batchPromises = batch.map(customer => processCustomer(customer));
        
        // Await the completion of the current batch
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
    }
    
    // --- 3. Summarize Results ---
    const finalSummary = results.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : { status: 'Rejected', reason: result.reason.message || 'Unknown rejection' }
    );

    const successCount = finalSummary.filter((r) => r.status === "Success").length;
    const partialCount = finalSummary.filter((r) => r.status === "Partial/Failure").length;
    const failedCount = finalSummary.filter((r) => r.status === "Failed" || r.status === "Rejected").length;
    const skippedCount = finalSummary.filter((r) => r.status === "Skipped").length;

    console.log(`\n--- Batch Summary ---`);
    console.log(`Total Customers: ${allCustomers.length}`);
    console.log(`Fully Successful Pulls: ${successCount}`);
    console.log(`Partial/Failed Pulls: ${partialCount + failedCount}`);
    console.log(`Skipped Customers: ${skippedCount}`);
    console.log(`---------------------\n`);

    return finalSummary;
  } catch (error) {
    console.error("Critical error fetching all customers:", error.message);
    return [];
  }
};

// --- RUNNABLE FUNCTION EXPORT ---
module.exports = PullAllConfigurations();