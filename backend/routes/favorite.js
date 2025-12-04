const {
  getAllFavorites,
  getFavoritesSummary,
  addFavorite,
  removeFavorite,
  updateFavoriteNotes,
  checkFavorite,
  toggleFavorite,
} = require("../Controller/favorite");

const router = require("express").Router();

router.get("/", getAllFavorites);
router.get("/summary", getFavoritesSummary);
router.get("/check", checkFavorite);
router.post("/", addFavorite);
router.post("/toggle", toggleFavorite);
router.put("/:id/notes", updateFavoriteNotes);
router.delete("/:id", removeFavorite);

module.exports = router;

