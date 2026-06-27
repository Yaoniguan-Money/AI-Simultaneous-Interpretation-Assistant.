import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              /** 数组形式触发 Vite resolveBuildOutputs 的 Array.isArray 分支，绕过 build.lib.formats 映射 */
              output: [{
                format: 'cjs',
                entryFileNames: '[name].cjs',
              }],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              /** 数组形式触发 Vite resolveBuildOutputs 的 Array.isArray 分支，绕过 build.lib.formats 映射 */
              output: [{
                format: 'cjs',
                entryFileNames: '[name].cjs',
              }],
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
