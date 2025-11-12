#!/usr/bin/env node
/**
 * Capacitor NodeJS Plugin After Copy Hook
 * Runs after capacitor copy/sync to download Node.js Mobile library and run prepare hooks
 */

import { runFetchLibNode } from './both/fetch-libnode.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const hooksDir = __dirname;

async function runHook(hookFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const hookPath = join(hooksDir, hookFile);
    const child = spawn('node', [hookPath], {
      stdio: 'inherit',
      shell: false,
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Hook ${hookFile} failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(new Error(`Error running hook ${hookFile}: ${error.message}`));
    });
  });
}

async function main() {
  try {
    // First, download Node.js Mobile library
    await runFetchLibNode();
    
    // Then run all prepare hooks
    const prepareHooks = [
      'after-prepare-native-modules-preference.js',
      'after-prepare-patch-npm-packages.js',
      'after-prepare-build-node-assets-lists.js',
    ];
    
    for (const hook of prepareHooks) {
      try {
        await runHook(hook);
      } catch (error) {
        // Log warning but continue - some hooks may not be needed
        console.warn(`Warning: ${hook} failed or skipped:`, error);
      }
    }
  } catch (error) {
    console.error('Error running after-copy hook:', error);
    process.exit(1);
  }
}

main();

