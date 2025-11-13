/**
 * Rebuilds Node.js native modules for Android/iOS using nodejs-mobile-gyp
 * Follows the same pattern as prebuild-for-nodejs-mobile
 * 
 * Usage: rebuild-native-module.js <module-path> <target>
 * 
 * Arguments:
 *   module-path: Path to the native module directory
 *   target: Target platform/arch (e.g., android-arm64, android-arm, android-x64)
 * 
 * Environment variables (set by Gradle):
 *   NODE_GYP: Path to nodejs-mobile-gyp
 *   NODE_DIR: Path to nodejs-mobile libnode directory
 *   NDK_HOME: Android NDK home directory
 *   TARGET_API: Android API level
 *   GYP_DEFINES: GYP defines string
 *   CC, CXX, AR, LINK: Compiler paths
 *   PATH: Modified PATH with compiler wrappers
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJSON {
  scripts?: {
    install?: string;
    rebuild?: string;
  };
  gypfile?: boolean;
}

/**
 * Get package.json from module directory
 */
function getPackageJSON(modulePath: string): PackageJSON | null {
  const pkgPath = join(modulePath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Check if module is a GYP-based native addon
 */
function isGypNodeAddon(modulePath: string): boolean {
  const bindingGyp = join(modulePath, 'binding.gyp');
  if (!existsSync(bindingGyp)) return false;
  
  const pkgJSON = getPackageJSON(modulePath);
  if (!pkgJSON) return false;
  
  return !!(pkgJSON.scripts?.install || pkgJSON.scripts?.rebuild || pkgJSON.gypfile);
}

/**
 * Patch package.json to use nodejs-mobile-gyp
 * Similar to prebuild-for-nodejs-mobile's approach
 * Sets the 'node-gyp' script to point to nodejs-mobile-gyp
 */
function patchPackageJSON(modulePath: string): boolean {
  const pkgPath = join(modulePath, 'package.json');
  if (!existsSync(pkgPath)) return false;
  
  const pkgJSON = getPackageJSON(modulePath);
  if (!pkgJSON) return false;
  
  const originalPkgJSON = JSON.stringify(pkgJSON, null, 2);
  
  // Ensure scripts exist
  if (!pkgJSON.scripts) {
    pkgJSON.scripts = {};
  }
  
  // Set 'node-gyp' script to use nodejs-mobile-gyp (npm will resolve it from PATH or node_modules)
  // This allows npm scripts that reference node-gyp to use nodejs-mobile-gyp instead
  if (!pkgJSON.scripts['node-gyp'] || !pkgJSON.scripts['node-gyp'].includes('nodejs-mobile-gyp')) {
    pkgJSON.scripts['node-gyp'] = 'nodejs-mobile-gyp';
  }
  
  const newPkgJSON = JSON.stringify(pkgJSON, null, 2);
  
  // Only patch if changed
  if (newPkgJSON !== originalPkgJSON) {
    // Backup original
    const backupPath = pkgPath + '.bak';
    if (!existsSync(backupPath)) {
      copyFileSync(pkgPath, backupPath);
    }
    
    writeFileSync(pkgPath, newPkgJSON + '\n', 'utf8');
    return true;
  }
  
  return false;
}

/**
 * Undo package.json patch
 */
function undoPackageJSONPatch(modulePath: string): void {
  const pkgPath = join(modulePath, 'package.json');
  const backupPath = pkgPath + '.bak';
  
  if (existsSync(backupPath)) {
    unlinkSync(pkgPath);
    copyFileSync(backupPath, pkgPath);
    unlinkSync(backupPath);
  }
}

/**
 * Find nodejs-mobile-gyp path
 * Looks in:
 * 1. Plugin's node_modules (if this is a development build)
 * 2. Environment variable NODE_GYP (set by Gradle)
 * 3. Current working directory's node_modules
 * 4. Parent directories (for monorepos)
 */
function findNodeGypPath(): string | null {
  // Try environment variable first (set by Gradle)
  if (process.env.NODE_GYP && existsSync(process.env.NODE_GYP)) {
    return process.env.NODE_GYP;
  }

  // Try plugin's node_modules (from scripts/dist/rebuild-native-module.js)
  // Go up from scripts/dist/ to project root
  const pluginRoot = resolve(__dirname, '../..');
  const pluginNodeGyp = join(pluginRoot, 'node_modules', 'nodejs-mobile-gyp', 'bin', 'node-gyp.js');
  if (existsSync(pluginNodeGyp)) {
    return pluginNodeGyp;
  }

  // Try current working directory's node_modules
  const cwdNodeGyp = join(process.cwd(), 'node_modules', 'nodejs-mobile-gyp', 'bin', 'node-gyp.js');
  if (existsSync(cwdNodeGyp)) {
    return cwdNodeGyp;
  }

  // Try parent directories (for monorepos)
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const parentNodeGyp = join(currentDir, 'node_modules', 'nodejs-mobile-gyp', 'bin', 'node-gyp.js');
    if (existsSync(parentNodeGyp)) {
      return parentNodeGyp;
    }
    const parentDir = resolve(currentDir, '..');
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

/**
 * Build GYP module using nodejs-mobile-gyp
 */
function buildGypModule(modulePath: string, nodeGypPath: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const task = spawn('node', [nodeGypPath, 'rebuild', '--release'], {
      cwd: modulePath,
      env: env,
      stdio: 'inherit'
    });
    
    task.on('close', (code) => {
      resolve(code ?? 0);
    });
    
    task.on('error', (err) => {
      console.error(`Error building module: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Main function
 */
async function main() {
  const modulePath = process.argv[2];
  const target = process.argv[3];
  
  if (!modulePath || !target) {
    console.error('Usage: rebuild-native-module.js <module-path> <target>');
    console.error('Example: rebuild-native-module.js ./node_modules/better-sqlite3 android-arm64');
    process.exit(1);
  }
  
  const resolvedModulePath = resolve(modulePath);
  
  if (!existsSync(resolvedModulePath)) {
    console.error(`Error: Module path does not exist: ${resolvedModulePath}`);
    process.exit(1);
  }
  
  if (!isGypNodeAddon(resolvedModulePath)) {
    console.error('Error: Not a GYP-based native module');
    process.exit(1);
  }
  
  // Find nodejs-mobile-gyp path
  let nodeGypPath = findNodeGypPath();
  if (!nodeGypPath) {
    console.error('Error: nodejs-mobile-gyp not found. Please install it: npm install --save-dev nodejs-mobile-gyp');
    console.error('Searched in:');
    console.error(`  - Plugin node_modules: ${join(resolve(__dirname, '../..'), 'node_modules', 'nodejs-mobile-gyp')}`);
    console.error(`  - Current directory: ${join(process.cwd(), 'node_modules', 'nodejs-mobile-gyp')}`);
    console.error(`  - NODE_GYP env var: ${process.env.NODE_GYP || '(not set)'}`);
    process.exit(1);
  }
  
  console.log(`Using nodejs-mobile-gyp at: ${nodeGypPath}`);
  
  // Patch package.json before building (sets node-gyp script to use nodejs-mobile-gyp)
  const packageJSONPatched = patchPackageJSON(resolvedModulePath);
  
  if (packageJSONPatched) {
    console.log('Patched package.json to use nodejs-mobile-gyp');
  }
  
  // Build the module directly using nodejs-mobile-gyp
  // We call it directly, so npm scripts aren't used, but patching helps if npm is invoked
  const buildEnv = {
    ...process.env,
    // Ensure nodejs-mobile-gyp is used
    NODE_GYP: nodeGypPath,
    npm_config_node_gyp: nodeGypPath,
  };
  
  const code = await buildGypModule(resolvedModulePath, nodeGypPath, buildEnv);
  
  // Undo patches after building (regardless of success/failure)
  if (packageJSONPatched) {
    undoPackageJSONPatch(resolvedModulePath);
  }
  
  process.exit(code);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

