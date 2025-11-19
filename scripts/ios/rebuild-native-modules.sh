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
  if [ ${#gypfiles[@]} -gt 0 ]; then
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

# Get the nodejs-mobile-gyp location and headers directory (set by build phase)
NODEJS_MOBILE_GYP_BIN_FILE="${NODEJS_MOBILE_GYP_BIN_FILE}"
# nodejs-mobile-gyp expects npm_config_nodedir to point to libnode directory (without include/node)
NODEJS_HEADERS_DIR="${NODEJS_HEADERS_DIR:-}"
if [ -z "$NODEJS_HEADERS_DIR" ]; then
  NODEJS_HEADERS_DIR="$( cd "$PROJECT_DIR" && cd ../../node_modules/capacitor-nodejs/ios/libnode && pwd )"
fi

# Adds the original project .bin to the path. It's a workaround
# to correctly build some modules that depend on symlinked modules,
# like node-pre-gyp.
if [ -d "$NODEJS_DIR/node_modules/.bin/" ]; then
  PATH="$NODEJS_DIR/node_modules/.bin/:$PATH"
fi

# Add node-gyp-build-mobile to PATH if available
# node-gyp-build-mobile is a dependency of the plugin, so it should be in the plugin's node_modules
if [ -n "$PROJECT_DIR" ]; then
  # Try plugin's node_modules first (where it's installed as a dependency)
  PLUGIN_NODE_GYP_BUILD_MOBILE="$PROJECT_DIR/../../node_modules/capacitor-nodejs/node_modules/.bin/node-gyp-build-mobile"
  if [ -f "$PLUGIN_NODE_GYP_BUILD_MOBILE" ]; then
    PATH="$(dirname "$PLUGIN_NODE_GYP_BUILD_MOBILE"):$PATH"
    export PATH
  else
    # Try project's node_modules (fallback)
    PROJECT_NODE_GYP_BUILD_MOBILE="$PROJECT_DIR/../../node_modules/.bin/node-gyp-build-mobile"
    if [ -f "$PROJECT_NODE_GYP_BUILD_MOBILE" ]; then
      PATH="$(dirname "$PROJECT_NODE_GYP_BUILD_MOBILE"):$PATH"
      export PATH
    else
      # Try using npx to find it (will look in plugin's node_modules via dependency tree)
      if command -v npx >/dev/null 2>&1; then
        # npx will find it in the plugin's node_modules
        export PATH="$PROJECT_DIR/../../node_modules/capacitor-nodejs/node_modules/.bin:$PATH"
      fi
    fi
  fi
fi

# Patch package.json files to use nodejs-mobile-gyp instead of node-gyp
# Also replace node-gyp-build with node-gyp-build-mobile for mobile compatibility
# This ensures that when npm rebuild runs install scripts, they use the mobile-compatible tools
find "$NODEJS_DIR/node_modules" -name "package.json" -type f | while read -r pkgjson; do
  # Check if this package has a binding.gyp (it's a native module)
  pkgdir=$(dirname "$pkgjson")
  if [ -f "$pkgdir/binding.gyp" ] || find "$pkgdir" -maxdepth 1 -name "*.gyp" -type f | grep -q .; then
    # Backup original if not already backed up
    if [ ! -f "$pkgjson.bak" ]; then
      cp "$pkgjson" "$pkgjson.bak" 2>/dev/null || true
    fi
    # Replace node-gyp references with nodejs-mobile-gyp
    sed -i.tmp "s|\"node-gyp\"|\"node $NODEJS_MOBILE_GYP_BIN_FILE\"|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp |node $NODEJS_MOBILE_GYP_BIN_FILE |g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp\"|node $NODEJS_MOBILE_GYP_BIN_FILE\"|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp'|node $NODEJS_MOBILE_GYP_BIN_FILE'|g" "$pkgjson" 2>/dev/null || true
    # Replace node-gyp-build with node-gyp-build-mobile
    sed -i.tmp "s|\"node-gyp-build\"|\"node-gyp-build-mobile\"|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp-build |node-gyp-build-mobile |g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp-build\"|node-gyp-build-mobile\"|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|node-gyp-build'|node-gyp-build-mobile'|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|require('node-gyp-build')|require('node-gyp-build-mobile')|g" "$pkgjson" 2>/dev/null || true
    sed -i.tmp "s|require(\"node-gyp-build\")|require(\"node-gyp-build-mobile\")|g" "$pkgjson" 2>/dev/null || true
    rm -f "$pkgjson.tmp" 2>/dev/null || true
  fi
done

# Also patch JavaScript files that require node-gyp-build to use node-gyp-build-mobile
# This handles cases where packages load bindings at runtime
find "$NODEJS_DIR/node_modules" -name "*.js" -type f | while read -r jsfile; do
  # Skip if already backed up or in node_modules/.bin
  if [[ "$jsfile" == *"/.bin/"* ]] || [[ "$jsfile" == *".bak" ]]; then
    continue
  fi
  # Check if file uses node-gyp-build
  if grep -q "node-gyp-build" "$jsfile" 2>/dev/null; then
    # Backup original if not already backed up
    if [ ! -f "$jsfile.bak" ]; then
      cp "$jsfile" "$jsfile.bak" 2>/dev/null || true
    fi
    # Replace node-gyp-build with node-gyp-build-mobile
    sed -i.tmp "s|require('node-gyp-build')|require('node-gyp-build-mobile')|g" "$jsfile" 2>/dev/null || true
    sed -i.tmp "s|require(\"node-gyp-build\")|require(\"node-gyp-build-mobile\")|g" "$jsfile" 2>/dev/null || true
    sed -i.tmp "s|from 'node-gyp-build'|from 'node-gyp-build-mobile'|g" "$jsfile" 2>/dev/null || true
    sed -i.tmp "s|from \"node-gyp-build\"|from \"node-gyp-build-mobile\"|g" "$jsfile" 2>/dev/null || true
    rm -f "$jsfile.tmp" 2>/dev/null || true
  fi
done

# Convert bundles (MH_BUNDLE) to shared libraries (MH_DYLIB) after building
# iOS frameworks require shared libraries, not bundles
# This is done post-build by modifying the Mach-O header filetype
find "$NODEJS_DIR/node_modules" -path "*/build/Release/*.node" -type f | while read -r nodefile; do
  # Check if it's a bundle (filetype 8) and convert to shared library (filetype 6)
  filetype=$(otool -h "$nodefile" 2>/dev/null | awk '/filetype/ {print $2}')
  if [ "$filetype" = "8" ]; then
    # Use a Python script to modify the Mach-O header
    python3 << 'PYTHON_CONVERT'
import struct
import sys

filepath = sys.argv[1]

try:
    with open(filepath, 'r+b') as f:
        # Read the first 32 bytes (Mach-O header)
        header = f.read(32)
        if len(header) < 32:
            sys.exit(0)

        # Check magic number (0xfeedfacf for 64-bit)
        magic = struct.unpack('<I', header[0:4])[0]
        if magic != 0xfeedfacf:  # MH_MAGIC_64
            sys.exit(0)

        # Get filetype (offset 12 for 64-bit)
        filetype = struct.unpack('<I', header[12:16])[0]

        # If it's a bundle (8), change to shared library (6)
        if filetype == 8:  # MH_BUNDLE
            # Modify the filetype in the header
            new_header = header[:12] + struct.pack('<I', 6) + header[16:]
            f.seek(0)
            f.write(new_header)
except Exception:
    # Silently fail
    pass
PYTHON_CONVERT
    "$nodefile" 2>/dev/null || true
  fi
done

# Also check .node directories
find "$NODEJS_DIR/node_modules" -path "*/build/Release/*.node" -type d | while read -r nodedir; do
  find "$nodedir" -type f ! -name "*.plist" | while read -r nodefile; do
    filetype=$(otool -h "$nodefile" 2>/dev/null | awk '/filetype/ {print $2}')
    if [ "$filetype" = "8" ]; then
      python3 << 'PYTHON_CONVERT'
import struct
import sys

filepath = sys.argv[1]

try:
    with open(filepath, 'r+b') as f:
        header = f.read(32)
        if len(header) < 32:
            sys.exit(0)
        magic = struct.unpack('<I', header[0:4])[0]
        if magic != 0xfeedfacf:
            sys.exit(0)
        filetype = struct.unpack('<I', header[12:16])[0]
        if filetype == 8:
            new_header = header[:12] + struct.pack('<I', 6) + header[16:]
            f.seek(0)
            f.write(new_header)
except Exception:
    pass
PYTHON_CONVERT
      "$nodefile" 2>/dev/null || true
    fi
  done
done

# Rebuild modules with right environment
pushd "$NODEJS_DIR/" > /dev/null

if [ "$PLATFORM_NAME" == "iphoneos" ]; then
  GYP_DEFINES="OS=ios iossim=0" \
  NODE_GYP="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_nodedir="$NODEJS_HEADERS_DIR" \
  npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_platform="ios" \
  npm_config_format="make-ios" \
  npm_config_node_engine="chakracore" \
  npm_config_arch="arm64" \
  npm --verbose rebuild --build-from-source
else
  GYP_DEFINES="OS=ios iossim=1" \
  NODE_GYP="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_nodedir="$NODEJS_HEADERS_DIR" \
  npm_config_node_gyp="$NODEJS_MOBILE_GYP_BIN_FILE" \
  npm_config_platform="ios" \
  npm_config_format="make-ios" \
  npm_config_node_engine="chakracore" \
  npm_config_arch="x64" \
  npm --verbose rebuild --build-from-source
fi

popd > /dev/null

# Restore original package.json files
find "$NODEJS_DIR/node_modules" -name "package.json.bak" -type f | while read -r bakfile; do
  pkgjson="${bakfile%.bak}"
  mv "$bakfile" "$pkgjson" 2>/dev/null || true
done

# Restore original JavaScript files
find "$NODEJS_DIR/node_modules" -name "*.js.bak" -type f | while read -r bakfile; do
  jsfile="${bakfile%.bak}"
  mv "$bakfile" "$jsfile" 2>/dev/null || true
done
