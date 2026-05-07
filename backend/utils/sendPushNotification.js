const axios = require('axios');
const db = require('../Models');
const PushToken = db.push_tokens;

/**
 * Send Expo push notification to all tokens for a user or a list of tokens
 * @param {string[]} tokens - Array of Expo push tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
async function sendPushNotification(tokens, title, body) {
  if (!tokens || tokens.length === 0) return;
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
  }));
  try {
    await axios.post('https://exp.host/--/api/v2/push/send', messages);
  } catch (err) {
    console.error('[Push] Expo push error:', err.message);
  }
}

/**
 * Get all push tokens for a user
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
sendPushNotification.getTokensForUser = async (userId) => {
  const tokens = await PushToken.findAll({ where: { user_id: userId } });
  return tokens.map(t => t.token);
};

/**
 * Get all push tokens in the system (for admin/global alerts)
 * @returns {Promise<string[]>}
 */
sendPushNotification.getAllTokens = async () => {
  const tokens = await PushToken.findAll();
  return tokens.map(t => t.token);
};

module.exports = sendPushNotification;
