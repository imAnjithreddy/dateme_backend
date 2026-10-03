const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

router.get('/health', systemController.getHealth);
router.get('/zones', systemController.getCampusZones);

module.exports = router;
