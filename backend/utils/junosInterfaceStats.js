// Extracted from cron/isisInterfaceStats.js so the access-topology poller
// (cron/accessTopology.js) can parse "show interfaces <if> statistics"
// output the same way instead of duplicating the regexes. Pure functions,
// no side effects — behavior is unchanged from where they used to live.

const parseInterfaceDetails = (output) => {
  const stats = { speed: null, input_bps: null, output_bps: null };
  if (!output) return stats;

  const speedMatch = output.match(/Speed:\s*(\d+)\s*(G|m)bps/i);
  if (speedMatch) {
    let val = parseInt(speedMatch[1], 10);
    stats.speed = speedMatch[2].toLowerCase() === "g" ? val * 1000 : val;
  }

  const inputMatch = output.match(/Input rate\s*:\s*(\d+)\s*bps/i);
  if (inputMatch) stats.input_bps = BigInt(inputMatch[1]).toString();

  const outputMatch = output.match(/Output rate\s*:\s*(\d+)\s*bps/i);
  if (outputMatch) stats.output_bps = BigInt(outputMatch[1]).toString();

  return stats;
};

const computeUtilization = (inputBpsStr, outputBpsStr, portSpeedMbps) => {
  if (!portSpeedMbps) return null;
  const inBps = parseInt(inputBpsStr, 10) || 0;
  const outBps = parseInt(outputBpsStr, 10) || 0;
  const maxBps = Math.max(inBps, outBps);
  const maxMbps = maxBps / 1e6;
  return (maxMbps / portSpeedMbps) * 100;
};

module.exports = { parseInterfaceDetails, computeUtilization };
