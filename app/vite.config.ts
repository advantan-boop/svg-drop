import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { aiMiddleware } from './server/ai';

// /api/* обслуживается тем же процессом, что и фронтенд (dev и preview)
const api = (): Plugin => ({
  name: 'svg-drop-api',
  configureServer(s) { s.middlewares.use(aiMiddleware(s.config.root)); },
  configurePreviewServer(s) { s.middlewares.use(aiMiddleware(s.config.root)); },
});

// GITHUB_PAGES=1 — статическая сборка для https://<user>.github.io/svg-drop/
// (без сервера: подбор по метафоре работает локально, по тегам)
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/svg-drop/' : '/',
  plugins: [react(), api()],
});
