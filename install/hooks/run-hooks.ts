#!/usr/bin/env node
/**
 * Capacitor NodeJS Plugin Hooks Runner
 * This script finds the plugin's location and runs all hooks
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The hooks directory is always the same directory as this script
// When called from user's package.json: node_modules/capacitor-nodejs/install/hooks/dist/run-hooks.js
// __dirname will be: .../node_modules/capacitor-nodejs/install/hooks/dist
const hooksDir = __dirname;

const hooks = [
  'after-prepare-native-modules-preference.js',
  'after-prepare-patch-npm-packages.js',
  'after-prepare-build-node-assets-lists.js',
  'after-prepare-create-macOS-builder-helper.js',
];

async function runHook(hookFile: string): Promise<{ success: boolean; code?: number; error?: string }> {
  const hookPath = join(hooksDir, hookFile);
  
  if (!existsSync(hookPath)) {
    console.warn(`Warning: Hook file not found: ${hookPath}`);
    return { success: false, error: 'File not found' };
  }
  
  return new Promise((resolve) => {
    const child = spawn('node', [hookPath], {
      stdio: 'inherit',
      shell: false,
    });
    
    child.on('close', (code) => {
      resolve({ success: code === 0, code: code ?? undefined });
    });
    
    child.on('error', (error) => {
      console.error(`Error running hook ${hookFile}:`, error);
      resolve({ success: false, error: error.message });
    });
  });
}

async function runAllHooks(): Promise<void> {
  for (const hook of hooks) {
    const result = await runHook(hook);
    if (!result.success) {
      console.error(`Hook ${hook} failed`);
      process.exit(1);
    }
  }
}

runAllHooks().catch((error) => {
  console.error('Error running hooks:', error);
  process.exit(1);
});

