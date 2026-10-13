const router = require("express").Router();
const { verifyToken, adminOnly } = require("../middleware/auth");
const {
  getAllMaps,
  getMapById,
  createMap,
  updateMap,
  deleteMap,
} = require("../Controller/networkMap");

router.get("/", verifyToken, getAllMaps);
router.get("/:id", verifyToken, getMapById);
router.post("/", verifyToken, adminOnly, createMap);
router.put("/:id", verifyToken, adminOnly, updateMap);
router.delete("/:id", verifyToken, adminOnly, deleteMap);

module.exports = router;
