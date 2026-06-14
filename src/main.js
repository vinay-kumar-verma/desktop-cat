const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor
} = require('electron');
const path = require('path');
const fs   = require('fs');

// Fix DPI scaling on Windows
app.commandLine.appendSwitch('high-dpi-support', '1');

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
let dragOffset = { x: 80, y: 80 };

app.whenReady().then(() => {
  config = loadConfig();

  // Get scale factor from primary display
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  if (config.x === null) config.x = width  - 200;
  if (config.y === null) config.y = height - 200;
  createWindow();
  createTray();
  setupPowerMonitor();
});

app.on('window-all-closed', () => {});

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor; // 1.25 on your machine

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

  let catRect  = { x: 0, y: 0, w: 160, h: 160 };
  let ignoring = true;
  let dragging = false;

  ipcMain.on('set-cat-rect', (_, rect) => { catRect = rect; });

  ipcMain.on('drag-start', () => {
    dragging = true;
    ignoring = false;
    // Compute offset entirely in screen coords — immune to DPI scaling
    const pt       = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    dragOffset = {
      x: pt.x - wx,
      y: pt.y - wy
    };
    win.setIgnoreMouseEvents(false);
  });

  ipcMain.on('drag-end', () => {
    dragging = false;
  });

  setInterval(() => {
    if (!win || win.isDestroyed() || dragging) return;
    const pt       = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    // Use scaleFactor to convert CSS catRect coords to screen coords
    const over = pt.x >= wx + catRect.x * scaleFactor &&
                 pt.x <= wx + (catRect.x + catRect.w) * scaleFactor &&
                 pt.y >= wy + catRect.y * scaleFactor &&
                 pt.y <= wy + (catRect.y + catRect.h) * scaleFactor;
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

// Inertia after drag ends — move by delta
ipcMain.on('move-window', (_, delta) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const newX = Math.max(0, Math.min(width  - 160, x + delta.dx));
  const newY = Math.max(0, Math.min(height - 160, y + delta.dy));
  win.setPosition(newX, newY, false);
});

// Live drag — cursor stays exactly where it grabbed the window
ipcMain.on('move-to-cursor', () => {
  if (!win || win.isDestroyed()) return;
  const pt = screen.getCursorScreenPoint();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const newX = Math.max(0, Math.min(width  - 160, pt.x - dragOffset.x));
  const newY = Math.max(0, Math.min(height - 160, pt.y - dragOffset.y));
  win.setPosition(newX, newY, false);
});

ipcMain.on('save-state', (_, state) => { Object.assign(config, state); saveConfig(config); });
ipcMain.handle('get-config', () => config);
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

function setupPowerMonitor() {
  powerMonitor.on('suspend', () => win.webContents.send('power-suspend'));
  powerMonitor.on('resume',  () => win.webContents.send('power-resume'));
}

const TRAY_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAjklEQVQ4je2SsQ3CMBBFHyUdMEIGSJkgHSMwQjZIxyg0KRmBETJBMkAGYANKKaVACRInCkLiSTbnu/Pde/8thFDVQ0S2wBG4u/snMAMuLRF3AYCIHIAbsAGWwA6YgLuZnSUdJK2B2swW/yRJkiRJkqTR9QpJkiRJkiRJkiRJkiRJkqRRXgAAAP//jj4HFwAAAABJRU5ErkJggg==';