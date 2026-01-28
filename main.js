const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const FOCUS_PAGE = path.join(__dirname, 'focus.html');
const APP_ICON = path.join(__dirname, 'favicon.png');
app.setName('Focus Mode');
let mainWindow = null;
const statsFilePath = () => path.join(app.getPath('userData'), 'focus-stats.json');
const statsBackupPath = () => `${statsFilePath()}.bak`;
const statsTempPath = () => `${statsFilePath()}.tmp`;

function tryParseStats(raw) {
  if (!raw || typeof raw !== 'string') return { data: null, repaired: null };
  try {
    return { data: JSON.parse(raw), repaired: null };
  } catch (_err) {
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace > 0) {
      const trimmed = raw.slice(0, lastBrace + 1);
      try {
        return { data: JSON.parse(trimmed), repaired: trimmed };
      } catch (_trimErr) {
        return { data: null, repaired: null };
      }
    }
    return { data: null, repaired: null };
  }
}

async function readStatsFile() {
  const statsPath = statsFilePath();
  const backupPath = statsBackupPath();
  try {
    const data = await fs.readFile(statsPath, 'utf-8');
    const parsed = tryParseStats(data);
    if (parsed.data) {
      if (parsed.repaired) {
        await fs.writeFile(statsPath, parsed.repaired, 'utf-8');
      }
      return parsed.data;
    }
    console.error('Failed to parse stats file, attempting backup restore.');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    console.error('Failed to read stats file:', err);
  }
  try {
    const backupData = await fs.readFile(backupPath, 'utf-8');
    const parsedBackup = tryParseStats(backupData);
    if (parsedBackup.data) {
      await fs.writeFile(statsPath, JSON.stringify(parsedBackup.data, null, 2), 'utf-8');
      return parsedBackup.data;
    }
  } catch (backupErr) {
    if (backupErr && backupErr.code !== 'ENOENT') {
      console.error('Failed to read backup stats file:', backupErr);
    }
  }
  try {
    if (fsSync.existsSync(statsPath)) {
      const corruptPath = `${statsPath}.corrupt-${Date.now()}`;
      await fs.rename(statsPath, corruptPath);
    }
  } catch (renameErr) {
    console.error('Failed to move corrupt stats file:', renameErr);
  }
  return null;
}

async function writeStatsFile(stats) {
  try {
    const statsPath = statsFilePath();
    const backupPath = statsBackupPath();
    const tempPath = statsTempPath();
    await fs.mkdir(path.dirname(statsPath), { recursive: true });
    if (fsSync.existsSync(statsPath)) {
      await fs.copyFile(statsPath, backupPath);
    }
    await fs.writeFile(tempPath, JSON.stringify(stats, null, 2), 'utf-8');
    try {
      await fs.rename(tempPath, statsPath);
    } catch (renameErr) {
      if (fsSync.existsSync(statsPath)) {
        await fs.unlink(statsPath);
      }
      await fs.rename(tempPath, statsPath);
    }
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
