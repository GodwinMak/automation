const db = require("../Models");
const { ptpNetworkKey } = require("../utils/ptpNetworkKey");

const IsisWatchlist = db.isisWatchlist;

// Get the current user's ISIS node watch list
exports.getMyIsisWatchlist = async (req, res) => {
  try {
    const entries = await IsisWatchlist.findAll({
      where: { userId: req.user.id },
      order: [["createdAt", "DESC"]],
    });
    res.status(200).json({ watchlist: entries });
  } catch (error) {
    console.error("Error fetching ISIS watchlist:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Add an ISIS adjacent node to the current user's watch list
exports.addIsisWatchlistEntry = async (req, res) => {
  const { pointToPointIp, isisAdjacencyId, neighborName, interfaceName, deviceName } = req.body;

  if (!pointToPointIp) {
    return res.status(400).json({ message: "pointToPointIp is required" });
  }

  // Always store the /31 network key, not the specific side's host IP — a
  // physical link has two isis_adjacency rows (one per device's own
  // perspective), and watching "one side" needs to match alerts fired from
  // either row of the same link. The picker (Controller/isisAdjacent.js's
  // getAdjacencyList) already sends the network key, but normalize here too
  // so this is correct regardless of what the client sends.
  const networkKey = ptpNetworkKey(pointToPointIp);
  if (!networkKey) {
    return res.status(400).json({ message: "pointToPointIp is not a valid CIDR" });
  }

  try {
    const existing = await IsisWatchlist.findOne({
      where: { userId: req.user.id, pointToPointIp: networkKey },
    });

    if (existing) {
      return res.status(400).json({ message: "This node is already in your watch list" });
    }

    const entry = await IsisWatchlist.create({
      userId: req.user.id,
      pointToPointIp: networkKey,
      isisAdjacencyId: isisAdjacencyId || null,
      neighborName: neighborName || null,
      interfaceName: interfaceName || null,
      deviceName: deviceName || null,
    });

    res.status(201).json({ message: "Added to ISIS watch list", entry });
  } catch (error) {
    console.error("Error adding ISIS watchlist entry:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Remove an ISIS node from the current user's watch list
exports.removeIsisWatchlistEntry = async (req, res) => {
  const { id } = req.params;

  try {
    const entry = await IsisWatchlist.findByPk(id);

    if (!entry) {
      return res.status(404).json({ message: "Watch list entry not found" });
    }

    if (entry.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only remove your own watch list entries" });
    }

    await entry.destroy();

    res.status(200).json({ message: "Removed from ISIS watch list" });
  } catch (error) {
    console.error("Error removing ISIS watchlist entry:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
