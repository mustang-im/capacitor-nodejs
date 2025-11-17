/**
 * iOS helper script to create Info.plist files for xcframeworks and copy dlopen override script
 * 
 * Ported from nodejs-mobile-cordova helper scripts
 * https://github.com/nodejs-mobile/nodejs-mobile-cordova/tree/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/helper-scripts
 */

import { existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processXCFrameworks } from './ios-create-plists.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Main function
 */
async function main(): Promise<void> {
  const nodejsProjectDir = process.argv[2];
  
  if (!nodejsProjectDir) {
    console.error('Usage: node ios-create-plists-and-dlopen-override.js <nodejs-project-dir>');
    process.exit(1);
  }
  
  // Process xcframeworks and create Info.plist files
  await processXCFrameworks(nodejsProjectDir);
  
  // Copy the minified override script to the nodejs directory
  // The override script is built by Vite and minified
  const overrideScriptSource = join(__dirname, 'dist', 'override-dlopen-paths-preload.js');
  const overrideScriptDest = join(nodejsProjectDir, 'override-dlopen-paths-preload.js');
  
  if (existsSync(overrideScriptSource)) {
    copyFileSync(overrideScriptSource, overrideScriptDest);
    console.log(`Copied override-dlopen-paths-preload.js: ${overrideScriptDest}`);
  } else {
    console.warn(`Warning: override-dlopen-paths-preload.js not found at ${overrideScriptSource}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Error:', message);
  process.exit(1);
});

