const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateUser } = require('../middleware/auth');

// All user routes require authenticated session
router.use(authenticateUser);

router.post('/onboarding', userController.completeOnboarding);
router.put('/profile', userController.updateProfile);
router.put('/discovery-preferences', userController.updateDiscoveryPreferences);
router.put('/avatar', userController.updateAvatar);
router.get('/:id', userController.getUserById);

module.exports = router;
