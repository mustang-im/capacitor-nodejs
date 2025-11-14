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

import { readFileSync, existsSync, mkdirSync, cpSync, rmSync, createWriteStream } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glob } from 'glob';
import https from 'node:https';
import http from 'node:http';
import AdmZip from 'adm-zip';

interface CapacitorConfig {
  plugins?: {
    CapacitorNodeJS?: {
      androidLibNode?: string;
      iosLibNode?: string;
    };
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root from the current working directory (where Capacitor CLI runs)
// This ensures we find the config file relative to where the command is executed
const projectRoot = process.cwd();

// Parse command line arguments and environment variables
const args = process.argv.slice(2);
// Get platform from CAPACITOR_PLATFORM environment variable (set by Capacitor) or command line
const platformArg = process.env.CAPACITOR_PLATFORM ||
                    args.find(arg => arg.startsWith('--platform='))?.split('=')[1] ||
                    args[args.indexOf('--platform') + 1];
const force = args.includes('--force') || args.includes('-f');

/**
 * Find and load Capacitor config file
 * Looks for config file relative to the current working directory (where Capacitor CLI runs)
 * Also searches from the script's location to handle cases where hooks run from different directories
 */
async function findCapacitorConfig(): Promise<CapacitorConfig> {
  // Start from current working directory (where Capacitor CLI executes)
  const searchRoot = process.cwd();

  // Also try to find config relative to where this script is located
  // This helps when the hook runs from a different working directory
  const scriptDir = dirname(__filename);
  const possibleRoots = [
    searchRoot,
    resolve(scriptDir, '../..'), // From scripts/dist/ to project root
    resolve(scriptDir, '../../..'), // In case we're deeper
  ];

  // Remove duplicates and filter to existing directories
  const uniqueRoots = Array.from(new Set(possibleRoots));

  for (const root of uniqueRoots) {
    const configPatterns = [
      join(root, 'capacitor.config.ts'),
      join(root, 'capacitor.config.js'),
      join(root, 'capacitor.config.json'),
    ];

    // Also check parent directories (for monorepos)
    const parentPatterns = [
      join(root, '..', 'capacitor.config.ts'),
      join(root, '..', 'capacitor.config.js'),
      join(root, '..', 'capacitor.config.json'),
    ];

    for (const configPath of [...configPatterns, ...parentPatterns]) {
      if (existsSync(configPath)) {
        try {
          if (configPath.endsWith('.json')) {
            const content = readFileSync(configPath, 'utf8');
            return JSON.parse(content) as CapacitorConfig;
          } else {
            // For TS/JS files, use dynamic import
            // Note: TypeScript files (.ts) need to be compiled first or use ts-node/tsx
            const module = await import(pathToFileURL(configPath).href);
            return (module.default || module) as CapacitorConfig;
          }
        } catch (error) {
          const err = error as Error;
          console.warn(`Failed to load config from ${configPath}:`, err.message);
        }
      }
    }
  }

  // Try using glob to find config files in current and parent directories
  try {
    const searchDirs = [...uniqueRoots, ...uniqueRoots.map(r => resolve(r, '..'))];
    for (const searchDir of searchDirs) {
      try {
        const configFiles = await glob('capacitor.config.{ts,js,json}', {
          cwd: searchDir,
          absolute: true,
          ignore: ['**/node_modules/**'],
        });

        for (const configPath of configFiles) {
          try {
            if (configPath.endsWith('.json')) {
              const content = readFileSync(configPath, 'utf8');
              return JSON.parse(content) as CapacitorConfig;
            } else {
              // For TS/JS files, try dynamic import
              // Use pathToFileURL for proper file URL handling (fixes macOS file:// URL warning)
              const fileUrl = pathToFileURL(configPath).href;
              const module = await import(fileUrl);
              return (module.default || module) as CapacitorConfig;
            }
          } catch (error) {
            // Continue to next file
            continue;
          }
        }
      } catch (error) {
        // Continue to next directory
        continue;
      }
    }
  } catch (error) {
    // Fall through to error
  }

  throw new Error('Could not find Capacitor config file');
}

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
function extractZip(zipPath: string, extractTo: string): void {
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
function copyDirectory(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
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
    extractZip(tempZip, libnodeDir);
    rmSync(tempZip, { force: true });
    console.log('Android libnode downloaded successfully.');
  } else {
    // Copy from local path
    const sourcePath = isAbsolute(source) ? source : resolve(process.cwd(), source);
    console.log(`Copying libnode from: ${sourcePath}`);
    copyDirectory(sourcePath, libnodeDir);
    console.log('Android libnode copied successfully.');
  }
}

/**
 * Setup libnode for iOS
 */
async function setupIOSLibNode(source: string, forceDownload: boolean): Promise<void> {
  // Use current working directory (where Capacitor CLI runs) as base
  const libnodeDir = join(process.cwd(), 'ios', 'libnode');

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
    extractZip(tempZip, libnodeDir);
    rmSync(tempZip, { force: true });
    console.log('iOS libnode downloaded successfully.');
  } else {
    // Copy from local path
    const sourcePath = isAbsolute(source) ? source : resolve(process.cwd(), source);
    console.log(`Copying libnode from: ${sourcePath}`);
    copyDirectory(sourcePath, libnodeDir);
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

    if (platform === 'android' || platform === 'both') {
      const androidLibNode = pluginConfig.androidLibNode;
      if (androidLibNode) {
        await setupAndroidLibNode(androidLibNode, forceDownload);
      } else {
        console.warn('androidLibNode not configured in Capacitor config. Skipping Android.');
      }
    }

    if (platform === 'ios' || platform === 'both') {
      const iosLibNode = pluginConfig.iosLibNode;
      if (iosLibNode) {
        await setupIOSLibNode(iosLibNode, forceDownload);
      } else {
        console.warn('iosLibNode not configured in Capacitor config. Skipping iOS.');
      }
    }

    if (platform !== 'android' && platform !== 'ios' && platform !== 'both') {
      console.error(`Invalid platform: ${platform}. Use 'android', 'ios', or 'both'.`);
      process.exit(1);
    }

  } catch (error) {
    const err = error as Error;
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();

