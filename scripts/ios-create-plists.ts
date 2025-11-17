/**
 * iOS helper to create Info.plist files for xcframeworks containing .node files
 * 
 * Ported from nodejs-mobile-cordova helper scripts
 * https://github.com/nodejs-mobile/nodejs-mobile-cordova/tree/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/helper-scripts
 */

import { existsSync } from 'node:fs';
import { readdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create Info.plist for an xcframework containing .node files
 */
export async function createInfoPlistForXCFramework(xcframeworkPath: string): Promise<void> {
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
  
  // Load template
  const templatePath = join(__dirname, 'ios-xcframework-info-plist.template.xml');
  const template = await readFile(templatePath, 'utf8');
  
  // Library entry template (small repetitive part, kept inline for simplicity)
  const libraryEntryTemplate = `    <dict>
      <key>LibraryIdentifier</key>
      <string>{{LibraryIdentifier}}</string>
      <key>LibraryPath</key>
      <string>{{LibraryPath}}</string>
      <key>SupportedArchitectures</key>
      <array>
        <string>{{SupportedArchitecture}}</string>
      </array>
      <key>SupportedPlatform</key>
      <string>{{SupportedPlatform}}</string>
    </dict>
`;
  
  // Generate libraries XML using the library entry template
  const librariesXml = infoPlist.AvailableLibraries.map((lib) =>
    libraryEntryTemplate
      .replace('{{LibraryIdentifier}}', lib.LibraryIdentifier)
      .replace('{{LibraryPath}}', lib.LibraryPath)
      .replace('{{SupportedArchitecture}}', lib.SupportedArchitectures[0])
      .replace('{{SupportedPlatform}}', lib.SupportedPlatform)
  ).join('');
  
  // Replace template placeholders
  const plistContent = template
    .replace('{{LIBRARIES}}', librariesXml)
    .replace('{{CFBundlePackageType}}', infoPlist.CFBundlePackageType)
    .replace('{{XCFrameworkFormatVersion}}', infoPlist.XCFrameworkFormatVersion);
  
  await writeFile(infoPlistPath, plistContent);
  console.log(`Created Info.plist: ${infoPlistPath}`);
}

/**
 * Find all xcframeworks in a directory
 */
export async function findXCFrameworks(dir: string, depth: number = 0): Promise<string[]> {
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
}

/**
 * Process all xcframeworks in the nodejs project directory and create Info.plist files
 */
export async function processXCFrameworks(nodejsProjectDir: string): Promise<void> {
  if (!existsSync(nodejsProjectDir)) {
    console.warn(`Node.js project directory not found: ${nodejsProjectDir}`);
    return;
  }
  
  const xcframeworks = await findXCFrameworks(nodejsProjectDir);
  
  console.log(`Found ${xcframeworks.length} xcframework(s)`);
  
  // Create Info.plist for each xcframework in parallel
  await Promise.all(
    xcframeworks.map(xcframework => createInfoPlistForXCFramework(xcframework))
  );
}

