const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const FOCUS_PAGE = path.join(__dirname, 'focus.html');
const APP_ICON = path.join(__dirname, 'favicon.png');
app.setName('Focus Mode');
let mainWindow = null;
const statsFilePath = () => path.join(app.getPath('userData'), 'focus-stats.json');

async function readStatsFile() {
  try {
    const data = await fs.readFile(statsFilePath(), 'utf-8');
    try {
      return JSON.parse(data);
    } catch (parseError) {
      console.error('Failed to parse stats file, resetting:', parseError);
      await fs.rename(statsFilePath(), `${statsFilePath()}.bak`);
      return null;
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    console.error('Failed to read stats file:', err);
    return null;
  }
}

async function writeStatsFile(stats) {
  try {
    await fs.mkdir(path.dirname(statsFilePath()), { recursive: true });
    await fs.writeFile(statsFilePath(), JSON.stringify(stats, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write stats file:', err);
    return false;
  }
}

async function resetStatsFile() {
  try {
    await fs.unlink(statsFilePath());
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return true;
    console.error('Failed to reset stats file:', err);
    return false;
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath
    }
  });

  win.loadFile(FOCUS_PAGE);
  win.webContents.on('did-finish-load', () => {
    if (fsSync.existsSync(preloadPath)) {
      console.log('[app] Preload loaded from:', preloadPath);
    } else {
      console.log('[app] Preload missing at:', preloadPath);
    }
  });
  mainWindow = win;
}

app.whenReady().then(async () => {
  if (app.dock && app.dock.setIcon) {
    app.dock.setIcon(APP_ICON);
  }
  
  createWindow();

  ipcMain.handle('stats:load', async () => readStatsFile());
  ipcMain.handle('stats:save', async (_event, stats) => writeStatsFile(stats));
  ipcMain.handle('stats:reset', async () => resetStatsFile());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
