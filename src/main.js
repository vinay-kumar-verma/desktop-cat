const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');

// ── Config persistence ─────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'cat-config.json');
const DEFAULT_CONFIG = {
  x: null,
  y: null,
  size: 80,
  lastFed: Date.now(),
  xp: 0,
  accessories: [],
  launchOnStartup: false,
  visible: true
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

// ── App state ──────────────────────────────────────────────────────────────
let win, tray, config;

app.whenReady().then(() => {
  config = loadConfig();

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  if (config.x === null) config.x = width - 200;
  if (config.y === null) config.y = height - 200;

  createWindow();
  createTray();
  setupPowerMonitor();

  if (config.launchOnStartup) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
});

app.on('window-all-closed', () => {});

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 300,
    height: 300,
    x: config.x,
    y: config.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(false);
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      document.addEventListener('mousemove', (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        window.catAPI.setIgnoreMouse(!el || el === document.documentElement || el === document.body);
      });
    `);
  });

  if (!config.visible) win.hide();
}

// ── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromDataURL(TRAY_ICON_DATA);
  tray = new Tray(img);
  tray.setToolTip('Desktop Cat 🐱');
  rebuildTrayMenu();

  tray.on('right-click', () => {
    tray.popUpContextMenu();
  });

  tray.on('double-click', () => {
    config.visible ? win.hide() : win.show();
    config.visible = !config.visible;
    saveConfig(config);
    rebuildTrayMenu();
  });
}

function rebuildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '🍖 Feed cat',  click: () => win.webContents.send('tray-feed') },
    { label: '⏰ Wake up',   click: () => win.webContents.send('tray-wake') },
    { type: 'separator' },
    {
      label: `👁 ${config.visible ? 'Hide' : 'Show'} cat`,
      click: () => {
        config.visible ? win.hide() : win.show();
        config.visible = !config.visible;
        saveConfig(config);
        rebuildTrayMenu();
      }
    },
    {
      label: '📐 Cat size',
      submenu: [
        { label: 'Small (64px)',   click: () => resizeCat(64)  },
        { label: 'Medium (96px)',  click: () => resizeCat(96)  },
        { label: 'Large (128px)',  click: () => resizeCat(128) }
      ]
    },
    { type: 'separator' },
    {
      label: '🚀 Launch on startup',
      type: 'checkbox',
      checked: config.launchOnStartup,
      click: (item) => {
        config.launchOnStartup = item.checked;
        app.setLoginItemSettings({ openAtLogin: item.checked });
        saveConfig(config);
      }
    },
    { type: 'separator' },
    { label: '❌ Quit', click: () => { saveConfig(config); app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function resizeCat(size) {
  config.size = size;
  saveConfig(config);
  win.webContents.send('set-size', size);
}

// ── IPC handlers ───────────────────────────────────────────────────────────
ipcMain.on('save-position', (_, pos) => {
  config.x = pos.x;
  config.y = pos.y;
  win.setPosition(pos.x, pos.y);
  saveConfig(config);
});

ipcMain.on('save-state', (_, state) => {
  Object.assign(config, state);
  saveConfig(config);
});

ipcMain.handle('get-config', () => config);

ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// ── Power monitor ──────────────────────────────────────────────────────────
function setupPowerMonitor() {
  powerMonitor.on('suspend', () => win.webContents.send('power-suspend'));
  powerMonitor.on('resume',  () => win.webContents.send('power-resume'));
}

// ── Tray icon (base64 16x16) ───────────────────────────────────────────────
const TRAY_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAjklEQVQ4je2SsQ3CMBBFHyUdMEIGSJkgHSMwQjZIxyg0KRmBETJBMkAGYANKKaVACRInCkLiSTbnu/Pde/8thFDVQ0S2wBG4u/snMAMuLRF3AYCIHIAbsAGWwA6YgLuZnSUdJK2B2swW/yRJkiRJkqTR9QpJkiRJkiRJkiRJkiRJkqRRXgAAAP//jj4HFwAAAABJRU5ErkJggg==';