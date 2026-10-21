const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = path.join(root, 'dist/index.html');
const source = fs.readFileSync(html, 'utf8');
// One self-contained IIFE: classic scripts avoid file-origin module CORS failures.
fs.writeFileSync(html, source.replace(/type="module"\s*/g, 'defer ').replace(/\s*crossorigin(?:="[^"]*")?/g, ''));
fs.mkdirSync(path.join(root, 'renderer'), { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(root, 'renderer'), { recursive: true });
