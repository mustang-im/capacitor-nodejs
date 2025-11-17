/**
 * Hook script that runs before Capacitor sync
 * This script downloads the libnode framework BEFORE pod install runs
 * 
 * This script is run automatically by Capacitor via the capacitor:sync:before hook
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

    // Download libnode framework BEFORE sync/pod install runs
    // This ensures the framework exists when the podspec is processed
    console.log(`Downloading libnode framework for platform: ${platform}...`);
    await runScript(resolve(scriptsDir, 'fetch-libnode.js'), ['--platform', platform]);

    console.log('Pre-sync hooks completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error running pre-sync hooks:', message);
    process.exit(1);
  }
}

main();

