import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function publicModelsManifest() {
  const virtualId = 'virtual:public-models'
  const resolvedId = '\0' + virtualId
  const dir = path.resolve(__dirname, 'public/models')

  function listGlbs() {
    try {
      return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb'))
    } catch {
      return []
    }
  }

  return {
    name: 'public-models-manifest',
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    load(id) {
      if (id === resolvedId) {
        return `export default ${JSON.stringify(listGlbs())}`
      }
    },
    configureServer(server) {
      server.watcher.add(dir)
      const invalidate = (file) => {
        if (file.startsWith(dir)) {
          const mod = server.moduleGraph.getModuleById(resolvedId)
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      }
      server.watcher.on('add', invalidate)
      server.watcher.on('unlink', invalidate)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), publicModelsManifest()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    fileParallelism: false,
  },
})
