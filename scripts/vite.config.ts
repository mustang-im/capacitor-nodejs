import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'node:url';
import { chmod, readdir } from 'node:fs/promises';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = dirname(fileURLToPath(import.meta.url));

// External modules that should not be bundled
const EXTERNAL_MODULES = ['nodejs-mobile-gyp', 'xcode', 'adm-zip'];

/**
 * Vite plugin to make built scripts executable
 * File copying is handled by vite-plugin-static-copy
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

        // Make JS entry scripts executable
        await Promise.all(
          scriptsToChmod.map(file =>
            chmod(join(distDir, file), 0o755).catch(err => {
              console.warn(`Failed to chmod ${file}:`, err);
            })
          )
        );

        // Make shell scripts executable (copied by vite-plugin-static-copy)
        const shellScripts = ['sign-native-modules.sh'];
        const { access } = await import('node:fs/promises');
        await Promise.all(
          shellScripts.map(async (script) => {
            const scriptPath = join(distDir, script);
            try {
              // Wait for file to exist (vite-plugin-static-copy may still be copying)
              await access(scriptPath);
              await chmod(scriptPath, 0o755);
            } catch (err) {
              // File doesn't exist yet or chmod failed - that's OK
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`Failed to chmod ${script}:`, err);
              }
            }
          })
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
  'before-sync': resolve(__dirname, 'common/before-sync.ts'),
  'after-sync': resolve(__dirname, 'common/after-sync.ts'),
  'fetch-libnode': resolve(__dirname, 'common/fetch-libnode.ts'),
  'rebuild-native-module': resolve(__dirname, 'common/rebuild-native-module.ts'),
  'ios-after-sync': resolve(__dirname, 'ios/ios-after-sync.ts'),
  'ios-create-plists-and-dlopen-override': resolve(__dirname, 'ios/ios-create-plists-and-dlopen-override.ts'),
  'create-frameworks-and-override': resolve(__dirname, 'ios/create-frameworks-and-override.ts'),
  'override-dlopen-paths-preload': resolve(__dirname, 'ios/override-dlopen-paths-preload.ts'),
  'rebuild-native-modules': resolve(__dirname, 'ios/rebuild-native-modules.ts'),
};

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'ios/sign-native-modules.sh',
          dest: '.',
        },
        {
          src: 'ios/ios-xcframework-info-plist.template.xml',
          dest: '.',
        },
      ],
    }),
    commonjs({
      transformMixedEsModules: true,
      // Handle CommonJS modules that don't have default exports
      defaultIsModuleExports: true,
      requireReturnsDefault: 'auto',
    }),
    makeScriptsExecutable(),
  ],
  ssr: {
    // Bundle all dependencies except external modules
    noExternal: new RegExp(`^(?!${EXTERNAL_MODULES.join('|')}).*$`),
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
        // Externalize node built-ins and specific modules (they'll be resolved from node_modules at runtime)
        if (id.startsWith('node:')) {
          return true; // Node built-ins
        }
        // Check if id matches any external module or its subpaths
        return EXTERNAL_MODULES.some((module) => id === module || id.startsWith(`${module}/`));
      },
      plugins: [
        nodeResolve({
          preferBuiltins: true,
          exportConditions: ['node', 'default'],
          // Bundle all dependencies except external modules
          resolveOnly: (module) => !EXTERNAL_MODULES.includes(module),
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
