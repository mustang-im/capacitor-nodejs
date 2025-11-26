#!/bin/bash
# Build phase script to rebuild Node.js native modules for iOS


PROJECT_ROOT="$PROJECT_DIR/../.."   # adjust if needed

# Source nvm if HOME is defined
if [ -n "${HOME:-}" ]; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

ASSETS_PATH="$(dirname "$PRODUCT_SETTINGS_PATH")"
NODE_PROJECT=$(jq -r '.plugins.CapacitorNodeJS.nodeDir' "$ASSETS_PATH/capacitor.config.json")
NODE_PROJECT_PATH="$CODESIGNING_FOLDER_PATH/public/$NODE_PROJECT"

# Determine if we need to rebuild native modules
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/public/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat "$PREFERENCE_FILE_PATH" | xargs)"
  fi
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  gypfiles=($(find "$NODE_PROJECT_PATH/node_modules" -type f -name "*.gyp"))
  if [ ${#gypfiles[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  echo "Skipping native module rebuild."
  exit 0
fi

echo "Cleaning old object files..."
find "$NODE_PROJECT_PATH" -name "*.o" -type f -delete
find "$NODE_PROJECT_PATH" -name "*.a" -type f -delete
find "$NODE_PROJECT_PATH" -name "*.node" -type f -delete
find "$NODE_PROJECT_PATH" -path "*/*.node/*" -delete
find "$NODE_PROJECT_PATH" -name "*.framework" -type d -delete
find "$NODE_PROJECT_PATH" -path "*/*.framework/*" -delete
find "$NODE_PROJECT_PATH" -path "*/.bin/*" -delete
find "$NODE_PROJECT_PATH" -name ".bin" -type d -delete

# Locate nodejs-mobile-gyp
if [ -d "$PROJECT_ROOT/node_modules/nodejs-mobile-gyp/" ]; then
  NODEJS_MOBILE_GYP_DIR="$(cd "$PROJECT_ROOT/node_modules/nodejs-mobile-gyp" && pwd)"
else
  echo "nodejs-mobile-gyp not found"
  exit 1
fi
NODEJS_MOBILE_GYP_BIN_FILE="$NODEJS_MOBILE_GYP_DIR/bin/node-gyp.js"

# Node.js headers for building
NODEJS_HEADERS_DIR="$(cd $PROJECT_ROOT/node_modules/capacitor-nodejs/ios/libnode && pwd)"

# Add project .bin to PATH
if [ -d "$PROJECT_ROOT/dist/nodejs/node_modules/.bin/" ]; then
  PATH="$PROJECT_ROOT/dist/nodejs/node_modules/.bin/:$PATH"
fi

# Set platform-specific flags
if [ "$PLATFORM_NAME" == "iphoneos" ]; then
  TARGET_ARCH="arm64"
  GYP_DEFINES="OS=ios PLATFORM=ios iossim=0 TARGET_ARCH=$TARGET_ARCH"
else
  TARGET_ARCH="x64"
  GYP_DEFINES="OS=ios PLATFORM=ios iossim=1 TARGET_ARCH=$TARGET_ARCH"
fi

echo "Rebuilding native modules for platform: $PLATFORM_NAME, arch: $TARGET_ARCH"

PATCH_SCRIPT="$PROJECT_ROOT/node_modules/capacitor-nodejs/scripts/ios/patch-binding-gyp.js"

if [[ ! -f "$PATCH_SCRIPT" ]]; then
    echo "Error: patch-binding-gyp.js not found at $PATCH_SCRIPT"
    exit 1
fi

# Rebuild each native module individually
for module in "$NODE_PROJECT_PATH/node_modules/"*/ ; do
  if [ -f "$module/binding.gyp" ]; then
    echo "Patching binding.gyp for module: $module"
    node "$PATCH_SCRIPT" "$module/binding.gyp"

    # Patch package.json if it exists
    if [ -f "$module/package.json" ]; then
        echo "  - Patching package.json"
        node "$PATCH_SCRIPT" "$module/package.json"
    fi

    echo "Rebuilding native module: $module"
    node "$NODEJS_MOBILE_GYP_BIN_FILE" rebuild \
      --release \
      --nodedir="$NODEJS_HEADERS_DIR" \
      --arch="$TARGET_ARCH" \
      --platform="ios" \
      --directory="$module"

    # Convert any .node bundles to shared libraries
    for nodeFile in "$module"*.node; do
        if [ -f "$nodeFile" ]; then
            echo "  - Converting $(basename "$nodeFile") to shared library"
            node "$PATCH_SCRIPT" "$nodeFile" convert
        fi
    done
  fi
done

echo "Native module rebuild completed."
