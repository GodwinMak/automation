const express = require('express');
const router = express.Router();
const db = require('../Models');
const PushToken = db.push_tokens;
const {verifyToken } = require('../middleware/auth');

// Register or update push token
router.post('/', verifyToken, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const [entry] = await PushToken.findOrCreate({
      where: { user_id: req.user.id },
      defaults: { token, platform }
    });
    if (entry.token !== token || entry.platform !== platform) {
      entry.token = token;
      entry.platform = platform;
      await entry.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
