import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'node:url';
import { chmod } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin to make built scripts executable
 */
function makeScriptsExecutable(): Plugin {
  return {
    name: 'make-scripts-executable',
    async writeBundle() {
      const distDir = join(__dirname, 'dist');
      try {
        const files = await readdir(distDir);
        const jsFiles = files.filter(f => f.endsWith('.js'));

        // Make only the entry point scripts executable (not chunk files)
        const entryScripts = Object.keys(scriptInputs).map(name => `${name}.js`);
        const scriptsToChmod = jsFiles.filter(f => entryScripts.includes(f));

        await Promise.all(
          scriptsToChmod.map(file =>
            chmod(join(distDir, file), 0o755).catch(err => {
              console.warn(`Failed to chmod ${file}:`, err);
            })
          )
        );

        if (scriptsToChmod.length > 0) {
          console.log(`Made ${scriptsToChmod.length} script(s) executable`);
        }
      } catch (error) {
        console.warn('Failed to make scripts executable:', error);
      }
    },
  };
}

const scriptInputs = {
  'after-copy': resolve(__dirname, 'after-copy.ts'),
  'fetch-libnode': resolve(__dirname, 'fetch-libnode.ts'),
  'rebuild-native-module': resolve(__dirname, 'rebuild-native-module.ts'),
  'ios-after-plugin-install': resolve(__dirname, 'ios-after-plugin-install.ts'),
  'ios-create-plists-and-dlopen-override': resolve(__dirname, 'ios-create-plists-and-dlopen-override.ts'),
};

export default defineConfig({
  plugins: [
    commonjs({
      transformMixedEsModules: true,
      // Handle CommonJS modules that don't have default exports
      defaultIsModuleExports: true,
      requireReturnsDefault: 'auto',
    }),
    makeScriptsExecutable(),
  ],
  ssr: {
    // Bundle all dependencies except nodejs-mobile-gyp, xcode, and adm-zip
    noExternal: /^(?!nodejs-mobile-gyp|xcode|adm-zip).*$/,
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
        // Externalize node built-ins, nodejs-mobile-gyp, xcode, and adm-zip (they'll be resolved from node_modules at runtime)
        if (id.startsWith('node:')) {
          return true; // Node built-ins (includes node:fs/promises for glob)
        }
        if (id === 'nodejs-mobile-gyp' || id.startsWith('nodejs-mobile-gyp/')) {
          return true; // Keep nodejs-mobile-gyp external
        }
        if (id === 'xcode' || id.startsWith('xcode/')) {
          return true; // Keep xcode external
        }
        if (id === 'adm-zip' || id.startsWith('adm-zip/')) {
          return true; // Keep adm-zip external
        }
        // Bundle everything else (local imports and npm packages)
        return false;
      },
      plugins: [
        nodeResolve({
          preferBuiltins: true,
          exportConditions: ['node', 'default'],
          // Bundle all dependencies except nodejs-mobile-gyp, xcode, and adm-zip
          resolveOnly: (module) => {
            return module !== 'nodejs-mobile-gyp' && module !== 'xcode' && module !== 'adm-zip';
          },
        }),
      ],
    },
    minify: 'esbuild', // Fast and effective minification
    target: 'node18',
    sourcemap: false, // Disable sourcemaps for smaller bundles
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
});
