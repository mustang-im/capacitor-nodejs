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
// xcode is a CommonJS module - keep it external (not bundled)
import xcode from 'xcode';
import { findCapacitorConfig, getNodeJSProjectPath, findCapacitorProjectRoot } from './config-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the Capacitor iOS project directory
 * Looks for ios/App or ios directory in the project
 * Searches from current working directory and walks up to find the project root
 */
function findIOSProjectPath(projectRoot: string): string | null {
  // Build list of possible roots to search (similar to findCapacitorConfig)
  const possibleRoots: string[] = [projectRoot];

  // Also search parent directories (for monorepos or when run from plugin directory)
  let current = projectRoot;
  for (let i = 0; i < 10; i++) {
    possibleRoots.push(current);
    const parent = resolve(current, '..');
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Remove duplicates and normalize paths
  const uniqueRoots = Array.from(new Set(possibleRoots.map(r => resolve(r))));

  // For each possible root, check for iOS project
  for (const root of uniqueRoots) {
    const possiblePaths = [
      join(root, 'ios', 'App'),
      join(root, 'ios'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        // Look for .xcodeproj or .xcworkspace
        const xcodeproj = join(path, 'App.xcodeproj');
        const xcworkspace = join(path, 'App.xcworkspace');
        if (existsSync(xcodeproj) || existsSync(xcworkspace)) {
          return path;
        }
      }
    }
  }

  return null;
}

/**
 * Find the Xcode project directory (.xcodeproj)
 * Returns the path to the .xcodeproj directory (not the project.pbxproj file)
 */
function findXcodeProject(iosPath: string): string | null {
  const xcodeprojDir = join(iosPath, 'App.xcodeproj');
  const xcodeprojFile = join(xcodeprojDir, 'project.pbxproj');
  if (existsSync(xcodeprojFile)) {
    return xcodeprojDir; // Return directory, not file
  }

  // Also check for Plugin.xcodeproj (for plugin development)
  const pluginXcodeprojDir = join(iosPath, 'Plugin.xcodeproj');
  const pluginXcodeprojFile = join(pluginXcodeprojDir, 'project.pbxproj');
  if (existsSync(pluginXcodeprojFile)) {
    return pluginXcodeprojDir; // Return directory, not file
  }

  return null;
}


/**
 * Get the path to rebuild-native-module.js script
 */
function getRebuildScriptPath(): string {
  // Script is in scripts/dist/rebuild-native-module.js
  const scriptPath = resolve(__dirname, 'dist', 'rebuild-native-module.js');
  return scriptPath;
}

/**
 * Get the path to nodejs-mobile-gyp
 */
function getNodeGypPath(projectRoot: string): string {
  // Try plugin's node_modules first
  const pluginNodeGyp = join(projectRoot, 'node_modules', 'nodejs-mobile-gyp', 'bin', 'node-gyp.js');
  if (existsSync(pluginNodeGyp)) {
    return pluginNodeGyp;
  }

  // Try parent node_modules (for monorepos)
  const parentNodeGyp = join(projectRoot, '..', 'node_modules', 'nodejs-mobile-gyp', 'bin', 'node-gyp.js');
  if (existsSync(parentNodeGyp)) {
    return parentNodeGyp;
  }

  // Fallback to assuming it's in PATH
  return 'nodejs-mobile-gyp';
}

/**
 * Create the rebuild native modules build phase script
 */
function createRebuildScript(
  nodejsProjectPath: string,
  rebuildScriptPath: string,
  nodeGypPath: string
): string {
  // Escape the paths for use in shell script
  const escapedRebuildScriptPath = rebuildScriptPath.replace(/'/g, "'\\''");
  const escapedNodeGypPath = nodeGypPath.replace(/'/g, "'\\''");

  return `set -e
# Check if build native modules preference is set
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  # If build native modules preference is not set, look for it in the project's
  # webDir/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"
  fi
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  # If build native modules preference is not set, try to find .gyp files to turn it on.
  gypfiles=($(find "$CODESIGNING_FOLDER_PATH/nodejs/" -type f -name "*.gyp" 2>/dev/null || true))
  if [ \${#gypfiles[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi

# Delete object files that may already come from within the npm package.
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.o" -type f -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.a" -type f -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.node" -type f -delete 2>/dev/null || true

# Delete bundle contents that may be there from previous builds.
find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.node/*" -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.node" -type d -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.framework/*" -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d -delete 2>/dev/null || true

# Symlinks to binaries are resolved during the copy, causing build time errors.
# The original project's .bin folder will be added to the path before building the native modules.
find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/.bin/*" -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name ".bin" -type d -delete 2>/dev/null || true

# Get the nodejs-mobile-gyp location
NODEJS_MOBILE_GYP_BIN_FILE="${escapedNodeGypPath}"

# Get the nodejs headers directory (libnode/include/node)
# Try multiple possible paths
NODEJS_HEADERS_DIR=""
if [ -d "$PROJECT_DIR/../ios/libnode/include/node" ]; then
  NODEJS_HEADERS_DIR="$( cd "$PROJECT_DIR" && cd ../ios/libnode/include/node && pwd )"
elif [ -d "$PROJECT_DIR/../../ios/libnode/include/node" ]; then
  NODEJS_HEADERS_DIR="$( cd "$PROJECT_DIR" && cd ../../ios/libnode/include/node && pwd )"
elif [ -d "$( dirname "$PRODUCT_SETTINGS_PATH" )/Plugins/capacitor-nodejs/ios/libnode/include/node" ]; then
  NODEJS_HEADERS_DIR="$( cd "$( dirname "$PRODUCT_SETTINGS_PATH" )" && cd Plugins/capacitor-nodejs/ios/libnode/include/node && pwd )"
fi

# Adds the original project .bin to the path. It's a workaround
# to correctly build some modules that depend on symlinked modules,
# like node-pre-gyp.
if [ -d "$CODESIGNING_FOLDER_PATH/nodejs/node_modules/.bin/" ]; then
  PATH="$CODESIGNING_FOLDER_PATH/nodejs/node_modules/.bin/:$PATH"
fi

# Rebuild modules for each architecture
pushd "$CODESIGNING_FOLDER_PATH/nodejs/" > /dev/null

if [ "$PLATFORM_NAME" == "iphoneos" ]; then
  # Device build - arm64
  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="arm64" node "${escapedRebuildScriptPath}" "$CODESIGNING_FOLDER_PATH/nodejs/" "ios-arm64" || true
else
  # Simulator build - x64
  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="x64" node "${escapedRebuildScriptPath}" "$CODESIGNING_FOLDER_PATH/nodejs/" "ios-x64" || true
fi

popd > /dev/null
`;
}

/**
 * Create the sign native modules build phase script
 */
function createSignScript(): string {
  return `set -e
# Check if build native modules preference is set
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/nodejs/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"
    # Remove the preference file so it doesn't get in the application package.
    rm "$PREFERENCE_FILE_PATH"
  fi
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  gypfiles=($(find "$CODESIGNING_FOLDER_PATH/nodejs/" -type f -name "*.gyp" 2>/dev/null || true))
  if [ \${#gypfiles[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi

# Delete object files
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.o" -type f -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.a" -type f -delete 2>/dev/null || true

# Create Info.plist for each framework built and loader override.
# Note: This helper script would need to be ported from nodejs-mobile-cordova
# For now, we'll skip this step and rely on the frameworks being properly built
# PATCH_SCRIPT_DIR="$( cd "$PROJECT_DIR" && cd ../../Plugins/capacitor-nodejs/install/helper-scripts/ && pwd )"
# NODEJS_PROJECT_DIR="$( cd "$CODESIGNING_FOLDER_PATH" && cd nodejs/ && pwd )"
# node "$PATCH_SCRIPT_DIR"/ios-create-plists-and-dlopen-override.js $NODEJS_PROJECT_DIR

# Embed every resulting .framework in the application and delete them afterwards.
embed_framework()
{
    FRAMEWORK_NAME="$(basename "$1")"
    mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    cp -r "$1" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    /usr/bin/codesign --force --sign $EXPANDED_CODE_SIGN_IDENTITY --preserve-metadata=identifier,entitlements,flags --timestamp=none "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME"
}

find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d | while read frmwrk_path; do embed_framework "$frmwrk_path"; done

# Delete gyp temporary .deps dependency folders from the project structure.
find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/.deps/*" -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name ".deps" -type d -delete 2>/dev/null || true

# Delete frameworks from their build paths
find "$CODESIGNING_FOLDER_PATH/nodejs/" -path "*/*.framework/*" -delete 2>/dev/null || true
find "$CODESIGNING_FOLDER_PATH/nodejs/" -name "*.framework" -type d -delete 2>/dev/null || true
`;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Get project root by finding Capacitor config file location
    // This is more reliable than process.cwd() which might be different
    const projectRoot = await findCapacitorProjectRoot() || process.cwd();

    console.log(`Searching for iOS project from project root: ${projectRoot}`);

    // Find iOS project path
    const iosPath = findIOSProjectPath(projectRoot);
    if (!iosPath) {
      console.warn(`iOS project not found. Searched from: ${projectRoot}`);
      console.warn('Skipping iOS hook setup.');
      return;
    }

    // Find Xcode project file
    const xcodeprojDir = findXcodeProject(iosPath);
    if (!xcodeprojDir) {
      console.warn('Xcode project file not found. Skipping iOS hook setup.');
      return;
    }

    console.log(`Found iOS project at: ${iosPath}`);
    console.log(`Found Xcode project at: ${xcodeprojDir}`);

    // Get Capacitor config and nodejs project path
    const config = await findCapacitorConfig();
    const nodejsProjectPath = getNodeJSProjectPath(config, projectRoot);
    const rebuildScriptPath = getRebuildScriptPath();
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
    const rebuildScriptPathRel = resolve(__dirname, 'dist', 'rebuild-native-module.js');
    const rebuildScript = createRebuildScript(nodejsProjectPath, rebuildScriptPathRel, nodeGypPath);
    const signScript = createSignScript();

    // Add rebuild native modules build phase
    const rebuildPhaseName = 'Build Node.js Mobile Native Modules';

    // Check if build phase already exists by reading the project file
    const pbxprojContent = readFileSync(pbxprojFile, 'utf8');
    if (pbxprojContent.includes(rebuildPhaseName)) {
      console.log(`Build phase already exists: ${rebuildPhaseName}`);
    } else {
      // Add build phase using xcode package
      // xcode.addBuildPhase(filePathsArray, buildPhaseType, comment, targetUuid, options)
      // For shell script: options should be { shellScript: "...", shellPath: "/bin/sh" }
      try {
        project.addBuildPhase(
          [], // filePathsArray - empty for shell script
          'PBXShellScriptBuildPhase',
          rebuildPhaseName,
          target.uuid,
          {
            shellScript: rebuildScript,
            shellPath: '/bin/sh'
          }
        );
        console.log(`Added build phase: ${rebuildPhaseName}`);
      } catch (error) {
        console.error(`Failed to add build phase ${rebuildPhaseName}: ${error}`);
        return;
      }
    }

    // Add sign native modules build phase
    const signPhaseName = 'Sign Node.js Mobile Native Modules';
    if (pbxprojContent.includes(signPhaseName)) {
      console.log(`Build phase already exists: ${signPhaseName}`);
    } else {
      try {
        project.addBuildPhase(
          [], // filePathsArray - empty for shell script
          'PBXShellScriptBuildPhase',
          signPhaseName,
          target.uuid,
          {
            shellScript: signScript,
            shellPath: '/bin/sh'
          }
        );
        console.log(`Added build phase: ${signPhaseName}`);
      } catch (error) {
        console.error(`Failed to add build phase ${signPhaseName}: ${error}`);
        return;
      }
    }

    // Save the project
    writeFileSync(pbxprojFile, project.writeSync());
    console.log('iOS hook setup completed successfully.');

  } catch (error) {
    const err = error as Error;
    console.error('Error setting up iOS hooks:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

