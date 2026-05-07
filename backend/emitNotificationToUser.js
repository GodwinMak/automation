// Helper to emit a notification to a specific user (used by notification controller)
let userSockets = null;

function setUserSockets(map) {
  userSockets = map;
}

function emitNotificationToUser(userId, notification) {
  if (!userSockets) return;
  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const sock of sockets) {
      sock.emit("linkDownAlert", notification);
    }
  }
}

module.exports = { emitNotificationToUser, setUserSockets };