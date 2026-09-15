import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: path.join(__dirname, 'src/main.ts'),
      formats: ['cjs'],
      fileName: 'main',
    },
    rollupOptions: {
      external: ['electron', 'electron-store', 'fs', 'path', 'url'],
      output: { inlineDynamicImports: true },
    },
    ssr: true,
  },
});
