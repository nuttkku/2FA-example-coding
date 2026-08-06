import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    port: 5173,
    // Vite's dev server enables permissive CORS (any origin) by default. This app
    // never needs cross-origin requests to reach it - the browser only ever talks
    // to this same origin - so we turn the default off (npm audit / GHSA-67mh-4wv8-2f99
    // flags the same class of issue one level down in esbuild's own dev server).
    cors: false,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
