const {
  getAllFavorites,
  getFavoritesSummary,
  addFavorite,
  removeFavorite,
  updateFavoriteNotes,
  checkFavorite,
  toggleFavorite,
} = require("../Controller/favorite");
const { verifyToken } = require("../middleware/auth");

const router = require("express").Router();

// All routes require authentication
// Each user sees only their own watchlist
router.get("/", verifyToken, getAllFavorites);
router.get("/summary", verifyToken, getFavoritesSummary);
router.get("/check", verifyToken, checkFavorite);
router.post("/", verifyToken, addFavorite);
router.post("/toggle", verifyToken, toggleFavorite);
router.put("/:id/notes", verifyToken, updateFavoriteNotes);
router.delete("/:id", verifyToken, removeFavorite);

module.exports = router;
