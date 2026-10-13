import 'dotenv/config';

const CONFIG_API_HOST = process.env.CONFIG_API_HOST; // e.g. https://your-tool-host
const CONFIG_API_EMAIL = process.env.CONFIG_API_EMAIL;
const CONFIG_API_PASSWORD = process.env.CONFIG_API_PASSWORD;
let cachedToken = null;

async function login() {
  if (!CONFIG_API_HOST || !CONFIG_API_EMAIL || !CONFIG_API_PASSWORD) {
    throw new Error(
      'Missing CONFIG_API_HOST / CONFIG_API_EMAIL / CONFIG_API_PASSWORD in .env'
    );
  }

  const res = await fetch(`${CONFIG_API_HOST}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CONFIG_API_EMAIL, password: CONFIG_API_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Config API login failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}

/**
 * Fetch wrapper that attaches the bearer token, logging in on first use
 * and re-logging in once if the token has expired (401).
 */
async function authedFetch(path) {
  if (!cachedToken) await login();

  let res = await fetch(`${CONFIG_API_HOST}${path}`, {
    headers: { Authorization: `Bearer ${cachedToken}` },
  });

  if (res.status === 401) {
    await login();
    res = await fetch(`${CONFIG_API_HOST}${path}`, {
      headers: { Authorization: `Bearer ${cachedToken}` },
    });
  }

  return res;
}

// Same lookup as getSwitchConfig, but also returns when the stored copy was
// last refreshed (the backup's updatedAt) — a bulk search over stored configs
// must be able to say how old the files it read are.
export async function getSwitchConfigWithMeta(deviceIp) {
  // The search is a loose substring match and PAGINATED: searching
  // "41.175.39.1" also matches .10-.19, .100+ and so on, and the exact
  // device can land beyond page 1 (which made LTZ-ACC1-AIR intermittently
  // "ambiguous / not found"). Read every page, stopping as soon as the exact
  // IP is seen.
  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const searchRes = await authedFetch(
      `/switch-configurations?search=${encodeURIComponent(deviceIp)}&page=${page}&pageSize=100`
    );
    if (!searchRes.ok) {
      throw new Error(`Config search failed: ${searchRes.status} ${await searchRes.text()}`);
    }
    const searchData = await searchRes.json();
    // Real shape: { items: [{ id, deviceId, deviceName, ip, filePath, ... }], totalItems, totalPages, ... }
    const pageItems = searchData.items || [];
    items.push(...pageItems);
    totalPages = Number(searchData.totalPages) || 1;
    if (pageItems.some((item) => item.ip === deviceIp) || pageItems.length === 0) break;
    page += 1;
  } while (page <= totalPages);

  // The search endpoint does a loose/substring match, not an exact one —
  // searching "41.175.37.1" also matches "41.175.37.10", "41.175.37.100",
  // "41.175.37.12", etc. Blindly taking items[0] can silently return a
  // COMPLETELY DIFFERENT device's config with no error, which is exactly
  // what happened for 41.175.37.1: it returned some other switch's config
  // (RAHA-GPON) instead of the real one. Require an exact IP match.
  let match = items.find((item) => item.ip === deviceIp);

  if (!match && items.length === 1) {
    // Only one result and it's not an exact IP match — could be a
    // legitimate hostname/alt-format match, but flag it since this is
    // exactly the kind of silent mismatch that caused the bug above.
    console.error(
      `[getSwitchConfig] warning: no exact IP match for ${deviceIp}, falling back to sole search result (ip=${items[0].ip}, deviceName=${items[0].deviceName})`
    );
    match = items[0];
  }

  if (!match) {
    if (items.length > 1) {
      throw new Error(
        `Ambiguous search for ${deviceIp}: ${items.length} switch configs matched (${items
          .map((i) => `${i.ip}${i.deviceName ? ` [${i.deviceName}]` : ''}`)
          .join(', ')}) but none is an exact IP match. Refusing to guess which one you meant.`
      );
    }
    throw new Error(`No switch configuration found for ${deviceIp}`);
  }

  const downloadRes = await authedFetch(`/switch-configurations/${match.id}/download`);
  if (!downloadRes.ok) {
    throw new Error(`Config download failed: ${downloadRes.status} ${await downloadRes.text()}`);
  }

  return { text: await downloadRes.text(), updatedAt: match.updatedAt || null, deviceName: match.deviceName || null };
}

export async function getSwitchConfig(deviceIp) {
  return (await getSwitchConfigWithMeta(deviceIp)).text;
}

/**
 * Very simple heuristic: does the question look like it's asking about a
 * specific device? Looks for an IPv4 address in the question.
 * Good enough to start with — replace with something smarter later
 * (hostname lookup, explicit device flag, etc).
 */
export function extractDeviceIp(question) {
  const match = question.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  return match ? match[0] : null;
}

/**
 * Resolve a bare IP (e.g. an l2circuit/BGP/OSPF neighbor address found in
 * a config, not necessarily the device the user is asking about) to its
 * real device name, via GET /devices/by-ip/<ip> on the same authenticated
 * API used for config search/download. Returns null if the API reports no
 * match (404) rather than throwing, since "no name on file" is a normal,
 * expected outcome here, not an error.
 */
export async function getDeviceNameByIp(ip) {
  const res = await authedFetch(`/devices/by-ip/${encodeURIComponent(ip)}`);

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Device lookup failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Response shape hasn't been pinned down against real data yet — try the
  // field names a device-lookup endpoint like this would plausibly use.
  return data.name || data.deviceName || data.hostname || data.device?.name || null;
}

/**
 * Resolve a device NAME (e.g. "LTZ-BNG02-TIG-DAR") to its IP, via
 * GET /devices?search=<name> on the same authenticated API. Confirmed
 * shape: { devices: [{ id, ip, name, lat, long }], totalItems, totalPages,
 * currentPage }. The search is loose/substring, so — same reasoning as
 * getSwitchConfig above — this requires an exact (case-insensitive) name
 * match before trusting a single result, and refuses to guess when
 * several devices match and none is exact.
 */
export async function getDeviceIpByName(name) {
  const res = await authedFetch(`/devices?search=${encodeURIComponent(name)}`);

  if (res.status === 404) return { ip: null, candidates: [] };
  if (!res.ok) {
    throw new Error(`Device search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const devices = data.devices || [];

  const exact = devices.find((d) => String(d.name || '').toLowerCase() === name.toLowerCase());
  if (exact) return { ip: exact.ip, candidates: devices };

  return { ip: null, candidates: devices };
}

/**
 * Full device inventory from GET /devices (paginated). Returns
 * [{ ip, name, isIsolated }]. Used by bulk_show_command to scan "all nodes".
 * Pages through everything (pageSize 100) rather than trusting a single
 * page, and stops on totalPages or an empty page.
 */
export async function listAllDevices() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await authedFetch(`/devices?page=${page}&pageSize=100&search=`);
    if (!res.ok) throw new Error(`Device list failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const devices = data.devices || [];
    for (const d of devices) {
      if (d?.ip) all.push({ ip: d.ip, name: d.name || d.ip, isIsolated: !!d.isIsolated });
    }
    totalPages = Number(data.totalPages) || 1;
    if (devices.length === 0) break;
    page += 1;
  } while (page <= totalPages);
  return all;
}

/**
 * Global CUSTOMER search — NOT a device/switch search. Queries
 * GET /search?q=<query>&limit=<limit> on the same authenticated API,
 * which searches five customer types in parallel (DIA, IPT, Shared,
 * L3VPN, FTTH, plus computed L2VPN circuits), matched by customerName,
 * cid, interface, nbr, or the linked client's email/phone/pastel name
 * (FTTH additionally matches on pppoeusername/ip/customerID). This is
 * the right tool for "where is this customer" / "find customer X" /
 * "look up circuit Y" questions — get_interface_config and
 * search_switch_config are for a KNOWN device's config, not for finding
 * which device/circuit a customer is on in the first place.
 *
 * The API itself requires at least 2 characters in `q` (returns an
 * empty result set otherwise) — that's enforced server-side, not
 * duplicated here.
 */
export async function searchCustomers(query, limit) {
  const trimmed = String(query || '').trim();
  const params = new URLSearchParams({ q: trimmed });
  if (limit) params.set('limit', String(limit));

  const res = await authedFetch(`/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Customer search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    results: Array.isArray(data.results) ? data.results : [],
    total: typeof data.total === 'number' ? data.total : (data.results || []).length,
    query: data.query || trimmed,
  };
}
