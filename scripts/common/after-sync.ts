/**
 * Hook script that runs after Capacitor sync
 * This script sets up iOS build phases and fixes framework paths
 * Note: Framework download happens in before-sync.ts (runs before pod install)
 * 
 * This script is run automatically by Capacitor via the capacitor:sync:after hook
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
    // Get platform from CAPACITOR_PLATFORM_NAME environment variable (set by Capacitor)
    // See: https://capacitorjs.com/docs/plugins/plugin-hooks
    // When running 'npx cap sync ios', CAPACITOR_PLATFORM_NAME is set to 'ios'
    // When running 'npx cap sync android', CAPACITOR_PLATFORM_NAME is set to 'android'
    // When running 'npx cap sync', CAPACITOR_PLATFORM_NAME may not be set (defaults to 'both')
    const platform = process.env.CAPACITOR_PLATFORM_NAME || 'both';
    // Scripts are all in the same directory (dist), so use __dirname directly
    const scriptsDir = __dirname;

    // Run iOS setup script only for iOS or both platforms
    // This runs AFTER sync/pod install, so Pods project exists
    if (platform === 'ios' || platform === 'both') {
      console.log('Running iOS after-sync script...');
      try {
        await runScript(resolve(scriptsDir, 'ios-after-sync.js'), []);
      } catch (error) {
        // Don't fail the whole process if iOS setup fails
        // This might happen if iOS project doesn't exist yet
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`iOS setup script failed (this is OK if iOS project doesn't exist): ${message}`);
      }
    }

    console.log('Post-sync hooks completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error running post-sync hooks:', message);
    process.exit(1);
  }
}

main();

