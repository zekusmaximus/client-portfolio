import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    'process.env.VITE_API_BASE_URL': JSON.stringify('https://5000-iu5y7tq9e83tumhd1uoou-57987d5d.manusvm.computer')
  }
})

