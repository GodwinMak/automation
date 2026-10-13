const {createDevice, createDevicesBulk, getAllDevices, getDeviceById, getDeviceByIp, updateDevice, deleteDevice, getInterfacesUp,getCustomersByIp } = require("../Controller/devices")

const router = require("express").Router();

// Create a single device
router.post("/", createDevice);
// Get interfaces that are up from a device
router.post("/interfaces-up", getInterfacesUp);

// Create devices in bulk
router.post("/bulk", createDevicesBulk);

// Get all devices
router.get("/", getAllDevices);

// Get a single device by IP (must be registered before /:id)
router.get("/by-ip/:ip", getDeviceByIp);

// Get a single device by ID
router.get("/:id", getDeviceById);

router.post("/customers", getCustomersByIp);

// Update a device by ID
router.put("/:id", updateDevice);

// Delete a device by ID
router.delete("/:id", deleteDevice);

module.exports = router;