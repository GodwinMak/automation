const terminalPanel = document.getElementById("terminal-panel");
const terminalSessions = new Map();

const AI_PROVIDERS = ["llama", "openrouter", "gemini", "k2horizon"];
const settingsState = {
  mode: "dark",
  textColor: "#e5e2e1",
  aiProvider: "llama",
  localModel: "",
};

async function loadSettings() {
  try {
    const result = await window.terminalCore.getSettings();
    if (!result.ok || !result.data) return;
    settingsState.mode = result.data.mode === "light" ? "light" : "dark";
    settingsState.textColor = typeof result.data.textColor === "string" ? result.data.textColor : "#e5e2e1";
    settingsState.aiProvider = AI_PROVIDERS.includes(result.data.aiProvider) ? result.data.aiProvider : "llama";
    settingsState.localModel = typeof result.data.localModel === "string" ? result.data.localModel : "";
  } catch (_err) {
    // Ignore invalid stored settings.
  }
}

async function saveSettings() {
  await window.terminalCore.setSettings(settingsState);
}

function getTerminalTheme() {
  const isLight = settingsState.mode === "light";
  const text = settingsState.textColor;
  return {
    background: isLight ? "#ffffff" : "#0e0e0e",
    foreground: text,
    cursor: isLight ? "#166534" : "#4af626",
    selectionBackground: isLight ? "#dbeafe" : "#1f2937",
    black: text,
    red: text,
    green: text,
    yellow: text,
    blue: text,
    magenta: text,
    cyan: text,
    white: text,
    brightBlack: text,
    brightRed: text,
    brightGreen: text,
    brightYellow: text,
    brightBlue: text,
    brightMagenta: text,
    brightCyan: text,
    brightWhite: text,
  };
}

function applyVisualSettings() {
  document.body.classList.toggle("theme-light", settingsState.mode === "light");
  terminalSessions.forEach(({ term }) => {
    term.setOption("theme", getTerminalTheme());
  });

  const preview = document.getElementById("settings-color-preview");
  if (preview) {
    preview.style.color = settingsState.textColor;
  }
}

function createTerminal(tabId) {
  const wrapper = document.createElement("div");
  wrapper.className = "w-full h-full";
  wrapper.style.display = "none";
  terminalPanel.appendChild(wrapper);

  const term = new window.Terminal({
    cursorBlink: true,
    fontFamily: "JetBrains Mono",
    fontSize: 13,
    theme: getTerminalTheme(),
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(wrapper);
  fitAddon.fit();

  wrapper.addEventListener("contextmenu", async (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    await handleTerminalContextAction();
  });

  term.onData(async (data) => {
    const active = getActiveTab();
    if (!active || active.id !== tabId || !active.connected) return;
    await window.terminalCore.send({ tabId, data });
  });

  const terminal = { wrapper, term, fitAddon };
  terminalSessions.set(tabId, terminal);
  return terminal;
}

function getOrCreateTerminal(tabId) {
  return terminalSessions.get(tabId) || createTerminal(tabId);
}

function getTerminal(tabId) {
  return terminalSessions.get(tabId) || null;
}

function getActiveTerminal() {
  if (!state.activeTabId) return null;
  return getTerminal(state.activeTabId);
}

async function copyFromActiveTerminal() {
  const activeTerminal = getActiveTerminal();
  if (!activeTerminal) return false;

  const selectedText = activeTerminal.term.getSelection() || String(window.getSelection?.() || "").trim();
  if (!selectedText) return false;

  await window.terminalCore.clipboardWriteText(selectedText);
  setStatus("Copied selection", "READY");
  return true;
}

async function pasteToActiveTerminal() {
  const active = getActiveTab();
  const activeTerminal = getActiveTerminal();
  if (!active || !active.connected || !activeTerminal) return false;

  const text = await window.terminalCore.clipboardReadText();
  if (!text) return false;

  await window.terminalCore.send({ tabId: active.id, data: text });
  return true;
}

async function handleTerminalContextAction() {
  const copied = await copyFromActiveTerminal();
  if (!copied) {
    await pasteToActiveTerminal();
  }
}

function showActiveTerminal() {
  terminalSessions.forEach((terminal, tabId) => {
    terminal.wrapper.style.display = tabId === state.activeTabId ? "block" : "none";
  });

  const activeTerminal = getActiveTerminal();
  if (activeTerminal) {
    activeTerminal.fitAddon.fit();
    activeTerminal.term.focus();
  }
}

function clearTerminal(tabId) {
  const terminal = getTerminal(tabId);
  if (!terminal) return;
  terminal.term.clear();
}

function disposeTerminal(tabId) {
  const terminal = getTerminal(tabId);
  if (!terminal) return;
  terminal.term.dispose();
  terminal.wrapper.remove();
  terminalSessions.delete(tabId);
}

function clearAllTerminals() {
  terminalSessions.forEach((terminal) => {
    terminal.term.dispose();
    terminal.wrapper.remove();
  });
  terminalSessions.clear();
  terminalPanel.innerHTML = "";
}

function writeToTab(tabId, message) {
  const terminal = getOrCreateTerminal(tabId);
  terminal.term.writeln(message);
}

const state = {
  sessions: [],
  tabs: [],
  activeTabId: null,
};

const sessionList = document.getElementById("session-list");
const tabBar = document.getElementById("tab-bar");
const statusLeft = document.getElementById("status-left");
const statusRight = document.getElementById("status-right");
const quickConnectModal = document.getElementById("quick-connect-modal");
const quickConnectName = document.getElementById("qc-name");
const quickConnectHostname = document.getElementById("qc-hostname");
const quickConnectUsername = document.getElementById("qc-username");
const quickConnectPort = document.getElementById("qc-port");
const quickConnectProtocol = document.getElementById("qc-protocol");
const quickConnectTargetGroup = document.getElementById("qc-target-group");
const quickConnectPassword = document.getElementById("qc-password");
const quickConnectSave = document.getElementById("qc-save");
const quickConnectCredentialsBlock = document.getElementById("qc-credentials-block");
const quickConnectCredentialsHint = document.getElementById("qc-credentials-hint");
const productionSearchInput = document.getElementById("production-search");
const credentialsModal = document.getElementById("credentials-modal");
const openCredentialsModalBtn = document.getElementById("open-credentials-modal");
const credentialsUsernameInput = document.getElementById("cred-username");
const credentialsPasswordInput = document.getElementById("cred-password");
const settingsModal = document.getElementById("settings-modal");
const openSettingsModalBtn = document.getElementById("open-settings-modal");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsCancelBtn = document.getElementById("settings-cancel");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsTextColorInput = document.getElementById("setting-text-color");
const rebuildIndexBtn = document.getElementById("rebuild-index-btn");
const rebuildIndexStatus = document.getElementById("rebuild-index-status");
const aiProviderSelect = document.getElementById("ai-provider-select");
const localModelSelect = document.getElementById("ai-local-model-select");

function updateLocalModelSelectAvailability() {
  if (!localModelSelect || !aiProviderSelect) return;
  localModelSelect.disabled = aiProviderSelect.value !== "llama";
}

// Populates the "Local" dropdown from the llama-server's own /v1/models
// endpoint (whatever it currently has in its --models-preset presets.ini)
// instead of a hardcoded list, so adding/removing a preset on the server
// shows up here without an app update. Best-effort: if the server isn't
// reachable (e.g. LLM_HOST unset, or it's simply not running right now),
// leaves just the "(default)" option rather than erroring the whole UI.
async function populateLocalModelOptions() {
  if (!localModelSelect) return;
  try {
    const result = await window.aiAssistant.listLocalModels();
    if (!result.ok || !Array.isArray(result.models)) return;
    for (const modelId of result.models) {
      if (!modelId || localModelSelect.querySelector(`option[value="${CSS.escape(modelId)}"]`)) continue;
      const opt = document.createElement("option");
      opt.value = modelId;
      opt.textContent = modelId;
      localModelSelect.appendChild(opt);
    }
    if (settingsState.localModel && localModelSelect.querySelector(`option[value="${CSS.escape(settingsState.localModel)}"]`)) {
      localModelSelect.value = settingsState.localModel;
    }
  } catch (_err) {
    // Server unreachable — leave the dropdown at just "(default)".
  }
}
const favoritesToggle = document.getElementById("favorites-toggle");
const favoritesChevron = document.getElementById("favorites-chevron");
const favoritesList = document.getElementById("favorites-list");
const otherDevicesChevron = document.getElementById("other-devices-chevron");
const otherSessionList = document.getElementById("other-session-list");

const credentialsState = {
  username: "sysadmin",
  password: "",
};

const uiState = {
  favoritesExpanded: true,
  otherDevicesExpanded: true,
};

const closingTabIds = new Set();

function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function setStatus(text, right = "IDLE") {
  statusLeft.textContent = text;
  statusRight.textContent = right;
}

function renderSessions() {
  sessionList.innerHTML = "";
  otherSessionList.innerHTML = "";

  const query = (productionSearchInput?.value || "").trim().toLowerCase();
  const mainSessions = state.sessions.filter((s) => s.group === "Main Devices" || s.group === "Production");
  const otherSessions = state.sessions.filter((s) => !(s.group === "Main Devices" || s.group === "Production"));

  if (otherDevicesChevron) {
    otherDevicesChevron.textContent = uiState.otherDevicesExpanded
      ? "keyboard_arrow_down"
      : "keyboard_arrow_right";
  }
  otherSessionList.classList.toggle("hidden", !uiState.otherDevicesExpanded);

  if (!query) {
    const emptyHint = document.createElement("div");
    emptyHint.className = "px-2 py-2 text-[11px] text-on-surface-variant font-terminal-sm";
    emptyHint.textContent = "Type in search to find Main Devices";
    // sessionList.appendChild(emptyHint);
  } else {
    const filteredMain = mainSessions.filter((s) =>
      s.name.toLowerCase().includes(query) ||
      String(s.host || "").toLowerCase().includes(query)
    );

    if (!filteredMain.length) {
      const noMatch = document.createElement("div");
      noMatch.className = "px-2 py-2 text-[11px] text-on-surface-variant font-terminal-sm";
      noMatch.textContent = "No matching Main Device";
      sessionList.appendChild(noMatch);
    } else {
      filteredMain.forEach((s) => {
        sessionList.appendChild(buildSessionRow(s));
      });
    }
  }

  if (uiState.otherDevicesExpanded) {
    otherSessions.forEach((s) => {
      otherSessionList.appendChild(buildSessionRow(s));
    });
  }
}

function buildSessionRow(s) {
    const row = document.createElement("button");
    row.className = "session-item w-full text-left flex items-center justify-between px-2 py-1 hover:bg-surface-variant rounded cursor-pointer group";
    row.dataset.id = s.id;
    row.innerHTML = `
      <span class="flex items-center space-x-2 text-on-surface">
        <span class="material-symbols-outlined text-[14px] ${s.connected ? "text-primary-fixed" : "text-on-surface-variant"}">dns</span>
        <span class="font-terminal-sm text-terminal-sm">${s.name} (${s.host})</span>
      </span>
      <span class="flex items-center gap-2">
        <button class="remove-btn p-0.5 rounded hover:bg-surface-container text-on-surface-variant" title="Remove device">
          <span class="material-symbols-outlined text-[14px] hover:text-error">delete</span>
        </button>
        <button class="favorite-btn p-0.5 rounded hover:bg-surface-container text-on-surface-variant" title="Toggle favorite">
          <span class="material-symbols-outlined text-[14px] ${s.favorite ? "text-primary-fixed" : "text-on-surface-variant"}">${s.favorite ? "star" : "star_outline"}</span>
        </button>
        <span class="w-1.5 h-1.5 rounded-full ${s.connected ? "bg-primary-container" : "bg-outline"}"></span>
      </span>
    `;

    if (state.activeTabId === s.id) row.classList.add("active");

    row.addEventListener("click", async () => {
      openTab(s);
      renderSessions();

      const tab = state.tabs.find((t) => t.id === s.id);
      if (!tab || tab.connected) return;

      await connectSession(tab);
    });

    row.querySelector(".favorite-btn").addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();

      const toggled = await window.terminalCore.toggleFavorite({ sessionId: s.id });
      if (!toggled.ok) {
        setStatus("Failed to update favorite", "ERROR");
        return;
      }

      const session = state.sessions.find((x) => x.id === s.id);
      if (session) {
        session.favorite = Boolean(toggled.favorite);
      }
      renderFavoritesDropdown();
      renderSessions();
    });

    row.querySelector(".remove-btn").addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();

      const ok = window.confirm(`Remove device '${s.name}' from list?`);
      if (!ok) return;

      const removed = await window.terminalCore.removeSession({ sessionId: s.id });
      if (!removed.ok) {
        setStatus(removed.error || "Failed to remove device", "ERROR");
        return;
      }

      const tabIndex = state.tabs.findIndex((t) => t.id === s.id);
      if (tabIndex !== -1) {
        const tab = state.tabs[tabIndex];
        const wasActive = state.activeTabId === tab.id;
        closingTabIds.add(tab.id);
        await window.terminalCore.disconnect({ tabId: tab.id });
        state.tabs.splice(tabIndex, 1);
        if (state.activeTabId === tab.id) {
          state.activeTabId = state.tabs[0]?.id || null;
        }
        if (wasActive || !state.activeTabId) clearTerminal(tab.id);
        disposeTerminal(tab.id);
        closingTabIds.delete(tab.id);
      }

      state.sessions = state.sessions.filter((x) => x.id !== s.id);
      if (!state.tabs.length) {
        clearAllTerminals();
        setStatus("SSH: Not Connected", "IDLE");
      }
      renderTabs();
      renderFavoritesDropdown();
      renderSessions();
      showActiveTerminal();
      setStatus(`Removed device: ${s.name}`, "READY");
    });

  return row;
}

function renderFavoritesDropdown() {
  if (!favoritesList) return;

  favoritesList.innerHTML = "";
  favoritesChevron.textContent = uiState.favoritesExpanded
    ? "keyboard_arrow_down"
    : "keyboard_arrow_right";
  favoritesList.classList.toggle("hidden", !uiState.favoritesExpanded);

  if (!uiState.favoritesExpanded) return;

  const favorites = state.sessions.filter((s) => s.favorite);
  if (!favorites.length) {
    const empty = document.createElement("div");
    empty.className = "px-2 py-1 text-[11px] text-on-surface-variant font-terminal-sm";
    empty.textContent = "No favorites yet";
    favoritesList.appendChild(empty);
    return;
  }

  favorites.forEach((s) => {
    const row = document.createElement("button");
    row.className = "w-full text-left flex items-center justify-between px-2 py-1 hover:bg-surface-variant rounded cursor-pointer";
    row.innerHTML = `
      <span class="flex items-center space-x-2 text-on-surface">
        <span class="material-symbols-outlined text-[14px] text-primary-fixed">star</span>
        <span class="font-terminal-sm text-terminal-sm">${s.name}</span>
      </span>
      <span class="w-1.5 h-1.5 rounded-full ${s.connected ? "bg-primary-container" : "bg-outline"}"></span>
    `;

    row.addEventListener("click", async () => {
      openTab(s);
      renderTabs();
      renderSessions();

      const tab = state.tabs.find((t) => t.id === s.id);
      if (!tab || tab.connected) return;

      await connectSession(tab);
    });

    favoritesList.appendChild(row);
  });
}

function renderTabs() {
  tabBar.innerHTML = "";

  if (!state.tabs.length) return;

  state.tabs.forEach((t) => {
    const tab = document.createElement("div");
    tab.className = "tab-item flex items-center space-x-2 px-4 py-1.5 border-r border-outline-variant min-w-max cursor-pointer";
    if (t.id === state.activeTabId) tab.classList.add("active");

    tab.innerHTML = `
      <span class="w-1.5 h-1.5 rounded-full ${t.connected ? "bg-primary-container" : "bg-outline"}"></span>
      <span class="font-terminal-sm text-terminal-sm text-on-surface">${t.name}</span>
      <button class="close-tab w-4 h-4 rounded flex items-center justify-center hover:bg-surface-container text-on-surface-variant">
        <span class="material-symbols-outlined text-[14px]">close</span>
      </button>
    `;

    tab.addEventListener("click", () => {
      state.activeTabId = t.id;
      renderTabs();
      renderSessions();
      showActiveTerminal();
      if (t.connected) {
        const protocol = String(t.protocol || "ssh").toLowerCase() === "telnet" ? "TELNET" : "SSH";
        const connectedText = protocol === "TELNET"
          ? `TELNET: ${t.host}:${t.port || 23}`
          : `SSH: ${t.username}@${t.host}`;
        setStatus(connectedText, "CONNECTED");
      } else {
        setStatus("SSH: Not Connected", "READY");
      }
    });

    tab.querySelector(".close-tab").addEventListener("click", async (evt) => {
      evt.stopPropagation();
      const wasActive = state.activeTabId === t.id;
      closingTabIds.add(t.id);
      await window.terminalCore.disconnect({ tabId: t.id });
      state.tabs = state.tabs.filter((x) => x.id !== t.id);
      if (state.activeTabId === t.id) {
        state.activeTabId = state.tabs[0]?.id || null;
      }
      if (wasActive || !state.activeTabId) clearTerminal(t.id);
      disposeTerminal(t.id);
      closingTabIds.delete(t.id);
      if (!state.tabs.length) {
        clearAllTerminals();
        setStatus("SSH: Not Connected", "IDLE");
      }
      renderTabs();
      renderFavoritesDropdown();
      renderSessions();
      showActiveTerminal();
    });

    tabBar.appendChild(tab);
  });
}

function openTab(session) {
  const found = state.tabs.find((t) => t.id === session.id);
  if (!found) {
    state.tabs.push({ ...session, connected: false });
    getOrCreateTerminal(session.id);
  }
  state.activeTabId = session.id;
  renderTabs();
  showActiveTerminal();
}

function showQuickConnectModal() {
  applyQuickConnectRules();
  quickConnectModal.classList.remove("hidden");
  quickConnectModal.classList.add("flex");
  setTimeout(() => quickConnectName.focus(), 50);
}

function hideQuickConnectModal() {
  quickConnectModal.classList.add("hidden");
  quickConnectModal.classList.remove("flex");
}

async function connectSession(session, passwordOverride) {
  const protocol = String(session.protocol || "ssh").toLowerCase() === "telnet" ? "telnet" : "ssh";
  const isMain = session.group === "Main Devices" || session.group === "Production";
  const username = isMain
    ? ((credentialsState.username || "").trim() || session.username)
    : (session.username || "").trim();
  const password = passwordOverride !== undefined
    ? passwordOverride
    : (isMain ? (credentialsState.password || "") : (session.password || ""));

  if (protocol === "ssh" && (!username || !password)) {
    setStatus(isMain ? "Saved system credentials are required for SSH" : "Other Devices SSH requires device username/password", "ERROR");
    return;
  }

  if (protocol === "telnet") {
    setStatus(`TELNET: connecting ${session.host}:${session.port || 23}...`, "CONNECTING");
  } else {
    setStatus(`SSH: connecting ${username}@${session.host}...`, "CONNECTING");
  }
  writeToTab(session.id, `\r\nConnecting to ${session.name} (${session.host})...`);

  const result = await window.terminalCore.connect({
    tabId: session.id,
    protocol,
    host: session.host,
    port: session.port,
    username: protocol === "ssh" ? username : undefined,
    password,
  });

  if (!result.ok) {
    setStatus("SSH: Connection failed", "ERROR");
    writeToTab(session.id, `Connection failed: ${result.error || "unknown error"}`);
    return;
  }

  const tab = state.tabs.find((t) => t.id === session.id);
  if (tab) {
    tab.connected = true;
    tab.username = username;
  }
  const knownSession = state.sessions.find((s) => s.id === session.id);
  if (knownSession) {
    knownSession.connected = true;
    knownSession.username = username;
  }
  if (protocol === "telnet") {
    setStatus(`TELNET: ${session.host}:${session.port || 23}`, "CONNECTED");
  } else {
    setStatus(`SSH: ${username}@${session.host}`, "CONNECTED");
  }
  renderTabs();
  renderFavoritesDropdown();
  renderSessions();
  showActiveTerminal();
  const terminal = getTerminal(session.id);
  if (!terminal) return;
  await window.terminalCore.resize({
    tabId: session.id,
    cols: terminal.term.cols,
    rows: terminal.term.rows,
  });
}

async function doConnect() {
  const active = getActiveTab();
  if (!active) {
    return;
  }
  await connectSession(active);
}

async function doDisconnect() {
  const active = getActiveTab();
  if (!active || !active.connected) return;
  await window.terminalCore.disconnect({ tabId: active.id });
  const tab = state.tabs.find((t) => t.id === active.id);
  if (tab) tab.connected = false;
  const session = state.sessions.find((s) => s.id === active.id);
  if (session) session.connected = false;
  setStatus("SSH: Disconnected", "IDLE");
  renderTabs();
  renderFavoritesDropdown();
  renderSessions();
}

window.terminalCore.onData(({ tabId, data }) => {
  const terminal = getOrCreateTerminal(tabId);
  terminal.term.write(data);
});

window.terminalCore.onClosed(({ tabId }) => {
  if (closingTabIds.has(tabId)) return;

  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab) tab.connected = false;
  if (state.activeTabId === tabId) {
    writeToTab(tabId, "\r\nConnection closed.");
    setStatus("Disconnected", "IDLE");
  }
  renderTabs();
  renderFavoritesDropdown();
  renderSessions();
});

window.addEventListener("resize", async () => {
  const active = getActiveTab();
  if (!active || !active.connected) return;
  const terminal = getActiveTerminal();
  if (!terminal) return;
  terminal.fitAddon.fit();
  await window.terminalCore.resize({
    tabId: active.id,
    cols: terminal.term.cols,
    rows: terminal.term.rows,
  });
});

document.getElementById("btn-connect").addEventListener("click", doConnect);
document.getElementById("btn-disconnect").addEventListener("click", doDisconnect);
productionSearchInput.addEventListener("input", renderSessions);
favoritesToggle.addEventListener("click", () => {
  uiState.favoritesExpanded = !uiState.favoritesExpanded;
  renderFavoritesDropdown();
});

if (otherDevicesChevron) {
  otherDevicesChevron.addEventListener("click", () => {
    uiState.otherDevicesExpanded = !uiState.otherDevicesExpanded;
    renderSessions();
  });
}

const quickConnectBtn = document.getElementById("btn-quick-connect");
if (quickConnectBtn) {
  quickConnectBtn.addEventListener("click", showQuickConnectModal);
}
document.getElementById("btn-new-session").addEventListener("click", showQuickConnectModal);

document.getElementById("qc-close").addEventListener("click", hideQuickConnectModal);
document.getElementById("qc-cancel").addEventListener("click", hideQuickConnectModal);

quickConnectModal.addEventListener("click", (evt) => {
  if (evt.target === quickConnectModal) hideQuickConnectModal();
});

function applyQuickConnectRules() {
  const group = quickConnectTargetGroup.value;
  const protocol = quickConnectProtocol.value;

  if (group === "Main Devices") {
    quickConnectProtocol.value = "ssh";
    quickConnectProtocol.disabled = true;
    quickConnectUsername.disabled = true;
    quickConnectPassword.disabled = true;
    quickConnectPort.value = "22";
    quickConnectPort.disabled = true;
    quickConnectCredentialsHint.textContent = "Main Devices uses saved system credentials.";
    quickConnectCredentialsBlock.classList.add("opacity-70");
    return;
  }

  quickConnectProtocol.disabled = false;
  quickConnectPort.disabled = false;

  if (protocol === "telnet") {
    quickConnectPort.value = quickConnectPort.value || "23";
    quickConnectUsername.disabled = true;
    quickConnectPassword.disabled = true;
    quickConnectCredentialsHint.textContent = "Telnet does not require username/password in this form.";
    quickConnectCredentialsBlock.classList.add("opacity-70");
  } else {
    if (!quickConnectPort.value || Number(quickConnectPort.value) === 23) {
      quickConnectPort.value = "22";
    }
    quickConnectUsername.disabled = false;
    quickConnectPassword.disabled = false;
    quickConnectCredentialsHint.textContent = "Other Devices SSH uses its own username/password (unique per device).";
    quickConnectCredentialsBlock.classList.remove("opacity-70");
  }
}

quickConnectTargetGroup.addEventListener("change", applyQuickConnectRules);
quickConnectProtocol.addEventListener("change", applyQuickConnectRules);

function showCredentialsModal() {
  credentialsUsernameInput.value = credentialsState.username || "";
  credentialsPasswordInput.value = credentialsState.password || "";
  credentialsModal.classList.remove("hidden");
  credentialsModal.classList.add("flex");
  setTimeout(() => credentialsUsernameInput.focus(), 50);
}

function hideCredentialsModal() {
  credentialsModal.classList.add("hidden");
  credentialsModal.classList.remove("flex");
}

function showSettingsModal() {
  const modeInput = document.querySelector(`input[name="theme-mode"][value="${settingsState.mode}"]`);
  if (modeInput) modeInput.checked = true;
  settingsTextColorInput.value = settingsState.textColor;
  const preview = document.getElementById("settings-color-preview");
  if (preview) preview.style.color = settingsState.textColor;
  settingsModal.classList.remove("hidden");
  settingsModal.classList.add("flex");
}

function hideSettingsModal() {
  settingsModal.classList.add("hidden");
  settingsModal.classList.remove("flex");
}

openCredentialsModalBtn.addEventListener("click", showCredentialsModal);
openSettingsModalBtn.addEventListener("click", showSettingsModal);
document.getElementById("cred-close").addEventListener("click", hideCredentialsModal);
document.getElementById("cred-cancel").addEventListener("click", hideCredentialsModal);
settingsCloseBtn.addEventListener("click", hideSettingsModal);
settingsCancelBtn.addEventListener("click", hideSettingsModal);

credentialsModal.addEventListener("click", (evt) => {
  if (evt.target === credentialsModal) hideCredentialsModal();
});

settingsModal.addEventListener("click", (evt) => {
  if (evt.target === settingsModal) hideSettingsModal();
});

settingsTextColorInput.addEventListener("input", () => {
  const preview = document.getElementById("settings-color-preview");
  if (preview) preview.style.color = settingsTextColorInput.value;
});

if (aiProviderSelect) {
  aiProviderSelect.addEventListener("change", async () => {
    settingsState.aiProvider = AI_PROVIDERS.includes(aiProviderSelect.value) ? aiProviderSelect.value : "llama";
    await saveSettings();
    updateLocalModelSelectAvailability();
    setStatus(`Model switched to ${aiProviderSelect.options[aiProviderSelect.selectedIndex].text}`, "READY");
  });
}

if (localModelSelect) {
  localModelSelect.addEventListener("change", async () => {
    settingsState.localModel = localModelSelect.value || "";
    await saveSettings();
    const label = settingsState.localModel || "server default";
    setStatus(`Local model set to ${label}`, "READY");
  });
}

settingsSaveBtn.addEventListener("click", async () => {
  const modeInput = document.querySelector('input[name="theme-mode"]:checked');
  settingsState.mode = modeInput?.value === "light" ? "light" : "dark";
  settingsState.textColor = settingsTextColorInput.value || "#e5e2e1";
  applyVisualSettings();
  await saveSettings();
  setStatus("Display settings saved", "READY");
  hideSettingsModal();
});

if (rebuildIndexBtn) {
  rebuildIndexBtn.addEventListener("click", async () => {
    rebuildIndexBtn.disabled = true;
    const originalLabel = rebuildIndexBtn.textContent;
    rebuildIndexBtn.textContent = "Rebuilding...";
    if (rebuildIndexStatus) rebuildIndexStatus.textContent = "This can take a minute — re-embedding every knowledge file.";

    try {
      const result = await window.aiAssistant.rebuildKnowledgeIndex();
      if (!result.ok) {
        if (rebuildIndexStatus) rebuildIndexStatus.textContent = `Failed: ${result.error}`;
        setStatus("Knowledge index rebuild failed", "ERROR");
      } else {
        const failedNote = result.failed ? `, ${result.failed} failed` : "";
        if (rebuildIndexStatus) {
          rebuildIndexStatus.textContent = `Done — ${result.fileCount} file(s), ${result.chunkCount} chunk(s) indexed${failedNote}.`;
        }
        setStatus("Knowledge index rebuilt", "READY");
      }
    } catch (err) {
      if (rebuildIndexStatus) rebuildIndexStatus.textContent = `Failed: ${err.message}`;
      setStatus("Knowledge index rebuild failed", "ERROR");
    } finally {
      rebuildIndexBtn.disabled = false;
      rebuildIndexBtn.textContent = originalLabel;
    }
  });
}

document.getElementById("cred-save").addEventListener("click", async () => {
  const username = credentialsUsernameInput.value.trim();
  const password = credentialsPasswordInput.value;

  const result = await window.terminalCore.setCredentials({ username, password });
  if (!result.ok) {
    setStatus(result.error || "Failed to save credentials", "ERROR");
    return;
  }

  credentialsState.username = result.data.username;
  credentialsState.password = result.data.password;
  setStatus("Default credentials saved", "READY");
  hideCredentialsModal();
});

document.addEventListener("keydown", (evt) => {
  const isCtrlOrCmd = evt.ctrlKey || evt.metaKey;
  const key = String(evt.key || "").toLowerCase();

  if (isCtrlOrCmd && evt.shiftKey && key === "c") {
    if (evt.repeat) return;
    evt.preventDefault();
    evt.stopPropagation();
    void copyFromActiveTerminal();
    return;
  }

  if (isCtrlOrCmd && evt.shiftKey && key === "v") {
    if (evt.repeat) return;
    evt.preventDefault();
    evt.stopPropagation();
    void pasteToActiveTerminal();
    return;
  }

  if (evt.key === "Escape" && !quickConnectModal.classList.contains("hidden")) {
    hideQuickConnectModal();
    return;
  }

  if (evt.key === "Escape" && !settingsModal.classList.contains("hidden")) {
    hideSettingsModal();
  }
}, true);

document.getElementById("qc-connect").addEventListener("click", async () => {
  applyQuickConnectRules();

  const group = quickConnectTargetGroup.value;
  const protocol = quickConnectProtocol.value;
  const name = quickConnectName.value.trim();
  const host = quickConnectHostname.value.trim();
  const username = quickConnectUsername.value.trim();
  const port = Number(quickConnectPort.value || (protocol === "telnet" ? 23 : 22));
  const password = quickConnectPassword.value;
  const saveSession = quickConnectSave.checked;

  if (!name || !host) {
    setStatus("Quick Connect: name and IP are required", "ERROR");
    return;
  }

  if (group === "Main Devices" && (!(credentialsState.username || "").trim() || !credentialsState.password)) {
    setStatus("Saved system credentials are required for Main Devices SSH", "ERROR");
    return;
  }

  if (group === "Other Devices" && protocol === "ssh" && (!username || !password)) {
    setStatus("Other Devices SSH requires username and password", "ERROR");
    return;
  }

  const id = saveSession ? `sess-${Date.now()}` : `quick-${Date.now()}`;
  let newSession = {
    id,
    name,
    host,
    port,
    protocol,
    username: group === "Main Devices" ? credentialsState.username : username,
    password: group === "Other Devices" && protocol === "ssh" ? password : "",
    group,
    connected: false,
  };

  if (saveSession) {
    const persisted = await window.terminalCore.addSession(newSession);
    if (!persisted.ok) {
      setStatus("Failed to save session profile", "ERROR");
      const active = getActiveTab();
      if (active) {
        writeToTab(active.id, `\r\nFailed to save session profile: ${persisted.error || "unknown error"}`);
      }
      return;
    }
    newSession = persisted.session;
    state.sessions.unshift(newSession);
  }

  openTab(newSession);
  renderSessions();
  hideQuickConnectModal();
  await connectSession(newSession, group === "Main Devices" ? credentialsState.password : password);
  quickConnectName.value = "";
  quickConnectHostname.value = "";
  quickConnectUsername.value = "";
  quickConnectPassword.value = "";
});

// ---------------------------------------------------------------------
// AI Assistant sidebar
// ---------------------------------------------------------------------

const aiSidebar = document.getElementById("ai-sidebar");
const aiResizeHandle = document.getElementById("ai-resize-handle");
const aiMessages = document.getElementById("ai-messages");
const aiForm = document.getElementById("ai-form");
const aiInput = document.getElementById("ai-input");
const aiSend = document.getElementById("ai-send");
const btnToggleAi = document.getElementById("btn-toggle-ai");
const aiSidebarCloseBtn = document.getElementById("ai-sidebar-close");
const aiNewChatBtn = document.getElementById("ai-new-chat");
const aiHistoryToggleBtn = document.getElementById("ai-history-toggle");
const aiHistoryCloseBtn = document.getElementById("ai-history-close");
const aiHistoryPanel = document.getElementById("ai-history-panel");
const aiHistoryList = document.getElementById("ai-history-list");

const AI_SIDEBAR_MIN_WIDTH = 280;
const AI_SIDEBAR_MAX_WIDTH = 720;
const AI_SIDEBAR_DEFAULT_WIDTH = 360;

let aiConversation = []; // { role: "user" | "assistant", content: string }
// null = this chat hasn't been saved yet (brand new / not sent a turn
// yet). Once the first saveChat() call returns, this holds the server's
// generated id so every later save updates the SAME chat instead of
// creating a new one each turn.
let currentChatId = null;

function readStoredAiSidebarWidth() {
  const stored = Number(window.localStorage.getItem("aiSidebarWidth"));
  if (Number.isFinite(stored) && stored >= AI_SIDEBAR_MIN_WIDTH && stored <= AI_SIDEBAR_MAX_WIDTH) {
    return stored;
  }
  return AI_SIDEBAR_DEFAULT_WIDTH;
}

function setAiSidebarOpen(open) {
  aiSidebar.classList.toggle("hidden", !open);
  aiResizeHandle.classList.toggle("hidden", !open);
  window.localStorage.setItem("aiSidebarOpen", open ? "1" : "0");
  // Let the terminal re-fit into the newly resized main pane.
  window.dispatchEvent(new Event("resize"));
}

// Chat bubbles render as plain text (bubble.textContent, not HTML), but
// the model sometimes still writes markdown emphasis out of habit — strip
// the bold markers so they don't show up as literal ** characters. Applied
// at display time only — never to what's stored in aiConversation/history,
// so the actual text sent back to the model is untouched.
function stripMarkdown(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}

function appendAiMessage(role, content) {
  const bubble = document.createElement("div");
  bubble.className = role === "user"
    ? "ml-auto max-w-[88%] bg-primary-container/10 border border-primary-container/40 text-on-surface rounded-DEFAULT px-3 py-2 text-terminal-sm font-terminal-sm whitespace-pre-wrap break-words"
    : "mr-auto max-w-[88%] bg-surface-variant border border-outline-variant text-on-surface rounded-DEFAULT px-3 py-2 text-terminal-sm font-terminal-sm whitespace-pre-wrap break-words";
  bubble.textContent = role === "assistant" ? stripMarkdown(content) : content;
  aiMessages.appendChild(bubble);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return bubble;
}

// ---------------------------------------------------------------------
// Chat history — multiple named chats, stored on the shared knowledge-
// server (see main.js's ai:chats:* handlers), not just one running thread.
// ---------------------------------------------------------------------

function startNewChat() {
  aiConversation = [];
  currentChatId = null;
  aiMessages.innerHTML = "";
  aiInput.value = "";
  aiInput.style.height = "auto";
  aiInput.focus();
}

async function openChat(id) {
  const result = await window.aiAssistant.getChat(id);
  if (!result.ok || !result.chat) return;
  aiConversation = Array.isArray(result.chat.messages) ? result.chat.messages : [];
  currentChatId = result.chat.id;
  aiMessages.innerHTML = "";
  for (const m of aiConversation) appendAiMessage(m.role, m.content);
  aiHistoryPanel.classList.add("hidden");
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function renderHistoryList() {
  aiHistoryList.innerHTML = `<div class="text-[11px] text-on-surface-variant px-2 py-1">Loading...</div>`;
  const result = await window.aiAssistant.listChats();
  if (!result.ok) {
    aiHistoryList.innerHTML = `<div class="text-[11px] text-error px-2 py-1">${result.error || "Could not load chat history."}</div>`;
    return;
  }
  const chats = result.chats || [];
  if (chats.length === 0) {
    aiHistoryList.innerHTML = `<div class="text-[11px] text-on-surface-variant px-2 py-1">No past chats yet.</div>`;
    return;
  }

  aiHistoryList.innerHTML = "";
  for (const chat of chats) {
    const row = document.createElement("div");
    row.className =
      "group flex items-center gap-1 rounded hover:bg-surface-variant px-2 py-1.5 cursor-pointer" +
      (chat.id === currentChatId ? " bg-surface-variant" : "");

    const titleWrap = document.createElement("div");
    titleWrap.className = "flex-1 min-w-0";
    const titleText = document.createElement("div");
    titleText.className = "text-terminal-sm font-terminal-sm text-on-surface truncate";
    titleText.textContent = chat.title || "New chat";
    const timeText = document.createElement("div");
    timeText.className = "text-[10px] text-on-surface-variant";
    timeText.textContent = formatRelativeTime(chat.updatedAt);
    titleWrap.appendChild(titleText);
    titleWrap.appendChild(timeText);
    row.appendChild(titleWrap);

    const deleteBtn = document.createElement("button");
    deleteBtn.className =
      "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/20 text-on-surface-variant hover:text-error transition-opacity shrink-0";
    deleteBtn.title = "Delete this chat";
    deleteBtn.innerHTML = `<span class="material-symbols-outlined text-[14px]">delete</span>`;
    deleteBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      await window.aiAssistant.deleteChat(chat.id);
      if (chat.id === currentChatId) startNewChat();
      renderHistoryList();
    });
    row.appendChild(deleteBtn);

    row.addEventListener("click", () => openChat(chat.id));
    aiHistoryList.appendChild(row);
  }
}

// Only one AI request is ever in flight at a time (the input/send button
// are disabled for the duration — see sendAiMessage below), so a single
// "which bubble is currently receiving stream tokens" reference is safe;
// no per-request ID bookkeeping needed. Registered once, not per-send.
let streamingBubble = null;

// Visually distinguishes a live "what's it doing right now" status line
// (e.g. "Searching knowledge base...") from the model's actual answer
// text, which reuses the same bubble once it starts arriving.
const STATUS_CLASSES = ["italic", "text-on-surface-variant"];
const clearStatusStyle = (bubble) => bubble.classList.remove(...STATUS_CLASSES);

if (window.aiAssistant?.onChatToken) {
  window.aiAssistant.onChatToken(({ text }) => {
    if (!streamingBubble) return;
    clearStatusStyle(streamingBubble);
    streamingBubble.textContent = stripMarkdown(text);
    aiMessages.scrollTop = aiMessages.scrollHeight;
  });
}

// Fires on every tool call the agent makes, for every provider — even
// ones that don't support onChatToken's token streaming. Reuses the same
// bubble; onChatToken above (or the final result in sendAiMessage) always
// overwrites this text once real generation actually starts, so a status
// line never lingers behind stale.
if (window.aiAssistant?.onChatStatus) {
  window.aiAssistant.onChatStatus(({ status }) => {
    if (!streamingBubble) return;
    streamingBubble.classList.add(...STATUS_CLASSES);
    streamingBubble.textContent = status;
    aiMessages.scrollTop = aiMessages.scrollHeight;
  });
}

async function sendAiMessage(text) {
  appendAiMessage("user", text);
  aiConversation.push({ role: "user", content: text });

  const thinkingBubble = appendAiMessage("assistant", "Thinking...");
  streamingBubble = thinkingBubble;
  aiSend.disabled = true;
  aiInput.disabled = true;
  const startedAt = performance.now();

  try {
    const result = await window.aiAssistant.chat(aiConversation);
    clearStatusStyle(thinkingBubble);
    if (result.ok && !String(result.answer ?? "").trim()) {
      // The model returned nothing. Showing a blank bubble (and keeping an
      // unanswered question in the history) is worse than saying so —
      // some providers reject history that has questions with no answers.
      thinkingBubble.textContent = "The model returned an empty reply. Please try again.";
      thinkingBubble.classList.add("text-error");
      aiConversation.pop();
    } else if (result.ok) {
      // Authoritative — always wins over whatever streamed, so a dropped
      // or out-of-order token event along the way is never a correctness
      // issue, just a momentarily-imperfect live preview.
      thinkingBubble.textContent = stripMarkdown(result.answer);
      aiConversation.push({ role: "assistant", content: result.answer });

      // A separate sibling element, not appended into thinkingBubble
      // itself — that node's textContent gets overwritten wholesale by
      // onChatToken/onChatStatus above, so anything sharing it would get
      // clobbered on the next streamed turn. Ephemeral UI only: not part
      // of aiConversation, so it isn't persisted or sent back to the model,
      // and a reopened chat (openChat, via appendAiMessage) won't show it
      // for past turns.
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const timingCaption = document.createElement("div");
      timingCaption.className = "mr-auto text-[10px] italic text-on-surface-variant px-1 -mt-2";
      const toolNote =
        typeof result.toolCalls !== "number"
          ? ""
          : result.toolCalls === 0
            ? " · no tools used: nothing was checked on your network"
            : ` · ${result.toolCalls} tool call${result.toolCalls === 1 ? "" : "s"}`;
      timingCaption.textContent = `Answered in ${elapsedSeconds.toFixed(1)}s${toolNote}`;
      aiMessages.appendChild(timingCaption);
    } else {
      thinkingBubble.textContent = `Error: ${result.error}`;
      thinkingBubble.classList.add("text-error");
      // Don't keep a failed turn in the conversation sent back to the agent.
      aiConversation.pop();
    }
  } catch (err) {
    clearStatusStyle(thinkingBubble);
    thinkingBubble.textContent = `Error: ${err.message}`;
    thinkingBubble.classList.add("text-error");
    aiConversation.pop();
  } finally {
    streamingBubble = null;
    aiSend.disabled = false;
    aiInput.disabled = false;
    aiInput.focus();
    aiMessages.scrollTop = aiMessages.scrollHeight;
    // Persist so the conversation survives closing/reopening the app, and
    // follows this engineer to another machine — best-effort; a failed
    // save here shouldn't interrupt the chat. The first save of a brand
    // new chat has no id yet; the server assigns one, and every save
    // after that reuses it so this stays the SAME chat, not a new one
    // per turn.
    window.aiAssistant
      .saveChat({ id: currentChatId, messages: aiConversation })
      .then((result) => {
        if (result.ok && result.chat) currentChatId = result.chat.id;
      })
      .catch(() => {});
  }
}

aiForm.addEventListener("submit", (evt) => {
  evt.preventDefault();
  const text = aiInput.value.trim();
  if (!text) return;

  aiInput.value = "";
  aiInput.style.height = "auto";
  void sendAiMessage(text);
});

aiInput.addEventListener("keydown", (evt) => {
  if (evt.key === "Enter" && !evt.shiftKey) {
    evt.preventDefault();
    aiForm.requestSubmit();
  }
});

aiInput.addEventListener("input", () => {
  aiInput.style.height = "auto";
  aiInput.style.height = `${Math.min(aiInput.scrollHeight, 128)}px`;
});

btnToggleAi.addEventListener("click", () => {
  setAiSidebarOpen(aiSidebar.classList.contains("hidden"));
});

aiSidebarCloseBtn.addEventListener("click", () => setAiSidebarOpen(false));

// The AI (running as a subprocess spawned by main.js) has no SSH
// connection of its own — when it needs to run a live command against a
// device that isn't already open in a tab, main.js asks THIS renderer to
// open a real, visible tab and connect it (reusing the exact same
// openTab/connectSession path a user clicking a session triggers), then
// reports back whether that succeeded so main.js can proceed.
if (window.aiAssistant?.onOpenDeviceTab) {
  window.aiAssistant.onOpenDeviceTab(async ({ requestId, host }) => {
    try {
      const session = state.sessions.find((s) => s.host === host) || {
        id: `ai-${host}`,
        name: host,
        host,
        port: 22,
        protocol: "ssh",
        group: "Main Devices", // uses the stored default credentials, same as the AI's caller expects
      };

      openTab(session);
      await connectSession(session);

      const tab = state.tabs.find((t) => t.id === session.id);
      window.aiAssistant.reportDeviceTabResult({
        requestId,
        ok: Boolean(tab?.connected),
        error: tab?.connected ? undefined : "Connection did not complete.",
      });
    } catch (err) {
      window.aiAssistant.reportDeviceTabResult({ requestId, ok: false, error: err.message });
    }
  });
}

aiNewChatBtn.addEventListener("click", () => {
  startNewChat();
  aiHistoryPanel.classList.add("hidden");
});

aiHistoryToggleBtn.addEventListener("click", () => {
  const willShow = aiHistoryPanel.classList.contains("hidden");
  aiHistoryPanel.classList.toggle("hidden");
  if (willShow) renderHistoryList();
});

aiHistoryCloseBtn.addEventListener("click", () => {
  aiHistoryPanel.classList.add("hidden");
});

let aiResizing = false;

aiResizeHandle.addEventListener("mousedown", (evt) => {
  aiResizing = true;
  evt.preventDefault();
});

window.addEventListener("mousemove", (evt) => {
  if (!aiResizing) return;
  const newWidth = Math.min(
    AI_SIDEBAR_MAX_WIDTH,
    Math.max(AI_SIDEBAR_MIN_WIDTH, window.innerWidth - evt.clientX)
  );
  aiSidebar.style.width = `${newWidth}px`;
});

window.addEventListener("mouseup", () => {
  if (!aiResizing) return;
  aiResizing = false;
  window.localStorage.setItem("aiSidebarWidth", parseInt(aiSidebar.style.width, 10));
  window.dispatchEvent(new Event("resize"));
});

(async function init() {
  await loadSettings();
  applyVisualSettings();
  if (aiProviderSelect) aiProviderSelect.value = settingsState.aiProvider;
  updateLocalModelSelectAvailability();
  populateLocalModelOptions(); // async, best-effort — doesn't block the rest of init

  const creds = await window.terminalCore.getCredentials();
  if (creds.ok && creds.data) {
    credentialsState.username = creds.data.username || "sysadmin";
    credentialsState.password = creds.data.password || "";
  }

  const sessions = await window.terminalCore.listSessions();
  state.sessions = sessions;
  renderFavoritesDropdown();
  renderSessions();
  renderTabs();
  showActiveTerminal();

  aiSidebar.style.width = `${readStoredAiSidebarWidth()}px`;
  const storedAiOpen = window.localStorage.getItem("aiSidebarOpen");
  setAiSidebarOpen(storedAiOpen === null ? true : storedAiOpen === "1");

  try {
    const list = await window.aiAssistant.listChats();
    if (list.ok && Array.isArray(list.chats) && list.chats.length > 0) {
      // Resume the most recently updated chat, same feel as the old
      // single-thread behavior — every other past chat is one click away
      // via the History panel.
      await openChat(list.chats[0].id);
    }
  } catch (_err) {
    // No saved history, or it couldn't be read — start with an empty chat.
  }
})();
