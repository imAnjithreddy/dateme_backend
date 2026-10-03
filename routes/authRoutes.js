const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateUser } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');

// Public auth endpoints protected by basic rate limiter
router.post('/register', authRateLimiter({ max: 15, windowMs: 15 * 60 * 1000 }), authController.register);
router.post('/login', authRateLimiter({ max: 15, windowMs: 15 * 60 * 1000 }), authController.login);

// Development admin bootstrap
router.post('/bootstrap-admin', authRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 }), authController.bootstrapAdmin);

// Protected session endpoints
router.get('/me', authenticateUser, authController.getMe);
router.post('/logout', authenticateUser, authController.logout);

module.exports = router;
