const path = require("path");
const fs = require("fs");
const net = require("net");
const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require("electron");
const { Client } = require("ssh2");

// The agentic RAG assistant lives alongside this app as an ES module tree
// under rag/ (agents/, lib/, tools/, knowledge/) — merged in from the
// standalone junos-rag-assistant project so the whole app packages and
// ships as one thing instead of spawning a separate Node project as a
// subprocess on every chat message. rag/package.json declares
// {"type":"module"} so everything under rag/ parses as ESM while this
// file (and preload.js/renderer.js) stays CommonJS; we reach it from here
// via dynamic import(), the standard way for a CJS file to load ESM.
const RAG_DIR = path.join(__dirname, "rag");
// Per-user, writable copy of the RAG's data (knowledge base, vector
// index, .env secrets) — NOT inside the packaged/asar app bundle, which
// is read-only once installed. Seeded from RAG_DIR on first run; see
// ensureRagDataDir()/initRag() below.
const RAG_DATA_DIR = path.join(app.getPath("userData"), "rag-data");

// productName was renamed from "LIT SecureCRT" to "LIT Terminal", which
// changes app.getName() and therefore app.getPath("userData") — Electron
// keys that path off the app name, so a plain rename would otherwise make
// an existing install start fresh, silently losing saved sessions,
// credentials, settings, and the whole rag-data folder (vector index +
// knowledge base + .env). This copies just those specific items over from
// the old app-name folder the first time the renamed app runs, and leaves
// the old folder in place afterward (untouched, safe to delete manually).
function migrateUserDataFromOldAppName() {
  try {
    const newUserData = app.getPath("userData");
    const oldUserData = path.join(path.dirname(newUserData), "LIT SecureCRT");
    if (oldUserData === newUserData || !fs.existsSync(oldUserData)) return;

    const itemsToMigrate = ["rag-data", "sessions.json", "credentials.json", "settings.json", "ai-chat-history.json"];
    for (const item of itemsToMigrate) {
      const oldItemPath = path.join(oldUserData, item);
      const newItemPath = path.join(newUserData, item);
      if (fs.existsSync(oldItemPath) && !fs.existsSync(newItemPath)) {
        fs.mkdirSync(newUserData, { recursive: true });
        fs.cpSync(oldItemPath, newItemPath, { recursive: true });
        console.log(`[migrate] Copied "${item}" from old "LIT SecureCRT" data folder`);
      }
    }
  } catch (error) {
    console.error("[migrate] userData migration from LIT SecureCRT failed:", error.message);
  }
}

// OpenRouter free models can be slow under load, and a full multi-device
// runbook walk (several run_show_command calls, some opening a new tab
// and waiting out its connect+settle delay) can legitimately take a
// while — matches agentLoop.js's higher round cap so a real diagnosis
// isn't cut off partway through.
const AI_AGENT_TIMEOUT_MS = 360000;

// Populated once initRag() finishes: { runFullAgent, chatWithToolsOpenRouter }.
let ragApi = null;

function ragFileUrl(...segments) {
  return require("url").pathToFileURL(path.join(RAG_DIR, ...segments)).href;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// First launch only: copy a default .env into the writable per-user data
// folder. The knowledge base itself is NO LONGER seeded/copied here — it
// now lives on a shared knowledge-server every install queries over HTTP
// (KNOWLEDGE_API_HOST/KNOWLEDGE_API_KEY in .env), so there's nothing local
// to build an index from on first run anymore. See knowledge-server/ in
// the junos-rag-assistant project.
function ensureRagDataDir() {
  const isFirstRun = !fs.existsSync(RAG_DATA_DIR);
  if (isFirstRun) {
    fs.mkdirSync(RAG_DATA_DIR, { recursive: true });
    const envDefault = path.join(RAG_DIR, ".env.default");
    const envTarget = path.join(RAG_DATA_DIR, ".env");
    if (fs.existsSync(envDefault)) fs.copyFileSync(envDefault, envTarget);
  }
  return isFirstRun;
}

// Loads the RAG's .env, points its relative './knowledge'/'./index' paths
// at the writable per-user folder, and loads its agent code. Must finish
// before the first "ai:chat" call — kicked off from app.whenReady().
async function initRag() {
  ensureRagDataDir();

  // Load into process.env BEFORE importing any rag/* module — several
  // (lib/llm.js, tools/configTool.js) read process.env.* at import time.
  require("dotenv").config({ path: path.join(RAG_DATA_DIR, ".env") });

  // Every relative path inside rag/** ('./knowledge', './index') resolves
  // against process.cwd() at call time — switching it once, globally, to
  // the writable per-user folder is simpler than threading an explicit
  // base path through that whole codebase.
  process.chdir(RAG_DATA_DIR);

  const [{ runFullAgent }, { chatWithToolsOpenRouter }, { registerLiveCommandHandler }] = await Promise.all([
    import(ragFileUrl("agents", "fullAgent.js")),
    import(ragFileUrl("lib", "llm.js")),
    import(ragFileUrl("lib", "electronBridge.js")),
  ]);

  // The one tool (run_show_command) that needs the Electron main process
  // itself — find/open the right terminal tab, enforce the read-only
  // allowlist, type the command into the visible shell. Direct function
  // call now (in-process), not the old subprocess JSON-line RPC.
  registerLiveCommandHandler(async (tool, args) => {
    if (tool === "run_show_command") {
      return runDeviceShowCommandQueued(args?.device_ip, args?.command);
    }
    if (tool === "bulk_show_command") {
      return runBulkShowCommand(args);
    }
    return { error: `Unknown tool requested by agent: ${tool}` };
  });

  ragApi = { runFullAgent, chatWithToolsOpenRouter };
}

const loadBootstrapProductionSessions = () => {
  const devicesPath = path.join(__dirname, "../backend/devices.json");

  try {
    const raw = fs.readFileSync(devicesPath, "utf8");
    const devices = JSON.parse(raw);

    if (!Array.isArray(devices)) return [];

    return devices
      .filter((d) => d && d.name && d.ip)
      .map((d, index) => ({
        id: `prod-${index + 1}-${String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: String(d.name).trim(),
        host: String(d.ip).trim(),
        port: 22,
        protocol: "ssh",
        username: "sysadmin",
        password: "",
        group: "Main Devices",
        connected: false,
      }));
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to load devices.json:", error.message);
    return [];
  }
};

let sessions = [];
let sessionsStorePath = "";
let credentialsStorePath = "";
let settingsStorePath = "";
let defaultCredentials = {
  username: "sysadmin",
  password: "",
};
const AI_PROVIDERS = ["llama", "openrouter", "gemini", "k2horizon"];
let appSettings = {
  mode: "dark",
  textColor: "#e5e2e1",
  aiProvider: "llama",
  localModel: "",
};

// Applies the chosen AI provider to every rag/* env var that gates model
// selection (see rag/lib/llm.js and rag/agents/*.js) — one setting drives
// all four internal agent roles (full/config/live/knowledge) at once.
// Safe to call any time: rag/* reads these from process.env fresh on
// every request rather than caching them at import time, so this takes
// effect on the very next AI message, no restart needed. Also called
// once at startup, BEFORE initRag()'s dotenv.config() runs, so it wins
// over whatever LLM_PROVIDER/etc. happens to be in the seeded .env file
// (dotenv does not overwrite already-set process.env vars).
function applyAiProviderEnv(provider) {
  const value = AI_PROVIDERS.includes(provider) ? provider : "llama";
  process.env.LLM_PROVIDER = value;
  process.env.AGENT_LLM_PROVIDER = value;
  process.env.CONFIG_PROVIDER = value;
  process.env.LIVE_PROVIDER = value;
  process.env.KNOWLEDGE_PROVIDER = value;
}

// Which named preset the local llama-server should load (see its
// --models-preset presets.ini — e.g. "llama-3.1-8b", "gemma-4-26b-a4b").
// Only meaningful when the provider above is "llama"; an empty value
// means "don't override — use whatever LLM_MODEL the seeded .env
// already has". Same timing/override reasoning as applyAiProviderEnv.
function applyLocalModelEnv(model) {
  if (typeof model === "string" && model.trim()) {
    process.env.LLM_MODEL = model.trim();
  }
}

const normalizeSession = (session) => ({
  id: session.id,
  name: String(session.name || "").trim(),
  host: String(session.host || "").trim(),
  port: Number(session.port || (String(session.protocol || "ssh").toLowerCase() === "telnet" ? 23 : 22)),
  protocol: String(session.protocol || "ssh").trim().toLowerCase() === "telnet" ? "telnet" : "ssh",
  username: String(session.username || "sysadmin").trim(),
  password: String(session.password || ""),
  group: String(session.group || "Main Devices").trim(),
  favorite: Boolean(session.favorite),
  connected: false,
});

const readStoredCredentials = () => {
  try {
    if (!credentialsStorePath || !fs.existsSync(credentialsStorePath)) return null;
    const raw = fs.readFileSync(credentialsStorePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      username: String(parsed.username || "sysadmin").trim(),
      password: String(parsed.password || ""),
    };
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to read credentials store:", error.message);
    return null;
  }
};

const writeStoredCredentials = () => {
  try {
    if (!credentialsStorePath) return;
    const dir = path.dirname(credentialsStorePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(credentialsStorePath, JSON.stringify(defaultCredentials, null, 2), "utf8");
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to write credentials store:", error.message);
  }
};

const readStoredSettings = () => {
  try {
    if (!settingsStorePath || !fs.existsSync(settingsStorePath)) return null;
    const raw = fs.readFileSync(settingsStorePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      mode: parsed.mode === "light" ? "light" : "dark",
      textColor: typeof parsed.textColor === "string" ? parsed.textColor : "#e5e2e1",
      aiProvider: AI_PROVIDERS.includes(parsed.aiProvider) ? parsed.aiProvider : "llama",
      localModel: typeof parsed.localModel === "string" ? parsed.localModel : "",
    };
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to read settings store:", error.message);
    return null;
  }
};

const writeStoredSettings = () => {
  try {
    if (!settingsStorePath) return;
    const dir = path.dirname(settingsStorePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsStorePath, JSON.stringify(appSettings, null, 2), "utf8");
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to write settings store:", error.message);
  }
};

// Chat history no longer lives in a local file at all — see the
// ai:chats:* handlers further down, which read/write it on the shared
// knowledge-server instead (keyed by defaultCredentials.username), so it
// follows an engineer to whichever machine they're logged into.

const readStoredSessions = () => {
  try {
    if (!sessionsStorePath || !fs.existsSync(sessionsStorePath)) return null;
    const raw = fs.readFileSync(sessionsStorePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed
      .filter((s) => s && s.id && s.name && s.host)
      .map(normalizeSession);
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to read sessions store:", error.message);
    return null;
  }
};

const writeStoredSessions = () => {
  try {
    if (!sessionsStorePath) return;
    const dir = path.dirname(sessionsStorePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(sessionsStorePath, JSON.stringify(sessions, null, 2), "utf8");
  } catch (error) {
    console.error("[TERMINAL_CORE] Failed to write sessions store:", error.message);
  }
};

const initializeSessionsStore = () => {
  sessionsStorePath = path.join(app.getPath("userData"), "sessions.json");
  credentialsStorePath = path.join(app.getPath("userData"), "credentials.json");
  settingsStorePath = path.join(app.getPath("userData"), "settings.json");

  const stored = readStoredSessions();
  if (stored && stored.length) {
    sessions = stored;
  } else {
    sessions = loadBootstrapProductionSessions();
    writeStoredSessions();
  }

  const storedCredentials = readStoredCredentials();
  if (storedCredentials) {
    defaultCredentials = storedCredentials;
  } else {
    writeStoredCredentials();
  }

  const storedSettings = readStoredSettings();
  if (storedSettings) {
    appSettings = storedSettings;
  } else {
    writeStoredSettings();
  }
  applyAiProviderEnv(appSettings.aiProvider);
  applyLocalModelEnv(appSettings.localModel);
};

const liveConnections = new Map();
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  migrateUserDataFromOldAppName();
  initializeSessionsStore();
  try {
    await initRag();
  } catch (err) {
    console.error("[rag] failed to initialize:", err.message);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const [, conn] of liveConnections) {
    try {
      if (conn.mode === "telnet") {
        conn.socket?.end();
        conn.socket?.destroy();
      } else {
        conn.stream?.end("exit\n");
        conn.client?.end();
      }
    } catch (_err) {
      // Ignore cleanup errors.
    }
  }
  liveConnections.clear();

  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("sessions:list", async () => sessions);

ipcMain.handle("sessions:toggleFavorite", async (_event, payload) => {
  const { sessionId } = payload || {};
  if (!sessionId) return { ok: false, error: "Missing sessionId" };

  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: "Session not found" };

  session.favorite = !session.favorite;
  writeStoredSessions();

  return { ok: true, favorite: session.favorite };
});

ipcMain.handle("sessions:add", async (_event, payload) => {
  const incoming = payload || {};
  const group = String(incoming.group || "Other Devices").trim();
  const protocol = String(incoming.protocol || "ssh").trim().toLowerCase() === "telnet" ? "telnet" : "ssh";

  if (!incoming.name || !incoming.host) {
    return { ok: false, error: "Name and host are required." };
  }

  if (group === "Other Devices" && protocol === "ssh") {
    if (!String(incoming.username || "").trim() || !String(incoming.password || "")) {
      return { ok: false, error: "Other Devices SSH requires username and password." };
    }
  }

  const newSession = normalizeSession({
    id: incoming.id || `sess-${Date.now()}`,
    name: incoming.name,
    host: incoming.host,
    port: incoming.port || (protocol === "telnet" ? 23 : 22),
    protocol,
    username: incoming.username,
    password: incoming.password,
    group,
  });

  sessions.unshift(newSession);
  writeStoredSessions();

  return { ok: true, session: newSession };
});

ipcMain.handle("sessions:remove", async (_event, payload) => {
  const { sessionId } = payload || {};
  if (!sessionId) return { ok: false, error: "Missing sessionId" };

  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { ok: false, error: "Session not found" };

  const connection = liveConnections.get(sessionId);
  if (connection) {
    try {
      if (connection.mode === "telnet") {
        connection.socket?.end();
        connection.socket?.destroy();
      } else {
        connection.stream?.end("exit\n");
        connection.client?.end();
      }
    } catch (_err) {
      // Ignore disconnect errors during remove.
    }
    liveConnections.delete(sessionId);
  }

  sessions.splice(index, 1);
  writeStoredSessions();
  return { ok: true };
});

ipcMain.handle("ssh:connect", async (event, payload) => {
  const { tabId, protocol, host, port, username, password, privateKey } = payload;
  const mode = String(protocol || "ssh").toLowerCase() === "telnet" ? "telnet" : "ssh";

  if (!tabId || !host || (mode === "ssh" && !username)) {
    return { ok: false, error: "Missing required connection fields." };
  }

  if (liveConnections.has(tabId)) {
    return { ok: false, error: "This tab already has an active connection." };
  }

  if (mode === "telnet") {
    return new Promise((resolve) => {
      let resolved = false;
      const socket = net.createConnection({
        host,
        port: Number(port || 23),
      });

      socket.on("connect", () => {
        liveConnections.set(tabId, { mode: "telnet", socket });
        resolved = true;
        resolve({ ok: true });
      });

      socket.on("data", (chunk) => {
        event.sender.send("ssh:data", { tabId, data: chunk.toString("utf8") });
      });

      socket.on("close", () => {
        liveConnections.delete(tabId);
        event.sender.send("ssh:closed", { tabId });
      });

      socket.on("error", (err) => {
        if (!resolved) {
          resolve({ ok: false, error: err.message });
        }
        liveConnections.delete(tabId);
        event.sender.send("ssh:closed", { tabId });
      });
    });
  }

  return new Promise((resolve) => {
    const client = new Client();

    client.on("ready", () => {
      client.shell((shellErr, stream) => {
        if (shellErr) {
          client.end();
          resolve({ ok: false, error: shellErr.message });
          return;
        }

        liveConnections.set(tabId, { mode: "ssh", client, stream, host });

        stream.on("data", (chunk) => {
          event.sender.send("ssh:data", { tabId, data: chunk.toString("utf8") });
        });

        stream.on("close", () => {
          liveConnections.delete(tabId);
          event.sender.send("ssh:closed", { tabId });
        });

        stream.stderr?.on("data", (chunk) => {
          event.sender.send("ssh:data", { tabId, data: chunk.toString("utf8") });
        });

        resolve({ ok: true });
      });
    });

    client.on("error", (err) => {
      liveConnections.delete(tabId);
      resolve({ ok: false, error: err.message });
    });

    client.connect({
      host,
      port: Number(port || 22),
      username,
      password: password || undefined,
      privateKey: privateKey || undefined,
      tryKeyboard: true,
      readyTimeout: 20000,
    });
  });
});

ipcMain.handle("ssh:send", async (_event, payload) => {
  const { tabId, data } = payload;
  const connection = liveConnections.get(tabId);
  if (!connection) return { ok: false };

  if (connection.mode === "telnet") {
    connection.socket?.write(data);
    return { ok: true };
  }

  if (!connection.stream) return { ok: false };
  connection.stream.write(data);
  return { ok: true };
});

ipcMain.handle("ssh:resize", async (_event, payload) => {
  const { tabId, cols, rows } = payload;
  const connection = liveConnections.get(tabId);
  if (!connection) return { ok: false };

  if (connection.mode === "telnet") {
    return { ok: true };
  }

  if (!connection.stream) return { ok: false };

  try {
    connection.stream.setWindow(rows, cols, 600, 300);
    return { ok: true };
  } catch (_err) {
    return { ok: false };
  }
});

ipcMain.handle("ssh:disconnect", async (_event, payload) => {
  const { tabId } = payload;
  const connection = liveConnections.get(tabId);
  if (!connection) return { ok: true };

  try {
    if (connection.mode === "telnet") {
      connection.socket?.end();
      connection.socket?.destroy();
    } else {
      connection.stream?.end("exit\n");
      connection.client?.end();
    }
  } catch (_err) {
    // Ignore errors while disconnecting.
  }

  liveConnections.delete(tabId);
  return { ok: true };
});

ipcMain.handle("ssh:pickPrivateKey", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Select Private Key",
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { ok: false, canceled: true };
  }

  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("credentials:get", async () => ({ ok: true, data: defaultCredentials }));

ipcMain.handle("credentials:set", async (_event, payload) => {
  const incoming = payload || {};
  const username = String(incoming.username || "").trim();
  const password = String(incoming.password || "");

  if (!username) {
    return { ok: false, error: "Username is required." };
  }

  defaultCredentials = { username, password };
  writeStoredCredentials();

  return { ok: true, data: defaultCredentials };
});

ipcMain.handle("settings:get", async () => ({ ok: true, data: appSettings }));

ipcMain.handle("settings:set", async (_event, payload) => {
  const incoming = payload || {};
  appSettings = {
    mode: incoming.mode === "light" ? "light" : "dark",
    textColor: typeof incoming.textColor === "string" && incoming.textColor ? incoming.textColor : "#e5e2e1",
    aiProvider: AI_PROVIDERS.includes(incoming.aiProvider) ? incoming.aiProvider : "llama",
    localModel: typeof incoming.localModel === "string" ? incoming.localModel : "",
  };
  writeStoredSettings();
  applyAiProviderEnv(appSettings.aiProvider);
  applyLocalModelEnv(appSettings.localModel);

  return { ok: true, data: appSettings };
});

ipcMain.handle("clipboard:readText", async () => {
  return clipboard.readText();
});

ipcMain.handle("clipboard:writeText", async (_event, payload) => {
  const text = String(payload?.text || "");
  clipboard.writeText(text);
  return { ok: true };
});

// ---------------------------------------------------------------------
// Live read-only commands for the AI
// ---------------------------------------------------------------------
//
// The AI agent (rag/agents/fullAgent.js, run in-process — see initRag())
// has no SSH connection of its own — it has to ask THIS process to run a
// command via registerLiveCommandHandler, either on an already-open
// terminal tab's connection, or (if the device isn't already connected)
// a new tab opened here using the desktop app's
// stored default credentials. Either way, the command is typed into the
// same interactive shell channel the tab displays, so it's visible on
// screen exactly like a human typing it — this is also the actual
// security boundary: it doesn't matter what the model decides to send,
// only a command starting with "show", "ping", or "traceroute", and
// containing none of the forbidden keywords below, is ever written to
// that shell. Configuration mode and commit are never reachable from
// here, period.
const ALLOWED_COMMAND_PATTERN = /^(show|ping|traceroute)\b/i;
const FORBIDDEN_COMMAND_KEYWORDS =
  /\b(configure|commit|edit|delete|set|deactivate|activate|load|rollback|request|restart|save|copy|rename|zeroize|reboot|halt|shell)\b/i;

function isLiveCommandAllowed(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command) return false;
  if (!ALLOWED_COMMAND_PATTERN.test(command)) return false;
  // "| display set" is a purely cosmetic output filter (prints the config as
  // set-style lines) — it is not the config-mode "set" command, but the bare
  // word "set" would otherwise trip FORBIDDEN_COMMAND_KEYWORDS and wrongly
  // reject read-only commands like "show configuration | display set | match X".
  // Only that exact pipe phrase is exempted; every other use of "set" stays blocked.
  const commandForKeywordCheck = command.replace(/\|\s*display\s+set\b/gi, "|");
  if (FORBIDDEN_COMMAND_KEYWORDS.test(commandForKeywordCheck)) return false;

  // A bare "ping <ip>" with no count runs indefinitely on Junos (like
  // Unix ping without -c) — since completion is detected by watching for
  // the prompt to reappear (see execShowCommand), an uncounted ping would
  // tie up the shared interactive shell until our own timeout gives up,
  // leaving the device still pinging in the background afterward. Require
  // a count so it always finishes and returns the prompt on its own.
  if (/^ping\b/i.test(command) && !/\bcount\s+\d+\b/i.test(command)) return false;

  return true;
}

function findLiveSshConnectionByHost(host) {
  for (const connection of liveConnections.values()) {
    if (connection.mode === "ssh" && connection.host === host) return connection;
  }
  return null;
}

// Types `command` into the SAME interactive shell channel the visible
// terminal tab is already showing (not a separate background exec()
// channel) — so the user actually sees the AI type the command and watch
// its output scroll by, exactly like typing it themselves. We tap the
// stream's data with an extra listener (added alongside the existing one
// that feeds the terminal UI — streams support multiple listeners fine)
// and buffer until a fresh Junos prompt line reappears at the end,
// signalling the command has finished.
const PROMPT_LINE_PATTERN = /(?:^|\r?\n)[^\r\n@]*@[^\r\n]*[%>#]\s*$/;

// Guards against two run_show_command calls writing to the SAME
// connection.stream at once. Without this, a second write landing while
// the first command's output is still arriving interleaves keystrokes
// into the live shell (observed in practice: a stray "s" mid-output
// tripped Junos's --More-- pager into "save output" mode, and other
// characters showed up scattered inside unrelated output columns) —
// which corrupts both commands' results and can leave prompt-detection
// unable to tell the first command ever finished. Keyed by the
// connection object itself (not the host string), since the same host
// could in principle have more than one connection entry.
const busyConnections = new WeakSet();

function execShowCommand(connection, command) {
  return new Promise((resolve) => {
    if (busyConnections.has(connection)) {
      resolve({
        error:
          "This device's terminal is currently busy running another command — wait for it to finish before running another. " +
          "(If you typed into this tab yourself while the AI was running a command, that's the cause — avoid typing into a tab the AI has an active command in.)",
      });
      return;
    }
    busyConnections.add(connection);

    let settled = false;
    let buffer = "";

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.stream.removeListener("data", onData);
      busyConnections.delete(connection);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        output: buffer.trim() || undefined,
        error: buffer.trim() ? undefined : `Command timed out after 25s with no response: "${command}"`,
      });
    }, 25000);

    // Junos's own CLI pager is the real cause of the "Filename: ..." /
    // "Wrote N lines of output to ..." corruption, not this busy-guard:
    // a long "show" command (e.g. a chassis with many transceivers) can
    // exceed the session's screen-length and pause at a "---(more)---"
    // prompt, which doesn't match PROMPT_LINE_PATTERN below — so this
    // never "finishes", the 25s timer fires, and busyConnections gets
    // released while the device is still sitting at that paused pager.
    // The NEXT command then gets typed straight into the pager, which
    // reads its leading "s" as the "save output" hotkey and the rest of
    // the line as the filename to save into. Appending "| no-more"
    // disables paging for this command's output entirely (valid even
    // when the command already has its own "|" filter), so it can never
    // stall on a pager in the first place. Only applied to "show" —
    // ping/traceroute output is already short (count-limited) and Junos
    // versions vary on piping live packet output.
    const sentCommand = /^show\b/i.test(command) ? `${command} | no-more` : command;

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (!PROMPT_LINE_PATTERN.test(buffer)) return;

      // Strip the echoed command itself (first line) and the trailing
      // prompt line(s) so the AI only sees the actual command output.
      let lines = buffer.split(/\r?\n/);
      if (lines.length && lines[0].trim() === sentCommand.trim()) {
        lines = lines.slice(1);
      }
      while (lines.length && /^[^\r\n@]*@[^\r\n]*[%>#]\s*$/.test(lines[lines.length - 1])) {
        lines.pop();
      }
      finish({ output: lines.join("\n").trim() });
    };

    connection.stream.on("data", onData);
    connection.stream.write(`${sentCommand}\n`);
  });
}

// Asks the renderer to open (or reuse) a real, visible tab for `host` and
// connect it — using the same UI code path a user clicking a session
// would trigger — rather than opening an invisible background connection.
// This way the AI's live-command traffic shows up honestly in a terminal
// tab, and the connection sticks around afterward for further commands
// (its own, or the user's).
const pendingTabOpenRequests = new Map();
let tabOpenRequestCounter = 0;

function requestRendererOpenTab(host) {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve({ ok: false, error: "Desktop app window is not available." });
      return;
    }

    const requestId = String(++tabOpenRequestCounter);
    const timer = setTimeout(() => {
      pendingTabOpenRequests.delete(requestId);
      resolve({ ok: false, error: `Timed out waiting for the app to open/connect a tab for ${host}.` });
    }, 25000);

    pendingTabOpenRequests.set(requestId, { resolve, timer });
    mainWindow.webContents.send("ai:openDeviceTab", { requestId, host });
  });
}

ipcMain.handle("ai:openDeviceTabResult", async (_event, payload) => {
  const { requestId, ok, error } = payload || {};
  const pending = pendingTabOpenRequests.get(requestId);
  if (!pending) return { ok: true }; // Already timed out or duplicate — ignore.
  pendingTabOpenRequests.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve({ ok: !!ok, error });
  return { ok: true };
});

async function runDeviceShowCommand(deviceIp, rawCommand) {
  const command = String(rawCommand || "").trim();

  if (!isLiveCommandAllowed(command)) {
    return {
      error: `Refused: only read-only "show", "ping", or "traceroute" commands may be run live (and "ping" must include a "count N"). "${command}" was rejected — configuration-mode and commit-related commands are never permitted, under any circumstance.`,
    };
  }

  let connection = findLiveSshConnectionByHost(deviceIp);

  if (!connection) {
    if (!defaultCredentials.username) {
      return {
        error: `No active SSH session is open for ${deviceIp}, and no default credentials are stored in the desktop app to connect automatically. Either connect to it in a terminal tab first, or set default credentials in Settings.`,
      };
    }

    const openResult = await requestRendererOpenTab(deviceIp);
    if (!openResult.ok) {
      return { error: `Could not open/connect a tab for ${deviceIp}: ${openResult.error || "unknown error"}` };
    }

    connection = findLiveSshConnectionByHost(deviceIp);
    if (!connection) {
      return { error: `A tab for ${deviceIp} reported connected, but no live session was found for it — please try again.` };
    }

    // A freshly-connected session is usually still printing its login
    // banner/MOTD when connectSession() resolves (that happens once the
    // channel opens, not once the device has finished talking) — give it
    // a moment to settle at its first prompt before we type into it,
    // otherwise our command can land mid-banner and confuse the
    // prompt-detection in execShowCommand.
    await new Promise((r) => setTimeout(r, 1500));
  }

  return execShowCommand(connection, command);
}

// Concurrent tool calls to the SAME device IP (see agentLoop.js's
// Promise.all-based parallel tool execution, added so a multi-device
// runbook round — e.g. RULE 8 checking several candidate devices — runs
// those checks at once instead of one SSH round-trip after another) must
// not race on connecting to / writing into that device's shell. This
// queue serializes runDeviceShowCommand() calls per host, so a burst of
// calls to ONE device still runs one at a time, in request order, while
// calls to DIFFERENT devices run fully in parallel exactly as intended.
// Without this, two concurrent first-time calls to the same not-yet-open
// host could both fire requestRendererOpenTab() at once (see its comment
// above), and even once connected, busyConnections' WeakSet would just
// reject whichever call lost the race with a "busy" error instead of it
// ever getting a real result.
const hostQueues = new Map();

function runDeviceShowCommandQueued(deviceIp, rawCommand) {
  const previous = hostQueues.get(deviceIp) || Promise.resolve();
  // .catch(() => {}) on the chain link (not on `run` itself, which the
  // caller still awaits and gets the real result/error from) so one
  // failed command for a host never wedges every later command queued
  // behind it — the queue only needs "wait your turn", not "stop on error".
  const run = previous.catch(() => {}).then(() => runDeviceShowCommand(deviceIp, rawCommand));
  hostQueues.set(deviceIp, run.catch(() => {}));
  return run;
}

// Fleet-wide read-only scan: runs ONE command across many devices with a
// bounded worker pool, no LLM involved per device, and returns a compact
// per-node summary. Reuses runDeviceShowCommandQueued, so the read-only
// allowlist, per-host serialization, and tab-open behavior are identical to
// a single run_show_command. NOTE: devices without an open tab get one
// opened (visible) like any other live command — hence the device cap.
const BULK_MAX_DEVICES = 200;
const BULK_CONCURRENCY = 8;
const BULK_MAX_LINES_PER_DEVICE = 15;
const BULK_EXEC_TIMEOUT_MS = 30000;

// One-shot, invisible SSH exec for bulk scans: connects with the stored
// default credentials, runs the (already allowlist-checked) command via
// ssh exec, returns its output, and disconnects. Used instead of opening a
// visible terminal tab per device, which would be unusable for 100+ nodes.
// If the device already has an open tab, the bulk worker uses that session
// instead (see below), so nothing here fights the user's live shell.
function execBackground(host, command) {
  return new Promise((resolve) => {
    const client = new Client();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.end(); } catch (_e) { /* already closed */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: `Timed out after ${BULK_EXEC_TIMEOUT_MS / 1000}s` }), BULK_EXEC_TIMEOUT_MS);
    const sentCommand = /^show\b/i.test(command) ? `${command} | no-more` : command;

    client.on("ready", () => {
      client.exec(sentCommand, (err, stream) => {
        if (err) return finish({ error: err.message });
        let out = "";
        stream.on("data", (c) => { out += c.toString("utf8"); });
        stream.stderr?.on("data", (c) => { out += c.toString("utf8"); });
        stream.on("close", () => finish({ output: out.trim() }));
      });
    });
    client.on("error", (err) => finish({ error: `SSH failed: ${err.message}` }));
    client.connect({
      host,
      port: 22,
      username: defaultCredentials.username,
      password: defaultCredentials.password || undefined,
      tryKeyboard: true,
      readyTimeout: 15000,
    });
  });
}

async function runBulkShowCommand({ command, devices, device_ips, match_text } = {}) {
  const cmd = String(command || "").trim();
  if (!isLiveCommandAllowed(cmd)) {
    return { error: `Refused: "${cmd}" is not an allowed read-only command (show, ping with count N, or traceroute only).` };
  }

  // `devices` ([{ip,name}]) comes from the inventory API (see agentTools.js);
  // fall back to explicit IPs, then to the app's configured SSH sessions.
  const byHost = new Map();
  if (Array.isArray(devices) && devices.length) {
    for (const d of devices) if (d?.ip) byHost.set(String(d.ip).trim(), d.name || d.ip);
  } else if (Array.isArray(device_ips) && device_ips.length) {
    const known = new Map(sessions.filter((s) => s.protocol === "ssh" && s.host).map((s) => [s.host, s.name]));
    for (const ip of device_ips) byHost.set(String(ip).trim(), known.get(String(ip).trim()) || String(ip).trim());
  } else {
    for (const s of sessions) if (s.protocol === "ssh" && s.host) byHost.set(s.host, s.name);
  }
  const targets = [...byHost.keys()];
  if (targets.length === 0) return { error: "No target devices found to scan." };
  if (targets.length > BULK_MAX_DEVICES) {
    return { error: `Refusing to scan ${targets.length} devices in one run (limit ${BULK_MAX_DEVICES}). Narrow the list or split into batches.` };
  }
  if (!defaultCredentials.username && targets.some((ip) => !findLiveSshConnectionByHost(ip))) {
    return { error: "No default credentials are stored in the desktop app, so devices without an open tab can't be reached. Set default credentials in Settings." };
  }

  const needle = match_text ? String(match_text).toLowerCase() : "";
  const results = new Array(targets.length);
  let next = 0;

  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const ip = targets[i];
      const name = byHost.get(ip) || ip;
      try {
        const res = findLiveSshConnectionByHost(ip)
          ? await runDeviceShowCommandQueued(ip, cmd)
          : await execBackground(ip, cmd);
        if (res.error && !res.output) {
          results[i] = { name, status: "error", detail: res.error };
          continue;
        }
        const lines = String(res.output || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const shown = needle ? lines.filter((l) => l.toLowerCase().includes(needle)) : lines;
        results[i] = { name, status: needle ? (shown.length ? "match" : "no_match") : "ok", lines: shown };
      } catch (err) {
        results[i] = { name, status: "error", detail: err.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, worker));

  const matched = results.filter((r) => r.status === "match" || (!needle && r.status === "ok"));
  const none = results.filter((r) => r.status === "no_match");
  const errors = results.filter((r) => r.status === "error");

  const out = [
    `Bulk run of "${cmd}" on ${targets.length} device(s)${needle ? `, filtering for "${match_text}"` : ""}: ${matched.length} ${needle ? "with matches" : "returned output"}, ${none.length} without, ${errors.length} failed.`,
  ];
  if (matched.length) {
    out.push("", needle ? "WITH MATCHES:" : "OUTPUT:");
    for (const r of matched) {
      const extra = r.lines.length > BULK_MAX_LINES_PER_DEVICE ? `\n  ... (${r.lines.length - BULK_MAX_LINES_PER_DEVICE} more lines)` : "";
      out.push(`- ${r.name}:\n  ${r.lines.slice(0, BULK_MAX_LINES_PER_DEVICE).join("\n  ") || "(no output)"}${extra}`);
    }
  }
  if (none.length) out.push("", `NO MATCH: ${none.map((r) => r.name).join(", ")}`);
  if (errors.length) {
    out.push("", "FAILED (could not be checked — not the same as no match):");
    for (const r of errors) out.push(`- ${r.name}: ${r.detail}`);
  }
  return { output: out.join("\n") };
}

// ---------------------------------------------------------------------
// AI chat — runs the RAG agent in-process (see initRag() above). Used to
// spawn chatOnce.js as a subprocess and talk to it over a line-JSON
// stdin/stdout protocol; now it's a plain awaited function call, and the
// one tool that needs this process (run_show_command) is wired up once
// via registerLiveCommandHandler instead of a per-message RPC exchange.
// ---------------------------------------------------------------------
ipcMain.handle("ai:chat", async (_event, payload) => {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) return { ok: false, error: "No messages provided." };
  if (!ragApi) {
    return { ok: false, error: "The AI assistant is still starting up — please try again in a moment." };
  }

  // Streams the answer to the renderer as it's generated (OpenRouter/K2
  // Horizon only — see chatWithTools in rag/lib/llm.js; llama/gemini just
  // never call this) via a side-channel IPC event, purely so the chat
  // feels responsive instead of sitting on "Thinking..." until the whole
  // answer is done. The invoke call below still resolves with the
  // complete, authoritative answer at the end regardless — the renderer
  // uses THAT as the real final text, so a dropped or out-of-order token
  // event here is harmless, never a correctness issue.
  const onToken = (text) => {
    mainWindow?.webContents.send("ai:chatToken", { text });
  };

  // Fires on every tool call the agent makes (knowledge search, device
  // lookups, live diagnostics, ...), for every provider — unlike onToken
  // above, this doesn't depend on the model supporting token streaming,
  // since it's driven by the tool loop itself (see describeToolCall in
  // rag/lib/agentLoop.js). Purely a "what's it doing right now" UI
  // affordance; never affects the actual answer.
  // Also counts the events — one fires per tool call actually executed — so
  // the reply can say how many tools really ran. A model sometimes
  // "answers" a data question (e.g. run X on all nodes) without calling any
  // tool and invents plausible output; the count makes that visible.
  let toolCallCount = 0;
  const onStatus = (status) => {
    toolCallCount += 1;
    mainWindow?.webContents.send("ai:chatStatus", { status });
  };

  let timer;
  try {
    const answer = await Promise.race([
      // chatFn/dropToolsAfterFirstRound are NOT passed here — runFullAgent
      // resolves those itself from AGENT_LLM_PROVIDER (see
      // resolveAgentProvider in fullAgent.js), which the model picker in
      // the sidebar drives via applyAiProviderEnv above. This used to be
      // hardcoded to OpenRouter here, which meant the picker never
      // actually changed what model answered the main chat — only the
      // internal live-diagnostics sub-agent (LIVE_PROVIDER, resolved
      // separately) ever responded to it.
      ragApi.runFullAgent(messages, { onToken, onStatus }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Agent timed out (took longer than 6 minutes).")),
          AI_AGENT_TIMEOUT_MS
        );
      }),
    ]);
    return { ok: true, answer, toolCalls: toolCallCount };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
});

// Wipes the vector index and re-ingests every knowledge file currently
// on disk from scratch. This is the only way to fully purge a bad
// Triggers a full wipe + re-ingest on the SHARED knowledge-server (see
// knowledge-server/ in the junos-rag-assistant project) rather than
// rebuilding a local per-user index — one rebuild here updates the index
// every engineer's app queries. Requires KNOWLEDGE_ADMIN_KEY in .env
// (separate from the everyday KNOWLEDGE_API_KEY used for search/
// corrections) — leave that blank on non-admin machines; the button will
// just explain it's not configured rather than silently failing.
async function rebuildKnowledgeIndex() {
  if (!process.env.KNOWLEDGE_API_HOST || !process.env.KNOWLEDGE_ADMIN_KEY) {
    throw new Error(
      "Rebuild Index needs KNOWLEDGE_API_HOST and KNOWLEDGE_ADMIN_KEY set in .env (the admin key is separate from the everyday KNOWLEDGE_API_KEY) — ask whoever administers the shared knowledge server for it."
    );
  }
  const res = await fetch(`${process.env.KNOWLEDGE_API_HOST}/rebuild-index`, {
    method: "POST",
    headers: { "x-admin-key": process.env.KNOWLEDGE_ADMIN_KEY },
  });
  if (!res.ok) {
    throw new Error(`Rebuild failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { fileCount: data.fileCount, chunkCount: data.chunkCount, failed: data.failed };
}

ipcMain.handle("ai:rebuildKnowledgeIndex", async () => {
  if (!ragApi) {
    return { ok: false, error: "The AI assistant is still starting up — please try again in a moment." };
  }
  try {
    const result = await rebuildKnowledgeIndex();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Queries the local llama-server's own OpenAI-compatible /v1/models
// endpoint for whatever presets it currently has defined (see its
// --models-preset presets.ini) — lets the sidebar's local-model dropdown
// populate itself from whatever the server actually has, instead of a
// hardcoded list that goes stale every time a preset is added/removed.
ipcMain.handle("ai:listLocalModels", async () => {
  const host = process.env.LLM_HOST;
  if (!host) return { ok: false, error: "LLM_HOST is not configured." };

  try {
    const res = await fetch(`${host}/v1/models`, {
      headers: process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {},
    });
    if (!res.ok) return { ok: false, error: `Server returned ${res.status}: ${await res.text()}` };
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- AI chat history — stored on the shared knowledge-server, keyed by
// defaultCredentials.username, not a per-machine local file. This is what
// makes a chat follow an engineer to whichever machine they're using (and
// what lets a lead review usage via the server's /admin/chats routes) —
// see knowledge-server/lib/chatStore.js. All four handlers share the same
// "is this even configured" guard and a small fetch wrapper.
function knowledgeChatUsername() {
  return String(defaultCredentials?.username || "").trim();
}

async function knowledgeChatFetch(urlPath, options = {}) {
  if (!process.env.KNOWLEDGE_API_HOST || !process.env.KNOWLEDGE_API_KEY) {
    throw new Error(
      "Chat history needs the shared knowledge base configured (missing KNOWLEDGE_API_HOST/KNOWLEDGE_API_KEY in .env)."
    );
  }
  const username = knowledgeChatUsername();
  if (!username) {
    throw new Error(
      "Chat history needs a username — set your default SSH username in Settings first (it's what your chats are stored under)."
    );
  }
  const url = new URL(`${process.env.KNOWLEDGE_API_HOST}${urlPath}`);
  url.searchParams.set("username", username);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", "x-api-key": process.env.KNOWLEDGE_API_KEY, ...options.headers },
    });
  } catch (err) {
    // A bare "fetch failed" (Node/undici's generic message) hides the
    // actual reason — connection refused, DNS failure, wrong port, etc.
    // lives in err.cause, not err.message. Surface it so this is actually
    // diagnosable from the error text alone.
    throw new Error(`Could not reach the shared knowledge base at ${url.origin}: ${err.cause?.message || err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Knowledge server returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

ipcMain.handle("ai:chats:list", async () => {
  try {
    const { chats } = await knowledgeChatFetch("/chats");
    return { ok: true, chats };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("ai:chats:get", async (_event, payload) => {
  try {
    const { chat } = await knowledgeChatFetch(`/chats/${encodeURIComponent(payload?.id)}`);
    return { ok: true, chat };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("ai:chats:save", async (_event, payload) => {
  const messages = Array.isArray(payload?.messages)
    ? payload.messages.filter(
        (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      )
    : [];
  try {
    const { chat } = await knowledgeChatFetch("/chats", {
      method: "POST",
      body: JSON.stringify({ username: knowledgeChatUsername(), id: payload?.id, title: payload?.title, messages }),
    });
    return { ok: true, chat };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("ai:chats:delete", async (_event, payload) => {
  try {
    await knowledgeChatFetch(`/chats/${encodeURIComponent(payload?.id)}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
