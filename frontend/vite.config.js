import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Safe headers that do not break Vite HMR / React Fast Refresh. */
const sharedSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * CSP for production static builds only. Do NOT set on the Vite dev server —
 * it blocks inline preamble scripts and HMR websockets.
 */
const productionCsp =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: sharedSecurityHeaders,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: {
      ...sharedSecurityHeaders,
      'Content-Security-Policy': productionCsp,
    },
  },
});
