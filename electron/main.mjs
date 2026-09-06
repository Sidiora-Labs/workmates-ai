import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  session,
  shell,
  systemPreferences,
  utilityProcess,
} from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeBadgeCount, resolveWindowState } from "./window-state.mjs";

import electronUpdater from "./vendor/electron-updater.cjs";

import { startCua, stopCua, registerCuaIpc } from "./cua.mjs";
import { nativeHelper } from "./native-helper.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON = path.join(HERE, "resources/app-icon.png");

const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";

const CANDIDATE_PORTS = [8799, 18799, 28799];

const DARK_BACKDROP = "#1c1c1e";
const LIGHT_BACKDROP = "#ffffff";

async function adoptLoginShellPath() {
  if (process.platform === "win32") return;
  const shell = process.env.SHELL || "/bin/zsh";
  const reported = await new Promise((resolve) => {
    execFile(shell, ["-ilc", 'echo "$PATH"'], { timeout: 4000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim().split("\n").at(-1));
    });
  });
  if (!reported) return;

  const merged = [...new Set([...reported.split(":"), ...(process.env.PATH ?? "").split(":")])]
    .filter(Boolean)
    .join(":");
  process.env.PATH = merged;
}

let serverProcess = null;
let serverPort = CANDIDATE_PORTS[0];
let serverStarted = true;

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on("second-instance", () => {
  const main = BrowserWindow.getAllWindows().find((w) => w !== quickWin && !w.isDestroyed());
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  app.focus?.({ steal: true });
});

async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  const child = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      WORKMATES_STATIC_DIR: path.join(process.resourcesPath, "ui"),
      WORKMATES_PORT: String(port),
    },
    stdio: "inherit",
  });

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.app === "workmates" && body.pid === child.pid && body.static) return child;
        break;
      }
    } catch {
    }
    await pause(500);
  }

  try {
    child.kill();
  } catch {
  }
  return null;
}

async function startServer() {
  for (let round = 0; round < 2; round++) {
    for (const port of CANDIDATE_PORTS) {
      const child = await startServerOn(port);
      if (child) {
        serverProcess = child;
        serverPort = port;
        return true;
      }
    }
    await pause(2500);
  }
  return false;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STARTUP_FAILURE_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${DARK_BACKDROP};color:#f2f2f5;font:15px -apple-system,system-ui">` +
      `<div style="text-align:center;max-width:380px">` +
      `<div style="font-size:42px;color:#8f9bff">▦</div>` +
      `<h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the Workmates server</h2>` +
      `<p style="color:#a1a1aa;line-height:1.5">Something else is using its ports. Quit and reopen Workmates. If it keeps happening, restart your Mac.</p>` +
      `</div></body>`,
  );

const isHttpUrl = (url) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

const isOurOwnPage = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
};

function installContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable && !params.selectionText && !params.linkURL && !params.misspelledWord)
      return;
    const items = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      if (items.length) items.push({ type: "separator" });
    }
    if (params.linkURL) {
      items.push(
        { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else {
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
    }
    Menu.buildFromTemplate(items).popup({ window: win, frame: params.frame });
  });
}

const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readWindowState() {
  try {
    return fs.readFileSync(windowStateFile(), "utf8");
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const file = windowStateFile();
  const staging = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      staging,
      JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }),
    );
    fs.renameSync(staging, file);
  } catch {
    fs.rmSync(staging, { force: true });
  }
}

function persistWindowState(win) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    writeWindowState(win);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, schedule);
  win.on("close", flush);
}

const BUTTONS = { x: 22, y: 16 };

function keepButtonsInPlace(win) {
  if (process.platform !== "darwin") return;
  const apply = () => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    try {
      win.setWindowButtonPosition(BUTTONS);
    } catch {
    }
  };
  for (const event of ["leave-full-screen", "enter-full-screen", "resize", "focus", "show"]) {
    win.on(event, () => setTimeout(apply, 120));
  }
  apply();
}

let quickWin = null;
let quickAccelerator = null;

function appUrl(query = "") {
  const base = app.isPackaged
    ? serverStarted
      ? `http://127.0.0.1:${serverPort}`
      : STARTUP_FAILURE_PAGE
    : DEV_URL;
  return query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base;
}

function quickWindow() {
  if (quickWin && !quickWin.isDestroyed()) return quickWin;
  quickWin = new BrowserWindow({
    width: 620,
    height: 190,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  installContextMenu(quickWin);
  quickWin.loadURL(appUrl("quick=1"));
  quickWin.on("blur", () => quickWin?.hide());
  quickWin.on("closed", () => {
    quickWin = null;
  });
  return quickWin;
}

function toggleQuickAsk() {
  const win = quickWindow();
  if (win.isVisible()) return win.hide();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  win.setPosition(Math.round(x + width / 2 - 310), Math.round(y + 140));
  win.showInactive();
  win.focus();
  win.webContents.send("quick:opened");
}

function applyQuickShortcut(accelerator) {
  if (quickAccelerator) {
    try {
      globalShortcut.unregister(quickAccelerator);
    } catch {}
    quickAccelerator = null;
  }
  if (!accelerator) return null;
  try {
    const ok = globalShortcut.register(accelerator, toggleQuickAsk);
    quickAccelerator = ok ? accelerator : null;
    return quickAccelerator;
  } catch {
    return null;
  }
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((d) => d.id !== primary.id);
  const restored = resolveWindowState(
    readWindowState(),
    [primary, ...others].map((d) => d.workArea),
  );
  const { width: screenW, height: screenH } = primary.workAreaSize;

  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: Math.min(900, screenW),
    minHeight: Math.min(600, screenH),
    icon: APP_ICON,
    ...(process.platform === "darwin"
      ? {
          vibrancy: "sidebar",
          visualEffectState: "active",
        }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKDROP : LIGHT_BACKDROP }),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: BUTTONS,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.join(HERE, "preload.cjs"),
    },
  });
  keepButtonsInPlace(win);
  installContextMenu(win);
  if (process.platform !== "darwin") {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown") return;
      const isZoomIn = input.control && (input.key === "=" || input.key === "+");
      if (isZoomIn) {
        win.webContents.setZoomLevel(Math.min(win.webContents.getZoomLevel() + 0.5, 5));
        return;
      }
      const isZoomOut = input.control && input.key === "-";
      if (isZoomOut) {
        win.webContents.setZoomLevel(Math.max(win.webContents.getZoomLevel() - 0.5, -4));
        return;
      }
      const isZoomReset = input.control && input.key === "0";
      if (isZoomReset) {
        win.webContents.setZoomLevel(0);
        return;
      }
      const isDevtools =
        input.control && input.shift && input.key.toLowerCase() === "i";
      if (isDevtools && !app.isPackaged) win.webContents.toggleDevTools();
    });
  }
  persistWindowState(win);
  if (restored.maximized) win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isOurOwnPage(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });

  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (app.isPackaged) {
    win.loadURL(serverStarted ? `http://127.0.0.1:${serverPort}` : STARTUP_FAILURE_PAGE);
  } else {
    win.loadURL(DEV_URL);
  }
}

ipcMain.handle("screen:frame", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
});

ipcMain.handle("perm:status", () => ({
  mic: systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown",
  screen: systemPreferences.getMediaAccessStatus?.("screen") ?? "unknown",
}));

ipcMain.handle("perm:request-mic", async () => {
  try {
    return await systemPreferences.askForMediaAccess("microphone");
  } catch {
    return false;
  }
});

ipcMain.handle("perm:request-screen", async () => {
  try {
    const helper = nativeHelper("perm-helper");
    await new Promise((resolve) => {
      execFile(helper, ["request"], { timeout: 15_000 }, () => resolve());
    });
  } catch {
  }
  return systemPreferences.getMediaAccessStatus?.("screen") ?? "unknown";
});

ipcMain.handle("perm:open-settings", (_event, pane) => {
  const panes = {
    mic: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
    speech: "Privacy_SpeechRecognition",
  };
  return shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${panes[pane] ?? "Privacy"}`,
  );
});

const standingBanners = new Map();

async function bannerIcon(avatar) {
  if (typeof avatar !== "string" || !avatar.startsWith("/api/")) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}${avatar}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

ipcMain.handle("notify:show", async (event, notice) => {
  if (!Notification.isSupported()) return;
  const target = String(notice?.target ?? "");
  const icon = await bannerIcon(notice?.avatar);
  const shown = new Notification({
    title: String(notice?.title ?? "Workmates").slice(0, 120),
    body: String(notice?.body ?? "").slice(0, 400),
    silent: !notice?.urgent,
    ...(icon ? { icon } : {}),
  });
  if (target) {
    standingBanners.get(target)?.close();
    standingBanners.set(target, shown);
    shown.on("close", () => {
      if (standingBanners.get(target) === shown) standingBanners.delete(target);
    });
  }
  shown.on("click", () => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus?.({ steal: true });
    win.webContents.send("notify:activate", { target: notice?.target ?? "" });
  });
  shown.show();
});

ipcMain.handle("dialog:pick-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled ? null : (filePaths[0] ?? null);
});

let badgeOverlay = null;
ipcMain.handle("badge:set", (event, value) => {
  const count = normalizeBadgeCount(value);
  if (process.platform === "win32") {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    badgeOverlay ??= nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
    win.setOverlayIcon(
      count > 0 && !badgeOverlay.isEmpty() ? badgeOverlay : null,
      count > 0 ? `${count} unread` : "",
    );
    return;
  }
  app.setBadgeCount(count);
});

let updaterState = { state: "idle" };

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("update:state", () => updaterState);
ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) return { state: "dev" };
  try {
    await electronUpdater.autoUpdater.checkForUpdates();
  } catch {
  }
  return updaterState;
});
ipcMain.handle("update:install", () => {
  if (!app.isPackaged) return;
  electronUpdater.autoUpdater.quitAndInstall();
});

ipcMain.handle("shortcut:apply", (_event, accelerator) =>
  applyQuickShortcut(typeof accelerator === "string" && accelerator ? accelerator : null),
);
ipcMain.handle("quick:hide", () => quickWin?.hide());
ipcMain.handle("quick:open-main", () => {
  quickWin?.hide();
  const [main] = BrowserWindow.getAllWindows().filter((w) => w !== quickWin);
  if (!main || main.isDestroyed()) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  app.focus?.({ steal: true });
});

function askHelper(args) {
  return new Promise((resolve) => {
    let helper;
    try {
      helper = nativeHelper("auth-helper");
    } catch {
      resolve("unavailable");
      return;
    }
    execFile(helper, args, { timeout: 130_000 }, (error, stdout) => {
      resolve(error ? "unavailable" : stdout.trim() || "unavailable");
    });
  });
}

ipcMain.handle("auth:status", () =>
  process.platform === "darwin" ? askHelper(["check"]) : Promise.resolve("unavailable"),
);

ipcMain.handle("auth:confirm", (_event, reason) => {
  if (process.platform !== "darwin") return "unavailable";
  const said = typeof reason === "string" ? reason.slice(0, 120) : "";
  return askHelper(["ask", said]);
});

ipcMain.handle("speech:start", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startSpeech(win);
});
ipcMain.handle("speech:stop", () => stopSpeech());

async function restoreQuickShortcut() {
  try {
    const { readFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const raw = JSON.parse(
      readFileSync(path.join(homedir(), ".workmates", "config.json"), "utf8"),
    );
    applyQuickShortcut(raw?.shortcuts?.quickAsk ?? null);
  } catch {
  }
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock.setIcon(APP_ICON);

  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  const GRANTED = new Set(["media", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(GRANTED.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    GRANTED.has(permission),
  );

  await adoptLoginShellPath();

  registerCuaIpc();
  startCua().catch((error) => console.error("[cua] start failed:", error));

  if (app.isPackaged) serverStarted = await startServer();
  createWindow();

  if (app.isPackaged) {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const tellWindows = (state, detail = {}) => {
      updaterState = { state, ...detail };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("update:state", updaterState);
      }
    };
    autoUpdater.on("checking-for-update", () => tellWindows("checking"));
    autoUpdater.on("update-available", (info) => tellWindows("downloading", { version: info?.version }));
    autoUpdater.on("update-not-available", () => tellWindows("current"));
    autoUpdater.on("download-progress", (progress) =>
      tellWindows("downloading", { percent: Math.round(progress?.percent ?? 0) }),
    );
    autoUpdater.on("update-downloaded", (info) => tellWindows("ready", { version: info?.version }));
    autoUpdater.on("error", (error) => {
      console.error("[updater]", error?.message ?? error);
      tellWindows("error");
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  void restoreQuickShortcut();

  app.on("activate", () => {
    const windows = BrowserWindow.getAllWindows().filter((w) => w !== quickWin);
    if (windows.length === 0) createWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let daemonStopped = false;
app.on("before-quit", (event) => {
  if (daemonStopped) return;
  event.preventDefault();
  try {
    serverProcess?.kill();
  } catch {
  }
  stopCua().finally(() => {
    daemonStopped = true;
    app.quit();
  });
});
