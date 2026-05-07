// constants/Constants.ts

export const T = {
  bg: "#0a0e14",
  bg2: "#111722",
  bg3: "#1a2234",
  bg4: "#222d42",
  border: "#2a3a56",
  border2: "#3a4f72",
  text: "#c8d8f0",
  text2: "#7a9abf",
  text3: "#4a6a8f",
  blue: "#4a9eff",
  blue2: "#2a7fdd",
  blue3: "#1a5faa",
  green: "#2dce8a",
  amber: "#ffb347",
  red: "#ff5a5a",
  purple: "#9b7fff",
  mono: "'JetBrains Mono',monospace",
  sans: "'Inter',sans-serif",
};

export const isAGGNode = (n: string): boolean => /AGG/i.test(n);
export const isPENode = (n: string): boolean => /-PE\d/i.test(n);
export const isBNGNode = (n: string): boolean => /BNG/i.test(n);
export const isCoreNode = (n: string): boolean =>
  /^LTZ-P\d/i.test(n) || /^LZA-P/i.test(n) || /^LZM-P/i.test(n);

export const SEV_COLORS: Record<string, string> = {
  CRITICAL: T.red,
  HIGH: T.amber,
  MEDIUM: T.purple,
  LOW: T.green,
};

export const SEV_BGS: Record<string, string> = {
  CRITICAL: "rgba(255,90,90,.15)",
  HIGH: "rgba(255,179,71,.15)",
  MEDIUM: "rgba(155,127,255,.15)",
  LOW: "rgba(45,206,138,.15)",
};

export const SEV_BORDER_COLORS: Record<string, string> = {
  CRITICAL: "rgba(255,90,90,.3)",
  HIGH: "rgba(255,179,71,.3)",
  MEDIUM: "rgba(155,127,255,.3)",
  LOW: "rgba(45,206,138,.3)",
};

export const API_BASE = "https://automation.liquidmatics.co.tz/isis-adjacency";
export const API_TIMEOUT = 10000; // 10 seconds
export const AUTO_REFRESH_INTERVAL = 3 * 60 * 1000; // 5 minutes
