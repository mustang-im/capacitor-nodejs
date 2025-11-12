import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [],
  build: {
    outDir: './dist',
    ssr: true, // Build for Node.js (SSR mode)
    rollupOptions: {
      input: {
        'after-copy': resolve(__dirname, 'after-copy.ts'),
        'after-prepare-native-modules-preference': resolve(__dirname, 'both/after-prepare-native-modules-preference.ts'),
        'after-prepare-patch-npm-packages': resolve(__dirname, 'both/after-prepare-patch-npm-packages.ts'),
        'after-prepare-build-node-assets-lists': resolve(__dirname, 'android/after-prepare-build-node-assets-lists.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
      external: (id) => {
        // Externalize node built-ins and @capacitor/cli (available in user's node_modules)
        return id.startsWith('node:') || id === '@capacitor/cli/dist/config.js' || id.startsWith('@capacitor/cli');
      },
    },
    minify: 'esbuild',
  },
});

