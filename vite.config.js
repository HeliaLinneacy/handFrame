import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@mediapipe/hands', '@mediapipe/camera_utils', '@mediapipe/drawing_utils']
  },
  server: {
    host: true
  }
})
