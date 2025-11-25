#!/bin/bash
# Sign Node.js native modules for iOS using process_frameworks.py

set -e

PROJECT_ROOT="$PROJECT_DIR/../.."

# Determine Node.js project path
ASSETS_PATH="$(dirname "$PRODUCT_SETTINGS_PATH")"
NODE_PROJECT=$(jq -r '.plugins.CapacitorNodeJS.nodeDir' "$ASSETS_PATH/capacitor.config.json")
NODE_PROJECT_PATH="$CODESIGNING_FOLDER_PATH/public/$NODE_PROJECT"

# Determine if native modules were built
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/public/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat "$PREFERENCE_FILE_PATH" | xargs)"
    rm "$PREFERENCE_FILE_PATH"
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

if [ "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" != "1" ]; then
  echo "No native modules to sign. Exiting."
  exit 0
fi

echo "Cleaning old frameworks..."
find "$NODE_PROJECT_PATH" -name "*.framework" -type d -exec rm -rf {} +

# Locate the patching Python script
PATCH_SCRIPT_DIR="$(cd "$PROJECT_DIR" && cd ../../node_modules/capacitor-nodejs/scripts/ios/ && pwd)"

# Ensure python3 is available
if ! command -v python3 &>/dev/null; then
  echo "python3 not found. Please install Python 3."
  exit 1
fi

echo "Generating frameworks from .node binaries..."
python3 "$PATCH_SCRIPT_DIR/process_frameworks.py" "$NODE_PROJECT_PATH"

echo "Embedding and signing frameworks..."
FRAMEWORKS=$(find "$NODE_PROJECT_PATH" -type d -name "*.framework")

if [ -z "$FRAMEWORKS" ]; then
  echo "No frameworks were generated."
  exit 0
fi

mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"

for fw in $FRAMEWORKS; do
  FRAMEWORK_NAME=$(basename "$fw")
  echo "Embedding $FRAMEWORK_NAME..."
  cp -R "$fw" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
  /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" \
    --preserve-metadata=identifier,entitlements,flags --timestamp=none \
    "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME"
done

echo "Cleaning up temporary build artifacts..."
find "$NODE_PROJECT_PATH" -name "*.o" -type f -delete
find "$NODE_PROJECT_PATH" -name "*.a" -type f -delete
find "$NODE_PROJECT_PATH" -name "*.framework" -type d -delete
find "$NODE_PROJECT_PATH" -path "*/*.framework/*" -delete
find "$NODE_PROJECT_PATH" -path "*/.bin/*" -delete
find "$NODE_PROJECT_PATH" -name ".bin" -type d -delete

echo "Native modules signing completed."
