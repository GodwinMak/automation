const {
  getMyIsisWatchlist,
  addIsisWatchlistEntry,
  removeIsisWatchlistEntry,
} = require("../Controller/isisWatchlist");
const { verifyToken } = require("../middleware/auth");

const router = require("express").Router();

// All routes require authentication — each user sees only their own ISIS watch list
router.get("/", verifyToken, getMyIsisWatchlist);
router.post("/", verifyToken, addIsisWatchlistEntry);
router.delete("/:id", verifyToken, removeIsisWatchlistEntry);

module.exports = router;
