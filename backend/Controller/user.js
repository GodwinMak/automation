const db = require("../Models");
const Users = db.users;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPermissionsForRole } = require("../middleware/auth");

/**
 * Register a new user (public - creates first admin or self-registration)
 */
exports.create = async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    const userCheck = await Users.findOne({ where: { email: email } });

    if (userCheck) {
      return res.status(409).send({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(Number(10));
    const hashedPassword = await bcrypt.hash(password, salt);

    const username = email.split("@")[0];

    // Check if this is the first user - make them admin
    const userCount = await Users.count();
    const role = userCount === 0 ? "admin" : "operator";

    const newUser = await Users.create({
      username,
      email,
      password: hashedPassword,
      fullName: fullName || username,
      role,
    });

    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(201).send({
      message: "User created successfully",
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        permissions: getPermissionsForRole(newUser.role),
      },
      token,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Login user
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(req.body);

    const user = await Users.findOne({ where: { email: email } });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(403).send({ message: "Account is deactivated. Contact administrator." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).send({ message: "Invalid password" });
    }

    // Update last login
    await user.update({ lastLogin: new Date() });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).send({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions: getPermissionsForRole(user.role),
      },
      token,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Get current user profile
 */
exports.getProfile = async (req, res) => {
  try {
    const user = await Users.findByPk(req.user.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send({
      user: {
        ...user.toJSON(),
        permissions: getPermissionsForRole(user.role),
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Update own profile (password, fullName)
 */
exports.updateProfile = async (req, res) => {
  try {
    const { password, fullName, currentPassword } = req.body;
    const user = await Users.findByPk(req.user.id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // If changing password, verify current password
    if (password) {
      if (!currentPassword) {
        return res.status(400).send({ message: "Current password is required" });
      }
      
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return res.status(401).send({ message: "Current password is incorrect" });
      }

      const salt = await bcrypt.genSalt(Number(10));
      user.password = await bcrypt.hash(password, salt);
    }

    if (fullName) {
      user.fullName = fullName;
    }

    await user.save();

    res.status(200).send({ 
      message: "Profile updated successfully",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      }
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

// ============ ADMIN ONLY FUNCTIONS ============

/**
 * Get all users (Admin only)
 */
exports.getAllUsers = async (req, res) => {
  try {
    const { search, role, isActive, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const whereClause = {};

    if (search) {
      const { Op } = require("sequelize");
      whereClause[Op.or] = [
        { username: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { fullName: { [Op.like]: `%${search}%` } },
      ];
    }

    if (role) {
      whereClause.role = role;
    }

    if (isActive !== undefined) {
      whereClause.isActive = isActive === "true";
    }

    const { count, rows } = await Users.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
      offset,
      limit: parseInt(pageSize),
    });

    res.status(200).send({
      users: rows,
      totalItems: count,
      totalPages: Math.ceil(count / parseInt(pageSize)),
      currentPage: parseInt(page),
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Create user (Admin only)
 */
exports.createUser = async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body;

    if (!email || !password) {
      return res.status(400).send({ message: "Email and password are required" });
    }

    // Validate role
    const validRoles = ["admin", "operator", "customer_relation"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).send({ message: "Invalid role" });
    }

    const userCheck = await Users.findOne({ where: { email: email } });

    if (userCheck) {
      return res.status(409).send({ message: "User with this email already exists" });
    }

    const salt = await bcrypt.genSalt(Number(10));
    const hashedPassword = await bcrypt.hash(password, salt);

    const username = email.split("@")[0];

    const newUser = await Users.create({
      username,
      email,
      password: hashedPassword,
      fullName: fullName || username,
      role: role || "operator",
      createdBy: req.user.id,
    });

    res.status(201).send({
      message: "User created successfully",
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Update user by ID (Admin only)
 */
exports.updateById = async (req, res) => {
  try {
    const userId = req.params.id;
    const { email, password, fullName, role, isActive } = req.body;

    const user = await Users.findByPk(userId);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user.id && isActive === false) {
      return res.status(400).send({ message: "You cannot deactivate your own account" });
    }

    // Prevent changing own role
    if (userId === req.user.id && role && role !== user.role) {
      return res.status(400).send({ message: "You cannot change your own role" });
    }

    if (email && email !== user.email) {
      // Check if new email is already in use
      const existingUser = await Users.findOne({ where: { email: email } });
      if (existingUser) {
        return res.status(409).send({ message: "Email already in use" });
      }
      user.email = email;
      user.username = email.split("@")[0];
    }

    if (password) {
      const salt = await bcrypt.genSalt(Number(10));
      user.password = await bcrypt.hash(password, salt);
    }

    if (fullName !== undefined) {
      user.fullName = fullName;
    }

    if (role !== undefined) {
      const validRoles = ["admin", "operator", "customer_relation"];
      if (!validRoles.includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }
      user.role = role;
    }

    if (isActive !== undefined) {
      user.isActive = isActive;
    }

    await user.save();

    res.status(200).send({ 
      message: "User updated successfully", 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        updatedAt: user.updatedAt,
      }
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Delete user by ID (Admin only)
 */
exports.deleteById = async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).send({ message: "You cannot delete your own account" });
    }

    const user = await Users.findByPk(userId);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    await user.destroy();

    res.status(200).send({ message: "User deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Get user by ID (Admin only)
 */
exports.getUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await Users.findByPk(userId, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send({ user });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

/**
 * Get role options
 */
exports.getRoles = async (req, res) => {
  res.status(200).send({
    roles: [
      { value: "admin", label: "Admin", description: "Full access to everything including user management" },
      { value: "operator", label: "Operator", description: "Same as Admin but cannot manage users" },
      { value: "customer_relation", label: "Customer Relation", description: "Limited access - own watchlist only, no configurations" },
    ]
  });
};
