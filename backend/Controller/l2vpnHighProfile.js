const db = require("../Models");

// Admin-only: flag/unflag an L2VPN interface/circuit row as high profile.
exports.markL2vpnHighProfile = async (req, res) => {
  const { id } = req.params;
  const { isHighProfile } = req.body;

  try {
    const iface = await db.l2vpninterfaces.findByPk(id);
    if (!iface) return res.status(404).json({ message: "L2VPN circuit not found" });

    await iface.update({ isHighProfile: !!isHighProfile });
    return res.status(200).json({ message: "Updated successfully", data: iface });
  } catch (error) {
    console.error("Error updating high-profile flag for L2VPN circuit:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
