import { defineConfig } from 'vite';
import versionInfo from '../version.json';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION_LABEL__: JSON.stringify(versionInfo.label),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
