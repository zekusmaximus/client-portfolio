import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Ensure HTTPS in production
  const getApiBaseUrl = () => {
    const envUrl = process.env.VITE_API_BASE_URL;
    
    if (mode === 'production') {
      if (!envUrl) {
        throw new Error('VITE_API_BASE_URL must be set for production builds');
      }
      // Enforce HTTPS for production
      if (!envUrl.startsWith('https://')) {
        throw new Error('Production API URL must use HTTPS protocol');
      }
      return envUrl;
    }
    
    // Development fallback
    return envUrl || 'http://localhost:5000';
  };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@/components": path.resolve(__dirname, "./src/components"),
        "@/lib": path.resolve(__dirname, "./src/lib"),
        "@/types": path.resolve(__dirname, "./src/types"),
        "@/utils": path.resolve(__dirname, "./src/utils")
      },
    },
    define: {
      'process.env.VITE_API_BASE_URL': JSON.stringify(getApiBaseUrl())
    }
  };
})

