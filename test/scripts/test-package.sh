#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root is two levels up from test/scripts/
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_PROJECT="$PROJECT_ROOT/test/test-project"

echo -e "${GREEN}=== Capacitor NodeJS Package Test Script ===${NC}\n"
echo -e "${YELLOW}Script directory: ${SCRIPT_DIR}${NC}"
echo -e "${YELLOW}Project root: ${PROJECT_ROOT}${NC}"
echo -e "${YELLOW}Test project: ${TEST_PROJECT}${NC}"
echo -e "${YELLOW}Current working directory: $(pwd)${NC}\n"

# Step 1: Build scripts
echo -e "${YELLOW}[1/5] Building scripts...${NC}"
cd "$PROJECT_ROOT"
npm run build-scripts
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Script build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Scripts built successfully${NC}\n"

# Step 2: Build bridge module
echo -e "${YELLOW}[2/5] Building bridge module...${NC}"
npm run build-bridge
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Bridge build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Bridge module built successfully${NC}\n"

# Step 3: Build full package
echo -e "${YELLOW}[3/5] Building full package...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Package build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Package built successfully${NC}\n"

# Step 4: Pack the package
echo -e "${YELLOW}[4/5] Packing package...${NC}"
npm pack > /dev/null 2>&1
# Find the most recently created .tgz file
PACKAGE_FILE=$(ls -1t "$PROJECT_ROOT"/capacitor-nodejs-*.tgz 2>/dev/null | head -1 | xargs basename)
if [ -z "$PACKAGE_FILE" ]; then
    echo -e "${RED}✗ Package file not found${NC}"
    echo -e "${YELLOW}Looking for capacitor-nodejs-*.tgz in: $PROJECT_ROOT${NC}"
    exit 1
fi
PACKAGE_PATH="$PROJECT_ROOT/$PACKAGE_FILE"
if [ ! -f "$PACKAGE_PATH" ]; then
    echo -e "${RED}✗ Package file does not exist: $PACKAGE_PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Package created: $PACKAGE_FILE${NC}\n"

# Step 5: Install in test project
echo -e "${YELLOW}[5/5] Installing package in test project...${NC}"
cd "$TEST_PROJECT"
npm install "$PACKAGE_PATH"
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Package installation failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Package installed in test project${NC}\n"

# Step 6: Sync Capacitor
echo -e "${YELLOW}[6/6] Syncing Capacitor...${NC}"
npx cap sync ios
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Capacitor sync failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Capacitor synced successfully${NC}\n"

# Summary
echo -e "${GREEN}=== Test Complete ===${NC}"
echo -e "Package: ${GREEN}$PACKAGE_FILE${NC}"
echo -e "Test project: ${GREEN}$TEST_PROJECT${NC}"
echo -e "\nTo test the build, run:"
echo -e "  ${YELLOW}cd $TEST_PROJECT/ios/App${NC}"
echo -e "  ${YELLOW}xcodebuild -project App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator build${NC}"

