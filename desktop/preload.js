const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("terminalCore", {
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  addSession: (payload) => ipcRenderer.invoke("sessions:add", payload),
  removeSession: (payload) => ipcRenderer.invoke("sessions:remove", payload),
  toggleFavorite: (payload) => ipcRenderer.invoke("sessions:toggleFavorite", payload),
  getCredentials: () => ipcRenderer.invoke("credentials:get"),
  setCredentials: (payload) => ipcRenderer.invoke("credentials:set", payload),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (payload) => ipcRenderer.invoke("settings:set", payload),
  connect: (payload) => ipcRenderer.invoke("ssh:connect", payload),
  send: (payload) => ipcRenderer.invoke("ssh:send", payload),
  resize: (payload) => ipcRenderer.invoke("ssh:resize", payload),
  disconnect: (payload) => ipcRenderer.invoke("ssh:disconnect", payload),
  pickPrivateKey: () => ipcRenderer.invoke("ssh:pickPrivateKey"),
  onData: (handler) => ipcRenderer.on("ssh:data", (_evt, payload) => handler(payload)),
  onClosed: (handler) => ipcRenderer.on("ssh:closed", (_evt, payload) => handler(payload)),
  clipboardReadText: () => ipcRenderer.invoke("clipboard:readText"),
  clipboardWriteText: (text) => ipcRenderer.invoke("clipboard:writeText", { text }),
});

contextBridge.exposeInMainWorld("aiAssistant", {
  chat: (messages) => ipcRenderer.invoke("ai:chat", { messages }),
  // Live token stream for the in-flight chat request — see main.js's
  // ai:chat handler. Purely a progressive-display side channel; the
  // chat() call above still resolves with the authoritative final answer.
  onChatToken: (handler) => ipcRenderer.on("ai:chatToken", (_event, payload) => handler(payload)),
  // Live "what's it doing right now" status for the in-flight chat request
  // — fires on every tool call regardless of provider, unlike onChatToken
  // which only fires for providers that support token streaming.
  onChatStatus: (handler) => ipcRenderer.on("ai:chatStatus", (_event, payload) => handler(payload)),
  listLocalModels: () => ipcRenderer.invoke("ai:listLocalModels"),
  rebuildKnowledgeIndex: () => ipcRenderer.invoke("ai:rebuildKnowledgeIndex"),
  // Lets the main process ask the renderer to open/connect a real,
  // visible terminal tab for a device the AI wants to run a live command
  // against but that isn't already connected — see run_show_command.
  onOpenDeviceTab: (handler) => ipcRenderer.on("ai:openDeviceTab", (_event, payload) => handler(payload)),
  reportDeviceTabResult: (payload) => ipcRenderer.invoke("ai:openDeviceTabResult", payload),
  // Chat history — stored on the shared knowledge-server, keyed by the
  // engineer's default SSH username, so it follows them across machines
  // and supports multiple named chats (not just one running thread).
  listChats: () => ipcRenderer.invoke("ai:chats:list"),
  getChat: (id) => ipcRenderer.invoke("ai:chats:get", { id }),
  saveChat: (payload) => ipcRenderer.invoke("ai:chats:save", payload), // { id?, title?, messages }
  deleteChat: (id) => ipcRenderer.invoke("ai:chats:delete", { id }),
});
