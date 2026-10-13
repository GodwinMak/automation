const schedule = require("node-schedule");
const ms = require("ms");
const {
  getTargetSwitches,
  executeJunosUpgrade,
  excuteJunosChangeDesription,
  takeNeighborIpFromBNGOrPe,
  excuteJunusNeighborDescription,
} = require("./junosUpgrade");

/**
 * Builds an { upgradeCustomer, rescheduleJobs } pair for a given customer
 * type, mirroring Controller/upgrade.js's DIA implementation — same SSH
 * policer/description flow, same temporary-upgrade auto-revert via
 * node-schedule — parameterized by which Sequelize models to read/write.
 *
 * One deliberate correction vs. DIA's literal behavior: DIA's own revert
 * path pushes only to the hardcoded BNG `switches` list, never to `pe`,
 * unlike its initial push which uses getTargetSwitches(switchName) — a
 * latent bug (PE-hosted circuits never get reverted on the PE side). This
 * factory uses getTargetSwitches(switchName) consistently for both push and
 * revert; DIA's own file is left untouched rather than fixed in place.
 *
 * @param {object} opts
 * @param {object} opts.InfoModel - e.g. db.iptcustomerinfos (row holds upmbps/downmbps/old_upmbps/old_downmbps/expires_at/upgrade_type)
 * @param {object} opts.CustomerModel - e.g. db.iptcustomers (joined for switchName)
 * @param {object} opts.UpgradeInfoModel - e.g. db.iptupgradeinfos (audit trail)
 * @param {string[]} opts.customerAssocKeys - possible association accessor names for the joined CustomerModel row, checked in order (Sequelize's default association naming isn't singular/plural-consistent across every model in this codebase)
 */
const createUpgradeController = ({
  InfoModel,
  CustomerModel,
  UpgradeInfoModel,
  customerAssocKeys,
  jobKey,
}) => {
  const effectiveJobKey = jobKey || (InfoModel && InfoModel.name) || "generic";
  const getJobName = (intfName) => `temp-upgrade:${effectiveJobKey}:${intfName}`;

  const resolveSwitchName = (customer) => {
    for (const key of customerAssocKeys) {
      if (customer[key] && customer[key].switchName) {
        return customer[key].switchName;
      }
    }
    return customer.switchName || "";
  };

  const applyCapacityOnDevices = async ({ intfName, upmbps, downmbps, switchName, sshConfig }) => {
    const targetSwitches = getTargetSwitches(switchName);
    for (const sw of targetSwitches) {
      console.log(`[Upgrade] Applying change on ${sw.name} (${sw.host})`);
      await executeJunosUpgrade(sw.host, sshConfig, upmbps, downmbps, intfName);
    }
  };

  const scheduleTemporaryRevert = ({ intfName, switchName, old_upmbps, old_downmbps, expiresAt, customer }) => {
    const jobName = getJobName(intfName);
    const existingJob = schedule.scheduledJobs[jobName];
    if (existingJob) existingJob.cancel();

    schedule.scheduleJob(jobName, expiresAt, async () => {
      console.log(`[Auto-Downgrade] Downgrading ${intfName}`);
      try {
        for (const sw of getTargetSwitches(switchName)) {
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
        console.error(`[Auto-Downgrade] Error on ${intfName}:`, error.message);
      }
    });
  };

  const upgradeCustomer = async (req, res) => {
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

    try {
      const customer = await InfoModel.findOne({
        where: { interface: intfName },
        include: [
          {
            model: CustomerModel,
            attributes: ["switchName"],
          },
        ],
      });

      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // SSH config using the credentials from the request body
      const sshConfigFromRequest = { username, password };

      const switchName = resolveSwitchName(customer);
      const targetSwitches = getTargetSwitches(switchName);

      // Run upgrade on all switches in the array
      for (const sw of targetSwitches) {
        console.log(`[Upgrade] Applying upgrade on ${sw.name} (${sw.host})`);
        await executeJunosUpgrade(
          sw.host,
          sshConfigFromRequest,
          new_upmbps,
          new_downmbps,
          intfName
        );
      }

      if (type === "permanent") {
        const old_upmbps = customer.upmbps;
        const old_downmbps = customer.downmbps;

        // 1. Get Neighbor IP from the first switch
        let neighborSwitchIP = null;
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
          }
        }

        // 3. Update customer description at neighbor switch if IP was found
        if (neighborSwitchIP) {
          await excuteJunusNeighborDescription(
            neighborSwitchIP,
            sshConfigFromRequest,
            new_upmbps,
            customer.customerName
          );
        }

        if (upgrade_type === "upgrade") {
          await UpgradeInfoModel.create({
            interface: intfName,
            current_bandwidth: customer.upmbps,
            upgrade_bandwidth: new_upmbps,
            approved_by,
            start_date: new Date(),
            account_manager,
            done_by: username,
          });
        }
        if (upgrade_type === "downgrade") {
          await UpgradeInfoModel.create({
            interface: intfName,
            current_bandwidth: customer.upmbps,
            downgrade_bandwidth: new_upmbps,
            approved_by,
            start_date: new Date(),
            account_manager,
            done_by: username,
          });
        }

        await customer.update({
          upmbps: new_upmbps,
          downmbps: new_downmbps,
          old_upmbps,
          old_downmbps,
          upgrade_type: "permanent",
          expires_at: null,
        });
      } else if (type === "temporary") {
        const old_upmbps = customer.upmbps;
        const old_downmbps = customer.downmbps;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ms(duration));

        if (upgrade_type === "upgrade") {
          await UpgradeInfoModel.create({
            interface: intfName,
            current_bandwidth: customer.upmbps,
            upgrade_bandwidth: new_upmbps,
            approved_by,
            start_date: new Date(),
            end_date: expiresAt,
            account_manager,
            done_by: username,
          });
        }
        if (upgrade_type === "downgrade") {
          await UpgradeInfoModel.create({
            interface: intfName,
            current_bandwidth: customer.upmbps,
            downgrade_bandwidth: new_upmbps,
            approved_by,
            start_date: new Date(),
            end_date: expiresAt,
            account_manager,
            done_by: username,
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

        scheduleTemporaryRevert({
          intfName,
          switchName,
          old_upmbps,
          old_downmbps,
          expiresAt,
          customer,
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

  const editTemporaryUpgrade = async (req, res) => {
    const {
      interface: intfName,
      username,
      password,
      type,
      duration,
      expires_at,
      new_upmbps,
      new_downmbps,
    } = req.body;

    if (!intfName) {
      return res.status(400).json({ message: "interface is required" });
    }

    try {
      const customer = await InfoModel.findOne({
        where: { interface: intfName },
        include: [{ model: CustomerModel, attributes: ["switchName"] }],
      });

      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      if (customer.upgrade_type !== "temporary") {
        return res.status(400).json({
          message: "Only temporary upgrades/downgrades can be edited",
        });
      }

      const switchName = resolveSwitchName(customer);
      const nextUp =
        new_upmbps !== undefined && new_upmbps !== null
          ? parseInt(new_upmbps, 10)
          : customer.upmbps;
      const nextDown =
        new_downmbps !== undefined && new_downmbps !== null
          ? parseInt(new_downmbps, 10)
          : customer.downmbps;

      if (!Number.isFinite(nextUp) || !Number.isFinite(nextDown)) {
        return res.status(400).json({ message: "Invalid capacity values" });
      }

      if (nextUp <= 0 || nextDown <= 0) {
        return res.status(400).json({ message: "Capacity must be positive" });
      }

      if (nextUp !== customer.upmbps || nextDown !== customer.downmbps) {
        if (!username || !password) {
          return res.status(400).json({
            message: "username and password are required when changing capacity",
          });
        }
        await applyCapacityOnDevices({
          intfName,
          upmbps: nextUp,
          downmbps: nextDown,
          switchName,
          sshConfig: { username, password },
        });
      }

      const updates = {
        upmbps: nextUp,
        downmbps: nextDown,
      };

      if (type === "permanent") {
        updates.upgrade_type = "permanent";
        updates.expires_at = null;
        const existingJob = schedule.scheduledJobs[getJobName(intfName)];
        if (existingJob) existingJob.cancel();
      } else {
        updates.upgrade_type = "temporary";
        let nextExpiry = customer.expires_at ? new Date(customer.expires_at) : null;

        if (duration) {
          nextExpiry = new Date(Date.now() + ms(duration));
        }
        if (expires_at) {
          nextExpiry = new Date(expires_at);
        }

        if (!nextExpiry || Number.isNaN(nextExpiry.getTime())) {
          return res.status(400).json({
            message: "Provide a valid duration or expires_at for temporary edit",
          });
        }
        if (nextExpiry <= new Date()) {
          return res.status(400).json({ message: "expires_at must be in the future" });
        }

        updates.expires_at = nextExpiry;
        scheduleTemporaryRevert({
          intfName,
          switchName,
          old_upmbps: customer.old_upmbps,
          old_downmbps: customer.old_downmbps,
          expiresAt: nextExpiry,
          customer,
        });
      }

      await customer.update(updates);

      return res.json({
        message: "Temporary upgrade updated successfully",
        customer,
      });
    } catch (error) {
      console.error("Error editing temporary upgrade:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  const rescheduleJobs = async () => {
    const sshConfig = {
      username: process.env.SSH_USERNAME,
      password: process.env.SSH_PASSWORD,
    };
    try {
      const temporaryUpgrades = await InfoModel.findAll({
        where: { upgrade_type: "temporary" },
        include: [
          {
            model: CustomerModel,
            attributes: ["switchName"],
          },
        ],
      });

      const now = new Date();

      for (const customer of temporaryUpgrades) {
        const {
          interface: intfName,
          old_upmbps,
          old_downmbps,
          expires_at,
        } = customer;

        if (!expires_at) continue;

        const targetSwitches = getTargetSwitches(resolveSwitchName(customer));

        if (new Date(expires_at) <= now) {
          // Expired -> downgrade immediately
          console.log(`[Fix] Immediate downgrade for expired ${intfName}`);
          try {
            for (const sw of targetSwitches) {
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
          // Future -> schedule normally
          console.log(
            `[Rescheduler] Rescheduling downgrade for ${intfName} at ${expires_at}`
          );
          scheduleTemporaryRevert({
            intfName,
            switchName: resolveSwitchName(customer),
            old_upmbps,
            old_downmbps,
            expiresAt: expires_at,
            customer,
          });
        }
      }
    } catch (error) {
      console.error("Error rescheduling jobs:", error);
    }
  };

  return { upgradeCustomer, editTemporaryUpgrade, rescheduleJobs };
};

module.exports = { createUpgradeController };
