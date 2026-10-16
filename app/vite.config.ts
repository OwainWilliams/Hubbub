import { defineConfig } from 'vite';

// Relative base so the build works on a GitHub Pages project path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
