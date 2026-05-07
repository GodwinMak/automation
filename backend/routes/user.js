const router = require("express").Router();
const {
  create,
  login,
  getProfile,
  updateProfile,
  getAllUsers,
  createUser,
  updateById,
  deleteById,
  getUserById,
  getRoles,
  registerPushToken,
} = require("../Controller/user");
const { verifyToken, adminOnly } = require("../middleware/auth");

// ============ PUBLIC ROUTES ============
// Self-registration (creates first admin automatically)
router.post("/register", create);

// Login
router.post("/login", login);

// Get available roles (for display)
router.get("/roles", getRoles);

// ============ AUTHENTICATED ROUTES ============
// Get own profile
router.get("/profile", verifyToken, getProfile);

// Update own profile (password, fullName)
router.put("/profile", verifyToken, updateProfile);

// ============ ADMIN ONLY ROUTES ============
// Get all users
router.get("/", verifyToken, adminOnly, getAllUsers);

router.post("/push-token", verifyToken, registerPushToken);

// Create new user
router.post("/", verifyToken, adminOnly, createUser);

// Get user by ID
router.get("/:id", verifyToken, adminOnly, getUserById);

// Update user by ID
router.put("/:id", verifyToken, adminOnly, updateById);

// Delete user by ID
router.delete("/:id", verifyToken, adminOnly, deleteById);

module.exports = router;
