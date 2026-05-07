const router = require("express").Router();
const {
  listSwitchConfigurations,
  downloadSwitchConfiguration,
} = require("../Controller/switchConfiguration");

router.get("/", listSwitchConfigurations);
router.get("/:id/download", downloadSwitchConfiguration);

module.exports = router;
