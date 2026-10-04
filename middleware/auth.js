const User = require('../models/User');
const { verifyToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/apiResponse');
const { ROLES } = require('../config/constants');

/**
 * Middleware to authenticate requests via JWT Bearer token or cookie
 */
const authenticateUser = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return errorResponse(res, 'Authentication required. Please sign in.', 401);
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return errorResponse(res, 'Your session has expired. Please sign in again.', 401, { code: 'TOKEN_EXPIRED' });
      }
      return errorResponse(res, 'Authentication token is invalid.', 401);
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      return errorResponse(res, 'Account no longer exists.', 401);
    }

    if (user.isSuspended || user.isBlocked || user.isBanned) {
      if (user.isSuspended && user.suspendedUntil && new Date(user.suspendedUntil) <= new Date()) {
        user.isSuspended = false;
        user.suspendedUntil = null;
        user.suspendReason = '';
        await user.save();
      } else {
        const reason = user.isBanned ? 'banned' : 'suspended';
        const detail = user.suspendReason || user.banReason || 'for safety and policy compliance.';
        const timeInfo = user.suspendedUntil ? ` until ${new Date(user.suspendedUntil).toLocaleString()}` : '';
        return errorResponse(res, `Your account has been ${reason}${timeInfo}. ${detail}`, 403);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    return errorResponse(res, 'Internal authentication verification error', 500);
  }
};

/**
 * Role-based authorization middleware
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Authentication required.', 401);
    }

    if (!allowedRoles.includes(req.user.role)) {
      return errorResponse(res, 'Access denied. You do not have permission to view this resource.', 403);
    }

    next();
  };
};

/**
 * Shortcut for platform admin access only
 */
const requireAdmin = requireRole(ROLES.PLATFORM_ADMIN);

module.exports = {
  authenticateUser,
  requireRole,
  requireAdmin
};
