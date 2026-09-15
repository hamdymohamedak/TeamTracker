#!/usr/bin/env node
/**
 * Ensures Electron's binary exists. pnpm/extract-zip sometimes leaves
 * path.txt without dist/Electron.app on this volume.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronDir = path.dirname(require.resolve('electron/package.json'));
const binaryRel = process.platform === 'darwin'
  ? 'Electron.app/Contents/MacOS/Electron'
  : process.platform === 'win32'
    ? 'electron.exe'
    : 'electron';
const binaryPath = path.join(electronDir, 'dist', binaryRel);
const pathTxt = path.join(electronDir, 'path.txt');

if (fs.existsSync(binaryPath)) {
  process.exit(0);
}

console.log('[ensure-electron] Electron binary missing; repairing…');
fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true });
fs.rmSync(pathTxt, { force: true });

const install = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (fs.existsSync(binaryPath)) {
  process.exit(install.status ?? 0);
}

// Fallback: unzip from @electron/get cache (install.js uses extract-zip, which can fail here)
const version = require(path.join(electronDir, 'package.json')).version;
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const cacheRoot = process.env.electron_config_cache
  || path.join(os.homedir(), 'Library', 'Caches', 'electron');

function findZip(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findZip(full);
      if (found) return found;
    } else if (entry.name === zipName) {
      return full;
    }
  }
  return null;
}

const zip = findZip(cacheRoot);
if (!zip) {
  console.error(`[ensure-electron] Could not find ${zipName} in ${cacheRoot}`);
  process.exit(1);
}

const dist = path.join(electronDir, 'dist');
fs.mkdirSync(dist, { recursive: true });
const unzip = spawnSync('unzip', ['-q', '-o', zip, '-d', dist], { stdio: 'inherit' });
if (unzip.status !== 0) {
  console.error('[ensure-electron] unzip failed');
  process.exit(unzip.status ?? 1);
}
fs.writeFileSync(pathTxt, binaryRel);
if (!fs.existsSync(binaryPath)) {
  console.error('[ensure-electron] Binary still missing after unzip');
  process.exit(1);
}
console.log('[ensure-electron] Restored Electron from cache via unzip');
