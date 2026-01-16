import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/sienge': {
        target: 'https://api.sienge.com.br',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          // Remove /api/sienge do início e mantém o resto do caminho
          // Exemplo: /api/sienge/imincorporadora/public/api/v1/creditors -> /imincorporadora/public/api/v1/creditors
          return path.replace(/^\/api\/sienge/, '')
        },
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('❌ Proxy error:', err.message)
          })
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Manter todos os headers originais, especialmente authorization
            console.log('🔄 Proxying:', req.method, req.url)
          })
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('✅ Proxy response:', proxyRes.statusCode, req.url)
          })
        }
      }
    }
  }
})
