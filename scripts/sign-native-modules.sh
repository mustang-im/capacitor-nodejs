#!/bin/sh
set -e
# Get nodeDir from config (defaults to "nodejs" if not set)
NODE_DIR="${NODE_DIR:-nodejs}"

# Use public/$NODE_DIR if it exists, otherwise $NODE_DIR
# Files are typically copied to public/nodejs/ in Capacitor apps
NODEJS_DIR="$CODESIGNING_FOLDER_PATH/public/$NODE_DIR"
if [ ! -d "$NODEJS_DIR" ]; then
  NODEJS_DIR="$CODESIGNING_FOLDER_PATH/$NODE_DIR"
fi

# Check if build native modules preference is set
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  PREFERENCE_FILE_PATH="$NODEJS_DIR/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"
    rm "$PREFERENCE_FILE_PATH"
  fi
fi

# Check if node directory exists
if [ ! -d "$NODEJS_DIR" ]; then
  echo "Warning: node directory not found at $NODEJS_DIR, skipping code signing"
  exit 0
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  organized_dirs=($(find "$NODEJS_DIR/build/Release" -name "*.node" -type d 2>/dev/null || find "$NODEJS_DIR/prebuilds" -name "*.node" -type d 2>/dev/null || find "$NODEJS_DIR/node_modules" -path "*/prebuilds/*/*.node" -type d 2>/dev/null || true))
  if [ ${#organized_dirs[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    gypfiles=($(find "$NODEJS_DIR/" -type f -name "*.gyp" 2>/dev/null || true))
    if [ ${#gypfiles[@]} -gt 0 ]; then
      NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
    else
      NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
    fi
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi

# Delete object files
find "$NODEJS_DIR/" -name "*.o" -type f -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.a" -type f -delete 2>/dev/null || true

# Create frameworks and override-dlopen-paths-data.json using TypeScript helper from plugin
# Find the script path in the plugin
SCRIPT_PATH="${PLUGIN_SCRIPTS_PATH}/create-frameworks-and-override.js"
if [ ! -f "${SCRIPT_PATH}" ]; then
  # Try source TypeScript file if dist doesn't exist
  SCRIPT_PATH="${PROJECT_DIR}/../../node_modules/capacitor-nodejs/scripts/create-frameworks-and-override.ts"
fi
if [ ! -f "${SCRIPT_PATH}" ]; then
  echo "Warning: create-frameworks-and-override script not found, skipping framework creation"
  exit 0
fi

# Run the TypeScript script to create frameworks and JSON override file
FRAMEWORK_OUTPUT=$(node "${SCRIPT_PATH}" "$NODEJS_DIR" 2>&1)
FRAMEWORK_EXIT_CODE=$?

echo "$FRAMEWORK_OUTPUT"

if [ $FRAMEWORK_EXIT_CODE -ne 0 ]; then
  echo "Warning: Framework creation script failed, continuing anyway"
fi

# Extract framework paths from output (lines starting with FRAMEWORK:)
FRAMEWORK_PATHS=$(echo "$FRAMEWORK_OUTPUT" | grep "^FRAMEWORK:" | sed 's/^FRAMEWORK://')

# Embed frameworks
embed_framework()
{
    FRAMEWORK_NAME="$(basename "$1")"
    mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    cp -r "$1" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    /usr/bin/codesign --force --sign $EXPANDED_CODE_SIGN_IDENTITY --preserve-metadata=identifier,entitlements,flags --timestamp=none "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME"
}

# Embed frameworks found by the script
if [ -n "$FRAMEWORK_PATHS" ]; then
  echo "$FRAMEWORK_PATHS" | while read frmwrk_path; do
    if [ -n "$frmwrk_path" ] && [ -d "$frmwrk_path" ]; then
      embed_framework "$frmwrk_path"
    fi
  done
fi

# Also embed any frameworks found via find (fallback)
find "$NODEJS_DIR/" -name "*.framework" -type d 2>/dev/null | while read frmwrk_path; do
  # Skip if already embedded
  FRAMEWORK_NAME="$(basename "$frmwrk_path")"
  if [ ! -d "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME" ]; then
    embed_framework "$frmwrk_path"
  fi
done

# Cleanup
find "$NODEJS_DIR/" -path "*/.deps/*" -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name ".deps" -type d -delete 2>/dev/null || true
find "$NODEJS_DIR/" -path "*/*.framework/*" -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.framework" -type d -delete 2>/dev/null || true

