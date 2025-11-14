/**
 * iOS helper script to create Info.plist files for xcframeworks containing .node files
 * and create dlopen override for remapping paths
 * 
 * Ported from nodejs-mobile-cordova helper scripts
 * https://github.com/nodejs-mobile/nodejs-mobile-cordova/tree/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/helper-scripts
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';

/**
 * Create Info.plist for an xcframework containing .node files
 */
async function createInfoPlistForXCFramework(xcframeworkPath: string): Promise<void> {
  const infoPlistPath = join(xcframeworkPath, 'Info.plist');
  
  // Check if Info.plist already exists
  if (existsSync(infoPlistPath)) {
    console.log(`Info.plist already exists: ${infoPlistPath}`);
    return;
  }
  
  // Read the xcframework structure to determine architectures
  const platformsDir = join(xcframeworkPath, 'ios-arm64_x86_64-simulator');
  const deviceDir = join(xcframeworkPath, 'ios-arm64');
  
  // Check directories in parallel
  const [platformsExists, deviceExists] = await Promise.all([
    stat(platformsDir).then(() => true).catch(() => false),
    stat(deviceDir).then(() => true).catch(() => false),
  ]);
  
  const architectures: string[] = [];
  if (platformsExists) {
    architectures.push('arm64', 'x86_64');
  }
  if (deviceExists && !architectures.includes('arm64')) {
    architectures.push('arm64');
  }
  
  // Create Info.plist content
  const infoPlist = {
    AvailableLibraries: architectures.map(arch => ({
      LibraryIdentifier: `ios-${arch === 'x86_64' ? 'arm64_x86_64-simulator' : 'arm64'}`,
      LibraryPath: `${basename(xcframeworkPath, '.xcframework')}.framework`,
      SupportedArchitectures: [arch],
      SupportedPlatform: 'ios'
    })),
    CFBundlePackageType: 'XFWK',
    XCFrameworkFormatVersion: '1.0'
  };
  
  // Write Info.plist
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${infoPlist.AvailableLibraries.map((lib, idx) => `
  <key>AvailableLibraries</key>
  <array>
    <dict>
      <key>LibraryIdentifier</key>
      <string>${lib.LibraryIdentifier}</string>
      <key>LibraryPath</key>
      <string>${lib.LibraryPath}</string>
      <key>SupportedArchitectures</key>
      <array>
        <string>${lib.SupportedArchitectures[0]}</string>
      </array>
      <key>SupportedPlatform</key>
      <string>${lib.SupportedPlatform}</string>
    </dict>
  </array>`).join('')}
  <key>CFBundlePackageType</key>
  <string>${infoPlist.CFBundlePackageType}</string>
  <key>XCFrameworkFormatVersion</key>
  <string>${infoPlist.XCFrameworkFormatVersion}</string>
</dict>
</plist>`;
  
  await writeFile(infoPlistPath, plistContent);
  console.log(`Created Info.plist: ${infoPlistPath}`);
}

/**
 * Create dlopen override for .node files in xcframeworks
 * This remaps the paths so Node.js can find the .node files
 */
async function createDlopenOverride(nodejsProjectDir: string): Promise<void> {
  const overrideDir = join(nodejsProjectDir, '.dlopen-override');
  
  // Create override directory if it doesn't exist
  try {
    await mkdir(overrideDir, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
  }
  
  // Find all .node files in xcframeworks
  const findNodeFiles = async (dir: string, depth: number = 0): Promise<string[]> => {
    if (depth > 10) return []; // Prevent infinite recursion
    
    const files: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      // Process entries in parallel
      const results = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dir, entry.name);
          
          if (entry.isDirectory()) {
            // Skip if it's an xcframework structure
            if (entry.name.endsWith('.xcframework')) {
              // Look for .node files inside the xcframework
              const frameworksDir = join(fullPath, 'ios-arm64_x86_64-simulator', basename(fullPath, '.xcframework') + '.framework');
              const deviceFrameworksDir = join(fullPath, 'ios-arm64', basename(fullPath, '.xcframework') + '.framework');
              
              const [simFiles, deviceFiles] = await Promise.all([
                stat(frameworksDir).then(() => findNodeFiles(frameworksDir, depth + 1)).catch(() => [] as string[]),
                stat(deviceFrameworksDir).then(() => findNodeFiles(deviceFrameworksDir, depth + 1)).catch(() => [] as string[]),
              ]);
              
              return [...simFiles, ...deviceFiles];
            } else {
              return findNodeFiles(fullPath, depth + 1);
            }
          } else if (entry.isFile() && entry.name.endsWith('.node')) {
            return [fullPath];
          }
          return [];
        })
      );
      
      return results.flat();
    } catch (error) {
      // Skip directories we can't read
      return [];
    }
  };
  
  const nodeFiles = await findNodeFiles(nodejsProjectDir);
  
  // Create override mappings
  const overrides: Record<string, string> = {};
  
  for (const nodeFile of nodeFiles) {
    const relativePath = nodeFile.replace(nodejsProjectDir + '/', '');
    const moduleName = basename(nodeFile, '.node');
    
    // Map the original path to the xcframework path
    // The actual path will be resolved at runtime based on the platform
    overrides[relativePath] = nodeFile;
  }
  
  // Write override file
  const overrideFile = join(overrideDir, 'overrides.json');
  await writeFile(overrideFile, JSON.stringify(overrides, null, 2));
  console.log(`Created dlopen override: ${overrideFile}`);
}

/**
 * Process all xcframeworks in the nodejs project directory
 */
async function processXCFrameworks(nodejsProjectDir: string): Promise<void> {
  if (!existsSync(nodejsProjectDir)) {
    console.warn(`Node.js project directory not found: ${nodejsProjectDir}`);
    return;
  }
  
  // Find all xcframeworks
  const findXCFrameworks = async (dir: string, depth: number = 0): Promise<string[]> => {
    if (depth > 5) return []; // Limit recursion depth
    
    const frameworks: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      // Process entries in parallel
      const results = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (entry.name.endsWith('.xcframework')) {
              return [fullPath];
            } else if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              return findXCFrameworks(fullPath, depth + 1);
            }
          }
          return [];
        })
      );
      
      return results.flat();
    } catch (error) {
      // Skip directories we can't read
      return [];
    }
  };
  
  const xcframeworks = await findXCFrameworks(nodejsProjectDir);
  
  console.log(`Found ${xcframeworks.length} xcframework(s)`);
  
  // Create Info.plist for each xcframework in parallel
  await Promise.all(
    xcframeworks.map(xcframework => createInfoPlistForXCFramework(xcframework))
  );
  
  // Create dlopen override
  await createDlopenOverride(nodejsProjectDir);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const nodejsProjectDir = process.argv[2];
  
  if (!nodejsProjectDir) {
    console.error('Usage: node ios-create-plists-and-dlopen-override.js <nodejs-project-dir>');
    process.exit(1);
  }
  
  await processXCFrameworks(nodejsProjectDir);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

