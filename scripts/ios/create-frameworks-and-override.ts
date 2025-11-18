/**
 * Create frameworks from organized .node files and generate override-dlopen-paths-data.json
 * This follows the approach from nodejs-mobile-cordova's ios-create-plists-and-dlopen-override.js
 */

import { existsSync, closeSync, openSync } from 'node:fs';
import { readdir, stat, mkdir, copyFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FrameworkInfo {
  originalRelativePath: string;
  originalFileName: string; // Full path to original .node directory
  frameworkName: string;
  frameworkDir: string;
  binaryPath: string;
}

async function createFramework(
  nodeDir: string,
  binaryPath: string,
  packageName: string,
  originalRelativePath: string,
  nodejsDir: string
): Promise<FrameworkInfo | null> {
  // Generate hash-based framework name (like original script)
  // Hash is based on the original relative path
  const hash = createHash('sha1').update(originalRelativePath).digest('hex').substring(0, 40);
  const frameworkName = `node${hash}.framework`;
  // Create framework in a temporary location within nodejsDir (will be copied to Frameworks later)
  const frameworkDir = join(nodejsDir, '.frameworks', frameworkName);

  // Create framework directory structure
  await mkdir(frameworkDir, { recursive: true });

  // Copy binary to framework
  const binaryName = frameworkName.replace('.framework', '');
  const frameworkBinaryPath = join(frameworkDir, binaryName);
  await copyFile(binaryPath, frameworkBinaryPath);

  // Create Info.plist
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${frameworkName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.nodejs.${frameworkName}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${frameworkName}</string>
  <key>CFBundlePackageType</key>
  <string>FMWK</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>MinimumOSVersion</key>
  <string>12.0</string>
</dict>
</plist>`;

  await writeFile(join(frameworkDir, 'Info.plist'), infoPlist, 'utf8');

  return {
    originalRelativePath,
    originalFileName: nodeDir, // Original .node directory path
    frameworkName,
    frameworkDir,
    binaryPath,
  };
}

async function findAndCreateFrameworks(nodejsDir: string): Promise<FrameworkInfo[]> {
  const frameworks: FrameworkInfo[] = [];

  // Process build/Release .node directories recursively in node_modules
  // npm rebuild builds modules in their own directories: node_modules/<module>/build/Release/
  const nodeModulesPath = join(nodejsDir, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    try {
      const modules = await readdir(nodeModulesPath, { withFileTypes: true });
      const moduleFrameworks = await Promise.all(
        modules
          .filter(entry => entry.isDirectory())
          .map(async (moduleEntry) => {
            const modulePath = join(nodeModulesPath, moduleEntry.name);
            const buildReleasePath = join(modulePath, 'build', 'Release');
            
            if (!existsSync(buildReleasePath)) {
              return [];
            }

            try {
              const entries = await readdir(buildReleasePath, { withFileTypes: true });
              const buildReleaseFrameworks = await Promise.all(
                entries
                  .filter(entry => entry.isDirectory() && entry.name.endsWith('.node'))
                  .map(async (entry) => {
                    const nodeDir = join(buildReleasePath, entry.name);
                    try {
                      const files = await readdir(nodeDir);
                      const fileFrameworks = await Promise.all(
                        files.map(async (file) => {
                          const filePath = join(nodeDir, file);
                          const fileStat = await stat(filePath);
                          if (fileStat.isFile() && !file.endsWith('.plist') && !file.endsWith('.framework')) {
                            // Relative path from nodejsDir: node_modules/<module>/build/Release/<module>.node
                            const originalRelative = `node_modules/${moduleEntry.name}/build/Release/${entry.name}`;
                            return createFramework(nodeDir, filePath, file, originalRelative, nodejsDir);
                          }
                          return null;
                        })
                      );
                      return fileFrameworks.filter((fw): fw is FrameworkInfo => fw !== null);
                    } catch {
                      return [];
                    }
                  })
              );
              return buildReleaseFrameworks.flat();
            } catch {
              return [];
            }
          })
      );
      frameworks.push(...moduleFrameworks.flat());
    } catch {
      // Skip if directory doesn't exist
    }
  }

  // Also check root build/Release (for backwards compatibility)
  const buildReleasePath = join(nodejsDir, 'build', 'Release');
  if (existsSync(buildReleasePath)) {
    try {
      const entries = await readdir(buildReleasePath, { withFileTypes: true });
      const buildReleaseFrameworks = await Promise.all(
        entries
          .filter(entry => entry.isDirectory() && entry.name.endsWith('.node'))
          .map(async (entry) => {
          const nodeDir = join(buildReleasePath, entry.name);
          try {
              const files = await readdir(nodeDir);
              const fileFrameworks = await Promise.all(
                files.map(async (file) => {
              const filePath = join(nodeDir, file);
                  const fileStat = await stat(filePath);
                  if (fileStat.isFile() && !file.endsWith('.plist') && !file.endsWith('.framework')) {
                const originalRelative = `build/Release/${entry.name}`;
                    return createFramework(nodeDir, filePath, file, originalRelative, nodejsDir);
                  }
                  return null;
                })
              );
              return fileFrameworks.filter((fw): fw is FrameworkInfo => fw !== null);
            } catch {
              return [];
            }
          })
      );
      frameworks.push(...buildReleaseFrameworks.flat());
    } catch {
      // Skip if directory doesn't exist
    }
  }

  // Process prebuilds .node directories
  const prebuildsPath = join(nodejsDir, 'prebuilds');
  if (existsSync(prebuildsPath)) {
    try {
      const platformDirs = await readdir(prebuildsPath, { withFileTypes: true });
      const prebuildsFrameworks = await Promise.all(
        platformDirs
          .filter(platformDir => platformDir.isDirectory())
          .map(async (platformDir) => {
          const platformPath = join(prebuildsPath, platformDir.name);
            try {
              const nodeDirs = await readdir(platformPath, { withFileTypes: true });
              const nodeDirFrameworks = await Promise.all(
                nodeDirs
                  .filter(nodeDirEntry => nodeDirEntry.isDirectory() && nodeDirEntry.name.endsWith('.node'))
                  .map(async (nodeDirEntry) => {
                        const nodeDir = join(platformPath, nodeDirEntry.name);
                        try {
                      const files = await readdir(nodeDir);
                      const fileFrameworks = await Promise.all(
                        files.map(async (file) => {
                            const filePath = join(nodeDir, file);
                          const fileStat = await stat(filePath);
                          if (fileStat.isFile() && !file.endsWith('.plist') && !file.endsWith('.framework')) {
                            const originalRelative = `prebuilds/${platformDir.name}/${nodeDirEntry.name}`;
                            return createFramework(nodeDir, filePath, file, originalRelative, nodejsDir);
                          }
                          return null;
                        })
                      );
                      return fileFrameworks.filter((fw): fw is FrameworkInfo => fw !== null);
                    } catch {
                      return [];
                    }
                  })
              );
              return nodeDirFrameworks.flat();
            } catch {
              return [];
            }
          })
      );
      frameworks.push(...prebuildsFrameworks.flat());
    } catch {
      // Skip if directory doesn't exist
    }
  }

  return frameworks;
}

function createOverrideJson(frameworks: FrameworkInfo[]): string {
  if (frameworks.length === 0) {
    return '[]';
  }

  // Create override mappings array
  const overrideMappings = frameworks.map((fw) => {
    // originalRelativePath is like "build/Release/better_sqlite3.node" or "prebuilds/ios-arm64/bufferutil.node"
    // Split into path parts
    const originalParts = fw.originalRelativePath.split('/').filter(Boolean);
    
    // newpath is relative to nodejsDir, pointing to the framework binary
    // Framework is at ../../Frameworks/<frameworkName>/<binaryName>
    const newParts = ['..', '..', 'Frameworks', fw.frameworkName, fw.frameworkName.replace('.framework', '')];
    
    return {
      originalpath: originalParts,
      newpath: newParts,
    };
  });

  return JSON.stringify(overrideMappings, null, 2);
}

async function main(): Promise<void> {
  const nodejsDir = process.argv[2];

  if (!nodejsDir) {
    console.error('Usage: node create-frameworks-and-override.ts <nodejs-dir>');
    process.exit(1);
  }

  if (!existsSync(nodejsDir)) {
    console.error(`Node.js directory not found: ${nodejsDir}`);
    process.exit(1);
  }

  console.log(`Creating frameworks from organized .node files in: ${nodejsDir}`);

  const frameworks = await findAndCreateFrameworks(nodejsDir);

  console.log(`Found ${frameworks.length} framework(s) to create`);

  // Copy runtime script that will override dlopen paths
  // Do this regardless of whether frameworks were found, so the script is always available
  const preloadScriptSource = join(__dirname, 'override-dlopen-paths-preload.js');
  const preloadScriptDest = join(nodejsDir, 'override-dlopen-paths-preload.js');
  if (existsSync(preloadScriptSource)) {
    await copyFile(preloadScriptSource, preloadScriptDest);
    console.log(`Copied override-dlopen-paths-preload.js: ${preloadScriptDest}`);
  } else {
    console.warn(`Warning: override-dlopen-paths-preload.js not found at ${preloadScriptSource}`);
  }

  if (frameworks.length > 0) {
    // Create override JSON
    const overrideJson = createOverrideJson(frameworks);
    const overrideJsonPath = join(nodejsDir, 'override-dlopen-paths-data.json');
    await writeFile(overrideJsonPath, overrideJson, 'utf8');
    console.log(`Created override-dlopen-paths-data.json: ${overrideJsonPath}`);

    // Put an empty file in each of the .node original locations, since some modules check their existence
    // First, remove the organized directories, then create empty files at those locations
    await Promise.all(
      frameworks.map(async (fw) => {
        try {
          // Remove the original .node directory if it exists
          if (existsSync(fw.originalFileName)) {
            const fileStat = await stat(fw.originalFileName);
            if (fileStat.isDirectory()) {
              // Remove directory contents first
              const files = await readdir(fw.originalFileName);
              await Promise.all(
                files.map(async (file) => {
                  const filePath = join(fw.originalFileName, file);
                  const statResult = await stat(filePath);
                  if (statResult.isFile()) {
                    await unlink(filePath);
                  }
                })
              );
              // Remove the directory
              await rmdir(fw.originalFileName);
            }
          }
          // Create empty file at original .node location
          closeSync(openSync(fw.originalFileName, 'w'));
          console.log(`Created empty file at original location: ${fw.originalFileName}`);
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          console.warn(`Warning: Could not create empty file at ${fw.originalFileName}: ${err}`);
        }
      })
    );

    // Output framework info for embedding (one per line: frameworkDir)
    frameworks.forEach((fw) => {
      console.log(`FRAMEWORK:${fw.frameworkDir}`);
    });
  } else {
    console.log('No frameworks found to create');
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

