import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { optimizeGlbFile } from './scripts/optimize-models.mjs'

function publicModelsManifest() {
  const virtualId = 'virtual:public-models'
  const resolvedId = '\0' + virtualId
  const outDir = path.resolve(__dirname, 'public/models')
  const srcDir = path.resolve(__dirname, 'models-src')

  function listGlbs() {
    try {
      return fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.glb'))
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
      // Watch both: outDir so the virtual manifest refreshes when optimized files appear,
      // and srcDir so we can auto-optimize GLBs dropped into models-src/ during dev.
      server.watcher.add(outDir)
      if (fs.existsSync(srcDir)) server.watcher.add(srcDir)

      const reload = () => {
        const mod = server.moduleGraph.getModuleById(resolvedId)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }

      // Wait until the file stops growing before optimizing — guards against
      // running gltf-transform on a half-written .glb while a drag-and-drop copy is still in flight.
      function waitForStable(file, cb) {
        let lastSize = -1
        const tick = () => {
          let size
          try { size = fs.statSync(file).size } catch { return }
          if (size === lastSize && size > 0) return cb()
          lastSize = size
          setTimeout(tick, 300)
        }
        tick()
      }

      server.watcher.on('add', (file) => {
        if (file.startsWith(srcDir) && file.toLowerCase().endsWith('.glb')) {
          waitForStable(file, () => {
            try {
              optimizeGlbFile(file)
            } catch (e) {
              console.error('[models] optimize failed:', e.message)
            }
            reload()
          })
          return
        }
        if (file.startsWith(outDir)) reload()
      })

      server.watcher.on('change', (file) => {
        // Re-optimize a source that was replaced in place
        if (file.startsWith(srcDir) && file.toLowerCase().endsWith('.glb')) {
          waitForStable(file, () => {
            try {
              optimizeGlbFile(file)
            } catch (e) {
              console.error('[models] optimize failed:', e.message)
            }
            reload()
          })
        }
      })

      server.watcher.on('unlink', (file) => {
        if (file.startsWith(outDir) || file.startsWith(srcDir)) reload()
      })
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
