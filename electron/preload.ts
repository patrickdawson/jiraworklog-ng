import { contextBridge } from 'electron';

// Establishes contextIsolation boundary; exposes no Node.js APIs to the renderer.
contextBridge.exposeInMainWorld('__jwl', {});
