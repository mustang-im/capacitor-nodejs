import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: './dist',
    ssr: true, // Build for Node.js (SSR mode)
    rollupOptions: {
      input: {
        'after-copy': resolve(__dirname, 'fetch-libnode.ts'),
        'rebuild-native-module': resolve(__dirname, 'rebuild-native-module.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        banner: '#!/usr/bin/env node', // Add shebang for executable scripts
      },
      external: (id) => {
        // Externalize node built-ins (they're available at runtime)
        return id.startsWith('node:');
      },
    },
    minify: 'esbuild',
    target: 'node18',
  },
});
