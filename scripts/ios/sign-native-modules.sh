#!/bin/bash
# sign-native-modules.sh
# Sign phase script to sign Node.js native modules for iOS

set -e

PROJECT_ROOT="$PROJECT_DIR/../.."   # adjust if needed

CONFIG_JSON=$(node -e "$CONFIG_JS")
NODE_DIR=$(echo "$CONFIG_JSON" | jq -r '.nodeDir')

NODEJS_PATH="$CODESIGNING_FOLDER_PATH/public/$NODE_DIR"

if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
# If build native modules preference is not set, look for it in the project's
# public/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt
  PREFERENCE_FILE_PATH="$CODESIGNING_FOLDER_PATH/public/NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"
  if [ -f "$PREFERENCE_FILE_PATH" ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES="$(cat $PREFERENCE_FILE_PATH | xargs)"
    # Remove the preference file so it doesn't get in the application package.
    rm "$PREFERENCE_FILE_PATH"
  fi
fi
if [ -z "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then
# If build native modules preference is not set, try to find .gyp files
#to turn it on.
  gypfiles=($(find "$NODEJS_PATH" -type f -name "*.gyp"))
  if [ ${#gypfiles[@]} -gt 0 ]; then
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=1
  else
    NODEJS_MOBILE_BUILD_NATIVE_MODULES=0
  fi
fi

if [ "1" != "$NODEJS_MOBILE_BUILD_NATIVE_MODULES" ]; then exit 0; fi
# Delete object files
find "$NODEJS_PATH" -name "*.o" -type f -delete
find "$NODEJS_PATH" -name "*.a" -type f -delete
# Create Info.plist for each framework built and loader override.
PATCH_SCRIPT_DIR="$( cd "$PROJECT_DIR" && cd ../../node_modules/capacitor-nodejs/scripts/ios/ && pwd )"
NODEJS_PROJECT_DIR="$( cd "$NODEJS_PATH" && pwd )"
python "$PATCH_SCRIPT_DIR/process_frameworks.py" $NODEJS_PROJECT_DIR
# Embed every resulting .framework in the application and delete them afterwards.
embed_framework()
{
    FRAMEWORK_NAME="$(basename "$1")"
    mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    cp -r "$1" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
    /usr/bin/codesign --force --sign $EXPANDED_CODE_SIGN_IDENTITY --preserve-metadata=identifier,entitlements,flags --timestamp=none "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/$FRAMEWORK_NAME"
}
find "$NODEJS_PATH" -name "*.framework" -type d | while read frmwrk_path; do embed_framework "$frmwrk_path"; done

#Delete gyp temporary .deps dependency folders from the project structure.
find "$NODEJS_PATH" -path "*/.deps/*" -delete
find "$NODEJS_PATH" -name ".deps" -type d -delete

#Delete frameworks from their build paths
find "$NODEJS_PATH" -path "*/*.framework/*" -delete
find "$NODEJS_PATH" -name "*.framework" -type d -delete
