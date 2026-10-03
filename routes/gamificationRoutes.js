const express = require('express');
const router = express.Router();
const {
  getMyGamificationSummary,
  getBadgesCatalog,
  claimAction,
  getUserGamification
} = require('../controllers/gamificationController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/summary', getMyGamificationSummary);
router.get('/badges', getBadgesCatalog);
router.post('/action', claimAction);
router.get('/user/:id', getUserGamification);

module.exports = router;
