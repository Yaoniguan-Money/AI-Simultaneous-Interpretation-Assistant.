import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { writeFileSync } from 'node:fs';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        /** 构建后将 CJS 覆盖写入 dist-electron，解决 "type": "module" 与 Rollup ESM 产物 + electron 模块解析冲突 */
        onstart() {
          const pkgPath = path.resolve(__dirname, 'dist-electron', 'package.json');
          writeFileSync(pkgPath, JSON.stringify({ type: 'commonjs' }));
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
