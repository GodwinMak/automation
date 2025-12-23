const jwt = require("jsonwebtoken");
const db = require("../Models");
const Users = db.users;

/**
 * Role-based permissions configuration
 */
const ROLE_PERMISSIONS = {
  admin: {
    // Admin has full access to everything
    canManageUsers: true,
    canConfigureCustomers: true,
    canUpgradeCustomers: true,
    canViewCapacity: true,
    canViewUptimeTrends: true,
    canViewChurnAnalysis: true,
    canView95thReport: true,
  },
  operator: {
    // Operator has same as Admin but no user management
    canManageUsers: false,
    canConfigureCustomers: false,
    canUpgradeCustomers: false,
    canViewCapacity: true,
    canViewUptimeTrends: true,
    canViewChurnAnalysis: true,
    canView95thReport: false,
  },
  customer_relation: {
    // Customer Relation has limited access
    canManageUsers: false,
    canConfigureCustomers: false,
    canUpgradeCustomers: false,
    canViewCapacity: false,
    canViewUptimeTrends: false,
    canViewChurnAnalysis: false,
    canView95thReport: false,
  },
};

// Note: Watchlist is always personal - each user sees only their own watchlist

/**
 * Verify JWT token and attach user to request
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and get current role
    const user = await Users.findByPk(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: "User account is deactivated" });
    }

    // Attach user and permissions to request
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.customer_relation,
    };

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.error("Auth middleware error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

/**
 * Check if user has a specific role
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: "Access denied. Insufficient permissions.",
        requiredRoles: allowedRoles,
        yourRole: req.user.role
      });
    }

    next();
  };
};

/**
 * Check if user has a specific permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!req.user.permissions[permission]) {
      return res.status(403).json({ 
        message: `Access denied. You don't have '${permission}' permission.`,
        yourRole: req.user.role
      });
    }

    next();
  };
};

/**
 * Admin only middleware
 */
const adminOnly = requireRole("admin");

/**
 * Admin or Operator middleware
 */
const adminOrOperator = requireRole("admin", "operator");

/**
 * Get permissions for a role
 */
const getPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.customer_relation;
};

module.exports = {
  verifyToken,
  requireRole,
  requirePermission,
  adminOnly,
  adminOrOperator,
  getPermissionsForRole,
  ROLE_PERMISSIONS,
};

