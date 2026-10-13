// Device tier is inferred purely from naming convention — Models/devices.js
// has no role/tier column (same "read it out of the name" approach this
// codebase already leans on elsewhere, e.g. l2vpnCircuit.js's PE_VPLS_DEVICES
// set). Order matters: international devices (non-LTZ prefixes) are checked
// first since their own "-P"/"-PE" segments would otherwise match the LTZ
// tier patterns below, and "-P\d" is checked last since it's the loosest
// pattern and would otherwise also match "-PE".
const getDeviceTier = (name) => {
  if (!name) return "OTHER";
  const n = String(name).trim().toUpperCase();

  if (!n.startsWith("LTZ-")) return "INTERNATIONAL";
  if (/-PE\d/.test(n)) return "PE";
  if (/^BNG/.test(n)) return "BNG";
  if (/-AGG\d/.test(n)) return "AGG";
  if (/-ACC\d/.test(n)) return "ACC";
  if (/-P\d/.test(n)) return "P";

  return "OTHER";
};

// Top-to-bottom row grouping for the weathermap layout — PE and BNG share a
// row (both sit at the same logical depth between the P core and AGG),
// matching the reference LibreNMS map's layout.
const TIER_ROWS = [
  { key: "INTERNATIONAL", label: "International", tiers: ["INTERNATIONAL"] },
  { key: "P", label: "Core (P)", tiers: ["P"] },
  { key: "PE_BNG", label: "PE / BNG", tiers: ["PE", "BNG"] },
  { key: "AGG", label: "Aggregation", tiers: ["AGG"] },
  { key: "ACC", label: "Access", tiers: ["ACC"] },
];

module.exports = { getDeviceTier, TIER_ROWS };
