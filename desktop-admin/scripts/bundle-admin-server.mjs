#!/usr/bin/env node
/**
 * Bundle the admin server + client SPA into desktop-admin/server-bundle
 * for packaging as Electron extraResources.
 *
 * Usage (from repo root or desktop-admin):
 *   node desktop-admin/scripts/bundle-admin-server.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopAdminRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopAdminRoot, '..');
const adminRoot = path.join(repoRoot, 'admin');
const outRoot = path.join(desktopAdminRoot, 'server-bundle');
const electronVersion = '30.5.1';

function run(cmd, args, cwd, env = {}) {
  console.log(`> ${cmd} ${args.join(' ')} (cwd=${cwd})`);
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${cmd} ${args.join(' ')}`);
  }
}

function main() {
  if (process.env.SKIP_ADMIN_SERVER_BUNDLE === '1') {
    const entry = path.join(outRoot, 'dist', 'server', 'index.js');
    if (fs.existsSync(entry)) {
      console.log('SKIP_ADMIN_SERVER_BUNDLE=1 — using existing server-bundle');
      return;
    }
    throw new Error('SKIP_ADMIN_SERVER_BUNDLE=1 but server-bundle is missing');
  }

  if (!fs.existsSync(adminRoot)) {
    const entry = path.join(outRoot, 'dist', 'server', 'index.js');
    if (fs.existsSync(entry)) {
      console.log(`Admin package not at ${adminRoot}; keeping existing server-bundle`);
      return;
    }
    throw new Error(`Admin package not found at ${adminRoot}`);
  }

  // Build admin (server + client) if dist missing or FORCE_ADMIN_BUILD=1
  const distServer = path.join(adminRoot, 'dist', 'server', 'index.js');
  const distClient = path.join(adminRoot, 'dist', 'client', 'index.html');
  if (!fs.existsSync(distServer) || !fs.existsSync(distClient) || process.env.FORCE_ADMIN_BUILD === '1') {
    run('pnpm', ['run', 'build'], adminRoot);
  }

  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });

  fs.cpSync(path.join(adminRoot, 'dist'), path.join(outRoot, 'dist'), { recursive: true });

  const adminPkg = JSON.parse(fs.readFileSync(path.join(adminRoot, 'package.json'), 'utf8'));
  // Server runtime deps only (exclude React UI packages used at build time)
  const serverDepNames = [
    'bonjour-service',
    'bcryptjs',
    'cors',
    'dotenv',
    'express',
    'jsonwebtoken',
    'nodemailer',
    'sqlite',
    'sqlite3',
    'uuid',
    'ws',
  ];
  const dependencies = {};
  for (const name of serverDepNames) {
    if (adminPkg.dependencies?.[name]) dependencies[name] = adminPkg.dependencies[name];
  }

  const bundlePkg = {
    name: 'teamtracker-admin-server-bundle',
    version: adminPkg.version || '1.0.0',
    private: true,
    type: 'module',
    dependencies,
  };
  fs.writeFileSync(path.join(outRoot, 'package.json'), JSON.stringify(bundlePkg, null, 2));

  // Prefer npm for a flat install inside the bundle (portable for electron-builder copy)
  run('npm', ['install', '--omit=dev', '--no-package-lock'], outRoot);

  // Rebuild native sqlite3 for Electron's Node ABI (ELECTRON_RUN_AS_NODE)
  run(
    'npx',
    ['--yes', `@electron/rebuild@3.7.1`, `-v`, electronVersion, `-f`, `-w`, 'sqlite3'],
    outRoot
  );

  // Marker for runtime
  fs.writeFileSync(
    path.join(outRoot, 'BUNDLE_INFO.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        electronVersion,
        adminVersion: adminPkg.version,
      },
      null,
      2
    )
  );

  console.log(`Admin server bundle ready: ${outRoot}`);
}

main();
