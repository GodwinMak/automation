import {
  getSwitchConfig,
  getSwitchConfigWithMeta,
  getDeviceNameByIp,
  getDeviceIpByName,
  searchCustomers,
  listAllDevices,
} from './configTool.js';
import { getLinkHistory, getCurrentStatus, getMetricTrend } from './warehouseTool.js';
import { filterConfigByInterface, filterConfigByUnitOnly, grepConfigLines, normalizeInterfaceAndUnit } from '../lib/junosConfig.js';
import { requestElectronTool } from '../lib/electronBridge.js';

const GET_FULL_CONFIG_LIMIT = parseInt(process.env.CONFIG_CHAR_LIMIT || '6000', 10);

// get_link_history: without a date bound, /history returns EVERY poll ever
// recorded for a link (33,607+ rows seen for one busy ISIS interface) —
// far too much to hand an LLM, and agentLoop.js's 50,000-char tool-output
// cap would silently truncate that down to just the OLDEST entries
// (poll_ts ASC), which is backwards for almost any real question ("has
// this been flapping" needs RECENT data). Default to a tight lookback
// when the model doesn't specify one, and condense the result to actual
// status CHANGES instead of a raw per-poll dump — polls between changes
// are identical or near-identical (continuous telemetry like bps/power
// changes every single poll, which would defeat a naive full-object diff).
const DEFAULT_HISTORY_LOOKBACK_DAYS = 3;
const RAW_HISTORY_FALLBACK_LIMIT = 50;

// Only the DISCRETE/status-like fields per service are worth diffing —
// deliberately excludes continuous telemetry (input_bps, rx_power_dbm,
// upmbps, etc.), which changes on every poll and would make every single
// row look like a "change". Numeric trend questions belong to
// check_utilization_trend (pre-aggregated daily averages), not this tool.
const STATUS_FIELDS_BY_SERVICE = {
  ISIS: ['state', 'level'],
  DIA: ['adminStatus', 'operationalStatus'],
  IPT: ['adminStatus', 'operationalStatus'],
  SHARED: ['adminStatus', 'operationalStatus'],
  L3VPN: ['adminStatus', 'operationalStatus'],
  FTTH: ['status', 'isExpired', 'isAliveWhileExpired', 'isFreeCustomer'],
};

// Returns a short list of {poll_ts, ...changedFields} events — only where
// a tracked status field actually differs from the previous poll — or
// null if this service_type has no known status-field set (caller should
// fall back to a capped raw dump in that case, e.g. for DEVICE or a
// future service added to the warehouse but not yet to this map).
function summarizeHistoryChanges(serviceType, history) {
  const watchFields = STATUS_FIELDS_BY_SERVICE[String(serviceType).toUpperCase()];
  if (!watchFields || history.length === 0) return null;

  const events = [];
  let prev = null;
  for (const row of history) {
    const snapshot = {};
    for (const field of watchFields) snapshot[field] = row.payload_json?.[field];
    if (prev === null || watchFields.some((field) => snapshot[field] !== prev[field])) {
      events.push({ poll_ts: row.poll_ts, ...snapshot });
    }
    prev = snapshot;
  }
  return events;
}

// Cache configs per device within one question — if the model calls
// multiple tools against the same device (e.g. get_interface_config then
// search_switch_config), don't log in and download the config twice.
const configCache = new Map();

async function fetchConfigCached(deviceIp) {
  if (!configCache.has(deviceIp)) {
    configCache.set(deviceIp, await getSwitchConfig(deviceIp));
  }
  return configCache.get(deviceIp);
}

// Same idea for name lookups — a neighbor IP that shows up in both the
// primary and backup l2circuit lines shouldn't trigger two round trips.
const deviceNameCache = new Map();

async function fetchDeviceNameCached(ip) {
  if (deviceNameCache.has(ip)) return deviceNameCache.get(ip);
  const name = await getDeviceNameByIp(ip);
  // Only cache a real hit. A miss can be a transient backend hiccup (the
  // Config API blipping, a 404 masking a real error — see getDeviceNameByIp)
  // rather than a stable fact, and this Map lives for the app's entire
  // runtime — caching a miss would make every future lookup for this IP
  // return the same stale "not found" forever, even once the device is
  // genuinely resolvable again, with no way to recover short of an app
  // restart. A confirmed hit, by contrast, is safe to cache indefinitely —
  // a device's name doesn't change turn to turn.
  if (name) deviceNameCache.set(ip, name);
  return name;
}

// Same idea, reverse direction — name to IP.
const deviceIpCache = new Map();

async function fetchDeviceIpCached(name) {
  if (deviceIpCache.has(name)) return deviceIpCache.get(name);
  const result = await getDeviceIpByName(name);
  // Same reasoning as fetchDeviceNameCached above — never permanently
  // cache a miss.
  if (result.ip) deviceIpCache.set(name, result);
  return result;
}

// Guard against a model passing a device IP that isn't a real device —
// observed with K2 Horizon: asked about LTZ-ACC1-ITO (really 41.175.39.2) it
// handed the config and live tools an IP (41.175.71.4) that appears in no
// record, so they failed with "no configuration found" / "could not connect"
// and the user was told the device was unreachable. Checks the IP against
// the device inventory (GET /devices/by-ip) and, if it is not there, returns
// an instruction to resolve the NAME with lookup_device_ip first. Returns
// null (= go ahead) when the IP is known, AND when the inventory itself
// can't be reached — a flaky inventory API must never block every tool.
let inventoryIps = null; // Set of every known device IP
let inventoryLoadedAt = 0;
const INVENTORY_TTL_MS = 5 * 60 * 1000;

async function unknownDeviceIpMessage(deviceIp) {
  const ip = String(deviceIp || '').trim();
  if (!ip) return null;
  try {
    // The full list (shape confirmed: { devices: [{ip, name, ...}] }) is the
    // source of truth — /devices/by-ip's response shape was never pinned
    // down, and a wrong guess there would block every tool call. Cached for
    // a few minutes so this adds no round trip per tool call.
    if (!inventoryIps || Date.now() - inventoryLoadedAt > INVENTORY_TTL_MS) {
      const all = await listAllDevices();
      if (all.length > 0) {
        inventoryIps = new Set(all.map((d) => String(d.ip).trim()));
        inventoryLoadedAt = Date.now();
      }
    }
    if (!inventoryIps || inventoryIps.has(ip)) return null;
    return (
      `${ip} is not a device in the network inventory, so this was not run. Do not guess or reuse an IP from memory: ` +
      `call lookup_device_ip with the device NAME to get its real management IP, then retry with that IP.`
    );
  } catch {
    return null;
  }
}

/**
 * OpenAI-style tool/function schemas. The model reads these descriptions
 * to decide which tool fits the question — writing accurate, specific
 * descriptions here matters as much as the implementations below.
 */
export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Search Junos documentation/reference material for general concepts, CLI syntax, or how-to information. Use this for conceptual questions ("how do I configure a VLAN"), not for a specific device\'s live state.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_interface_config',
      description:
        'Get the exact configuration lines for one interface (optionally one logical unit) on a specific switch. Use this whenever the question names a specific interface, e.g. ge-0/0/12 or xe-0/0/3. Includes both the "set interfaces ..." stanza AND any other stanza that references this interface.unit by name (e.g. "set protocols l2circuit neighbor ... interface ge-0/0/12.2847 ..." for a pseudowire/L2VPN circuit) — so this is also the right tool for "is there an l2circuit/pseudowire on this unit" style questions. If the question gives a unit number but NOT the interface name (e.g. "what\'s on unit 2847"), omit "interface" entirely and pass only "unit" — this searches every interface on the device for that unit number instead of guessing which one it is.',
      parameters: {
        type: 'object',
        properties: {
          device_ip: { type: 'string', description: "The switch's management/loopback IP" },
          interface: {
            type: 'string',
            description:
              "Interface name, format type-fpc/pic/port with no leading zeros, e.g. ge-0/0/12, xe-0/0/3. Do NOT include the unit number here (not \"xe-0/0/2/223\" or \"xe-0/0/2.223\") — pass it in the separate \"unit\" field below. Omit this field entirely (leave it out) if you only know the unit number, not which interface it's on.",
          },
          unit: { type: 'string', description: 'Logical unit number, e.g. 668 — passed separately from interface, never appended to it. Can be given alone (without interface) to search every interface for it.' },
        },
        required: ['device_ip'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_switch_config',
      description:
        'Search a specific switch\'s ENTIRE configuration for every line containing an exact keyword, tag, or customer name (e.g. "DIA", "MPLS", a customer name). Returns the complete set of matching lines, or explicitly reports zero matches. Always use this instead of guessing for "list all X" or "does X exist" questions about a device.',
      parameters: {
        type: 'object',
        properties: {
          device_ip: { type: 'string', description: "The switch's management/loopback IP" },
          keyword: { type: 'string', description: 'Exact term to search for' },
        },
        required: ['device_ip', 'keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_show_command',
      description:
        'Run a single READ-ONLY Junos command live against a device — "show ..." (e.g. "show interfaces ge-0/0/12.2847 extensive", "show route", "show system alarms", "show version"), "ping ... count N" (e.g. "ping 10.0.0.1 rapid count 20" — count is REQUIRED, an uncounted ping is rejected since it never ends on its own), or "traceroute ...". If the user already has that device open in a terminal tab in the desktop app, it runs there; otherwise the desktop app automatically opens a new visible terminal tab for it using its stored default credentials, connects, and runs the command there (the tab stays open afterward, same as if the user had connected it themselves) — so you do NOT need to ask the user to connect first, just call this directly. Only if it comes back with a real connection/credential failure should you relay that to the user (e.g. suggest checking the device is reachable, or that default credentials are set). The command MUST start with "show", "ping", or "traceroute" — this NEVER enters configuration mode and NEVER commits, edits, sets, or deletes anything, under any circumstance; any other command is rejected before it ever reaches the device, regardless of what is asked. If a user asks you to configure something, change a setting, or commit a change, decline and explain that live config changes are outside what you can do — this tool is read-only by design.',
      parameters: {
        type: 'object',
        properties: {
          device_ip: { type: 'string', description: "The switch's management/loopback IP — must match a session already open in the desktop app." },
          command: { type: 'string', description: 'The exact command to run, e.g. "show interfaces ge-0/0/12.2847 extensive" or "ping 10.0.0.1 rapid count 20". Must start with "show", "ping", or "traceroute" — and "ping" must include a "count N".' },
        },
        required: ['device_ip', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_show_command',
      description:
        'Run ONE read-only command ("show ...", same rules as run_show_command) across MANY devices at once and get back a compact per-node summary — use this for fleet-wide questions like "which nodes have user X configured", "which devices have this alarm", or "run this show command on all nodes". Runs devices in parallel without a model call per device, so it is far faster than looping run_live_diagnostics. Set match_text to only report devices whose output contains that text (case-insensitive) — the result lists matching nodes, non-matching nodes, and nodes that FAILED to be checked (a failure is NOT a no-match; report it separately). Omit device_ips to scan EVERY device in the network inventory (devices API); use name_contains (e.g. "ACC1", "RAH") to limit by hostname substring, or device_ips for specific management IPs. Isolated devices are skipped by default (reported as SKIPPED). Max 200 devices per call. Example: command="show configuration | display set | match ecouser", match_text="ecouser".',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The read-only command to run on every device, e.g. "show configuration | display set | match ecouser".' },
          device_ips: { type: 'array', items: { type: 'string' }, description: 'Optional list of management IPs. Omit to scan the full inventory.' },
          name_contains: { type: 'string', description: 'Optional hostname substring filter applied to the inventory, e.g. "ACC1".' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'Optional hostnames and/or IPs to leave out of the scan ("run on all except X, Y"). Pass every name and IP the user listed.' },
          include_isolated: { type: 'boolean', description: 'Set true to also scan devices flagged isolated. Default false.' },
          match_text: { type: 'string', description: 'Optional text to look for in each device\'s output; only matching lines are reported.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_search_config',
      description:
        'Search the STORED configuration files (the saved backups, not the live devices) of many or all devices for a configuration statement or keyword, and report which devices contain it. Use this when the user asks to look in the configuration files or backups across the network, for example which nodes have a given statement or user configured, including deactivated statements. Stored configs are in set format, so search for the statement as written there, such as deactivate interfaces lo0 unit 0 family inet filter. Matching is a case-insensitive substring. It covers isolated devices too and needs no SSH, so it is much faster than a live scan. The result lists devices with matches, devices without, and devices whose config could not be read (not the same as no match), plus how old the stored copies are. Omit device_ips to search every device in the inventory.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The statement or text to look for in each stored config.' },
          device_ips: { type: 'array', items: { type: 'string' }, description: 'Optional list of management IPs. Omit to search the full inventory.' },
          name_contains: { type: 'string', description: 'Optional hostname substring filter for the inventory.' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'Optional hostnames or IPs to leave out of the search.' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_device_name',
      description:
        'Resolve a bare IP address to its real device name/hostname — e.g. an l2circuit/BGP/OSPF neighbor IP found in a config that has no name attached to it. ALWAYS use this instead of guessing, inventing, or leaving out a name for an IP you don\'t already know from the question or config text itself. If it returns no match, say the IP has no known name on file rather than making one up.',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'The IPv4 address to look up, e.g. 41.175.37.20' },
        },
        required: ['ip'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_device_ip',
      description:
        'Resolve a device NAME/hostname (e.g. "LTZ-BNG02-TIG-DAR", "SW-CORE-01") to its management IP — every other tool needs an IP, not a name, so ALWAYS use this first whenever the user (or a runbook/knowledge base entry) refers to a device by name instead of IP. Never guess or invent an IP for a device name. If several devices match and none is an exact name match, the result lists the candidates — ask the user to disambiguate rather than picking one.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The device name/hostname to look up, e.g. LTZ-BNG02-TIG-DAR' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_customers',
      description:
        'Search for a CUSTOMER (not a device/switch) across every service type at once — DIA, IPT, Shared, L3VPN, FTTH, and L2VPN — matched by customer name, circuit ID (cid), interface, neighbor (nbr), or the linked client\'s email/phone/pastel name (FTTH also matches on PPPoE username, IP, or customer ID). Use this for "where is this customer", "find customer X", "which service/circuit does X have", or "look up CID Y" style questions — do NOT guess a device or interface for a customer from memory or pattern-matching. This is NOT for finding a device/switch itself — use lookup_device_ip/lookup_device_name for that. Requires at least 2 characters in the query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Customer name, circuit ID (CID), interface, neighbor, email, phone, or pastel name to search for. Minimum 2 characters.' },
          limit: { type: 'integer', description: 'Max results per customer type before merging (default 10). Optional.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_full_config',
      description:
        "Get a switch's complete raw configuration. Only use this as a last resort when no more specific tool fits — configs can be very large, so prefer get_interface_config or search_switch_config when you know what you're looking for.",
      parameters: {
        type: 'object',
        properties: {
          device_ip: { type: 'string', description: "The switch's management/loopback IP" },
        },
        required: ['device_ip'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_link_history',
      description:
        'Get STATUS-CHANGE events (not raw traffic numbers) for one specific link/circuit/customer over a time range, from the network warehouse — automatically condensed to only the polls where status actually changed, e.g. "has this been flapping", "was this down yesterday too", "when did this go from Up to Down". Set current_only to true to instead get just the last known polled state of the link (the latest snapshot, which may be up to one polling interval old; this is NOT a live device query, use run_show_command for that) — faster than pulling history when only the present state matters. NOT for traffic/utilization trend numbers (use check_utilization_trend). Requires the exact record_key and service_type — if you only have a customer name or interface, use search_customers first. Defaults to the last 3 days if "from" is omitted — always pass an explicit "from" for anything longer than a few days back, since this can otherwise be scanning months of history.',
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string', description: 'One of DIA, IPT, SHARED, L3VPN, FTTH, ISIS, DEVICE — the service this link belongs to.' },
          record_key: { type: 'string', description: 'The exact warehouse record_key for this link/circuit, as returned by search_customers or a prior lookup — do not guess or construct one.' },
          from: { type: 'string', description: 'Start date/time (YYYY-MM-DD or full datetime). Defaults to 3 days ago if omitted — pass this explicitly for any longer lookback.' },
          to: { type: 'string', description: 'Optional end date/time. Omit to search up to the most recent record.' },
          current_only: { type: 'string', description: 'Set to true to return only the latest polled state instead of status-change history. Default is false. from and to are ignored when true.' },
        },
        required: ['service_type', 'record_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_utilization_trend',
      description:
        'Get the daily-averaged trend for one metric (e.g. util_pct, down_mbps, up_mbps, capacity_mbps, is_up) on one specific link/circuit over a lookback window, from the network warehouse\'s pre-aggregated daily metrics. Use this for "is this link trending toward saturation", "what has average utilization looked like over the last N days", or any question about a TREND rather than a single point in time. NOT for live current state (use run_show_command, or get_link_history with current_only true for the last polled state) and NOT for raw per-poll history (use get_link_history). Requires the exact record_key — if you only have a customer name or interface, use search_customers first.',
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string', description: 'One of DIA, IPT, SHARED, L3VPN, FTTH, ISIS, DEVICE.' },
          record_key: { type: 'string', description: 'The exact warehouse record_key for this link/circuit.' },
          metric: { type: 'string', description: 'The metric name to trend, e.g. "util_pct", "down_mbps", "up_mbps", "capacity_mbps", "is_up". If unsure which exist for this service, try "util_pct" for ISIS or "down_mbps"/"up_mbps" for DIA/IPT/L3VPN.' },
          days: { type: 'integer', description: 'How many days of history to look back over (default 30, max 365).' },
        },
        required: ['service_type', 'record_key', 'metric'],
      },
    },
  },
];

export const toolImplementations = {
  // Queries the shared office-wide knowledge-server (see
  // knowledge-server/ in the junos-rag-assistant project) instead of a
  // local per-user vectra index — every engineer's app hits the SAME
  // index, so a knowledge-base edit or correction only needs indexing
  // once, not on every desktop separately. See KNOWLEDGE_API_HOST /
  // KNOWLEDGE_API_KEY in .env.
  async search_knowledge_base({ query }) {
    if (!process.env.KNOWLEDGE_API_HOST || !process.env.KNOWLEDGE_API_KEY) {
      return 'The shared knowledge base is not configured on this machine (missing KNOWLEDGE_API_HOST/KNOWLEDGE_API_KEY in .env) — ask your admin for the connection details.';
    }
    try {
      const res = await fetch(`${process.env.KNOWLEDGE_API_HOST}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.KNOWLEDGE_API_KEY },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        return `Knowledge base search failed (${res.status}): ${await res.text()}`;
      }
      const data = await res.json();
      return data.text || 'No matching documents found in the knowledge base.';
    } catch (err) {
      return `Could not reach the shared knowledge base at ${process.env.KNOWLEDGE_API_HOST}: ${err.cause?.message || err.message}`;
    }
  },

  async get_interface_config({ device_ip, interface: rawIface, unit: rawUnit }) {
    try {
      const unknownIp = await unknownDeviceIpMessage(device_ip);
      if (unknownIp) return unknownIp;
      if (!rawIface && !rawUnit) {
        return 'Either an interface name or a unit number is required to look up config — provide at least one.';
      }

      const config = await fetchConfigCached(device_ip);

      if (!rawIface) {
        // Interface unknown — search every interface on the device for
        // this unit number. Each returned line names its own parent
        // interface, so the model can read off which one it actually is.
        const unit = String(rawUnit).trim();
        const result = filterConfigByUnitOnly(config, unit);
        return (
          result.trim() ||
          `No configuration lines found referencing unit ${unit} on any interface on ${device_ip}.`
        );
      }

      const { iface, unit } = normalizeInterfaceAndUnit(rawIface, rawUnit);
      if (iface !== rawIface || unit !== (rawUnit || null)) {
        console.error(`[get_interface_config] normalized "${rawIface}"/"${rawUnit || ''}" -> "${iface}"/"${unit || ''}"`);
      }
      const result = filterConfigByInterface(config, iface, unit || null);
      return result.trim() || `No configuration lines found for interface ${iface}${unit ? ` unit ${unit}` : ''} on ${device_ip}.`;
    } catch (err) {
      return `Error fetching config for ${device_ip}: ${err.message}`;
    }
  },

  async run_show_command({ device_ip, command }) {
    try {
      const unknownIp = await unknownDeviceIpMessage(device_ip);
      if (unknownIp) return unknownIp;
      const res = await requestElectronTool('run_show_command', { device_ip, command });
      if (res.error) return res.error;
      const output = String(res.output || '').trim();
      return output || '(command ran but returned no output)';
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },

  async bulk_show_command({ command, device_ips, name_contains, exclude, include_isolated, match_text }) {
    try {
      // The schema uses plain strings (K2 Horizon's gateway rejected array/
      // boolean parameters). Accept real arrays/booleans too, in case a
      // model sends them anyway.
      const toList = (v) =>
        (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
      device_ips = toList(device_ips);
      exclude = toList(exclude);
      include_isolated = include_isolated === true || String(include_isolated).toLowerCase() === 'true';

      // "Run on all EXCEPT ..." — entries may be hostnames or IPs, matched
      // exactly (case-insensitive). Name AND IP are both checked, so a
      // mistyped IP next to a correct name (or vice versa) still excludes
      // the right device.
      const excludeSet = new Set(
        (Array.isArray(exclude) ? exclude : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      );
      const isExcluded = (d) => excludeSet.has(d.ip.toLowerCase()) || excludeSet.has(d.name.toLowerCase());
      let excluded = [];

      // Inventory comes from the devices API (all nodes, paginated). Isolated
      // devices are skipped by default — they're deliberately cut off — and
      // reported as skipped so they're never mistaken for "checked, no match".
      let devices = null;
      let skippedIsolated = [];
      if (!Array.isArray(device_ips) || device_ips.length === 0) {
        let inventory = await listAllDevices();
        if (name_contains) {
          const needle = String(name_contains).toLowerCase();
          inventory = inventory.filter((d) => d.name.toLowerCase().includes(needle));
        }
        if (!include_isolated) {
          skippedIsolated = inventory.filter((d) => d.isIsolated).map((d) => d.name);
          inventory = inventory.filter((d) => !d.isIsolated);
        }
        excluded = inventory.filter(isExcluded).map((d) => d.name);
        devices = inventory.filter((d) => !isExcluded(d)).map(({ ip, name }) => ({ ip, name }));
        if (devices.length === 0) return 'No devices matched the scan filter (after excluding isolated/excluded devices).';
      } else {
        device_ips = device_ips.filter((ip) => !excludeSet.has(String(ip).trim().toLowerCase()));
        if (device_ips.length === 0) return 'No devices left to scan after applying the exclusions.';
      }

      const res = await requestElectronTool('bulk_show_command', { command, devices, device_ips, match_text });
      if (res.error) return res.error;
      let text = String(res.output || '').trim() || '(bulk run returned no output)';
      if (excluded.length) {
        text += `\n\nEXCLUDED as requested (not checked): ${excluded.join(', ')}`;
      }
      const unmatchedExcludes = [...excludeSet].filter(
        (e) => !excluded.some((n) => n.toLowerCase() === e) && !(devices || []).some((d) => d.ip === e)
      );
      if (unmatchedExcludes.length && excluded.length < excludeSet.size) {
        text += `\n(Exclusion entries that matched no inventory device by name: ${unmatchedExcludes.join(', ')} — they may match by IP, or be mistyped.)`;
      }
      if (skippedIsolated.length) {
        text += `\n\nSKIPPED (isolated, not checked): ${skippedIsolated.join(', ')}`;
      }
      return text;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },

  async bulk_search_config({ keyword, device_ips, name_contains, exclude }) {
    try {
      const kw = String(keyword || '').trim();
      if (kw.length < 3) return 'Give a statement or keyword of at least 3 characters to search the stored configs for.';
      const needle = kw.toLowerCase();

      const toList = (v) =>
        (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
      const wantedIps = new Set(toList(device_ips));
      const excludeSet = new Set(toList(exclude));

      let inventory = await listAllDevices();
      if (wantedIps.size) inventory = inventory.filter((d) => wantedIps.has(d.ip.toLowerCase()));
      if (name_contains) {
        const sub = String(name_contains).toLowerCase();
        inventory = inventory.filter((d) => d.name.toLowerCase().includes(sub));
      }
      const excluded = inventory.filter((d) => excludeSet.has(d.ip.toLowerCase()) || excludeSet.has(d.name.toLowerCase()));
      inventory = inventory.filter((d) => !excluded.includes(d));
      if (inventory.length === 0) return 'No devices matched the search filter.';

      // Not the shared fetchConfigCached: that Map never evicts, and a
      // fleet-wide search would pin every device's full config in memory.
      const results = new Array(inventory.length);
      let next = 0;
      const worker = async () => {
        while (next < inventory.length) {
          const i = next++;
          const { ip, name } = inventory[i];
          try {
            const { text, updatedAt } = await getSwitchConfigWithMeta(ip);
            // Every matching line, not only description lines (grepConfigLines
            // prefers description lines and would hide other matches).
            const lines = text
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.toLowerCase().includes(needle));
            results[i] = { name, status: lines.length ? 'match' : 'no_match', lines, updatedAt };
          } catch (err) {
            results[i] = { name, status: 'error', detail: err.message };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, inventory.length) }, worker));

      const matched = results.filter((r) => r.status === 'match');
      const none = results.filter((r) => r.status === 'no_match');
      const errors = results.filter((r) => r.status === 'error');
      const dates = results.map((r) => r.updatedAt).filter(Boolean).sort();

      const out = [
        `Searched the STORED config files of ${inventory.length} device(s) for "${kw}": ${matched.length} with matches, ${none.length} without, ${errors.length} could not be read.`,
      ];
      if (dates.length) {
        out.push(`These are saved backups, last refreshed between ${dates[0]} and ${dates[dates.length - 1]} — not live device state.`);
      }
      if (matched.length) {
        out.push('', 'WITH MATCHES:');
        for (const r of matched) {
          const shown = r.lines.slice(0, 10);
          out.push(`- ${r.name}:\n  ${shown.join('\n  ')}${r.lines.length > 10 ? `\n  ... (${r.lines.length - 10} more lines)` : ''}`);
        }
      }
      if (none.length) {
        out.push('', none.length <= 40 ? `NO MATCH: ${none.map((r) => r.name).join(', ')}` : `NO MATCH: ${none.length} devices (list omitted for length).`);
      }
      if (errors.length) {
        out.push('', 'COULD NOT BE READ (not checked — NOT the same as no match):');
        for (const r of errors) out.push(`- ${r.name}: ${r.detail}`);
      }
      if (excluded.length) out.push('', `EXCLUDED as requested: ${excluded.map((d) => d.name).join(', ')}`);
      return out.join('\n');
    } catch (err) {
      return `Error searching stored configs: ${err.message}`;
    }
  },

  async search_switch_config({ device_ip, keyword }) {
    try {
      const unknownIp = await unknownDeviceIpMessage(device_ip);
      if (unknownIp) return unknownIp;
      const config = await fetchConfigCached(device_ip);
      const lines = grepConfigLines(config, keyword);
      if (lines.length === 0) {
        return `Zero lines matched "${keyword}" anywhere in ${device_ip}'s configuration. This term does not exist on this device — do not invent or approximate a match.`;
      }
      return `${lines.length} line(s) matched "${keyword}" (this is the complete set, not a sample):\n${lines.join('\n')}`;
    } catch (err) {
      return `Error searching config for ${device_ip}: ${err.message}`;
    }
  },

  async lookup_device_name({ ip }) {
    try {
      const name = await fetchDeviceNameCached(ip);
      return name
        ? `${ip} resolves to device name: ${name}`
        : `No device name on file for ${ip} — refer to it by IP rather than guessing a name.`;
    } catch (err) {
      return `Error looking up device name for ${ip}: ${err.message}`;
    }
  },

  async lookup_device_ip({ name }) {
    try {
      const { ip, candidates } = await fetchDeviceIpCached(name);
      if (ip) return `${name} resolves to IP: ${ip}`;
      if (candidates.length > 0) {
        return `No exact match for "${name}" — ${candidates.length} similar device(s) found, none exact: ${candidates
          .map((d) => `${d.name} (${d.ip})`)
          .join(', ')}. Ask the user which one they meant rather than guessing.`;
      }
      return `No device found for "${name}" — do not guess an IP for it.`;
    } catch (err) {
      return `Error looking up IP for ${name}: ${err.message}`;
    }
  },

  async search_customers({ query, limit }) {
    try {
      const trimmed = String(query || '').trim();
      if (trimmed.length < 2) {
        return 'Search query must be at least 2 characters — ask the user for a more specific name, CID, or interface before searching.';
      }

      const { results, total, query: echoedQuery } = await searchCustomers(trimmed, limit);

      if (results.length === 0) {
        return `No customer found matching "${echoedQuery}" across DIA, IPT, Shared, L3VPN, FTTH, or L2VPN records — do not guess or invent a match.`;
      }

      const summary = results
        .map(
          (r) =>
            `- [${r.type || 'unknown'}] ${r.customerName || '(no name)'} — cid=${r.cid || 'n/a'}, interface=${r.interface || 'n/a'}, nbr=${r.nbr || 'n/a'}, status=${r.status || 'unknown'}, switch=${r.switchName || 'n/a'}`
        )
        .join('\n');

      return `${total} total match(es) for "${echoedQuery}" (showing ${results.length}):\n${summary}\n\nIf more than one distinct customer matches, ask the user which one they meant rather than picking one yourself.`;
    } catch (err) {
      return `Error searching customers: ${err.message}`;
    }
  },

  async get_full_config({ device_ip }) {
    try {
      const unknownIp = await unknownDeviceIpMessage(device_ip);
      if (unknownIp) return unknownIp;
      const config = await fetchConfigCached(device_ip);
      if (config.length > GET_FULL_CONFIG_LIMIT) {
        return `Config is ${config.length} characters — too large to return in full (limit ${GET_FULL_CONFIG_LIMIT}). Use get_interface_config or search_switch_config instead to narrow down what you need.`;
      }
      return config;
    } catch (err) {
      return `Error fetching config for ${device_ip}: ${err.message}`;
    }
  },

  async get_link_history({ service_type, record_key, from, to, current_only }) {
    // current_only replaces the former separate get_current_status tool
    // (merged to keep the router's tool count at 10 — K2 Horizon's gateway
    // rejects requests with 11 or more tools).
    if (current_only === true || String(current_only).toLowerCase() === 'true') {
      return toolImplementations.get_current_status({ service_type, record_key });
    }
    try {
      const usedDefaultFrom = !from;
      const effectiveFrom =
        from || new Date(Date.now() - DEFAULT_HISTORY_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

      const { count, history } = await getLinkHistory(service_type, record_key, effectiveFrom, to);

      if (count === 0) {
        const rangeNote = usedDefaultFrom
          ? ` (defaulted to the last ${DEFAULT_HISTORY_LOOKBACK_DAYS} days since no "from" was given — pass an explicit, wider "from" to search further back)`
          : '';
        return `No historical records found for ${service_type} record_key="${record_key}" between ${effectiveFrom} and ${to || 'now'}${rangeNote} — do not assume this means the link doesn't exist, it may just predate warehouse polling, the range may be too narrow, or the record_key may be wrong.`;
      }

      const events = summarizeHistoryChanges(service_type, history);
      if (events) {
        const lines = events.map(({ poll_ts, ...fields }) => `${poll_ts}: ${JSON.stringify(fields)}`);
        return (
          `${count} raw poll(s) for ${service_type} "${record_key}" between ${effectiveFrom} and ${to || 'now'}, ` +
          `condensed to ${events.length} status-change event(s) (only shown where a tracked status field actually ` +
          `changed between polls — use check_utilization_trend for traffic/utilization numbers, not this tool):\n${lines.join('\n')}`
        );
      }

      // No known status-field set for this service_type — fall back to a
      // capped raw dump of the MOST RECENT entries (not oldest-first).
      const capped = history.slice(-RAW_HISTORY_FALLBACK_LIMIT);
      const lines = capped.map((h) => `${h.poll_ts}: ${JSON.stringify(h.payload_json)}`);
      return `${count} historical record(s) for ${service_type} "${record_key}" between ${effectiveFrom} and ${to || 'now'} (showing the ${capped.length} most recent):\n${lines.join('\n')}`;
    } catch (err) {
      return `Error fetching link history: ${err.message}`;
    }
  },

  async get_current_status({ service_type, record_key }) {
    try {
      const current = await getCurrentStatus(service_type, record_key);
      if (!current) {
        return `No current status on file for ${service_type} record_key="${record_key}" — it may not exist, or may not yet have been polled by the warehouse.`;
      }
      return `Last known state for ${service_type} "${record_key}" as of ${current.poll_ts} (recorded from ${current.source_host}): ${JSON.stringify(current.payload_json)}`;
    } catch (err) {
      return `Error fetching current status: ${err.message}`;
    }
  },

  async check_utilization_trend({ service_type, record_key, metric, days }) {
    try {
      const { count, trend } = await getMetricTrend(service_type, record_key, metric, days);
      if (count === 0) {
        return `No "${metric}" trend data found for ${service_type} record_key="${record_key}" over the requested window — either this metric isn't tracked for this service type, or there's not enough history yet.`;
      }
      const lines = trend.map((t) => `${t.day}: ${t.metric_value} (${t.sample_count} samples)`);
      return `${count} day(s) of "${metric}" for ${service_type} "${record_key}":\n${lines.join('\n')}`;
    } catch (err) {
      return `Error fetching utilization trend: ${err.message}`;
    }
  },
};
