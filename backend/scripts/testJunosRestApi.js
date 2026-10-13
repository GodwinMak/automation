/**
 * One-off: does the Junos REST API actually work as a replacement for
 * SSH-scraping "show isis adjacency", on ONE test device?
 *
 * Junos maps CLI "show" commands to RPCs, and (once
 * `set system services rest http/https port <n>` is configured on the
 * device — see the instructions given alongside this script) exposes them
 * over HTTP(S) at /rpc/<rpc-name>, authenticated the same way as CLI login
 * (HTTP Basic Auth, same username/password as SSH_USERNAME/SSH_PASSWORD).
 * "show isis adjacency" maps to the get-isis-adjacency-information RPC.
 *
 * This is a read-only GET against a single device — safe to run against a
 * live device once REST is enabled on it. Prints the raw response so we can
 * see the actual JSON shape before deciding whether it's worth swapping any
 * cron job over to it.
 *
 * Usage (from backend/):
 *   node scripts/testJunosRestApi.js --host 10.1.2.3
 *   node scripts/testJunosRestApi.js --host 10.1.2.3 --port 3000 --https --insecure
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const axios = require("axios");
const https = require("https");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const HOST = getArg("host");
if (!HOST) {
  console.error("Usage: node scripts/testJunosRestApi.js --host <device-ip> [--port 3000] [--https] [--insecure] [--rpc get-isis-adjacency-information]");
  process.exit(1);
}
const USE_HTTPS = hasFlag("https");
const PORT = getArg("port", USE_HTTPS ? "443" : "3000");
const INSECURE = hasFlag("insecure");
const USERNAME = process.env.SSH_USERNAME;
const PASSWORD = process.env.SSH_PASSWORD;

const RPC = getArg("rpc", "get-isis-adjacency-information");
const url = `${USE_HTTPS ? "https" : "http"}://${HOST}:${PORT}/rpc/${RPC}`;

const run = async () => {
  console.log(`[test] GET ${url}`);
  console.log(`[test] Auth user: ${USERNAME || "(SSH_USERNAME not set in .env!)"}`);

  const startedAt = Date.now();
  try {
    const res = await axios.get(url, {
      auth: { username: USERNAME, password: PASSWORD },
      headers: { Accept: "application/json" },
      timeout: 10000,
      httpsAgent: USE_HTTPS ? new https.Agent({ rejectUnauthorized: !INSECURE }) : undefined,
      validateStatus: () => true, // we want to see 4xx/5xx bodies too, not throw
    });

    console.log(`[test] Responded in ${Date.now() - startedAt}ms — HTTP ${res.status}`);
    console.log(`[test] Content-Type: ${res.headers["content-type"]}`);
    console.log("\n=== RAW BODY ===");
    console.log(typeof res.data === "string" ? res.data.slice(0, 3000) : JSON.stringify(res.data, null, 2).slice(0, 3000));

    if (res.status === 200) {
      console.log("\n✅ REST API responded successfully — worth comparing this shape against parseISISAdjacency's expectations next.");
    } else if (res.status === 401) {
      console.log("\n❌ 401 Unauthorized — check SSH_USERNAME/SSH_PASSWORD in .env match this device's login, and that the user's class has REST/CLI access.");
    } else {
      console.log(`\n⚠️  Unexpected status ${res.status} — see body above.`);
    }
  } catch (err) {
    console.log(`\n❌ Request failed after ${Date.now() - startedAt}ms: ${err.code || err.message}`);
    if (err.code === "ECONNREFUSED") {
      console.log("Connection refused — REST service likely isn't enabled/listening on this port yet (see `show configuration system services rest` on the device).");
    } else if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      console.log("Timed out — check firewall/ACLs between this box and the device on that port, or that the port is actually the one configured.");
    } else if (err.message?.includes("certificate")) {
      console.log("TLS/certificate error — try again with --insecure for this test (self-signed cert is Junos's default for https REST).");
    }
  }
};

run();
