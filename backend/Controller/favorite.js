const db = require("../Models");
const { Op } = require("sequelize");

const Favorite = db.favorites;
const DiaCustomer = db.diacustomers;
const IptCustomer = db.iptcustomers;
const SharedCustomer = db.sharedcustomers;

// Get all favorites with live status
// Each user sees ONLY their own watchlist
exports.getAllFavorites = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const typeFilter = req.query.type || "";

  try {
    let whereClause = {
      customerName: { [Op.like]: `%${searchQuery}%` },
    };

    if (typeFilter && typeFilter !== "all") {
      whereClause.customerType = typeFilter;
    }

    // Every user sees only their own watchlist
    if (req.user) {
      whereClause.userId = req.user.id;
    }

    const { count, rows } = await Favorite.findAndCountAll({
      where: whereClause,
      offset,
      limit: pageSize,
      order: [["createdAt", "DESC"]],
    });

    // Enrich with live status
    const enrichedFavorites = await Promise.all(
      rows.map(async (fav) => {
        let status = "unknown";
        let switchName = "";

        try {
          if (fav.customerType === "DIA") {
            const customer = await DiaCustomer.findOne({
              where: { interface: fav.interface },
            });
            status = customer?.operationalStatus || "unknown";
            switchName = customer?.switchName || "";
          } else if (fav.customerType === "IPT") {
            const customer = await IptCustomer.findOne({
              where: { interface: fav.interface },
            });
            status = customer?.operationalStatus || "unknown";
            switchName = customer?.switchName || "";
          } else if (fav.customerType === "Shared") {
            const customer = await SharedCustomer.findOne({
              where: { interface: fav.interface },
            });
            status = customer?.operationalStatus || "unknown";
            switchName = customer?.switchName || "";
          }
        } catch (err) {
          console.error("Error getting status for favorite:", err);
        }

        return {
          ...fav.toJSON(),
          status,
          switchName,
        };
      })
    );

    const totalPages = Math.ceil(count / pageSize);

    res.status(200).json({
      favorites: enrichedFavorites,
      totalItems: count,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get favorites summary (counts)
// Each user sees only their own watchlist counts
exports.getFavoritesSummary = async (req, res) => {
  try {
    let whereClause = {};
    
    // Every user sees only their own watchlist
    if (req.user) {
      whereClause.userId = req.user.id;
    }

    const total = await Favorite.count({ where: whereClause });
    const diaCount = await Favorite.count({ where: { ...whereClause, customerType: "DIA" } });
    const iptCount = await Favorite.count({ where: { ...whereClause, customerType: "IPT" } });
    const sharedCount = await Favorite.count({ where: { ...whereClause, customerType: "Shared" } });

    // Get live status counts
    const favorites = await Favorite.findAll({ where: whereClause });
    let upCount = 0;
    let downCount = 0;

    for (const fav of favorites) {
      let status = "unknown";
      if (fav.customerType === "DIA") {
        const customer = await DiaCustomer.findOne({
          where: { interface: fav.interface },
        });
        status = customer?.operationalStatus || "unknown";
      } else if (fav.customerType === "IPT") {
        const customer = await IptCustomer.findOne({
          where: { interface: fav.interface },
        });
        status = customer?.operationalStatus || "unknown";
      } else if (fav.customerType === "Shared") {
        const customer = await SharedCustomer.findOne({
          where: { interface: fav.interface },
        });
        status = customer?.operationalStatus || "unknown";
      }

      if (status === "up") upCount++;
      else if (status === "down") downCount++;
    }

    res.status(200).json({
      total,
      diaCount,
      iptCount,
      sharedCount,
      upCount,
      downCount,
    });
  } catch (error) {
    console.error("Error fetching favorites summary:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Add to favorites
exports.addFavorite = async (req, res) => {
  const { customerId, customerName, customerType, interface: iface, cid, nbr, notes } = req.body;

  try {
    // For customer_relation, check if THEY already have this favorite
    // For others, check if it exists globally (or per user)
    const checkWhere = { customerId, customerType };
    
    if (req.user) {
      // Each user can have their own watchlist entry for the same customer
      checkWhere.userId = req.user.id;
    }

    const existing = await Favorite.findOne({ where: checkWhere });

    if (existing) {
      return res.status(400).json({ message: "Customer already in your favorites" });
    }

    const favorite = await Favorite.create({
      customerId,
      customerName,
      customerType,
      interface: iface,
      cid,
      nbr,
      notes,
      userId: req.user?.id || null,
    });

    res.status(201).json({ message: "Added to favorites", favorite });
  } catch (error) {
    console.error("Error adding favorite:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Remove from favorites
// Each user can only remove their own favorites
exports.removeFavorite = async (req, res) => {
  const { id } = req.params;

  try {
    const favorite = await Favorite.findByPk(id);

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    // Users can only remove their own favorites
    if (req.user && favorite.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only remove your own favorites" });
    }

    await favorite.destroy();

    res.status(200).json({ message: "Removed from favorites" });
  } catch (error) {
    console.error("Error removing favorite:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update favorite notes
// Each user can only update their own notes
exports.updateFavoriteNotes = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const favorite = await Favorite.findByPk(id);

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    // Users can only update their own favorites
    if (req.user && favorite.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only update your own favorites" });
    }

    favorite.notes = notes;
    await favorite.save();

    res.status(200).json({ message: "Notes updated", favorite });
  } catch (error) {
    console.error("Error updating favorite notes:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Check if customer is favorite (for current user)
exports.checkFavorite = async (req, res) => {
  const { customerId, customerType } = req.query;

  try {
    const whereClause = { customerId, customerType };
    
    // Check for current user's favorite
    if (req.user) {
      whereClause.userId = req.user.id;
    }

    const favorite = await Favorite.findOne({ where: whereClause });

    res.status(200).json({
      isFavorite: !!favorite,
      favorite: favorite || null,
    });
  } catch (error) {
    console.error("Error checking favorite:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Toggle favorite (add if not exists, remove if exists)
exports.toggleFavorite = async (req, res) => {
  const { customerId, customerName, customerType, interface: iface, cid, nbr } = req.body;

  try {
    const whereClause = { customerId, customerType };
    
    // Toggle for current user only
    if (req.user) {
      whereClause.userId = req.user.id;
    }

    const existing = await Favorite.findOne({ where: whereClause });

    if (existing) {
      await existing.destroy();
      res.status(200).json({ message: "Removed from favorites", isFavorite: false });
    } else {
      const favorite = await Favorite.create({
        customerId,
        customerName,
        customerType,
        interface: iface,
        cid,
        nbr,
        userId: req.user?.id || null,
      });
      res.status(201).json({ message: "Added to favorites", isFavorite: true, favorite });
    }
  } catch (error) {
    console.error("Error toggling favorite:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

