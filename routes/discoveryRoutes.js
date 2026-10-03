const express = require('express');
const router = express.Router();
const discoveryController = require('../controllers/discoveryController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', discoveryController.getDiscoveryFeed);
router.get('/feed', discoveryController.getDiscoveryFeed);

module.exports = router;
