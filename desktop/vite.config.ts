import { defineConfig } from 'vite';
import path from 'path';

const PRODUCTION_SERVER_URL = 'https://tracker.hostly-eg.com';
const LOCAL_SERVER_URL = 'http://localhost:3001';

export default defineConfig(({ mode }) => {
  // Explicit override for CI / one-off builds, else mode picks local vs prod.
  const defaultServerUrl = (
    process.env.TEAMTRACKER_SERVER_URL ||
    (mode === 'development' ? LOCAL_SERVER_URL : PRODUCTION_SERVER_URL)
  ).replace(/\/+$/, '');

  console.log(`[vite] mode=${mode} default serverUrl=${defaultServerUrl}`);

  return {
    define: {
      __TEAMTRACKER_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
    },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
      lib: {
        entry: path.join(__dirname, 'src/main.ts'),
        formats: ['cjs'],
        fileName: 'main'
      },
      rollupOptions: {
        external: [
          'electron',
          'electron-store',
          'active-win',
          'child_process',
          'util',
          'fs',
          'path'
        ],
        output: {
          inlineDynamicImports: true,
        },
      },
      ssr: true,  // This tells Vite this is a Node.js build
    },
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
      },
    },
  };
});
