// Shared optics-power parsing/threshold logic — single source of truth for
// both the standalone Optics Power dashboard (OpticsPower.tsx) and any
// other page that shows a link's real Tx/Rx power against its alarm/
// warning bounds (e.g. the network map hover tooltip). tx_power_dbm/
// rx_power_dbm are JSON-stringified arrays of dBm readings so both
// single-lane ports (ge/xe) and 4-lane ports (et- 40G/100G) fit the same
// backend column — see backend/Models/isisAdjacent.js.
export type OpticsStatus = "alarm" | "warning" | "normal" | "nodata";

export const STATUS_RANK: Record<OpticsStatus, number> = { alarm: 3, warning: 2, normal: 1, nodata: 0 };
export const STATUS_WORD: Record<OpticsStatus, string> = { alarm: "ALARM", warning: "WARN", normal: "OK", nodata: "—" };

export function safeParseArray(text: string | null | undefined): number[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((n) => typeof n === "number" && !Number.isNaN(n)) : [];
  } catch {
    return [];
  }
}

export function laneStatus(
  value: number,
  hiAlarm: number | null | undefined,
  loAlarm: number | null | undefined,
  hiWarn: number | null | undefined,
  loWarn: number | null | undefined
): OpticsStatus {
  if (value === null || value === undefined) return "nodata";
  if (hiAlarm !== null && hiAlarm !== undefined && value >= hiAlarm) return "alarm";
  if (loAlarm !== null && loAlarm !== undefined && value <= loAlarm) return "alarm";
  if (hiWarn !== null && hiWarn !== undefined && value >= hiWarn) return "warning";
  if (loWarn !== null && loWarn !== undefined && value <= loWarn) return "warning";
  return "normal";
}

export function worstOpticsStatus(a: OpticsStatus, b: OpticsStatus): OpticsStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function fmtDbm(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

// Worst status across every lane of a Tx or Rx reading, plus that worst
// lane's own value (the one worth surfacing in a compact one-line summary).
export function summarizePowerReading(
  text: string | null | undefined,
  hiAlarm: number | null | undefined,
  loAlarm: number | null | undefined,
  hiWarn: number | null | undefined,
  loWarn: number | null | undefined
): { status: OpticsStatus; worstValue: number | null } {
  const values = safeParseArray(text);
  if (values.length === 0) return { status: "nodata", worstValue: null };

  let status: OpticsStatus = "normal";
  let worstValue = values[0];
  for (const v of values) {
    const s = laneStatus(v, hiAlarm, loAlarm, hiWarn, loWarn);
    if (STATUS_RANK[s] > STATUS_RANK[status]) {
      status = s;
      worstValue = v;
    }
  }
  return { status, worstValue };
}
