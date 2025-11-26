#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'fs';

function patchBindingGyp(bindingGypPath) {
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
    const newLines = [];

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

function patchPackageJSON_preNodeGyp_modulePath(filePath) {
    if (!existsSync(filePath)) return;

    let packageReadData = readFileSync(filePath);
    let packageJSON = JSON.parse(packageReadData);
    
    if (packageJSON && packageJSON.binary && packageJSON.binary.module_path) {
        let binaryPathConfiguration = packageJSON.binary.module_path;
        binaryPathConfiguration = binaryPathConfiguration.replace(/\{node_abi\}/g, "node_abi");
        binaryPathConfiguration = binaryPathConfiguration.replace(/\{platform\}/g, "platform");
        binaryPathConfiguration = binaryPathConfiguration.replace(/\{arch\}/g, "arch");
        binaryPathConfiguration = binaryPathConfiguration.replace(/\{target_arch\}/g, "target_arch");
        binaryPathConfiguration = binaryPathConfiguration.replace(/\{libc\}/g, "libc");
        packageJSON.binary.module_path = binaryPathConfiguration;
        
        let packageWriteData = JSON.stringify(packageJSON, null, 2);
        writeFileSync(filePath, packageWriteData);
    }
}

// Convert MH_BUNDLE to MH_DYLIB
function convertBundleToSharedLibrary(filePath) {
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
            console.log(`Converted bundle to shared library: ${filePath}`);
        }
    } catch (error) {
        // Silently fail
    }
}

// --- Main Execution Logic ---

const filePath = process.argv[2];
const operation = process.argv[3]; // Optional third argument for special operations

if (!filePath) {
    console.error('Error: Please provide a file path.');
    console.error('Usage: node patch-binding-gyp.js <file_path> [operation]');
    console.error('Supported file types: binding.gyp, package.json, .node');
    console.error('Operations: convert (for .node files)');
    process.exit(1);
}

if (filePath.endsWith('binding.gyp')) {
    patchBindingGyp(filePath);
} else if (filePath.endsWith('package.json')) {
    patchPackageJSON_preNodeGyp_modulePath(filePath);
} else if (filePath.endsWith('.node')) {
    if (operation === 'convert') {
        convertBundleToSharedLibrary(filePath);
    }
} else {
    console.error(`Error: Unsupported file type "${filePath}".`);
    console.error('Supported file types: binding.gyp, package.json, .node');
    process.exit(1);
}
