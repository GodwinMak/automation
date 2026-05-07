import { T } from "./Constants";
import {fmtMetric, utilColor } from "./formatters";

export function Tag({ children, color, bg, style = {} }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 3,
        fontFamily: T.mono,
        fontSize: 10,
        fontWeight: 500,
        background: bg || "rgba(74,158,255,.15)",
        color: color || T.blue,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function MetricCard({ value, label, colorClass }) {
  const colors = {
    critical: T.red,
    warning: T.amber,
    ok: T.green,
    info: T.blue,
  };
  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 24,
          fontWeight: 600,
          lineHeight: 1,
          color: colors[colorClass] || T.text,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: T.text3,
          marginTop: 4,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          fontFamily: T.mono,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function SectionHeader({
  icon,
  children,
  iconBg = "rgba(74,158,255,.2)",
  iconBorder = "rgba(74,158,255,.3)",
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: ".08em",
        color: T.text2,
        textTransform: "uppercase",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          background: iconBg,
          border: `1px solid ${iconBorder}`,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      {children}
    </div>
  );
}
export function RecItem({ rec }) {
  const colors = {
    CRITICAL: T.red,
    HIGH: T.amber,
    MEDIUM: T.purple,
    LOW: T.green,
  };
  const bgs = {
    CRITICAL: "rgba(255,90,90,.06)",
    HIGH: "rgba(255,179,71,.06)",
    MEDIUM: "rgba(155,127,255,.06)",
    LOW: "rgba(45,206,138,.06)",
  };
  const col = colors[rec.priority];
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 6,
        marginBottom: 10,
        borderLeft: `3px solid ${col}`,
        background: bgs[rec.priority],
      }}
    >
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".1em",
          marginBottom: 6,
          color: col,
        }}
      >
        ● {rec.priority} — {rec.type.replace(/_/g, " ").toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 13,
          color: T.text,
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        {rec.text}
      </div>
      <div
        style={{
          fontSize: 12,
          color: T.text2,
          background: T.bg3,
          padding: "8px 10px",
          borderRadius: 4,
          borderLeft: `2px solid ${T.border2}`,
        }}
      >
        → {rec.action}
      </div>
    </div>
  );
}

export function UtilBar({ util, label, compact = false }) {
  if (util === null || util === undefined) return null;
  const col = utilColor(util);
  if (compact) {
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 80 }}
      >
        <div
          style={{
            flex: 1,
            height: 5,
            background: T.bg4,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${util}%`,
              background: col,
              borderRadius: 3,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10,
            color: col,
            flexShrink: 0,
          }}
        >
          {util}%
        </span>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      {label && (
        <div
          style={{
            fontSize: 10,
            color: T.text3,
            marginBottom: 3,
            fontFamily: T.mono,
          }}
        >
          {label}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            background: T.bg4,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${util}%`,
              background: col,
              borderRadius: 3,
              transition: "width .3s",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: col,
            fontWeight: 600,
            width: 36,
            textAlign: "right",
          }}
        >
          {util}%
        </span>
      </div>
    </div>
  );
}

export function DisruptionBanners({ aggpe }) {
  if (!aggpe) return null;
  const banners = [];
  if (aggpe.peFullyDisrupted && aggpe.pePairsDisrupted.length > 0) {
    const pairs = aggpe.pePairsDisrupted
      .map((p) => `${p.from} ↔ ${p.to}`)
      .join(", ");
    banners.push(
      <div
        key="pe-full"
        style={{
          padding: "12px 16px",
          background: "rgba(255,90,90,.08)",
          border: "1px solid rgba(255,90,90,.35)",
          borderLeft: `4px solid ${T.red}`,
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".1em",
            marginBottom: 4,
            color: T.red,
          }}
        >
          ⚡ PE DISRUPTION DETECTED
        </div>
        <div style={{ color: T.text }}>
          <strong>{pairs}</strong> cannot communicate at all after this failure.
        </div>
      </div>,
    );
  }
  if (aggpe.peMetricDegraded && aggpe.pePairsInflated.length > 0) {
    const w = aggpe.pePairsInflated.reduce((a, b) =>
      b.costDiff > a.costDiff ? b : a,
    );
    const mult = Math.round(w.afterCost / w.beforeCost);
    banners.push(
      <div
        key="pe-metric"
        style={{
          padding: "12px 16px",
          background: "rgba(255,179,71,.07)",
          border: "1px solid rgba(255,179,71,.3)",
          borderLeft: `4px solid ${T.amber}`,
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".1em",
            marginBottom: 4,
            color: T.amber,
          }}
        >
          ⚠ PE-TO-PE METRIC EXPLOSION
        </div>
        <div style={{ color: T.text }}>
          <strong>
            {w.from} → {w.to}
          </strong>{" "}
          metric jumps{" "}
          <strong>
            {fmtMetric(w.beforeCost)} → {fmtMetric(w.afterCost)}
          </strong>{" "}
          ({mult}× worse).
        </div>
      </div>,
    );
  }
  if (
    aggpe.aggCrossLinkBroken &&
    !aggpe.peFullyDisrupted &&
    !aggpe.peMetricDegraded
  )
    banners.push(
      <div
        key="agg-cl"
        style={{
          padding: "12px 16px",
          background: "rgba(255,179,71,.07)",
          border: "1px solid rgba(255,179,71,.3)",
          borderLeft: `4px solid ${T.amber}`,
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".1em",
            marginBottom: 4,
            color: T.amber,
          }}
        >
          ⚠ AGG CROSS-LINK BROKEN
        </div>
        <div style={{ color: T.text }}>
          Direct path between{" "}
          <strong>{aggpe.survivingAGGs.join(" and ") || "AGG nodes"}</strong> is
          lost.
        </div>
      </div>,
    );
  if (aggpe.isAGGFailure && aggpe.l1NodesLosingAGG.length > 0) {
    const n = aggpe.l1NodesLosingAGG.length;
    banners.push(
      <div
        key="l1-lost"
        style={{
          padding: "12px 16px",
          background: "rgba(255,90,90,.08)",
          border: "1px solid rgba(255,90,90,.35)",
          borderLeft: `4px solid ${T.red}`,
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".1em",
            marginBottom: 4,
            color: T.red,
          }}
        >
          ⚡ {n} L1 DEVICE(S) LOSE ALL AGG UPLINKS
        </div>
        <div style={{ color: T.text, fontFamily: T.mono, fontSize: 12 }}>
          {aggpe.l1NodesLosingAGG.slice(0, 6).join(", ")}
          {n > 6 ? ` … +${n - 6} more` : ""}
        </div>
        <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>
          Surviving AGG:{" "}
          <strong style={{ color: T.blue }}>
            {aggpe.survivingAGGs.join(", ") || "none"}
          </strong>
        </div>
      </div>,
    );
  }
  if (
    aggpe.isAGGFailure &&
    aggpe.l1NodesLosingAGG.length === 0 &&
    aggpe.survivingAGGs.length > 0
  )
    banners.push(
      <div
        key="agg-ok"
        style={{
          padding: "12px 16px",
          background: "rgba(74,158,255,.06)",
          border: "1px solid rgba(74,158,255,.25)",
          borderLeft: `4px solid ${T.blue}`,
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".1em",
            marginBottom: 4,
            color: T.blue,
          }}
        >
          ℹ AGG FAILOVER — ALL L1 DEVICES RETAIN UPLINKS
        </div>
        <div style={{ color: T.text }}>
          All L1 devices can still reach{" "}
          <strong>{aggpe.survivingAGGs.join(", ")}</strong>.
        </div>
      </div>,
    );
  return <>{banners}</>;
}
