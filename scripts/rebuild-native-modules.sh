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
  # If build native modules preference is not set, look for it in the project's
  # webDir/nodeDir/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt
  PREFERENCE_FILE_PATH="$NODEJS_DIR/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"
  fi
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  # If build native modules preference is not set, try to find .gyp files to turn it on.
  gypfiles=($(find "$NODEJS_DIR/" -type f -name "*.gyp" 2>/dev/null || true))
  gypfiles_count=${#gypfiles[@]}
  if [ "$gypfiles_count" -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi

# Delete object files that may already come from within the npm package.
find "$NODEJS_DIR/" -name "*.o" -type f -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.a" -type f -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.node" -type f -delete 2>/dev/null || true

# Delete bundle contents that may be there from previous builds.
find "$NODEJS_DIR/" -path "*/*.node/*" -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.node" -type d -delete 2>/dev/null || true
find "$NODEJS_DIR/" -path "*/*.framework/*" -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name "*.framework" -type d -delete 2>/dev/null || true

# Symlinks to binaries are resolved during the copy, causing build time errors.
# The original project's .bin folder will be added to the path before building the native modules.
find "$NODEJS_DIR/" -path "*/.bin/*" -delete 2>/dev/null || true
find "$NODEJS_DIR/" -name ".bin" -type d -delete 2>/dev/null || true

# Get the nodejs-mobile-gyp location
NODEJS_MOBILE_GYP_BIN_FILE="${NODEJS_MOBILE_GYP_BIN_FILE}"

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
if [ -d "$NODEJS_DIR/node_modules/.bin/" ]; then
  PATH="$NODEJS_DIR/node_modules/.bin/:$PATH"
fi

# Rebuild modules for each architecture
pushd "$NODEJS_DIR/" > /dev/null

if [ "$PLATFORM_NAME" == "iphoneos" ]; then
  # Device build - arm64
  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="arm64" node "${REBUILD_SCRIPT_PATH}" "$NODEJS_DIR/" "ios-arm64" || true
else
  # Simulator build - x64
  GYP_DEFINES="OS=ios" npm_config_nodedir="$NODEJS_HEADERS_DIR" npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" npm_config_platform="ios" npm_config_format="make-ios" npm_config_node_engine="chakracore" npm_config_arch="x64" node "${REBUILD_SCRIPT_PATH}" "$NODEJS_DIR/" "ios-x64" || true
fi

popd > /dev/null

