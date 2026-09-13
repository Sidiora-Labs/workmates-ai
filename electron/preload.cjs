const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscription(channel) {
  return (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld("rooms", {
  serverConnection: () => ipcRenderer.invoke("server:connection"),
  configureServer: (connection) => ipcRenderer.invoke("server:configure", connection),
  screenFrame: () => ipcRenderer.invoke("screen:frame"),

  notifyShow: (notice) => ipcRenderer.invoke("notify:show", notice),
  badgeSet: (count) => ipcRenderer.invoke("badge:set", count),
  filePath: (file) => webUtils.getPathForFile(file),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),

  appVersion: () => ipcRenderer.invoke("app:version"),
  updateState: () => ipcRenderer.invoke("update:state"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateState: subscription("update:state"),
  shortcutApply: (accelerator) => ipcRenderer.invoke("shortcut:apply", accelerator),
  quickHide: () => ipcRenderer.invoke("quick:hide"),
  quickOpenMain: () => ipcRenderer.invoke("quick:open-main"),
  onQuickOpened: subscription("quick:opened"),
  onNotifyActivate: subscription("notify:activate"),
  speechStart: () => ipcRenderer.invoke("speech:start"),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  onSpeechTranscript: subscription("speech:transcript"),
  onSpeechEnd: subscription("speech:end"),

  authStatus: () => ipcRenderer.invoke("auth:status"),
  authConfirm: (reason) => ipcRenderer.invoke("auth:confirm", reason),

  permStatus: () => ipcRenderer.invoke("perm:status"),
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  permRequestScreen: () => ipcRenderer.invoke("perm:request-screen"),
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),
});
