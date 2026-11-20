import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifestFilename: 'manifest.json',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'FreshVeggie Delivery',
          short_name: 'FreshVeggie',
          description: 'Farm fresh vegetables delivered to your doorstep in minutes.',
          theme_color: '#16a34a',
          background_color: '#16a34a',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          categories: ['shopping', 'food', 'lifestyle'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ],
          shortcuts: [
            {
              name: 'Explore Veggies',
              short_name: 'Browse',
              url: '/browse',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
            },
            {
              name: 'My Orders',
              short_name: 'Orders',
              url: '/orders',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
            },
            {
              name: 'Shopping Cart',
              short_name: 'Cart',
              url: '/cart',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
          runtimeCaching: [
            {
              urlPattern: /\/api\/(catalog\/bootstrap|slots)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'edge-api-bootstrap-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 5
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'product-images-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: true,
          type: 'module'
        }
      })
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
