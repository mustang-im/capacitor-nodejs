import { defineConfig } from 'vite';
import nodeExternals from 'rollup-plugin-node-externals';

export default defineConfig({
  plugins: [
    nodeExternals({
      deps: false,
      devDeps: true,
    }),
  ],
  build: {
    outDir: './',
    lib: {
      entry: './fetch-libnode.ts',
      formats: ["es"],
      fileName: 'fetch-libnode',
    },
    minify: 'esbuild',
  },
});
