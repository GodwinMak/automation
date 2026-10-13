/**
 * Shared recipient-resolution for ISIS link/high-traffic alerts, used by
 * both cron/isisAdjacent.js and cron/isisInterfaceStats.js (previously each
 * built its own flat "all canReceiveIsisSms users" list, with no way to
 * scope alerts to a specific link).
 *
 * A user's isisWatchScope decides how they're resolved:
 *  - "all" (default): matches every alert-worthy link, network-wide.
 *  - "watchlist": matches only links the user has added to isis_watchlists.
 *
 * A physical link has two isis_adjacency rows — one from each device's own
 * perspective, each with its own host IP in the same /31 (e.g.
 * 41.175.46.36/31 and 41.175.46.37/31). isis_watchlists always stores the
 * *network* key (see ptpNetworkKey — the picker in Controller/isisAdjacent.js
 * and addIsisWatchlistEntry both normalize to it before it's ever saved), so
 * whichever side's row an alert actually fires from, it's normalized here
 * too before matching — a user who picked "the SEA side" still matches an
 * alert reported from the PE side of the same link.
 *
 * A link with no point_to_point_ip can only ever match "all"-mode users —
 * there's nothing to watch-list it by.
 */
const db = require("../Models");
const { Op } = require("sequelize");
const { ptpNetworkKey } = require("./ptpNetworkKey");

/**
 * @param {string|null} pointToPointIp - the alerting link's point_to_point_ip
 * @param {"link"|"highTraffic"} alertKind - which SMS opt-in column to gate on
 * @param {{ requireSmsOptIn?: boolean }} [opts] - pass requireSmsOptIn:false
 *   to resolve by isisWatchScope alone, ignoring the SMS toggles (used for
 *   in-app ISIS notifications, which aren't gated by the SMS preferences).
 * @returns {Promise<{ phoneNumbers: string[], users: Array }>}
 */
const getIsisAlertRecipients = async (pointToPointIp, alertKind, opts = {}) => {
  const { requireSmsOptIn = true } = opts;
  const smsColumn = alertKind === "highTraffic" ? "highTrafficSmsEnabled" : "canReceiveIsisSms";

  const where = { isActive: true, phoneNumber: { [Op.ne]: null } };
  if (requireSmsOptIn) {
    where[smsColumn] = true;
  }

  const users = await db.users.findAll({
    where,
    attributes: ["id", "phoneNumber", "isisWatchScope"],
    raw: true,
  });

  if (users.length === 0) return { phoneNumbers: [], users: [] };

  const allModeUsers = users.filter((u) => u.isisWatchScope !== "watchlist");
  const watchlistModeUsers = users.filter((u) => u.isisWatchScope === "watchlist");

  let watchedUsers = [];
  const networkKey = ptpNetworkKey(pointToPointIp);
  if (watchlistModeUsers.length > 0 && networkKey) {
    const watchRows = await db.isisWatchlist.findAll({
      where: {
        userId: watchlistModeUsers.map((u) => u.id),
        pointToPointIp: networkKey,
      },
      attributes: ["userId"],
      raw: true,
    });
    const watchedIds = new Set(watchRows.map((r) => r.userId));
    watchedUsers = watchlistModeUsers.filter((u) => watchedIds.has(u.id));
  }

  const finalUsers = [...allModeUsers, ...watchedUsers];
  return { phoneNumbers: finalUsers.map((u) => u.phoneNumber), users: finalUsers };
};

module.exports = { getIsisAlertRecipients };
