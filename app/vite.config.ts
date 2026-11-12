import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GITHUB_PAGES=1 — сборка для https://<user>.github.io/svg-drop/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/svg-drop/' : '/',
  plugins: [react()],
});
