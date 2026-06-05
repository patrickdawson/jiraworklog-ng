import { app } from 'electron';
import { menubar } from 'menubar';
import path from 'path';

const NEXT_URL = 'http://localhost:3000';

app.on('ready', () => {
  const mb = menubar({
    index: NEXT_URL,
    icon: path.join(__dirname, '../assets/tray-icon.png'),
    browserWindow: {
      width: 1000,
      height: 680,
      minWidth: 750,
      resizable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
    showDockIcon: false,
    preloadWindow: true,
  });

  mb.on('ready', () => {
    console.log('JiraWorklog menubar app ready');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
