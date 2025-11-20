/**
 * Rebuild native Node.js modules for iOS
 * This script patches package.json, binding.gyp, and JavaScript files to use mobile-compatible tools,
 * rebuilds the modules, and converts bundles to shared libraries.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, statSync, readdirSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// Get environment variables from Xcode
const NODE_DIR = process.env.NODE_DIR || 'nodejs';
const CODESIGNING_FOLDER_PATH = process.env.CODESIGNING_FOLDER_PATH || '';
const PROJECT_DIR = process.env.PROJECT_DIR || '';
const PLATFORM_NAME = process.env.PLATFORM_NAME || 'iphoneos';
const NODEJS_MOBILE_GYP_BIN_FILE = process.env.NODEJS_MOBILE_GYP_BIN_FILE || '';
const NODEJS_HEADERS_DIR = process.env.NODEJS_HEADERS_DIR || '';

// Determine nodejs directory
let NODEJS_DIR = join(CODESIGNING_FOLDER_PATH, 'public', NODE_DIR);
if (!existsSync(NODEJS_DIR)) {
  NODEJS_DIR = join(CODESIGNING_FOLDER_PATH, NODE_DIR);
}

// Check if build native modules preference is set
let NODEJS_MOBILE_BUILD_NATIVE_MODULES = process.env.NODEJS_MOBILE_BUILD_NATIVE_MODULES;

if (!NODEJS_MOBILE_BUILD_NATIVE_MODULES) {
  const preferenceFile = join(NODEJS_DIR, 'NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt');
  if (existsSync(preferenceFile)) {
    NODEJS_MOBILE_BUILD_NATIVE_MODULES = readFileSync(preferenceFile, 'utf8').trim();
  }
}

if (!NODEJS_MOBILE_BUILD_NATIVE_MODULES) {
  // Check for .gyp files
  try {
    const result = execSync(`find "${NODEJS_DIR}/" -type f -name "*.gyp" 2>/dev/null | head -1`, { encoding: 'utf8' });
    NODEJS_MOBILE_BUILD_NATIVE_MODULES = result.trim() ? '1' : '0';
  } catch {
    NODEJS_MOBILE_BUILD_NATIVE_MODULES = '0';
  }
}

if (NODEJS_MOBILE_BUILD_NATIVE_MODULES !== '1') {
  process.exit(0);
}

// Clean up old build artifacts
function cleanup() {
  const patterns = [
    { pattern: '*.o', type: 'file' },
    { pattern: '*.a', type: 'file' },
    { pattern: '*.node', type: 'file' },
    { pattern: '*.node', type: 'dir' },
    { pattern: '*.framework', type: 'dir' },
    { pattern: '.bin', type: 'dir' },
  ];

  for (const { pattern, type } of patterns) {
    try {
      if (type === 'file') {
        execSync(`find "${NODEJS_DIR}/" -name "${pattern}" -type f -delete 2>/dev/null || true`, { stdio: 'ignore' });
      } else {
        execSync(`find "${NODEJS_DIR}/" -name "${pattern}" -type d -delete 2>/dev/null || true`, { stdio: 'ignore' });
      }
    } catch {
      // Ignore errors
    }
  }

  // Delete bundle contents
  try {
    execSync(`find "${NODEJS_DIR}/" -path "*/*.node/*" -delete 2>/dev/null || true`, { stdio: 'ignore' });
    execSync(`find "${NODEJS_DIR}/" -path "*/*.framework/*" -delete 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore errors
  }
}

// Patch package.json files
function patchPackageJson(pkgjsonPath: string, nodejsMobileGypBinFile: string): void {
  if (!existsSync(pkgjsonPath)) return;

  const pkgdir = dirname(pkgjsonPath);
  const bindingGyp = join(pkgdir, 'binding.gyp');
  const hasGyp = existsSync(bindingGyp) ||
    execSync(`find "${pkgdir}" -maxdepth 1 -name "*.gyp" -type f 2>/dev/null | head -1`, { encoding: 'utf8' }).trim() !== '';

  if (!hasGyp) return;

  const bakPath = `${pkgjsonPath}.bak`;
  if (!existsSync(bakPath)) {
    copyFileSync(pkgjsonPath, bakPath);
  }

  let content = readFileSync(pkgjsonPath, 'utf8');
  const originalContent = content;

  // Replace node-gyp references
  content = content.replace(/"node-gyp"/g, `"node ${nodejsMobileGypBinFile}"`);
  content = content.replace(/node-gyp /g, `node ${nodejsMobileGypBinFile} `);
  content = content.replace(/node-gyp"/g, `node ${nodejsMobileGypBinFile}"`);
  content = content.replace(/node-gyp'/g, `node ${nodejsMobileGypBinFile}'`);

  // Replace node-gyp-build with node-gyp-build-mobile
  content = content.replace(/"node-gyp-build"/g, '"node-gyp-build-mobile"');
  content = content.replace(/node-gyp-build /g, 'node-gyp-build-mobile ');
  content = content.replace(/node-gyp-build"/g, 'node-gyp-build-mobile"');
  content = content.replace(/node-gyp-build'/g, "node-gyp-build-mobile'");
  content = content.replace(/require\('node-gyp-build'\)/g, "require('node-gyp-build-mobile')");
  content = content.replace(/require\("node-gyp-build"\)/g, 'require("node-gyp-build-mobile")');

  if (content !== originalContent) {
    writeFileSync(pkgjsonPath, content, 'utf8');
  }
}

// Patch binding.gyp files to add product_type: 'dynamic_library'
function patchBindingGyp(bindingGypPath: string): void {
  if (!existsSync(bindingGypPath)) return;

  const bakPath = `${bindingGypPath}.bak`;
  if (!existsSync(bakPath)) {
    copyFileSync(bindingGypPath, bakPath);
  }

  let content = readFileSync(bindingGypPath, 'utf8');

  // Check if product_type is already set to dynamic_library
  if (/'product_type'\s*:\s*'dynamic_library'/.test(content)) {
    return;
  }

  const lines = content.split('\n');
  const newLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    newLines.push(line);

    // Check if this line has target_name
    if (/'target_name'/.test(line)) {
      // Check if next few lines already have product_type
      let hasProductType = false;
      const indentMatch = line.match(/^(\s*)/);
      const baseIndent = indentMatch ? indentMatch[1] : '';

      // Look ahead to see if product_type already exists
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const nextLine = lines[j];
        if (/'product_type'/.test(nextLine)) {
          hasProductType = true;
          break;
        }
        // Stop if we hit a line that's not indented more (end of this target's properties)
        const nextIndentMatch = nextLine.match(/^(\s*)/);
        if (nextIndentMatch) {
          const nextIndent = nextIndentMatch[1];
          if (nextLine.trim() && nextIndent.length <= baseIndent.length && !nextLine.trim().match(/^[#\/]/)) {
            break;
          }
        }
      }

      if (!hasProductType) {
        // Add product_type after target_name line with same indentation
        const indent = baseIndent + '  ';
        newLines.push(`${indent}'product_type': 'dynamic_library',`);
      }
    }
  }

  const newContent = newLines.join('\n');
  if (newContent !== content) {
    writeFileSync(bindingGypPath, newContent, 'utf8');
  }
}

// Patch JavaScript files
function patchJavaScript(jsPath: string): void {
  if (!existsSync(jsPath)) return;
  if (jsPath.includes('/.bin/') || jsPath.endsWith('.bak')) return;

  let content = readFileSync(jsPath, 'utf8');
  if (!content.includes('node-gyp-build')) return;

  const bakPath = `${jsPath}.bak`;
  if (!existsSync(bakPath)) {
    copyFileSync(jsPath, bakPath);
  }

  const originalContent = content;
  content = content.replace(/require\('node-gyp-build'\)/g, "require('node-gyp-build-mobile')");
  content = content.replace(/require\("node-gyp-build"\)/g, 'require("node-gyp-build-mobile")');
  content = content.replace(/from 'node-gyp-build'/g, "from 'node-gyp-build-mobile'");
  content = content.replace(/from "node-gyp-build"/g, 'from "node-gyp-build-mobile"');

  if (content !== originalContent) {
    writeFileSync(jsPath, content, 'utf8');
  }
}

// Convert MH_BUNDLE to MH_DYLIB
function convertBundleToSharedLibrary(filePath: string): void {
  if (!existsSync(filePath)) return;

  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size < 32) return;

    const buffer = Buffer.from(readFileSync(filePath));

    // Check magic number (0xfeedfacf for 64-bit)
    if (buffer.length < 32 || buffer.readUInt32LE(0) !== 0xfeedfacf) {
      return;
    }

    // Get filetype (offset 12 for 64-bit)
    const filetype = buffer.readUInt32LE(12);

    // If it's a bundle (8), change to shared library (6)
    if (filetype === 8) {
      buffer.writeUInt32LE(6, 12); // MH_DYLIB
      writeFileSync(filePath, buffer);
    }
  } catch {
    // Silently fail
  }
}

// Restore original files
function restoreFiles(pattern: string): void {
  try {
    const result = execSync(`find "${NODEJS_DIR}/node_modules" -name "${pattern}" -type f 2>/dev/null`, { encoding: 'utf8' });
    const files = result.trim().split('\n').filter(f => f);

    for (const bakFile of files) {
      const originalFile = bakFile.replace(/\.bak$/, '');
      try {
        if (existsSync(bakFile) && existsSync(originalFile)) {
          copyFileSync(bakFile, originalFile);
          unlinkSync(bakFile);
        }
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // Ignore errors
  }
}

// Main function
async function main() {
  console.log('Rebuilding native Node.js modules for iOS...');

  // Cleanup
  cleanup();

  // Determine headers directory
  let headersDir = NODEJS_HEADERS_DIR;
  if (!headersDir && PROJECT_DIR) {
    headersDir = join(PROJECT_DIR, '../../node_modules/capacitor-nodejs/ios/libnode');
  }

  // Build in a temporary directory to avoid permission errors in read-only app bundle
  const tempBuildDir = join(tmpdir(), `nodejs-rebuild-${Date.now()}`);
  const tempNodeModules = join(tempBuildDir, 'node_modules');

  // Copy node_modules to temp directory first
  console.log(`Copying node_modules to temporary build directory: ${tempBuildDir}`);
  if (!existsSync(join(NODEJS_DIR, 'node_modules'))) {
    console.warn('No node_modules found in NODEJS_DIR, skipping rebuild');
    return;
  }
  mkdirSync(tempBuildDir, { recursive: true });
  cpSync(join(NODEJS_DIR, 'node_modules'), tempNodeModules, { recursive: true });

  // Find and patch package.json files in temp directory
  console.log('Patching package.json files...');
  try {
    const pkgJsonFiles = execSync(`find "${tempNodeModules}" -name "package.json" -type f 2>/dev/null`, { encoding: 'utf8' });
    for (const pkgJson of pkgJsonFiles.trim().split('\n').filter(f => f)) {
      patchPackageJson(pkgJson, NODEJS_MOBILE_GYP_BIN_FILE);
    }
  } catch {
    // Ignore errors
  }

  // Find and patch binding.gyp files in temp directory
  console.log('Patching binding.gyp files...');
  try {
    const bindingGypFiles = execSync(`find "${tempNodeModules}" -name "binding.gyp" -type f 2>/dev/null`, { encoding: 'utf8' });
    for (const bindingGyp of bindingGypFiles.trim().split('\n').filter(f => f)) {
      patchBindingGyp(bindingGyp);
    }
  } catch {
    // Ignore errors
  }

  // Find and patch JavaScript files in temp directory
  console.log('Patching JavaScript files...');
  try {
    const jsFiles = execSync(`find "${tempNodeModules}" -name "*.js" -type f 2>/dev/null`, { encoding: 'utf8' });
    for (const jsFile of jsFiles.trim().split('\n').filter(f => f && !f.includes('/.bin/') && !f.endsWith('.bak'))) {
      patchJavaScript(jsFile);
    }
  } catch {
    // Ignore errors
  }

  // Rebuild modules
  console.log('Rebuilding native modules in temporary directory...');
  const env: Record<string, string> = {
    ...process.env,
    GYP_DEFINES: PLATFORM_NAME === 'iphoneos' ? 'OS=ios iossim=0' : 'OS=ios iossim=1',
    // Don't set NODEJS_MOBILE_GYP - let node-gyp-build-mobile use regular node-gyp
    npm_config_nodedir: headersDir,
    npm_config_platform: 'ios',
    npm_config_format: 'make-ios',
    npm_config_node_engine: 'chakracore',
    npm_config_arch: PLATFORM_NAME === 'iphoneos' ? 'arm64' : 'x64',
  };

  // Add node-gyp-build-mobile to PATH
  if (PROJECT_DIR) {
    const projectBin = join(PROJECT_DIR, '../../node_modules/.bin');
    const pluginBin = join(PROJECT_DIR, '../../node_modules/capacitor-nodejs/node_modules/.bin');
    const pathParts: string[] = [];
    if (existsSync(projectBin)) {
      pathParts.push(projectBin);
    }
    if (existsSync(pluginBin)) {
      pathParts.push(pluginBin);
    }
    if (pathParts.length > 0) {
      env.PATH = `${pathParts.join(':')}:${env.PATH || ''}`;
    }
  }

  try {
    // Build in temp directory
    // Source nvm to ensure npm is available
    const npmCommand = process.env.HOME
      ? `source "${process.env.HOME}/.nvm/nvm.sh" 2>/dev/null || true; npm --verbose rebuild --build-from-source`
      : 'npm --verbose rebuild --build-from-source';

    execSync(npmCommand, {
      cwd: tempBuildDir,
      env,
      stdio: 'inherit',
      shell: '/bin/bash', // Use bash to support source command
    });

    // Copy built .node files back to app bundle
    console.log('Copying built .node files back to app bundle...');
    try {
      const builtFiles = execSync(`find "${tempNodeModules}" -path "*/build/Release/*.node" -type f 2>/dev/null`, { encoding: 'utf8' });
      for (const builtFile of builtFiles.trim().split('\n').filter(f => f)) {
        // Get relative path from tempNodeModules
        const relativePath = builtFile.replace(tempNodeModules + '/', '');
        const targetPath = join(NODEJS_DIR, 'node_modules', relativePath);
        const targetDir = dirname(targetPath);

        // Create target directory if needed (should already exist, but be safe)
        try {
          mkdirSync(targetDir, { recursive: true });
          copyFileSync(builtFile, targetPath);
        } catch (copyError) {
          console.warn(`Failed to copy ${builtFile} to ${targetPath}:`, copyError);
        }
      }

      // Also handle .node directories
      const builtDirs = execSync(`find "${tempNodeModules}" -path "*/build/Release/*.node" -type d 2>/dev/null`, { encoding: 'utf8' });
      for (const builtDir of builtDirs.trim().split('\n').filter(f => f)) {
        const relativePath = builtDir.replace(tempNodeModules + '/', '');
        const targetPath = join(NODEJS_DIR, 'node_modules', relativePath);

        try {
          mkdirSync(dirname(targetPath), { recursive: true });
          cpSync(builtDir, targetPath, { recursive: true });
        } catch (copyError) {
          console.warn(`Failed to copy directory ${builtDir} to ${targetPath}:`, copyError);
        }
      }
    } catch (copyError) {
      console.warn('Failed to copy built files:', copyError);
    }

    // Clean up temp directory
    try {
      execSync(`rm -rf "${tempBuildDir}"`, { stdio: 'ignore' });
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    console.error('Failed to rebuild native modules:', error);
    // Clean up temp directory on error
    try {
      execSync(`rm -rf "${tempBuildDir}"`, { stdio: 'ignore' });
    } catch {
      // Ignore cleanup errors
    }
    // Continue anyway
  }

  // Convert bundles to shared libraries
  console.log('Converting bundles to shared libraries...');
  try {
    const nodeFiles = execSync(`find "${NODEJS_DIR}/node_modules" -path "*/build/Release/*.node" -type f 2>/dev/null`, { encoding: 'utf8' });
    for (const nodeFile of nodeFiles.trim().split('\n').filter(f => f)) {
      convertBundleToSharedLibrary(nodeFile);
    }

    // Also check .node directories
    const nodeDirs = execSync(`find "${NODEJS_DIR}/node_modules" -path "*/build/Release/*.node" -type d 2>/dev/null`, { encoding: 'utf8' });
    for (const nodeDir of nodeDirs.trim().split('\n').filter(f => f)) {
      try {
        const entries = readdirSync(nodeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && !entry.name.endsWith('.plist')) {
            convertBundleToSharedLibrary(join(nodeDir, entry.name));
          }
        }
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // Ignore errors
  }

  // Restore original files
  console.log('Restoring original files...');
  restoreFiles('package.json.bak');
  restoreFiles('binding.gyp.bak');
  restoreFiles('*.js.bak');

  console.log('Done rebuilding native modules.');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

