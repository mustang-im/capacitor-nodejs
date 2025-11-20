# iOS Native Modules - Debugging and Troubleshooting Guide

This guide covers the structure, debugging, and troubleshooting for Node.js native modules on iOS.

## Table of Contents

- [Overview](#overview)
- [Required Structure](#required-structure)
- [Build Process](#build-process)
- [Native Module Structure](#native-module-structure)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)
- [Verification](#verification)

## Overview

iOS native modules require a specific structure and build process:

1. **Node.js Mobile Runtime**: The Node.js runtime is provided via the `NodeMobile.xcframework`
2. **Native Modules**: JavaScript modules with native C/C++ bindings must be compiled for iOS
3. **Framework Creation**: Native modules are converted to iOS frameworks for proper code signing
4. **Code Signing**: All frameworks must be signed with the app's code signing identity

## Required Structure

### Node.js Project Structure

The Node.js project must be located in the Capacitor `webDir` (typically `dist` or `www`):

```
your-app/
├── dist/                    # Capacitor webDir
│   └── nodejs/              # Node.js project directory (configurable via nodeDir)
│       ├── index.js         # Entry point
│       ├── package.json
│       └── node_modules/
│           └── your-module/
│               ├── binding.gyp    # Required for native modules
│               └── src/            # C/C++ source files
```

### iOS Build Structure

During the iOS build, the structure becomes:

```
App.app/
├── Frameworks/              # Embedded frameworks
│   ├── Capacitor.framework
│   ├── NodeMobile.framework
│   └── node<hash>.framework # Native module frameworks
└── public/
    └── nodejs/              # Node.js project
        ├── index.js
        ├── node_modules/
        │   └── your-module/
        │       └── build/
        │           └── Release/
        │               └── your-module.node/  # Organized .node directory
        └── override-dlopen-paths-data.json   # Path mapping for frameworks
```

## Build Process

### Build Phases

The plugin automatically adds two build phases to your Xcode project:

1. **Build Node.js Mobile Native Modules**
   - Runs `rebuild-native-modules.js`
   - Patches `package.json` and `binding.gyp` files
   - Rebuilds native modules using `nodejs-mobile-gyp`
   - Converts bundles to shared libraries

2. **Sign Node.js Mobile Native Modules**
   - Runs `sign-native-modules.js`
   - Creates frameworks from `.node` files
   - Embeds frameworks in the app
   - Signs frameworks with code signing identity

### Build Flow

```
1. Xcode Build Starts
   ↓
2. Build Node.js Mobile Native Modules Phase
   ├─ Detects native modules (checks for .gyp files)
   ├─ Patches package.json (node-gyp → nodejs-mobile-gyp)
   ├─ Patches binding.gyp (adds product_type: 'dynamic_library')
   ├─ Runs npm rebuild
   └─ Converts MH_BUNDLE to MH_DYLIB
   ↓
3. Sign Node.js Mobile Native Modules Phase
   ├─ Finds .node directories in:
   │  ├─ build/Release/*.node
   │  ├─ prebuilds/*/*.node
   │  └─ node_modules/*/prebuilds/*/*.node
   ├─ Creates frameworks from .node files
   ├─ Generates override-dlopen-paths-data.json
   ├─ Copies frameworks to App.app/Frameworks/
   └─ Signs frameworks with codesign
   ↓
4. Xcode Build Completes
```

## Native Module Structure

### Detecting Native Modules

The build system detects native modules by looking for:

1. **`.gyp` files**: Any `binding.gyp` or `*.gyp` file indicates a native module
2. **Organized `.node` directories**: Pre-built modules in:
   - `build/Release/*.node/`
   - `prebuilds/<platform>/*.node/`
   - `node_modules/<module>/prebuilds/<platform>/*.node/`

### Native Module Formats

#### 1. GYP-based Modules (Source Code)

Modules with `binding.gyp` files are built from source:

```
your-module/
├── binding.gyp
├── package.json
└── src/
    └── your-module.cc
```

**Requirements:**
- `binding.gyp` file must exist
- C/C++ source files
- Compatible with `nodejs-mobile-gyp`

#### 2. Prebuilt Modules

Pre-built modules for iOS:

```
your-module/
└── prebuilds/
    └── ios-arm64/          # or ios-arm64_x86_64-simulator
        └── your-module.node/
            └── <binary>
```

**Supported Platforms:**
- `ios-arm64` - iOS devices (arm64)
- `ios-arm64_x86_64-simulator` - iOS Simulator (arm64 + x86_64)

#### 3. Build Output

After building, modules are organized as:

```
your-module/
└── build/
    └── Release/
        └── your-module.node/    # Directory containing binary
            └── <binary>
```

## Debugging

### Enable Verbose Logging

To see detailed build output, check the Xcode build log:

1. Open Xcode
2. Go to **Product** → **Build** (or press `Cmd+B`)
3. Open the **Report Navigator** (⌘9)
4. Select the latest build
5. Filter by "Sign Node.js Mobile Native Modules" or "Build Node.js Mobile Native Modules"

### Manual Script Execution

Test the scripts manually to see their output:

```bash
# Set environment variables (from Xcode build settings)
export NODE_DIR="nodejs"
export CODESIGNING_FOLDER_PATH="/path/to/App.app"
export PLUGIN_SCRIPTS_PATH="node_modules/capacitor-nodejs/scripts/dist"
export TARGET_BUILD_DIR="/path/to/build/dir"
export FRAMEWORKS_FOLDER_PATH="Frameworks"
export PROJECT_DIR="/path/to/project"

# Run the sign script
node node_modules/capacitor-nodejs/scripts/dist/sign-native-modules.js
```

### Check Script Output

The `sign-native-modules.js` script outputs:

- `Creating frameworks from organized .node files in: <path>`
- `Found N framework(s) to create`
- `FRAMEWORK:<path>` - One line per framework created
- `No frameworks found to create` - If no native modules detected

### Verify Framework Creation

Check if frameworks were created:

```bash
# In Xcode build directory
find ~/Library/Developer/Xcode/DerivedData/*/Build/Products/*/App.app/Frameworks \
  -name "node*.framework" -type d
```

### Check Override JSON

Verify the path mapping file:

```bash
cat <App.app>/public/nodejs/override-dlopen-paths-data.json
```

Should contain entries like:
```json
[
  {
    "originalpath": ["build", "Release", "your-module.node"],
    "newpath": ["..", "..", "Frameworks", "node<hash>.framework", "node<hash>"]
  }
]
```

## Troubleshooting

### Issue: "No frameworks found to create"

**Symptoms:**
- Build succeeds but no native module frameworks are created
- Script outputs: "No frameworks found to create"

**Causes:**
1. No native modules installed
2. Native modules don't have `.gyp` files
3. Native modules weren't built (no `.node` files in `build/Release/`)
4. Prebuilds are for wrong platform (e.g., darwin instead of ios)

**Solutions:**

1. **Check for native modules:**
   ```bash
   find <nodejs-dir> -name "*.gyp" -o -name "binding.gyp"
   ```

2. **Verify build output:**
   ```bash
   find <nodejs-dir> -path "*/build/Release/*.node" -type d
   ```

3. **Check prebuilds platform:**
   ```bash
   find <nodejs-dir> -path "*/prebuilds/*" -name "*.node"
   # Should be ios-arm64 or ios-arm64_x86_64-simulator
   ```

4. **Force rebuild:**
   ```bash
   cd <nodejs-dir>
   npm rebuild
   ```

### Issue: "Warning: node directory not found"

**Symptoms:**
- Script exits early with: "Warning: node directory not found at <path>, skipping code signing"

**Causes:**
- Node.js directory path is incorrect
- `CODESIGNING_FOLDER_PATH` is not set correctly
- `NODE_DIR` doesn't match actual directory name

**Solutions:**

1. **Check environment variables:**
   ```bash
   echo $CODESIGNING_FOLDER_PATH
   echo $NODE_DIR
   ```

2. **Verify directory structure:**
   ```bash
   ls -la $CODESIGNING_FOLDER_PATH/public/$NODE_DIR
   # or
   ls -la $CODESIGNING_FOLDER_PATH/$NODE_DIR
   ```

3. **Update Capacitor config:**
   ```typescript
   // capacitor.config.ts
   {
     plugins: {
       CapacitorNodeJS: {
         nodeDir: "nodejs"  // Must match actual directory name
       }
     }
   }
   ```

### Issue: Framework Creation Fails

**Symptoms:**
- Script outputs: "Warning: Framework creation script failed, continuing anyway"
- No frameworks in `App.app/Frameworks/`

**Causes:**
1. `create-frameworks-and-override.js` script not found
2. `.node` files are corrupted or empty
3. Binary architecture mismatch

**Solutions:**

1. **Check script path:**
   ```bash
   ls -la $PLUGIN_SCRIPTS_PATH/create-frameworks-and-override.js
   ```

2. **Verify .node files:**
   ```bash
   file <path-to-.node-file>
   # Should show: Mach-O universal binary with 2 architectures: [arm64 x86_64]
   ```

3. **Check binary size:**
   ```bash
   ls -lh <path-to-.node-file>
   # Should not be 0 bytes
   ```

### Issue: Code Signing Fails

**Symptoms:**
- Build fails with code signing errors
- Frameworks not signed

**Causes:**
1. `EXPANDED_CODE_SIGN_IDENTITY` not set
2. Code signing identity invalid
3. Framework structure incorrect

**Solutions:**

1. **Check code signing identity:**
   ```bash
   echo $EXPANDED_CODE_SIGN_IDENTITY
   # Should be set by Xcode
   ```

2. **Manually sign framework:**
   ```bash
   codesign --force --sign "Apple Development: Your Name" \
     --preserve-metadata=identifier,entitlements,flags \
     --timestamp=none <framework-path>
   ```

3. **Verify framework structure:**
   ```bash
   ls -la <framework-path>/
   # Should contain: Info.plist and binary file
   ```

### Issue: Module Not Loading at Runtime

**Symptoms:**
- App crashes when loading native module
- "dlopen failed" errors

**Causes:**
1. Framework not embedded in app
2. Path override not working
3. Architecture mismatch

**Solutions:**

1. **Verify framework is embedded:**
   ```bash
   # Check app bundle
   ls -la <App.app>/Frameworks/node*.framework
   ```

2. **Check override JSON:**
   ```bash
   cat <App.app>/public/nodejs/override-dlopen-paths-data.json
   ```

3. **Verify architecture:**
   ```bash
   file <App.app>/Frameworks/node*.framework/node*
   # Should match app architecture
   ```

### Issue: Build Phase Not Running

**Symptoms:**
- Build phases not executing
- No script output in build log

**Causes:**
1. Build phases not added to Xcode project
2. Script path incorrect
3. Node.js not in PATH

**Solutions:**

1. **Re-sync Capacitor:**
   ```bash
   npx cap sync ios
   ```

2. **Check build phases in Xcode:**
   - Open Xcode project
   - Select target → Build Phases
   - Verify "Build Node.js Mobile Native Modules" and "Sign Node.js Mobile Native Modules" exist

3. **Check script paths:**
   ```bash
   # In Xcode build phase, should be:
   node "../../node_modules/capacitor-nodejs/scripts/dist/rebuild-native-modules.js"
   node "../../node_modules/capacitor-nodejs/scripts/dist/sign-native-modules.js"
   ```

## Verification

### Verify Build Phases

1. Open Xcode project
2. Select your app target
3. Go to **Build Phases** tab
4. Verify these phases exist:
   - ✅ Build Node.js Mobile Native Modules
   - ✅ Sign Node.js Mobile Native Modules

### Verify Framework Creation

After a successful build:

```bash
# Find build directory
BUILD_DIR=$(xcodebuild -showBuildSettings -project YourApp.xcodeproj \
  -scheme YourApp | grep BUILD_DIR | head -1 | awk '{print $3}')

# Check frameworks
find "$BUILD_DIR" -name "node*.framework" -type d
```

### Verify Framework Structure

Each framework should have:

```
node<hash>.framework/
├── Info.plist          # Framework metadata
└── node<hash>          # Binary executable
```

### Verify Code Signing

```bash
# Check framework signature
codesign -dv --verbose=4 <framework-path>

# Should show:
# Authority=Apple Development: Your Name (XXXXXXXXXX)
# Identifier=com.nodejs.node<hash>.framework
```

### Verify Runtime Loading

Check app logs for:

```
Creating frameworks from organized .node files in: <path>
Found N framework(s) to create
FRAMEWORK:<path>
```

## Environment Variables

The build scripts use these Xcode environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_DIR` | Node.js directory name | `nodejs` |
| `CODESIGNING_FOLDER_PATH` | App bundle path | `/path/to/App.app` |
| `PLUGIN_SCRIPTS_PATH` | Plugin scripts directory | `node_modules/capacitor-nodejs/scripts/dist` |
| `TARGET_BUILD_DIR` | Build output directory | `/path/to/build` |
| `FRAMEWORKS_FOLDER_PATH` | Frameworks subdirectory | `Frameworks` |
| `EXPANDED_CODE_SIGN_IDENTITY` | Code signing identity | `Apple Development: Name` |
| `PROJECT_DIR` | Xcode project directory | `/path/to/project` |
| `NODEJS_MOBILE_BUILD_NATIVE_MODULES` | Force build flag | `1` or `0` |
| `NODEJS_MOBILE_GYP_BIN_FILE` | nodejs-mobile-gyp path | `${PROJECT_DIR}/../../node_modules/.bin/nodejs-mobile-gyp` |
| `NODEJS_HEADERS_DIR` | Node.js headers directory | `${PROJECT_DIR}/../../node_modules/capacitor-nodejs/ios/libnode` |

## Additional Resources

- [Node.js for Mobile Apps Documentation](https://github.com/nodejs-mobile/nodejs-mobile)
- [nodejs-mobile-gyp Documentation](https://github.com/nodejs-mobile/nodejs-mobile-gyp)
- [iOS Framework Structure](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFrameworks/Concepts/FrameworkAnatomy.html)
- [Code Signing Guide](https://developer.apple.com/documentation/xcode/code-signing-your-app)

