#!/usr/bin/env node
/**
 * Materialize live-view modules next to admin/desktop consumers.
 *
 * Production must NOT use relative re-exports into shared/dist — those break
 * once TypeScript emits under admin/dist/ (one extra directory segment).
 * Instead we copy the compiled shared/dist/live-view runtime files into place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const srcDir = path.join(root, 'shared', 'dist', 'live-view');

if (!fs.existsSync(path.join(srcDir, 'index.js'))) {
  console.error(`Missing ${srcDir}/index.js — run shared build first`);
  process.exit(1);
}

/** @type {{ dir: string, mode: 'runtime' | 'full' }[]} */
const targets = [];
if (!args.has('--dist-only')) {
  // Keep hand-written .ts re-export stubs for tsc; only replace runtime .js
  targets.push(
    { dir: path.join(root, 'admin', 'shared', 'live-view'), mode: 'runtime' },
    { dir: path.join(root, 'desktop', 'src', 'live-view-shared'), mode: 'runtime' }
  );
}
if (args.has('--dist') || args.has('--dist-only')) {
  targets.push({
    dir: path.join(root, 'admin', 'dist', 'shared', 'live-view'),
    mode: 'full',
  });
}

if (targets.length === 0) {
  console.error('Usage: write-live-view-stubs.mjs [--dist] [--dist-only]');
  process.exit(1);
}

function copyLiveView(destDir, mode) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (mode === 'runtime' && !name.endsWith('.js')) {
      continue;
    }
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  }
  console.log(`copied live-view (${mode}) → ${path.relative(root, destDir)}`);
}

for (const { dir, mode } of targets) {
  copyLiveView(dir, mode);
}
