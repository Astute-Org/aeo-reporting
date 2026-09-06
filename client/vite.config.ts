import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development Vite serves the client and proxies /api to the server.
// In production the server serves client/dist itself and no proxy exists.
//
// The server's port is read from AEO_PORT, not PORT: some launchers set PORT
// for the process they open in the browser (this client), and the server must
// not follow it onto the same port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.CLIENT_PORT) || 5180,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.AEO_PORT || 3400}`,
        changeOrigin: true,
      },
    },
  },
});
