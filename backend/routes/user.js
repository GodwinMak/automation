const router = require("express").Router();
const {create, login, updateById, deleteById} = require("../Controller/user");

router.post("/", create);
router.post("/login", login);
router.put("/:id", updateById);
router.delete("/:id", deleteById);

module.exports = router;

