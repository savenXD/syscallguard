const { app, BrowserWindow, Menu, dialog, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startDemo } = require('./desktop/demo-server.cjs');

// Keep the existing profile so the dashboard's saved settings survive the new app name.
const profilePath = path.join(app.getPath('appData'), 'syscallguard-dashboard');
fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setName('SyscallGuard');
if (process.platform === 'linux') app.commandLine.appendSwitch('class', 'syscallguard');

const args = process.argv.slice(1);
const explicitBridge = args.find((arg) => arg.startsWith('--bridge='))?.slice('--bridge='.length) || process.env.SG_BRIDGE_URL;
const demoMode = args.includes('--demo') || (app.isPackaged && !explicitBridge && !args.includes('--live'));
const isKiosk = args.includes('--kiosk');
const isFullscreen = isKiosk || args.includes('--fullscreen');
let bridgeUrl = explicitBridge || 'ws://127.0.0.1:8765';
let window = null;
let demo = null;
const statePath = path.join(app.getPath('userData'), 'window-state.json');
const iconPath = path.join(__dirname, 'build', 'icons', 'icon.png');

function restoredBounds() {
  try {
    const bounds = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))) return {};
    if (bounds.width < 1024 || bounds.height < 700) return {};
    const visible = screen.getAllDisplays().some(({ workArea: area }) => bounds.x < area.x + area.width - 64
      && bounds.x + bounds.width > area.x + 64 && bounds.y < area.y + area.height - 64 && bounds.y + bounds.height > area.y + 64);
    return visible ? bounds : {};
  } catch { return {}; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, ...restoredBounds(), minWidth: 1024, minHeight: 700,
    title: demoMode ? 'SyscallGuard — Demo' : 'SyscallGuard', icon: iconPath,
    backgroundColor: '#000', show: false, kiosk: isKiosk, fullscreen: isFullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, additionalArguments: [`--bridge-url=${bridgeUrl}`],
    },
  });
  window = win;
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); });
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('close', () => {
    if (isKiosk || win.isFullScreen()) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(win.getNormalBounds()));
    } catch { /* Read-only profiles must not prevent a clean exit. */ }
  });
  win.on('closed', () => { window = null; });
  const load = process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  load.catch((error) => { dialog.showErrorBox('SyscallGuard could not start', error.message); app.quit(); });
}

function nativeMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ label: 'App', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('io.syscallguard.desktop');
    app.setAboutPanelOptions({ applicationName: 'SyscallGuard', applicationVersion: app.getVersion(),
      copyright: 'SyscallGuard · INNOTECH26', iconPath, credits: 'Kernel security operations dashboard' });
    if (process.platform === 'darwin') app.dock?.setIcon(iconPath);
    nativeMenu();
    if (demoMode) { demo = await startDemo(); bridgeUrl = demo.url; }
    const protocol = new URL(bridgeUrl).protocol;
    if (protocol !== 'ws:' && protocol !== 'wss:') throw new Error('The bridge address must use ws:// or wss://.');
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch((error) => { dialog.showErrorBox('SyscallGuard could not start', error.message); app.quit(); });
}
app.on('before-quit', () => { if (demo) void demo.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
