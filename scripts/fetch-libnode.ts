/**
 * Script to download or copy Node.js Mobile library based on Capacitor config
 *
 * Usage:
 *   node scripts/fetch-libnode.js [--platform android|ios|both] [--force]
 *
 * Options:
 *   --platform <platform>  Platform to setup (android, ios, or both).
 *                          Default: reads from CAPACITOR_PLATFORM env var, or 'both' if not set
 *   --force, -f            Force redownload even if libnode already exists
 *
 * Note: When run as a Capacitor hook (capacitor:copy:after), the platform is automatically
 *       detected from the CAPACITOR_PLATFORM environment variable.
 *
 * Configuration:
 *   The script reads from your Capacitor config file (capacitor.config.ts/js/json):
 *
 *   plugins: {
 *     CapacitorNodeJS: {
 *       androidLibNode: "https://example.com/android-libnode.zip" | "/path/to/local/libnode",
 *       iosLibNode: "https://example.com/ios-libnode.zip" | "/path/to/local/libnode"
 *     }
 *   }
 *
 * Examples:
 *   # Download for both platforms
 *   node scripts/fetch-libnode.js
 *
 *   # Download only for Android
 *   node scripts/fetch-libnode.js --platform android
 *
 *   # Force redownload
 *   node scripts/fetch-libnode.js --force
 *
 *   # Force redownload for iOS only
 *   node scripts/fetch-libnode.js --platform ios --force
 */

import { existsSync, mkdirSync, cpSync, rmSync, createWriteStream } from 'node:fs';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';
import AdmZip from 'adm-zip';
import { findCapacitorConfig, type CapacitorConfig } from './config-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get plugin root directory
// Script is at scripts/dist/fetch-libnode.js, so go up two levels to get plugin root
const pluginRoot = dirname(dirname(__dirname));

// Parse command line arguments and environment variables
const args = process.argv.slice(2);
// Get platform from CAPACITOR_PLATFORM environment variable (set by Capacitor) or command line
const platformArg = process.env.CAPACITOR_PLATFORM ||
                    args.find(arg => arg.startsWith('--platform='))?.split('=')[1] ||
                    args[args.indexOf('--platform') + 1];
const force = args.includes('--force') || args.includes('-f');

/**
 * Download a file from URL
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        const location = response.headers.location;
        if (!location) {
          reject(new Error('Redirect location not found'));
          return;
        }
        return downloadFile(location, destPath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage || 'Unknown error'}`));
        return;
      }

      const fileStream = createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        rmSync(destPath, { force: true });
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Extract zip file
 */
async function extractZip(zipPath: string, extractTo: string): Promise<void> {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractTo, true);
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to extract zip: ${err.message}`);
  }
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  const { mkdir, cp } = await import('node:fs/promises');

  if (!existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }

  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

/**
 * Setup libnode for Android
 */
async function setupAndroidLibNode(source: string, forceDownload: boolean): Promise<void> {
  // Use current working directory (where Capacitor CLI runs) as base
  const libnodeDir = join(process.cwd(), 'android', 'libnode');

  if (existsSync(libnodeDir) && !forceDownload) {
    console.log('Android libnode already exists. Use --force to redownload.');
    return;
  }

  console.log(`Setting up Android libnode from: ${source}`);

  if (forceDownload && existsSync(libnodeDir)) {
    console.log('Removing existing libnode directory...');
    rmSync(libnodeDir, { recursive: true, force: true });
  }

  mkdirSync(libnodeDir, { recursive: true });

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // Download from URL
      const tempZip = join(libnodeDir, 'libnode.zip');
      console.log('Downloading libnode...');
      await downloadFile(source, tempZip);
      console.log('Extracting libnode...');
      await extractZip(tempZip, libnodeDir);
      rmSync(tempZip, { force: true });
      console.log('Android libnode downloaded successfully.');
    } else {
      // Copy from local path
      const sourcePath = isAbsolute(source) ? source : resolve(process.cwd(), source);
      console.log(`Copying libnode from: ${sourcePath}`);
      await copyDirectory(sourcePath, libnodeDir);
      console.log('Android libnode copied successfully.');
    }
}

/**
 * Setup libnode for iOS
 * Downloads to plugin's ios/libnode/ directory (like nodejs-mobile-cordova)
 */
async function setupIOSLibNode(source: string, forceDownload: boolean): Promise<void> {
  // Download to plugin's ios/libnode/ directory
  const libnodeDir = join(pluginRoot, 'ios', 'libnode');

  if (existsSync(libnodeDir) && !forceDownload) {
    console.log('iOS libnode already exists. Use --force to redownload.');
    return;
  }

  console.log(`Setting up iOS libnode from: ${source}`);

  if (forceDownload && existsSync(libnodeDir)) {
    console.log('Removing existing libnode directory...');
    rmSync(libnodeDir, { recursive: true, force: true });
  }

  mkdirSync(libnodeDir, { recursive: true });

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // Download from URL
    const tempZip = join(libnodeDir, 'libnode.zip');
    console.log('Downloading libnode...');
    await downloadFile(source, tempZip);
    console.log('Extracting libnode...');
    await extractZip(tempZip, libnodeDir);
    rmSync(tempZip, { force: true });
    console.log('iOS libnode downloaded successfully.');
  } else {
    // Copy from local path
    const sourcePath = isAbsolute(source) ? source : resolve(process.cwd(), source);
    console.log(`Copying libnode from: ${sourcePath}`);
    await copyDirectory(sourcePath, libnodeDir);
    console.log('iOS libnode copied successfully.');
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const config = await findCapacitorConfig();
    const pluginConfig = config?.plugins?.CapacitorNodeJS || {};

    const platform = platformArg?.toLowerCase() || 'both';
    const forceDownload = force;

    if (platform !== 'android' && platform !== 'ios' && platform !== 'both') {
      console.error(`Invalid platform: ${platform}. Use 'android', 'ios', or 'both'.`);
      process.exit(1);
    }

    // Run Android and iOS setup in parallel when both are needed
    const tasks: Promise<void>[] = [];

    if (platform === 'android' || platform === 'both') {
      const androidLibNode = pluginConfig.androidLibNode;
      if (androidLibNode) {
        tasks.push(setupAndroidLibNode(androidLibNode, forceDownload));
      } else {
        console.warn('androidLibNode not configured in Capacitor config. Skipping Android.');
      }
    }

    if (platform === 'ios' || platform === 'both') {
      const iosLibNode = pluginConfig.iosLibNode;
      if (iosLibNode) {
        tasks.push(setupIOSLibNode(iosLibNode, forceDownload));
      } else {
        console.warn('iosLibNode not configured in Capacitor config. Skipping iOS.');
      }
    }

    // Wait for all tasks to complete in parallel
    await Promise.all(tasks);

  } catch (error) {
    const err = error as Error;
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();

