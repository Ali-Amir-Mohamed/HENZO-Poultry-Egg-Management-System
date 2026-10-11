import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Version shown in the app (login page, Synchro): build date + short commit
const commit = (process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || (() => {
  try { return execSync('git rev-parse HEAD').toString().trim() } catch { return '' }
})()).slice(0, 7)
const version = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}${commit ? ' · ' + commit : ''}`

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      output: {
        // Libraries in their own files: an app update does not re-download them
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          outils: ['i18next', 'react-i18next', 'dexie']
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'HENZO – Gestion avicole',
        short_name: 'HENZO',
        description: 'Gestion de ferme avicole et production d’œufs',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#132a47',
        theme_color: '#132a47',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // Notifications on the phone: push and click handlers
        importScripts: ['push-sw.js'],
        // Supabase API calls are never cached: offline writes go through the IndexedDB queue instead.
        // Only the Google font is cached so the app keeps its look offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
})
