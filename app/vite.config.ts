import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { aiMiddleware } from './server/ai';

// /api/* обслуживается тем же процессом, что и фронтенд (dev и preview)
const api = (): Plugin => ({
  name: 'svg-drop-api',
  configureServer(s) { s.middlewares.use(aiMiddleware(s.config.root)); },
  configurePreviewServer(s) { s.middlewares.use(aiMiddleware(s.config.root)); },
});

export default defineConfig({
  plugins: [react(), api()],
});
