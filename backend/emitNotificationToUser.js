// Helper to emit notifications through connected Socket.IO clients
let userSockets = null;

function setUserSockets(map) {
  userSockets = map;
}

function emitNotificationToUser(userId, notification) {
  if (!userSockets) return 0;
  const sockets = userSockets.get(userId);
  if (!sockets) return 0;

  let emitted = 0;
  for (const sock of sockets) {
    sock.emit("linkDownAlert", notification);
    emitted += 1;
  }
  return emitted;
}

function emitNotificationToAll(notification) {
  if (!userSockets) return 0;

  let emitted = 0;
  for (const sockets of userSockets.values()) {
    for (const sock of sockets) {
      sock.emit("linkDownAlert", notification);
      emitted += 1;
    }
  }
  return emitted;
}

module.exports = { emitNotificationToUser, emitNotificationToAll, setUserSockets };
