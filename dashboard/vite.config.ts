import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    // React refresh injects an inline preamble in dev; production keeps script-src self.
    transformIndexHtml: (html) => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
  }],
  base: './', // Vital for Electron loading files via file://
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
