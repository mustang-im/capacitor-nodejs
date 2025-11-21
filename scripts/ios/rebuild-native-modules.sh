#!/bin/bash
# rebuild-native-modules.sh
# Build phase script to rebuild Node.js native modules for iOS

set -e

PROJECT_ROOT="$PROJECT_DIR/../.."   # adjust if needed

CONFIG_JSON=$(node -e "$CONFIG_JS")
NODE_DIR=$(echo "$CONFIG_JSON" | jq -r '.nodeDir')

NODEJS_PATH="$CODESIGNING_FOLDER_PATH/public/$NODE_DIR"

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/public/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat "$PREFERENCE_FILE_PATH" | xargs)"
  fi
fi

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  gypfiles=($(find "$NODEJS_PATH" -type f -name "*.gyp"))
  if [ ${#gypfiles[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
  exit 0
fi

# Delete object files that may already come from within the npm package
find "$NODEJS_PATH" -name "*.o" -type f -delete
find "$NODEJS_PATH" -name "*.a" -type f -delete
find "$NODEJS_PATH" -name "*.node" -type f -delete

# Delete bundle contents that may be there from previous builds
find "$NODEJS_PATH" -path "*/*.node/*" -delete
find "$NODEJS_PATH" -name "*.node" -type d -delete
find "$NODEJS_PATH" -path "*/*.framework/*" -delete
find "$NODEJS_PATH" -name "*.framework" -type d -delete

# Symlinks to binaries are resolved by cordova prepare during the copy
find "$NODEJS_PATH" -path "*/.bin/*" -delete
find "$NODEJS_PATH" -name ".bin" -type d -delete

# Get the nodejs-mobile-gyp location
if [ -d "$PROJECT_DIR/../../node_modules/capacitor-nodejs/node_modules/nodejs-mobile-gyp/" ]; then
  NODEJS_MOBILE_GYP_DIR="$(cd "$PROJECT_DIR" && cd ../../node_modules/capacitor-nodejs/node_modules/nodejs-mobile-gyp/ && pwd)"
elseif [ -d "$PROJECT_DIR/../../node_modules/nodejs-mobile-gyp/" ]; then
  NODEJS_MOBILE_GYP_DIR="$(cd "$PROJECT_DIR" && cd ../../node_modules/nodejs-mobile-gyp/ && pwd)"
else
  echo "nodejs-mobile-gyp not found"
  exit 1
fi
NODEJS_MOBILE_GYP_BIN_FILE="$NODEJS_MOBILE_GYP_DIR/bin/node-gyp.js"

# Rebuild modules with right environment
NODEJS_HEADERS_DIR="$(cd "$(dirname "$PRODUCT_SETTINGS_PATH")" && cd ../../node_modules/capacitor-nodejs/ios/libnode/ && pwd)"

# Add original project .bin to PATH for modules that depend on symlinked modules
if [ -d "$PROJECT_DIR/../../dist/nodejs/node_modules/.bin/" ]; then
  PATH="$PROJECT_DIR/../../dist/nodejs/node_modules/.bin/:$PATH"
fi

pushd "$NODEJS_PATH"

if [ "$PLATFORM_NAME" == "iphoneos" ]; then
  GYP_DEFINES="OS=ios" \
  npm_config_nodedir="$NODEJS_HEADERS_DIR" \
  npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_platform="ios" \
  npm_config_format="make-ios" \
  npm_config_arch="arm64" \
  npm --verbose rebuild --build-from-source
else
  GYP_DEFINES="OS=ios" \
  npm_config_nodedir="$NODEJS_HEADERS_DIR" \
  npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_platform="ios" \
  npm_config_format="make-ios" \
  npm_config_arch="x64" \
  npm --verbose rebuild --build-from-source
fi

popd
