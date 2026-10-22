import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const BACKEND_URL = 'https://api.echosocial.fr';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Preview tunnels (Codespaces/LocalTunnel) use a public Host header.
    allowedHosts: true,
    proxy: {
      '/api': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/messaging': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/notif': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/watches': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/tools': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/jarvis': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/relations': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/groups': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/framework': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/scripts': { target: BACKEND_URL, changeOrigin: true, secure: true },
      '/ws': { target: BACKEND_URL.replace('https', 'wss'), ws: true, changeOrigin: true, secure: true },
    },
  },
  resolve: {
    alias: [
      { find: '@web', replacement: path.resolve(__dirname, './src') },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
})
