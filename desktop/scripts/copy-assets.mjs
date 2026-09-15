#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(root, 'src/preload.cjs'), path.join(dist, 'preload.cjs'));

const uiSrc = path.join(root, 'src/ui');
const uiDest = path.join(dist, 'ui');
fs.rmSync(uiDest, { recursive: true, force: true });
fs.cpSync(uiSrc, uiDest, { recursive: true });

console.log('[copy-assets] copied preload.cjs and ui/ to dist/');
