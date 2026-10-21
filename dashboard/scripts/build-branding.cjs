const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}
function icns(images) {
  const types = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const chunks = images.filter(({ size }) => types[size]).map(({ size, png }) => {
    const header = Buffer.alloc(8); header.write(types[size], 0); header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}
async function build() {
  const config = JSON.parse(await fs.readFile(path.join(root, 'branding/brand.json'), 'utf8'));
  const master = path.join(root, 'branding', config.master);
  const source = await fs.readFile(master, 'utf8');
  if (!source.includes('viewBox="0 0 64 64"')) throw new Error('Keep the master viewBox at 0 0 64 64.');
  const mark = source.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<(title|desc)>[\s\S]*?<\/\1>/g, '').replaceAll('#ffffff', config.foreground);
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>SyscallGuard</title><rect x="2" y="2" width="124" height="124" rx="28" fill="${config.background}" stroke="#ffffff" stroke-opacity=".14"/><g transform="translate(20 20) scale(1.375)">${mark}</g></svg>`;
  const publicPath = path.join(root, 'public/branding');
  const nativePath = path.join(root, 'build/icons');
  await fs.mkdir(publicPath, { recursive: true }); await fs.mkdir(nativePath, { recursive: true });
  const writePublic = (name, value) => fs.writeFile(path.join(publicPath, name), value);
  await writePublic('logo.svg', source);
  await writePublic('logo-dark.svg', source.replaceAll('#ffffff', config.background));
  await writePublic('app-icon.svg', tile); await writePublic('favicon.svg', tile);
  await fs.writeFile(path.join(root, 'public/logo.svg'), source);
  const raster = (svg, size) => sharp(Buffer.from(svg), { density: 1152 }).resize(size, size).png().toBuffer();
  await writePublic('logo.png', await raster(source, 1024));
  await writePublic('logo-dark.png', await raster(source.replaceAll('#ffffff', config.background), 1024));
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const png = await raster(tile, size); images.push({ size, png });
    await writePublic(`app-icon-${size}.png`, png);
    await fs.writeFile(path.join(nativePath, `${size}x${size}.png`), png);
  }
  for (const [name, size] of [['favicon-16x16.png', 16], ['favicon-32x32.png', 32], ['apple-touch-icon.png', 180], ['android-chrome-192x192.png', 192], ['android-chrome-512x512.png', 512]]) await writePublic(name, await raster(tile, size));
  await writePublic('favicon.ico', ico(images.filter(({ size }) => size <= 64)));
  await fs.writeFile(path.join(nativePath, 'icon.ico'), ico(images.filter(({ size }) => size <= 256)));
  await fs.writeFile(path.join(nativePath, 'icon.icns'), icns(images));
  await fs.writeFile(path.join(nativePath, 'icon.png'), images.find(({ size }) => size === 512).png);
  const manifest = { name: config.name, short_name: config.shortName, description: config.description, start_url: '../index.html', display: 'standalone',
    background_color: config.background, theme_color: config.background,
    icons: [192, 512].map((n) => ({ src: `android-chrome-${n}x${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' })) };
  await writePublic('site.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
  const generated = [];
  for (const directory of [publicPath, nativePath]) for (const name of (await fs.readdir(directory)).sort()) generated.push(path.relative(root, path.join(directory, name)));
  await fs.writeFile(path.join(root, 'branding/asset-manifest.json'), JSON.stringify({ master: path.relative(root, master), generated }, null, 2) + '\n');
  process.stdout.write('Brand assets regenerated from branding/mark.svg.\n');
}
build().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
