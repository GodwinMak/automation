// A point-to-point link's two ends each get their own host IP within the
// same subnet (e.g. 41.175.46.36/31 and 41.175.46.37/31 for the two sides
// of one /31) via cron/ptpBackfill.js. Reducing to the network address lets
// us recognize "these two rows — one from each device's own perspective —
// describe the same physical link" without relying on interface-name
// matching, which differs between the two ends and can't be compared
// directly.
//
// Shared by Controller/isisAdjacent.js (topology/impact-data pairing and the
// watch-list picker's link grouping) and utils/notificationRecipients.js
// (matching an alerting link's raw point_to_point_ip against a user's
// isis_watchlists entry, which is stored as this same network key) — a
// user watching "the SEA side" of a link must still get alerted when the
// down/recovery event fires from the PE side's row, since both describe one
// physical link.
//
// Returns the network address in dotted-decimal form (e.g. "41.175.46.36/31"),
// not a raw integer — that keeps the result a valid CIDR string, so this
// function is idempotent (ptpNetworkKey(ptpNetworkKey(x)) === ptpNetworkKey(x)).
// That matters: the watch-list picker (getAdjacencyList) already returns a
// normalized network key as pointToPointIp, and addIsisWatchlistEntry
// re-normalizes whatever it's given rather than trusting the caller — an
// integer-form result would fail that second pass, since it no longer
// matches this function's own dotted-decimal input regex.
const ptpNetworkKey = (cidr) => {
  if (!cidr) return null;
  const m = String(cidr).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const [, o1, o2, o3, o4, bitsStr] = m;
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return null;
  const ip = ((+o1 << 24) | (+o2 << 16) | (+o3 << 8) | +o4) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const network = (ip & mask) >>> 0;
  const n1 = (network >>> 24) & 0xff;
  const n2 = (network >>> 16) & 0xff;
  const n3 = (network >>> 8) & 0xff;
  const n4 = network & 0xff;
  return `${n1}.${n2}.${n3}.${n4}/${bits}`;
};

module.exports = { ptpNetworkKey };
