const express = require('express');
const router = express.Router();
const db = require('../Models');
const { checkPitchForUpgrade } = require('../cron/pitchForUpgradeChecker');
const { verifyToken } = require('../middleware/auth');

// Public: get latest pitch-for-upgrade records (most recent run first)
router.get('/', verifyToken, async (req, res) => {
  try {
    const Pitch = db.pitchForUpgradeReports;
    const rows = await Pitch.findAll({ order: [['runAt','DESC'], ['createdAt','DESC']] });
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching pitch-for-upgrade records:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin utility: run the check on demand
router.post('/run', verifyToken, async (req, res) => {
  try {
    const results = await checkPitchForUpgrade();
    res.status(200).json({ message: 'Pitch check executed', count: results?.length || 0, results });
  } catch (error) {
    console.error('Error running pitch check:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
