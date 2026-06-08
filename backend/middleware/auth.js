const jwt = require("jsonwebtoken");
const db = require("../Models");
const Users = db.users;

/**
 * Simple in-memory user cache to avoid a DB round-trip on every request.
 * TTL: 5 minutes — short enough to pick up deactivations promptly.
 */
const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const userCache = new Map();

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

function invalidateUserCache(userId) {
  userCache.delete(userId);
}

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
    canDiagnoseCustomer: true,
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
    canDiagnoseCustomer: true,
  },
  customer_relation: {
    // Customer Relation has limited access
    canManageUsers: false,
    canConfigureCustomers: false,
    canUpgradeCustomers: false,
    canViewCapacity: false,
    canViewUptimeTrends: false,
    // Allow customer_relation to view churn analysis, but data will be
    // restricted server-side to their own watchlist.
    canViewChurnAnalysis: true,
    canView95thReport: false,
    canDiagnoseCustomer: true,
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

    // Try cache first to avoid a DB hit on every request
    let user = getCachedUser(decoded.userId);
    if (!user) {
      user = await Users.findByPk(decoded.userId);
      if (user) setCachedUser(decoded.userId, user);
    }
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: "User account is deactivated" });
    }

    // If the user changed their password after the token was issued, reject the token
    if (user.passwordChangedAt) {
      const tokenIat = decoded.iat; // issued at (seconds)
      const pwdChangedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (tokenIat < pwdChangedAtSec) {
        return res.status(401).json({ message: "Password changed. Please login again." });
      }
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
  invalidateUserCache,
};

