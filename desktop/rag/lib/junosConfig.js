/**
 * Helpers for working with Junos "set"-style configs (one line per
 * statement, e.g. "set interfaces ge-0/0/12 unit 668 vlan-id 668").
 * Because every line for a given interface literally starts with
 * "set interfaces <name>", we can pull out exactly that interface's
 * config with a string match — no embeddings needed, and it's more
 * precise than semantic chunk retrieval for this kind of question.
 */

// Matches common Junos interface names: ge-0/0/12, xe-0/0/3, et-0/0/48,
// ae0, lo0, irb.100, etc. Captures the base interface and an optional
// unit number (from ".668" or "unit 668" in the question).
const IFACE_REGEX =
  /\b((?:ge|xe|et|ae|lo|me|em|irb|fxp|vlan|so|t1|t3|ds3|st0)-?\d+(?:\/\d+\/\d+)?)(?:\.(\d+)|\s+unit\s+(\d+))?\b/i;

export function extractInterfaceQuery(question) {
  const match = question.match(IFACE_REGEX);
  if (!match) return null;
  return {
    iface: match[1],
    unit: match[2] || match[3] || null,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Models occasionally fold the logical unit into the interface string
// instead of passing it separately — e.g. "xe-0/0/2/223" or
// "xe-0/0/2.223" for interface xe-0/0/2 unit 223 — and/or zero-pad a
// segment ("0/0/02" instead of "0/0/2", which Junos never does). This
// normalizes both cases so lookups against the real "set interfaces
// xe-0/0/2 unit 223 ..." lines still match instead of silently
// returning nothing.
export function normalizeInterfaceAndUnit(rawIface, rawUnit) {
  let iface = String(rawIface || '').trim();
  let unit = rawUnit !== undefined && rawUnit !== null && rawUnit !== '' ? String(rawUnit).trim() : null;

  // Physical-style: prefix-fpc/pic/port, optionally with a folded unit
  // after a trailing "." or "/" (e.g. "xe-0/0/2/223", "xe-0/0/02.223").
  const physical = iface.match(/^([a-z]+)-(\d+)\/(\d+)\/(\d+)(?:[./](\d+))?$/i);
  if (physical) {
    const [, prefix, fpc, pic, port, foldedUnit] = physical;
    iface = `${prefix}-${parseInt(fpc, 10)}/${parseInt(pic, 10)}/${parseInt(port, 10)}`;
    if (!unit && foldedUnit) unit = foldedUnit;
    return { iface, unit };
  }

  // Logical-style: prefix + number, optionally ".unit" (e.g. "ae0.223",
  // "irb.100", "lo0").
  const logical = iface.match(/^([a-z]+)(\d+)(?:\.(\d+))?$/i);
  if (logical) {
    const [, prefix, num, foldedUnit] = logical;
    iface = `${prefix}${parseInt(num, 10)}`;
    if (!unit && foldedUnit) unit = foldedUnit;
    return { iface, unit };
  }

  return { iface, unit };
}

// Every distinct logical unit number configured under "set interfaces
// <iface> unit <N> ..." anywhere in the config, used to tell a physical
// port genuinely SHARED across multiple customers (many distinct units)
// apart from an interface effectively DEDICATED to one circuit (at most
// one real customer unit, aside from unit 0 — which in this network's
// DIA-With-Tag convention is never itself a customer, only the ccc/
// l2circuit pseudowire endpoint companion to the numbered routed unit).
function findAllUnitsForInterface(config, iface) {
  const re = new RegExp(
    `^(?:set|deactivate|delete|activate)\\s+interfaces\\s+${escapeRegex(iface)}\\s+unit\\s+(\\d+)\\b`,
    'gim'
  );
  const units = new Set();
  let m;
  while ((m = re.exec(config)) !== null) units.add(m[1]);
  return units;
}

/**
 * Returns every config line for the given interface (all units), or
 * just one unit if `unit` is provided. Empty string if nothing matches.
 */
export function filterConfigByInterface(config, iface, unit = null) {
  const lines = config.split('\n');

  // (?=[.\s]|$) makes sure "ge-0/0/1" doesn't also match "ge-0/0/12"
  const basePattern = new RegExp(
    `^(set|deactivate|delete|activate)\\s+interfaces\\s+${escapeRegex(iface)}(?=[.\\s]|$)`,
    'i'
  );

  if (!unit) {
    // No specific unit — everything under this interface, unchanged.
    const primaryLines = lines.filter((line) => basePattern.test(line.trim()));
    const crossRefPattern = new RegExp(`\\b${escapeRegex(iface)}\\b`, 'i');
    const primarySet = new Set(primaryLines);
    const crossRefLines = lines.filter((line) => {
      if (primarySet.has(line)) return false;
      const trimmed = line.trim();
      if (basePattern.test(trimmed)) return false;
      return crossRefPattern.test(trimmed);
    });
    return [...primaryLines, ...crossRefLines].join('\n');
  }

  // A specific unit was asked for. Whether physical-port-level lines (mtu,
  // description, flexible-vlan-tagging, encapsulation — lines with no
  // "unit N" in them) and a "unit 0" companion belong in the answer
  // depends on whether this interface is dedicated to ONE circuit or
  // genuinely shared: on a shared port (e.g. a ge-*/xe-* trunk carrying
  // several customers on different units), those lines apply to every
  // customer on the port, not specifically the one asked about, so they
  // stay excluded. On a dedicated interface (this network's ps{N}
  // pseudo-interfaces are named per-customer, so there's normally only
  // ONE real customer unit plus unit 0 as its ccc/l2circuit endpoint),
  // those same lines ARE part of this one circuit's complete picture.
  const allUnits = findAllUnitsForInterface(config, iface);
  allUnits.delete('0');
  allUnits.delete(String(unit));
  const isDedicated = allUnits.size === 0;

  const relevantUnits = new Set([String(unit)]);
  if (isDedicated) relevantUnits.add('0');

  const primaryLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!basePattern.test(trimmed)) return false;
    const unitMatch = trimmed.match(/interfaces\s+\S+(?:\.(\d+)\b|\s+unit\s+(\d+)\b)/i);
    const lineUnit = unitMatch ? unitMatch[1] || unitMatch[2] : null;
    if (lineUnit === null) return isDedicated; // physical-level line
    return relevantUnits.has(lineUnit);
  });

  // Same cross-reference idea as the no-unit case above (e.g. a pseudowire
  // under "set protocols l2circuit neighbor ... interface ps4411.0 ..."),
  // but checked once per relevant unit — so a dedicated interface's unit-0
  // l2circuit binding is picked up alongside the requested unit's own.
  const primarySet = new Set(primaryLines);
  const crossRefLines = [];
  for (const u of relevantUnits) {
    const crossRefPattern = new RegExp(`\\b${escapeRegex(`${iface}.${u}`)}\\b`, 'i');
    for (const line of lines) {
      if (primarySet.has(line) || crossRefLines.includes(line)) continue;
      const trimmed = line.trim();
      if (basePattern.test(trimmed)) continue;
      if (crossRefPattern.test(trimmed)) crossRefLines.push(line);
    }
  }

  return [...primaryLines, ...crossRefLines].join('\n');
}

/**
 * When the logical unit number is known but the interface it belongs to
 * isn't, find which interface(s) actually have this unit configured, then
 * reuse filterConfigByInterface's full per-interface logic (dedicated vs
 * shared detection, unit-0 companion, l2circuit binding) for each one —
 * so this "interface unknown" path gets the same complete-circuit
 * behavior as when the caller already knows the interface name, rather
 * than a flat substring match with no context. Each returned section
 * names its own parent interface, so nothing upstream needs to know it
 * first.
 */
export function filterConfigByUnitOnly(config, unit) {
  const ifaceRe = new RegExp(
    `^(?:set|deactivate|delete|activate)\\s+interfaces\\s+(\\S+)\\s+unit\\s+${escapeRegex(unit)}\\b`,
    'gim'
  );
  const interfaces = new Set();
  let m;
  while ((m = ifaceRe.exec(config)) !== null) interfaces.add(m[1]);

  if (interfaces.size > 0) {
    return [...interfaces]
      .map((iface) => filterConfigByInterface(config, iface, unit))
      .filter(Boolean)
      .join('\n');
  }

  // Fallback: no "set interfaces X unit <unit> ..." stanza exists at all
  // (e.g. the unit is only referenced elsewhere, like an l2circuit entry
  // for an already-deleted interface) — a flat substring match is still
  // better than nothing here.
  const pattern = new RegExp(`\\bunit\\s+${escapeRegex(unit)}\\b|\\.${escapeRegex(unit)}\\b`, 'i');
  return config
    .split('\n')
    .filter((line) => pattern.test(line.trim()))
    .join('\n');
}

// Question/filler words and generic structural terms (interface,
// description, circuit, etc. describe *what kind* of thing to look at,
// not the actual value to search for) — excluded so what's left is the
// real search term(s).
const KEYWORD_STOPWORDS = new Set([
  'i', 'a', 'an', 'the', 'on', 'of', 'to', 'is', 'are', 'it', 'its', 'all', 'any', 'some',
  'this', 'that', 'these', 'those', 'there', 'their', 'in', 'for', 'and', 'or', 'be', 'has', 'have',
  'do', 'does', 'did', 'what', 'which', 'who', 'show', 'me', 'list', 'find', 'get', 'give', 'please',
  'can', 'you', 'tell', 'about', 'know', 'want', 'need', 'with', 'from', 'by', 'as', 'at',
  'circuit', 'circuits', 'description', 'interface', 'interfaces', 'config', 'configuration',
  'device', 'switch', 'ip', 'unit', 'vlan',
]);

/**
 * Pulls out candidate search terms from a question, ordered by how
 * likely each is to be the actual thing the user wants matched:
 *  1. An exact quoted phrase ("Exim Zanzibar") — highest confidence.
 *  2. All-caps acronym/tag-like words (DIA, MPLS, L2VPN) — these show up
 *     verbatim in the config too.
 *  3. Any other non-stopword word, longest first (more specific = safer).
 *
 * Returns an array so the caller can try each in turn and use the first
 * one that actually matches something in the config, rather than
 * committing to a single guess.
 */
export function extractKeywordCandidates(question) {
  const candidates = [];

  const quoted = question.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) candidates.push((quoted[1] || quoted[2]).trim());

  const words = question
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ' ') // drop IPs, handled separately
    .replace(/[?.,!:;()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !KEYWORD_STOPWORDS.has(w.toLowerCase()));

  const acronyms = words.filter((w) => /^[A-Z]{2,8}$/.test(w));
  candidates.push(...acronyms);

  const rest = words.filter((w) => !acronyms.includes(w)).sort((a, b) => b.length - a.length);
  candidates.push(...rest);

  return [...new Set(candidates)];
}

/**
 * Returns every line containing the keyword — not a top-K guess, all of
 * them, so "list every circuit with X" doesn't silently drop matches.
 * Prefers lines that also contain "description" (since that's usually
 * what's being asked about) but falls back to any matching line if none
 * of the matches happen to be on a description line.
 */
export function grepConfigLines(config, keyword) {
  const re = new RegExp(escapeRegex(keyword), 'i');
  const lines = config.split('\n');

  const descriptionMatches = lines.filter((line) => /description/i.test(line) && re.test(line));
  if (descriptionMatches.length > 0) return descriptionMatches;

  return lines.filter((line) => re.test(line));
}
