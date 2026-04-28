import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// REMOVE_BEFORE_LAUNCH (Gap 1.1.G) — picker is dev-phase tooling only.
// Static bundle is served by the acreos express server at /__dev/picker/
// so iframes inside the picker can load same-origin acreos URLs (Clerk
// cookies require same-origin to render authenticated UI in iframes).
export default defineConfig({
  plugins: [react()],
  base: '/__dev/picker/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
