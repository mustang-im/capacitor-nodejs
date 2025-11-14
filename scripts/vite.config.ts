import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scriptInputs = {
  'after-copy': resolve(__dirname, 'after-copy.ts'),
  'fetch-libnode': resolve(__dirname, 'fetch-libnode.ts'),
  'rebuild-native-module': resolve(__dirname, 'rebuild-native-module.ts'),
  'ios-after-plugin-install': resolve(__dirname, 'ios-after-plugin-install.ts'),
};

export default defineConfig({
  plugins: [
    commonjs({
      transformMixedEsModules: true,
      // Handle CommonJS modules that don't have default exports
      defaultIsModuleExports: true,
      requireReturnsDefault: 'auto',
    }),
  ],
  ssr: {
    // Bundle all dependencies except nodejs-mobile-gyp and xcode
    noExternal: /^(?!nodejs-mobile-gyp|xcode).*$/,
  },
  build: {
    outDir: './dist',
    ssr: true,
    rollupOptions: {
      input: scriptInputs,
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        banner: '#!/usr/bin/env node',
        inlineDynamicImports: false,
        // Optimize for smaller output
        compact: true, // Remove whitespace
        generatedCode: {
          constBindings: true, // Use const instead of var for better minification
        },
      },
      external: (id) => {
        // Externalize node built-ins, nodejs-mobile-gyp, and xcode (they'll be resolved from node_modules at runtime)
        // Bundle all other dependencies (adm-zip, etc.)
        if (id.startsWith('node:')) {
          return true; // Node built-ins (includes node:fs/promises for glob)
        }
        if (id === 'nodejs-mobile-gyp' || id.startsWith('nodejs-mobile-gyp/')) {
          return true; // Keep nodejs-mobile-gyp external
        }
        if (id === 'xcode' || id.startsWith('xcode/')) {
          return true; // Keep xcode external
        }
        // Bundle everything else (local imports and npm packages)
        return false;
      },
      plugins: [
        nodeResolve({
          preferBuiltins: true,
          exportConditions: ['node', 'default'],
          // Bundle all dependencies except nodejs-mobile-gyp and xcode
          resolveOnly: (module) => {
            return module !== 'nodejs-mobile-gyp' && module !== 'xcode';
          },
        }),
      ],
    },
    minify: 'esbuild', // Fast and effective minification
    target: 'node18',
    sourcemap: false, // Disable sourcemaps for smaller bundles
    // Esbuild minification options
    esbuild: {
      drop: ['console'], // Remove console statements
      legalComments: 'none', // Remove comments
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
});
