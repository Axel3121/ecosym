import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Axey-backend (leser Hermes' SQLite read-only) kjører på 8787
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
