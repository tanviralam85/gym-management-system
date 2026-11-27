import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  return {
    plugins: [react()],
    envDir: '..',
    server: {
      host: '127.0.0.1',
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${env.API_PORT ?? 3000}`,
      },
    },
  };
});
