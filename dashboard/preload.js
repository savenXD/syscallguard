const { contextBridge } = require('electron');

// Extract bridge URL passed from main process via additionalArguments
let bridgeUrl = 'ws://127.0.0.1:8765';
for (const arg of process.argv) {
  if (arg.startsWith('--bridge-url=')) {
    bridgeUrl = arg.slice('--bridge-url='.length);
    break;
  }
}

// Expose only the bridge URL to window. Nothing else crosses the boundary.
contextBridge.exposeInMainWorld('bridgeUrl', bridgeUrl);
