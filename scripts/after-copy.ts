/**
 * Main hook script that runs after Capacitor copy
 * This script orchestrates multiple post-copy tasks:
 * 1. Fetch libnode for Android/iOS
 * 2. Setup iOS build phases for native module rebuilding
 * 
 * This script is run automatically by Capacitor via the capacitor:copy:after hook
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run a script and wait for it to complete
 */
function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${scriptPath} exited with code ${code ?? 'unknown'}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const platform = process.env.CAPACITOR_PLATFORM || 'both';
    // Scripts are all in the same directory (dist), so use __dirname directly
    const scriptsDir = __dirname;

    // Always run fetch-libnode (handles both Android and iOS)
    console.log('Running fetch-libnode script...');
    await runScript(resolve(scriptsDir, 'fetch-libnode.js'), []);

    // Run iOS setup script only for iOS or both platforms
    if (platform === 'ios' || platform === 'both') {
      console.log('Running iOS after-plugin-install script...');
      try {
        await runScript(resolve(scriptsDir, 'ios-after-plugin-install.js'), []);
      } catch (error) {
        // Don't fail the whole process if iOS setup fails
        // This might happen if iOS project doesn't exist yet
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`iOS setup script failed (this is OK if iOS project doesn't exist): ${message}`);
      }
    }

    console.log('Post-copy hooks completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error running post-copy hooks:', message);
    process.exit(1);
  }
}

main();

