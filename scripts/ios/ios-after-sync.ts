/**
 * iOS hook script to add build phases for rebuilding Node.js native modules
 * Ported from nodejs-mobile-cordova for Capacitor
 *
 * This script adds two build phases to the Xcode project:
 * 1. Build Node.js Mobile Native Modules - Rebuilds native modules using npm rebuild
 * 2. Sign Node.js Mobile Native Modules - Signs and embeds the resulting frameworks
 *
 * Usage: This script is run as a Capacitor hook after sync (capacitor:copy:after)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import xcode from 'xcode';
import { findCapacitorConfig, findCapacitorProjectRoot, getPluginSettings } from '../common/config-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fix NodeMobile framework path in Pods project
 * Based on nodejs-mobile-cordova's fix-xcframework-path.js approach
 * Reference: https://github.com/nodejs-mobile/nodejs-mobile-cordova/blob/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/hooks/ios/fix-xcframework-path.js
 */
async function fixXcframeworkPath(projectRoot: string, iosPath: string): Promise<void> {
  try {
    // Framework is at plugin/ios/libnode/NodeMobile.xcframework
    // When plugin is installed, it's at node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework
    // Pods project can be at:
    //   - ios/App/Pods/Pods.xcodeproj/project.pbxproj (Capacitor default)
    //   - ios/Pods/Pods.xcodeproj/project.pbxproj (alternative location)
    // Relative path from Pods project to framework: ../../../node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework

    // Try multiple possible Pods locations
    const possiblePodsPaths = [
      join(iosPath, 'Pods', 'Pods.xcodeproj', 'project.pbxproj'), // ios/App/Pods
      join(projectRoot, 'ios', 'Pods', 'Pods.xcodeproj', 'project.pbxproj'), // ios/Pods
    ];

    let podsProjectPath: string | null = null;
    for (const path of possiblePodsPaths) {
      if (existsSync(path)) {
        podsProjectPath = path;
        break;
      }
    }

    if (!podsProjectPath) {
      console.warn(`Pods project not found at any of the expected locations:`);
      possiblePodsPaths.forEach(path => console.warn(`  - ${path}`));
      console.warn('This is OK if pod install has not been run yet. Run pod install first.');
      return;
    }

    // Get relative path from Pods project to framework
    // Pods.xcodeproj is in ios/App/Pods/
    // Framework is at node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework (relative to project root)
    // So from Pods.xcodeproj: ../../../node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework
    const relativeXcFrameworkPath = join('..', '..', '..', 'node_modules', 'capacitor-nodejs', 'ios', 'libnode', 'NodeMobile.xcframework').replace(/\\/g, '/');

    // Patch the project file to fix .xcframework include error (exactly like nodejs-mobile-cordova)
    let pbxProjContents = readFileSync(podsProjectPath, 'utf8');
    pbxProjContents = pbxProjContents.replace(/path = libs\/ios\/nodemobile\/NodeMobile\.xcframework/g, `path = "${relativeXcFrameworkPath}"`);
    pbxProjContents = pbxProjContents.replace(/path = "libs\/ios\/nodemobile\/NodeMobile\.xcframework"/g, `path = "${relativeXcFrameworkPath}"`);
    writeFileSync(podsProjectPath, pbxProjContents);

    console.log('Successfully fixed NodeMobile framework path in Pods project.');

  } catch (error) {
    const err = error as Error;
    console.warn(`Failed to fix NodeMobile framework path: ${err.message}`);
    // Don't fail the whole process if this fails
  }
}

/**
 * Find iOS project path from Capacitor project root
 * Checks multiple possible locations for iOS project
 */
function findIOSProjectPath(projectRoot: string): string | null {
  // Try multiple possible iOS project locations
  const possibleIOSPaths = [
    join(projectRoot, 'ios', 'App'), // Standard Capacitor location
    join(projectRoot, 'ios'), // Alternative location
  ];

  for (const iosPath of possibleIOSPaths) {
    if (existsSync(iosPath)) {
      return iosPath;
    }
  }
  return null;
}

/**
 * Find Xcode project directory
 */
function findXcodeProject(iosPath: string): string | null {
  const xcodeprojDirs = ['App.xcodeproj', 'App.xcworkspace'];
  for (const dir of xcodeprojDirs) {
    const xcodeprojPath = join(iosPath, dir);
    if (existsSync(xcodeprojPath)) {
      // Return the .xcodeproj directory, not the .xcworkspace
      if (dir.endsWith('.xcodeproj')) {
        return xcodeprojPath;
      }
    }
  }
  return null;
}

/**
 * Get nodejs-mobile-gyp path relative to Xcode project
 * Uses ${PROJECT_DIR} for absolute path resolution (like headers path)
 */
function getNodeGypPath(): string {
  // nodejs-mobile-gyp is installed in node_modules/.bin/nodejs-mobile-gyp
  // From Xcode project (ios/App/App.xcodeproj), relative path is: ../../node_modules/.bin/nodejs-mobile-gyp
  // Use ${PROJECT_DIR} for absolute path resolution
  return '${PROJECT_DIR}/../../node_modules/.bin/nodejs-mobile-gyp';
}

/**
 * Get rebuild shell script path relative to Xcode project
 */
function getRebuildShellScriptPath(): string {
  // Script is in scripts/dist/rebuild-native-modules.sh
  // When installed, it's at node_modules/capacitor-nodejs/scripts/dist/rebuild-native-modules.sh
  // From Xcode project (ios/App/App.xcodeproj), relative path is: ../../node_modules/capacitor-nodejs/scripts/dist/rebuild-native-modules.sh
  return join('..', '..', 'node_modules', 'capacitor-nodejs', 'scripts', 'dist', 'rebuild-native-modules.sh');
}

/**
 * Get sign shell script path relative to Xcode project
 */
function getSignShellScriptPath(): string {
  // Script is in scripts/dist/sign-native-modules.sh
  // When installed, it's at node_modules/capacitor-nodejs/scripts/dist/sign-native-modules.sh
  // From Xcode project (ios/App/App.xcodeproj), relative path is: ../../node_modules/capacitor-nodejs/scripts/dist/sign-native-modules.sh
  return join('..', '..', 'node_modules', 'capacitor-nodejs', 'scripts', 'dist', 'sign-native-modules.sh');
}

/**
 * Escape a value for use in a shell script string (handles quotes and backslashes)
 * Note: We don't escape dollar signs as they may be needed for variable substitution
 * and are safe inside double quotes when used as literal values
 */
function escapeShellValue(value: string): string {
  // Replace backslashes and quotes with escaped versions
  // Dollar signs are safe inside double quotes when used as literal values
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Create rebuild build phase script that sets environment variables and executes external script
 * The script points to the external .sh file instead of embedding content
 */
function createRebuildBuildPhaseScript(nodeGypPath: string, nodeDir: string, nodeHeadersPath: string, shellScriptPath: string): string {
  // Create a script that sets environment variables and executes the external script file
  // Escape paths to handle special characters, but preserve ${PROJECT_DIR} variable
  const escapedNodeDir = escapeShellValue(nodeDir);
  // nodeGypPath and nodeHeadersPath use ${PROJECT_DIR} for absolute path resolution
  const escapedNodeGypPath = nodeGypPath.includes('${PROJECT_DIR}')
    ? nodeGypPath.replace(/"/g, '\\"')  // Only escape quotes, preserve ${PROJECT_DIR}
    : escapeShellValue(nodeGypPath);
  const escapedNodeHeadersPath = nodeHeadersPath.includes('${PROJECT_DIR}')
    ? nodeHeadersPath.replace(/"/g, '\\"')  // Only escape quotes, preserve ${PROJECT_DIR}
    : escapeShellValue(nodeHeadersPath);
  const escapedShellScriptPath = escapeShellValue(shellScriptPath);
  
  const script = `export NODE_DIR="${escapedNodeDir}"
export NODEJS_MOBILE_GYP_BIN_FILE="${escapedNodeGypPath}"
export NODEJS_HEADERS_DIR="${escapedNodeHeadersPath}"
sh "${escapedShellScriptPath}"`;
  return script;
}

/**
 * Create sign build phase script that sets environment variables and executes external script
 * The script points to the external .sh file instead of embedding content
 */
function createSignBuildPhaseScript(nodeDir: string, pluginScriptsPath: string, shellScriptPath: string): string {
  // Create a script that sets environment variables and executes the external script file
  // Escape paths to handle special characters
  const escapedNodeDir = escapeShellValue(nodeDir);
  const escapedPluginScriptsPath = escapeShellValue(pluginScriptsPath);
  const escapedShellScriptPath = escapeShellValue(shellScriptPath);
  
  const script = `export NODE_DIR="${escapedNodeDir}"
export PLUGIN_SCRIPTS_PATH="${escapedPluginScriptsPath}"
sh "${escapedShellScriptPath}"`;
  return script;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const currentWorkingDir = process.cwd();
    const foundProjectRoot = await findCapacitorProjectRoot();
    const projectRoot = foundProjectRoot || currentWorkingDir;
    const iosPath = findIOSProjectPath(projectRoot);
    
    if (!iosPath) {
      console.warn(`iOS project not found. Searched from: ${projectRoot}`);
      console.warn('Skipping iOS sync setup.');
      return;
    }
    const xcodeprojDir = findXcodeProject(iosPath);
    if (!xcodeprojDir) {
      console.warn('Xcode project file not found. Skipping iOS sync setup.');
      return;
    }

    console.log(`Found iOS project at: ${iosPath}`);
    console.log(`Found Xcode project at: ${xcodeprojDir}`);

    // Fix NodeMobile framework path in Pods project
    await fixXcframeworkPath(projectRoot, iosPath);

    // Get Capacitor config
    const config = await findCapacitorConfig();
    const nodeGypPath = getNodeGypPath();

    // Load Xcode project using xcode package
    const pbxprojFile = join(xcodeprojDir, 'project.pbxproj');
    if (!existsSync(pbxprojFile)) {
      console.warn('project.pbxproj file not found. Skipping iOS sync setup.');
      return;
    }

    console.log(`Loading Xcode project from: ${pbxprojFile}`);
    // xcode is external (not bundled), so we can use it directly
    const project = xcode.project(pbxprojFile);

    // Parse the project synchronously
    try {
      project.parseSync();
    } catch (error) {
      console.error(`Failed to parse Xcode project: ${error}`);
      return;
    }

    // Get the first target (usually "App")
    const target = project.getFirstTarget();
    if (!target) {
      console.warn('No targets found in Xcode project. Skipping iOS sync setup.');
      return;
    }

    console.log(`Using target: ${target.name || target.uuid || 'unknown'}`);

    // Get nodeDir from config
    const settings = getPluginSettings(config);
    const nodeDir = settings.nodeDir;

    // Get plugin scripts path (relative to Xcode project)
    const pluginScriptsPath = join('..', '..', 'node_modules', 'capacitor-nodejs', 'scripts', 'dist');

    // Get shell script paths (relative to Xcode project)
    const rebuildShellScriptPath = getRebuildShellScriptPath();
    const signShellScriptPath = getSignShellScriptPath();

    // Get Node.js headers path (nodejs-mobile-gyp expects libnode directory, not include/node)
    const nodeHeadersPath = '${PROJECT_DIR}/../../node_modules/capacitor-nodejs/ios/libnode';

    // Create build phase scripts that set environment variables and execute external scripts
    // These scripts point to the external .sh files instead of embedding content
    const rebuildScript = createRebuildBuildPhaseScript(nodeGypPath, nodeDir, nodeHeadersPath, rebuildShellScriptPath);
    const signScript = createSignBuildPhaseScript(nodeDir, pluginScriptsPath, signShellScriptPath);

    /**
     * Add or update a build phase with the given script
     */
    function addOrUpdateBuildPhase(phaseName: string, script: string, possibleNames: string[]): void {
    let pbxprojContent = readFileSync(pbxprojFile, 'utf8');
      const phaseExists = possibleNames.some(name => pbxprojContent.includes(name));

      if (!phaseExists) {
        // Add new build phase
        project.addBuildPhase(
          [],
          'PBXShellScriptBuildPhase',
          phaseName,
          target.uuid,
          {
            shellScript: script,
            shellPath: '/bin/sh',
          }
        );
        writeFileSync(pbxprojFile, project.writeSync());
        console.log(`Added build phase: ${phaseName}`);
    } else {
        // Update existing build phase - find and replace the script content
        // Since the script is now short (just env vars + script call), we can use a simpler approach
        const escapedScript = JSON.stringify(script).slice(1, -1);
        
        // Escape phase names for regex
        const possibleNamesEscaped = possibleNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        
        // Match any of the possible phase names and update the shellScript
        // Pattern: UUID /* Phase Name */ = { ... shellScript = "old script" ... };
        const updateRegex = new RegExp(
          `((?:[A-F0-9]{24}) \\/\\* (?:${possibleNamesEscaped}) \\*\\/ = \\{[\\s\\S]*?shellScript = ")[^"]*(";[\\s\\S]*?\\};)`,
          'g'
        );

        const updatedContent = pbxprojContent.replace(updateRegex, (match, prefix, suffix) => {
        return prefix + escapedScript + suffix;
      });

      if (updatedContent !== pbxprojContent) {
          // Fix NODEJS_HEADERS_DIR if updating rebuild phase
          let finalContent = updatedContent;
          if (phaseName === 'Build Node.js Mobile Native Modules') {
            // Fix path to use ${PROJECT_DIR} and point to libnode (not include/node)
            finalContent = finalContent.replace(
              /NODEJS_HEADERS_DIR=\\"\.\.\/\.\.\/node_modules\/capacitor-nodejs\/ios\/libnode(?:\/include\/node)?\\"/g,
              'NODEJS_HEADERS_DIR=\\"${PROJECT_DIR}/../../node_modules/capacitor-nodejs/ios/libnode\\"'
            );
          }
          writeFileSync(pbxprojFile, finalContent);
          console.log(`Updated existing build phase: ${phaseName}`);
      } else {
          // If regex didn't match, add a new phase
        project.addBuildPhase(
          [],
          'PBXShellScriptBuildPhase',
            phaseName,
          target.uuid,
          {
              shellScript: script,
            shellPath: '/bin/sh',
          }
        );
          writeFileSync(pbxprojFile, project.writeSync());
          console.log(`Added build phase (existing phase not found): ${phaseName}`);
        }
      }
    }

    // Add or update rebuild phase
    addOrUpdateBuildPhase(
      'Build Node.js Mobile Native Modules',
      rebuildScript,
      ['Build Node.js Mobile Native Modules', 'Rebuild Node.js Native Modules']
    );

    // Add or update sign phase
    addOrUpdateBuildPhase(
      'Sign Node.js Mobile Native Modules',
      signScript,
      ['Sign Node.js Mobile Native Modules', 'Code Sign Node Native Modules', 'Code Sign Node.js Native Modules']
    );
    console.log('iOS sync setup completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`Error setting up iOS sync: ${message}`);
    if (stack) {
      console.error(`Error stack: ${stack}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});
