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

module.exports = {
  authRateLimiter
};
