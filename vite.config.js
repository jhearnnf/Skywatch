import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { optimizeGlbFile } from './scripts/optimize-models.mjs'
import { OFFLINE_AIRCRAFT_GLBS } from './src/lib/offlineAircraft.js'

// Identifies the exact frontend bundle a browser is running, which is reported
// on every heartbeat and surfaced in Admin › Users. On web the semver alone is
// not enough: the PWA service worker can leave a device pinned to an older
// bundle indefinitely, and two deploys of the same version are indistinguishable
// without the commit. Vercel injects the sha at build time; locally we ask git.
function buildId() {
  const fromCI = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VITE_VERCEL_GIT_COMMIT_SHA
  if (fromCI) return fromCI.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'dev'
  }
}

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Precache exactly the offline aircraft GLBs (Typhoon + Hawk T2) — the heavy
// World3D character/scene models are deliberately left out. Each entry needs a
// revision so the service worker re-fetches when the model changes.
function offlineGlbPrecacheEntries() {
  return OFFLINE_AIRCRAFT_GLBS.map((file) => {
    const abs = path.resolve(__dirname, 'public/models', file)
    let revision = null
    try {
      revision = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex')
    } catch {
      /* model not present at build time — skip revision */
    }
    return { url: `/models/${file}`, revision }
  })
}

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
  plugins: [
    react(),
    tailwindcss(),
    publicModelsManifest(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually (web only) in src/main.jsx
      manifest: false,       // keep the existing public/manifest.webmanifest
      workbox: {
        // Precache the app shell. GLBs are added explicitly below so the heavy
        // World3D models (character/scene) are never precached.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,png,ico}'],
        globIgnores: ['**/models/**'],
        additionalManifestEntries: offlineGlbPrecacheEntries(),
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 3D/vendor chunks
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Aircraft cutout images live on Cloudinary — cache on first use so
            // the warm step (and any online play) makes them available offline.
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sw-cloudinary-cutouts',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // CBAT aircraft roster JSON — serve fresh when online, fall back to
            // the last cached copy offline.
            urlPattern: ({ url }) =>
              url.pathname.includes('/api/games/cbat/aircraft-cutouts') ||
              url.pathname.includes('/api/games/cbat/fighter-aircraft'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'sw-cbat-roster',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Any aircraft GLB requested at runtime — belt-and-suspenders on top
            // of the precached offline pair.
            urlPattern: ({ url }) => url.pathname.startsWith('/models/') && url.pathname.endsWith('.glb'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sw-aircraft-models',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_BUILD__:   JSON.stringify(buildId()),
  },
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
    pool: 'forks',
  },
})
