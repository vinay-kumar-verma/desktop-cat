const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor
} = require('electron');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'cat-config.json');
const DEFAULT_CONFIG = {
  x: null, y: null, size: 80,
  lastFed: Date.now(), xp: 0,
  accessories: [], launchOnStartup: false, visible: true
};

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

let win, tray, config;

app.whenReady().then(() => {
  config = loadConfig();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  if (config.x === null) config.x = width  - 200;
  if (config.y === null) config.y = height - 200;
  createWindow();
  createTray();
  setupPowerMonitor();
});

app.on('window-all-closed', () => {});

function createWindow() {
  win = new BrowserWindow({
    width: 160, height: 160,
    x: config.x, y: config.y,
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
  win.setIgnoreMouseEvents(true, { forward: true });

  // Poll cursor every 16ms, toggle mouse events based on cat's actual rect
  let catRect = { x: 0, y: 0, w: 160, h: 160 }; // fallback = full window
  let ignoring = true;

  ipcMain.on('set-cat-rect', (_, rect) => { catRect = rect; });

  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const pt       = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const over = pt.x >= wx + catRect.x &&
                 pt.x <= wx + catRect.x + catRect.w &&
                 pt.y >= wy + catRect.y &&
                 pt.y <= wy + catRect.y + catRect.h;
    if (over !== !ignoring) {
      ignoring = !over;
      win.setIgnoreMouseEvents(ignoring, { forward: true });
    }
  }, 16);

  if (!config.visible) win.hide();
}

function createTray() {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromDataURL(TRAY_ICON_DATA);
  tray = new Tray(img);
  tray.setToolTip('Desktop Cat 🐱');
  rebuildTrayMenu();
  tray.on('right-click', () => tray.popUpContextMenu());
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
        { label: 'Small (64px)',  click: () => resizeCat(64)  },
        { label: 'Medium (96px)', click: () => resizeCat(96)  },
        { label: 'Large (128px)', click: () => resizeCat(128) }
      ]
    },
    { type: 'separator' },
    {
      label: '🚀 Launch on startup', type: 'checkbox',
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

ipcMain.on('save-position', (_, pos) => {
  config.x = pos.x; config.y = pos.y;
  win.setPosition(pos.x, pos.y);
  saveConfig(config);
});

// Drag: move window by delta
ipcMain.on('move-window', (_, delta) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const newX = Math.max(0, Math.min(width  - 160, x + delta.dx));
  const newY = Math.max(0, Math.min(height - 160, y + delta.dy));
  win.setPosition(newX, newY, false);
});

ipcMain.on('save-state', (_, state) => { Object.assign(config, state); saveConfig(config); });
ipcMain.handle('get-config', () => config);
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  win.setIgnoreMouseEvents(true, { forward: true });
});

function setupPowerMonitor() {
  powerMonitor.on('suspend', () => win.webContents.send('power-suspend'));
  powerMonitor.on('resume',  () => win.webContents.send('power-resume'));
}

const TRAY_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAjklEQVQ4je2SsQ3CMBBFHyUdMEIGSJkgHSMwQjZIxyg0KRmBETJBMkAGYANKKaVACRInCkLiSTbnu/Pde/8thFDVQ0S2wBG4u/snMAMuLRF3AYCIHIAbsAGWwA6YgLuZnSUdJK2B2swW/yRJkiRJkqTR9QpJkiRJkiRJkiRJkiRJkqRRXgAAAP//jj4HFwAAAABJRU5ErkJggg==';