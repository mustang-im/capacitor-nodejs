/**
 * iOS hook script to add build phases for rebuilding Node.js native modules
 * Ported from nodejs-mobile-cordova for Capacitor
 *
 * This script adds two build phases to the Xcode project:
 * 1. Build Node.js Mobile Native Modules - Rebuilds native modules using rebuild-native-module.js
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
 * Get rebuild script path relative to project
 */
function getRebuildScriptPath(): string {
  // Script is in scripts/dist/rebuild-native-module.js
  // When installed, it's at node_modules/capacitor-nodejs/scripts/dist/rebuild-native-module.js
  // From Xcode project (ios/App/App.xcodeproj), relative path is: ../../node_modules/capacitor-nodejs/scripts/dist/rebuild-native-module.js
  return join('..', '..', 'node_modules', 'capacitor-nodejs', 'scripts', 'dist', 'rebuild-native-module.js');
}

/**
 * Get nodejs-mobile-gyp path
 */
function getNodeGypPath(projectRoot: string): string {
  // nodejs-mobile-gyp is installed in node_modules/.bin/nodejs-mobile-gyp
  // From project root, it's at node_modules/.bin/nodejs-mobile-gyp
  return join(projectRoot, 'node_modules', '.bin', 'nodejs-mobile-gyp');
}

/**
 * Generate a 24-character hexadecimal UUID for Xcode project files
 */
function generateUuid(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}

/**
 * Escape script for embedding in Xcode project.pbxproj file
 * The project.pbxproj format requires specific escaping for shell scripts
 * The script must be on a single line with \n for newlines
 * Note: We do NOT escape dollar signs because they're needed for shell variables
 */
function escapeScriptForPbxproj(script: string): string {
  // Escape in the order that matters:
  // 1. Backslashes first (so we don't double-escape)
  // 2. Quotes
  // 3. Newlines (convert to \n)
  // 4. Tabs (convert to \t)
  // Note: Dollar signs are NOT escaped - they're needed for shell variables like $NODE_MODULES_DIR
  return script
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/"/g, '\\"')     // Escape quotes
    .replace(/\t/g, '\\t')     // Escape tabs
    .replace(/\r\n/g, '\\n')  // Convert Windows line endings
    .replace(/\r/g, '\\n')    // Convert old Mac line endings
    .replace(/\n/g, '\\n');   // Convert Unix line endings
}

/**
 * Create rebuild script content by reading from shell script file and injecting variables
 */
function createRebuildScript(rebuildScriptPathRel: string, nodeGypPath: string, nodeDir: string): string {
  // Read the shell script template
  const scriptPath = join(__dirname, 'rebuild-native-modules.sh');
  let script = readFileSync(scriptPath, 'utf8');

  // Inject variables
  script = script.replace(/\$\{NODE_DIR:-nodejs\}/g, nodeDir);
  script = script.replace(/\$\{NODEJS_MOBILE_GYP_BIN_FILE\}/g, nodeGypPath);
  script = script.replace(/\$\{REBUILD_SCRIPT_PATH\}/g, rebuildScriptPathRel);

  return script;
}

/**
 * Create sign script content by reading from shell script file and injecting variables
 */
function createSignScript(nodeDir: string, pluginScriptsPath: string): string {
  // Read the shell script template
  const scriptPath = join(__dirname, 'sign-native-modules.sh');
  let script = readFileSync(scriptPath, 'utf8');

  // Inject variables
  script = script.replace(/\$\{NODE_DIR:-nodejs\}/g, nodeDir);
  script = script.replace(/\$\{PLUGIN_SCRIPTS_PATH\}/g, pluginScriptsPath);

  return script;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const projectRoot = await findCapacitorProjectRoot() || process.cwd();
    console.log(`Searching for iOS project from project root: ${projectRoot}`);
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
    const rebuildScriptPathRel = getRebuildScriptPath();
    const nodeGypPath = getNodeGypPath(projectRoot);

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

    // Create build phase scripts
    // Use relative path for the rebuild script
    const rebuildScript = createRebuildScript(rebuildScriptPathRel, nodeGypPath, nodeDir);
    const signScript = createSignScript(nodeDir, pluginScriptsPath);

    // Check if build phases already exist (check for various possible names)
    let pbxprojContent = readFileSync(pbxprojFile, 'utf8');
    const rebuildPhaseExists = pbxprojContent.includes('Build Node.js Mobile Native Modules') ||
                               pbxprojContent.includes('Rebuild Node.js Native Modules');
    const signPhaseExists = pbxprojContent.includes('Sign Node.js Mobile Native Modules') ||
                           pbxprojContent.includes('Code Sign Node Native Modules') ||
                           pbxprojContent.includes('Code Sign Node.js Native Modules');

    let fileUpdatedDirectly = false;

    // Handle rebuild phase - write directly to project file to ensure proper escaping
    // The xcode package doesn't properly escape scripts, so we write it manually
    if (!rebuildPhaseExists) {
      const escapedRebuildScript = escapeScriptForPbxproj(rebuildScript);
      
      // Use xcode package to add the phase, but then manually fix the escaping
      project.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        'Build Node.js Mobile Native Modules',
        target.uuid,
        {
          shellScript: rebuildScript,
          shellPath: '/bin/sh',
        }
      );
      
      // Write the project and then fix the escaping
      writeFileSync(pbxprojFile, project.writeSync());
      let updatedContent = readFileSync(pbxprojFile, 'utf8');
      
      // Find and fix the rebuild phase script escaping
      // Match the build phase with shellScript - need to match everything until the closing quote
      // The script might span multiple lines, so we need to match newlines too
      const rebuildPhaseRegex = /(([A-F0-9]{24}) \/\* Build Node\.js Mobile Native Modules \*\/ = \{[\s\S]*?shellScript = ")([\s\S]*?)(";[\s\S]*?\};)/;
      updatedContent = updatedContent.replace(rebuildPhaseRegex, (match, prefix, uuid, script, suffix) => {
        // Replace the entire script content with properly escaped version
        return prefix + escapedRebuildScript + suffix;
      });
      
      writeFileSync(pbxprojFile, updatedContent);
      pbxprojContent = updatedContent;
      fileUpdatedDirectly = true;
      console.log('Added build phase: Build Node.js Mobile Native Modules');
    } else {
      console.log('Build phase already exists: Build Node.js Mobile Native Modules');
    }

    if (!signPhaseExists) {
      const escapedSignScript = escapeScriptForPbxproj(signScript);
      
      // Use xcode package to add the phase, but then manually fix the escaping
      project.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        'Sign Node.js Mobile Native Modules',
        target.uuid,
        {
          shellScript: signScript,
          shellPath: '/bin/sh',
        }
      );
      
      // Write the project and then fix the escaping
      if (!fileUpdatedDirectly) {
        writeFileSync(pbxprojFile, project.writeSync());
        pbxprojContent = readFileSync(pbxprojFile, 'utf8');
      }
      
      // Find and fix the sign phase script escaping
      // Match the build phase with shellScript - need to match everything until the closing quote
      // The script might span multiple lines, so we need to match newlines too
      const signPhaseRegex = /(([A-F0-9]{24}) \/\* Sign Node\.js Mobile Native Modules \*\/ = \{[\s\S]*?shellScript = ")([\s\S]*?)(";[\s\S]*?\};)/;
      let updatedContent = pbxprojContent;
      updatedContent = updatedContent.replace(signPhaseRegex, (match, prefix, uuid, script, suffix) => {
        // Replace the entire script content with properly escaped version
        return prefix + escapedSignScript + suffix;
      });
      
      writeFileSync(pbxprojFile, updatedContent);
      pbxprojContent = updatedContent;
      fileUpdatedDirectly = true;
      console.log('Added build phase: Sign Node.js Mobile Native Modules');
    } else {
      // Update existing sign phase with the new script
      console.log('Build phase already exists: Sign Node.js Mobile Native Modules - updating script');
      // Find and update ALL code sign phases (both old and new names)
      let updatedContent = pbxprojContent;

      // Update both "Code Sign Node Native Modules" and "Sign Node.js Mobile Native Modules" phases
      // Match the phase definition more precisely - the shellScript is on one line with escaped newlines
      // Match from the UUID to the end of shellScript
      const phaseUpdateRegex = /((?:BFB3ED892E8365590007C670|53658CB2EE144605B9DBE77D) \/\* (?:Code Sign Node Native Modules|Sign Node\.js Mobile Native Modules) \*\/ = \{[\s\S]*?shellScript = ")[^"]*(";[\s\S]*?\};)/g;

      updatedContent = updatedContent.replace(phaseUpdateRegex, (match, prefix, suffix) => {
        // Escape the script properly for the project.pbxproj format
        const escapedScript = escapeScriptForPbxproj(signScript);
        return prefix + escapedScript + suffix;
      });

      if (updatedContent !== pbxprojContent) {
        writeFileSync(pbxprojFile, updatedContent);
        console.log('Updated existing code sign build phase(s) with dlopen override and code signing');
        fileUpdatedDirectly = true;
      } else {
        console.log('Could not update existing phase, adding new one');
        const escapedSignScript = escapeScriptForPbxproj(signScript);
        
        project.addBuildPhase(
          [],
          'PBXShellScriptBuildPhase',
          'Sign Node.js Mobile Native Modules',
          target.uuid,
          {
            shellScript: signScript,
            shellPath: '/bin/sh',
          }
        );
        
        // Write the project and then fix the escaping
        if (!fileUpdatedDirectly) {
          writeFileSync(pbxprojFile, project.writeSync());
          pbxprojContent = readFileSync(pbxprojFile, 'utf8');
        }
        
        // Find and fix the sign phase script escaping
        // Match the build phase with shellScript - need to match everything until the closing quote
        // The script might span multiple lines, so we need to match newlines too
        const signPhaseRegex = /(([A-F0-9]{24}) \/\* Sign Node\.js Mobile Native Modules \*\/ = \{[\s\S]*?shellScript = ")([\s\S]*?)(";[\s\S]*?\};)/;
        let updatedContent = pbxprojContent;
        updatedContent = updatedContent.replace(signPhaseRegex, (match, prefix, uuid, script, suffix) => {
          // Replace the entire script content with properly escaped version
          return prefix + escapedSignScript + suffix;
        });
        
        writeFileSync(pbxprojFile, updatedContent);
        pbxprojContent = updatedContent;
        fileUpdatedDirectly = true;
      }
    }

    // Only write if we didn't update the file directly
    if (!fileUpdatedDirectly) {
      writeFileSync(pbxprojFile, project.writeSync());
    }
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
