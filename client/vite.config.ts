import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development Vite serves the client and proxies /api to the server.
// In production the server serves client/dist itself and no proxy exists.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.CLIENT_PORT) || 5180,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 3400}`,
        changeOrigin: true,
      },
    },
  },
});
