const { app, BrowserWindow } = require('electron');
const path = require('path');
const fsSync = require('fs');

const FOCUS_PAGE = path.join(__dirname, 'focus.html');
const APP_ICON = path.join(__dirname, 'favicon.png');
app.setName('Focus Mode');
let mainWindow = null;

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
