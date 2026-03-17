import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
