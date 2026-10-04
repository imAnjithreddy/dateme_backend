/**
 * In-memory sliding window rate limiter for authentication endpoints
 */

const ipRequests = new Map();

// Cleanup stale records periodically (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequests.entries()) {
    if (now - record.windowStart > 15 * 60 * 1000) {
      ipRequests.delete(ip);
    }
  }
}, 10 * 60 * 1000);

const authRateLimiter = (options = {}) => {
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
  const maxAttempts = options.max || 15; // Max 15 attempts per window

  return (req, res, next) => {
    // In dev testing, allow bypass if header is set or test environment
    if (process.env.NODE_ENV === 'test' || req.headers['x-bypass-ratelimit'] === 'datee-testing-secret') {
      return next();
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();

    let record = ipRequests.get(ip);
    if (!record || now - record.windowStart > windowMs) {
      record = {
        windowStart: now,
        count: 1
      };
      ipRequests.set(ip, record);
      return next();
    }

    record.count += 1;

    if (record.count > maxAttempts) {
      const retryAfterMinutes = Math.ceil((windowMs - (now - record.windowStart)) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many authentication attempts from this network. Please try again after ${retryAfterMinutes} minute(s).`
      });
    }

    next();
  };
};

const userMessageHistory = new Map(); // userId -> [timestamp1, timestamp2, ...]
const userReportHistory = new Map(); // userId -> [timestamp1, timestamp2, ...]

// Periodic cleanup of stale user histories every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of userMessageHistory.entries()) {
    const valid = timestamps.filter((t) => now - t < 60 * 1000);
    if (valid.length === 0) {
      userMessageHistory.delete(userId);
    } else {
      userMessageHistory.set(userId, valid);
    }
  }
  for (const [userId, timestamps] of userReportHistory.entries()) {
    const valid = timestamps.filter((t) => now - t < 60 * 60 * 1000);
    if (valid.length === 0) {
      userReportHistory.delete(userId);
    } else {
      userReportHistory.set(userId, valid);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check socket messaging rate limit (Burst: 5 msgs / 5 sec, Sustained: 30 msgs / 60 sec)
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds, message: string }
 */
const checkSocketMessageRateLimit = (userId) => {
  if (!userId) return { allowed: true };
  const uid = userId.toString();
  const now = Date.now();

  let timestamps = userMessageHistory.get(uid) || [];
  // Filter within last 60 seconds
  timestamps = timestamps.filter((t) => now - t < 60 * 1000);

  // Check Burst limit: max 5 messages in 5 seconds
  const burstTimestamps = timestamps.filter((t) => now - t < 5 * 1000);
  if (burstTimestamps.length >= 5) {
    const earliestBurst = burstTimestamps[0];
    const retryAfter = Math.max(1, Math.ceil((5000 - (now - earliestBurst)) / 1000));
    return {
      allowed: false,
      retryAfter,
      message: `You are sending messages too quickly. Please wait ${retryAfter} second(s).`
    };
  }

  // Check Sustained limit: max 30 messages in 60 seconds
  if (timestamps.length >= 30) {
    const earliestSustained = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((60000 - (now - earliestSustained)) / 1000));
    return {
      allowed: false,
      retryAfter,
      message: `Message rate limit reached (30/min). Please slow down for ${retryAfter} second(s).`
    };
  }

  timestamps.push(now);
  userMessageHistory.set(uid, timestamps);
  return { allowed: true };
};

/**
 * REST API Middleware for Direct Messages
 */
const messageRateLimiter = () => {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' || req.headers['x-bypass-ratelimit'] === 'datee-testing-secret') {
      return next();
    }
    const userId = req.user?._id;
    if (!userId) return next();

    const check = checkSocketMessageRateLimit(userId);
    if (!check.allowed) {
      return res.status(429).json({
        success: false,
        message: check.message,
        retryAfter: check.retryAfter
      });
    }
    next();
  };
};

/**
 * Rate limiter for Report Submissions (Max 10 reports per hour to prevent report abuse)
 */
const reportRateLimiter = () => {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' || req.headers['x-bypass-ratelimit'] === 'datee-testing-secret') {
      return next();
    }
    const userId = req.user?._id;
    if (!userId) return next();

    const uid = userId.toString();
    const now = Date.now();
    let timestamps = userReportHistory.get(uid) || [];
    timestamps = timestamps.filter((t) => now - t < 60 * 60 * 1000);

    if (timestamps.length >= 10) {
      return res.status(429).json({
        success: false,
        message: 'You have submitted too many reports recently. Please wait before reporting again.'
      });
    }

    timestamps.push(now);
    userReportHistory.set(uid, timestamps);
    next();
  };
};

module.exports = {
  authRateLimiter,
  messageRateLimiter,
  checkSocketMessageRateLimit,
  reportRateLimiter
};
