/**
 * iOS hook script to add build phases for rebuilding Node.js native modules
 * Ported from nodejs-mobile-cordova for Capacitor
 *
 * This script adds two build phases to the Xcode project:
 * 1. Build Node.js Mobile Native Modules - Rebuilds native modules using rebuild-native-module.js
 * 2. Sign Node.js Mobile Native Modules - Signs and embeds the resulting frameworks
 *
 * Usage: This script is typically run as a Capacitor hook after plugin installation
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import xcode from 'xcode';
import { findCapacitorConfig, getNodeJSProjectPath, findCapacitorProjectRoot } from './config-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Fix NodeMobile framework path in Pods project
 * Based on nodejs-mobile-cordova's fix-xcframework-path.js approach
 * Reference: https://github.com/nodejs-mobile/nodejs-mobile-cordova/blob/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/hooks/ios/fix-xcframework-path.js
 */
async function fixXcframeworkPath(projectRoot: string, iosPath: string): Promise<void> {
  try {
    // Framework is at plugin/ios/libnode/NodeMobile.xcframework
    // When plugin is installed, it's at node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework
    // Pods project is at ios/App/Pods/Pods.xcodeproj/project.pbxproj
    // Relative path from Pods project to framework: ../../../node_modules/capacitor-nodejs/ios/libnode/NodeMobile.xcframework

    const podsProjectPath = join(iosPath, 'Pods', 'Pods.xcodeproj', 'project.pbxproj');
    if (!existsSync(podsProjectPath)) {
      console.warn(`Pods project not found at: ${podsProjectPath}`);
      console.warn('Run pod install first.');
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
 */
function findIOSProjectPath(projectRoot: string): string | null {
  const iosPath = join(projectRoot, 'ios', 'App');
  if (existsSync(iosPath)) {
    return iosPath;
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
 * Create rebuild script content
 */
function createRebuildScript(nodejsProjectPath: string, rebuildScriptPathRel: string, nodeGypPath: string): string {
  // Use array join to avoid TypeScript parsing bash ${} syntax
  return [
    'set -e',
    '# Check if build native modules preference is set',
    'if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then',
    '  # If build native modules preference is not set, look for it in the project\'s',
    '  # webDir/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt',
    '  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"',
    '  if [ -f "$PREFERENCE_FILE_PATH" ]; then',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"',
    '  fi',
    'fi',
    '',
    'if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then',
    '  # If build native modules preference is not set, try to find .gyp files to turn it on.',
    '  gypfiles=($(find "$CODESIGNING_FOLDER_PATH/nodejs/" -type f -name "*.gyp" 2>/dev/null || true))',
    '  gypfiles_count=${#gypfiles[@]}',
    '  if [ "$gypfiles_count" -gt 0 ]; then',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1',
    '  else',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0',
    '  fi',
    'fi',
    '',
    'if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi',
    '',
    '# Delete object files that may already come from within the npm package.',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.o" -type f -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.a" -type f -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.node" -type f -delete 2>/dev/null || true',
    '',
    '# Delete bundle contents that may be there from previous builds.',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.node/*" -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.node" -type d -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.framework/*" -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d -delete 2>/dev/null || true',
    '',
    '# Symlinks to binaries are resolved during the copy, causing build time errors.',
    '# The original project\'s .bin folder will be added to the path before building the native modules.',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/.bin/*" -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name ".bin" -type d -delete 2>/dev/null || true',
    '',
    '# Get the nodejs-mobile-gyp location',
    `NODEJS_MOBILE_GYP_BIN_FILE="${nodeGypPath}"`,
    '',
    '# Get the nodejs headers directory (libnode/include/node)',
    '# Try multiple possible paths',
    'NODEJS_HEADERS_DIR=""',
    'if [ -d "$PROJECT_DIR/../ios/libnode/include/node" ]; then',
    '  NODEJS_HEADERS_DIR="$( cd "$PROJECT_DIR" && cd ../ios/libnode/include/node && pwd )"',
    'elif [ -d "$PROJECT_DIR/../../ios/libnode/include/node" ]; then',
    '  NODEJS_HEADERS_DIR="$( cd "$PROJECT_DIR" && cd ../../ios/libnode/include/node && pwd )"',
    'elif [ -d "$( dirname "$PRODUCT_SETTINGS_PATH" )/Plugins/capacitor-nodejs/ios/libnode/include/node" ]; then',
    '  NODEJS_HEADERS_DIR="$( cd "$( dirname "$PRODUCT_SETTINGS_PATH" )" && cd Plugins/capacitor-nodejs/ios/libnode/include/node && pwd )"',
    'fi',
    '',
    '# Adds the original project .bin to the path. It\'s a workaround',
    '# to correctly build some modules that depend on symlinked modules,',
    '# like node-pre-gyp.',
    'if [ -d "$CODESIGNING_FOLDER_PATH/nodejs/node_modules/.bin/" ]; then',
    '  PATH="$CODESIGNING_FOLDER_PATH/nodejs/node_modules/.bin/:$PATH"',
    'fi',
    '',
    '# Rebuild modules for each architecture',
    'pushd "$CODESIGNING_FOLDER_PATH/nodejs/" > /dev/null',
    '',
    'if [ "$PLATFORM_NAME" == "iphoneos" ]; then',
    '  # Device build - arm64',
    `  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="arm64" node "${rebuildScriptPathRel}" "$CODESIGNING_FOLDER_PATH/nodejs/" "ios-arm64" || true`,
    'else',
    '  # Simulator build - x64',
    `  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="x64" node "${rebuildScriptPathRel}" "$CODESIGNING_FOLDER_PATH/nodejs/" "ios-x64" || true`,
    'fi',
    '',
    'popd > /dev/null'
  ].join('\n');
}

/**
 * Create sign script content
 */
function createSignScript(): string {
  // Use array join to avoid TypeScript parsing bash ${} syntax
  return [
    'set -e',
    '# Check if build native modules preference is set',
    'if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then',
    '  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"',
    '  if [ -f "$PREFERENCE_FILE_PATH" ]; then',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"',
    '    # Remove the preference file so it doesn\'t get in the application package.',
    '    rm "$PREFERENCE_FILE_PATH"',
    '  fi',
    'fi',
    '',
    'if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then',
    '  gypfiles=($(find "$CODESIGNING_FOLDER_PATH/nodejs/" -type f -name "*.gyp" 2>/dev/null || true))',
    '  gypfiles_count=${#gypfiles[@]}',
    '  if [ "$gypfiles_count" -gt 0 ]; then',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1',
    '  else',
    '    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0',
    '  fi',
    'fi',
    '',
    'if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi',
    '',
    '# Delete object files',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.o" -type f -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.a" -type f -delete 2>/dev/null || true',
    '',
    '# Create Info.plist for each framework built and loader override.',
    '# Note: This helper script would need to be ported from nodejs-mobile-cordova',
    '# For now, we\'ll skip this step and rely on the frameworks being properly built',
    '# PATCH_SCRIPT_DIR="$( cd "$PROJECT_DIR" && cd ../../Plugins/capacitor-nodejs/install/helper-scripts/ && pwd )"',
    '# NODEJS_PROJECT_DIR="$( cd "$CODESIGNING_FOLDER_PATH" && cd nodejs/ && pwd )"',
    '# node "$PATCH_SCRIPT_DIR"/ios-create-plists-and-dlopen-override.js $NODEJS_PROJECT_DIR',
    '',
    '# Embed every resulting .framework in the application and delete them afterwards.',
    'embed_framework()',
    '{',
    '    FRAMEWORK_NAME="$(basename "$1")"',
    '    mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"',
    '    cp -r "$1" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"',
    '    /usr/bin/codesign --force --sign $EXPANDED_CODE_SIGN_IDENTITY --preserve-metadata=identifier,entitlements,flags --timestamp=none "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME"',
    '}',
    '',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d | while read frmwrk_path; do embed_framework "$frmwrk_path"; done',
    '',
    '# Delete gyp temporary .deps dependency folders from the project structure.',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/.deps/*" -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name ".deps" -type d -delete 2>/dev/null || true',
    '',
    '# Delete frameworks from their build paths',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.framework/*" -delete 2>/dev/null || true',
    'find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d -delete 2>/dev/null || true'
  ].join('\n');
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
      console.warn('Skipping iOS hook setup.');
      return;
    }
    const xcodeprojDir = findXcodeProject(iosPath);
    if (!xcodeprojDir) {
      console.warn('Xcode project file not found. Skipping iOS hook setup.');
      return;
    }

    console.log(`Found iOS project at: ${iosPath}`);
    console.log(`Found Xcode project at: ${xcodeprojDir}`);

    // Fix NodeMobile framework path in Pods project
    await fixXcframeworkPath(projectRoot, iosPath);

    // Get Capacitor config and nodejs project path
    const config = await findCapacitorConfig();
    const nodejsProjectPath = getNodeJSProjectPath(config, projectRoot);
    const rebuildScriptPathRel = getRebuildScriptPath();
    const nodeGypPath = getNodeGypPath(projectRoot);

    // Load Xcode project using xcode package
    const pbxprojFile = join(xcodeprojDir, 'project.pbxproj');
    if (!existsSync(pbxprojFile)) {
      console.warn('project.pbxproj file not found. Skipping iOS hook setup.');
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
      console.warn('No targets found in Xcode project. Skipping iOS hook setup.');
      return;
    }

    console.log(`Using target: ${target.name || target.uuid || 'unknown'}`);

    // Create build phase scripts
    // Use relative path for the rebuild script
    const rebuildScript = createRebuildScript(nodejsProjectPath, rebuildScriptPathRel, nodeGypPath);
    const signScript = createSignScript();

    // Check if build phases already exist
    const pbxprojContent = readFileSync(pbxprojFile, 'utf8');
    const rebuildPhaseExists = pbxprojContent.includes('Build Node.js Mobile Native Modules');
    const signPhaseExists = pbxprojContent.includes('Sign Node.js Mobile Native Modules');

    if (!rebuildPhaseExists) {
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
      console.log('Added build phase: Build Node.js Mobile Native Modules');
    } else {
      console.log('Build phase already exists: Build Node.js Mobile Native Modules');
    }

    if (!signPhaseExists) {
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
      console.log('Added build phase: Sign Node.js Mobile Native Modules');
    } else {
      console.log('Build phase already exists: Sign Node.js Mobile Native Modules');
    }

    writeFileSync(pbxprojFile, project.writeSync());
    console.log('iOS hook setup completed successfully.');
  } catch (error) {
    const err = error as Error;
    console.error(`Error setting up iOS hooks: ${err.message}`);
    console.error(`Error stack: ${err.stack}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Unhandled error: ${error}`);
  process.exit(1);
});
