// Override process.dlopen to remap paths from expected locations to organized locations
// This follows the approach from nodejs-mobile-cordova's override-dlopen-paths-preload.js
// Reference: https://github.com/nodejs-mobile/nodejs-mobile-cordova/blob/69b0122c0910d308ecdd9b0b7771fcf195a5b44b/install/helper-scripts/override-dlopen-paths-preload.js

import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const substitutionDataFile = join(__dirname, 'override-dlopen-paths-data.json');

// If the json file exists, override dlopen to load the specified framework paths instead.
if (existsSync(substitutionDataFile)) {
  const pathSubstitutionData = JSON.parse(readFileSync(substitutionDataFile, 'utf8')) as Array<{
    originalpath: string[];
    newpath: string[];
  }>;

  // Build a dictionary to convert paths at runtime, taking current sandboxed paths into account.
  const pathSubstitutionDictionary = Object.fromEntries(
    pathSubstitutionData.map((item) => [
      normalize(join(__dirname, ...item.originalpath)),
      normalize(join(__dirname, ...item.newpath)),
    ])
  );

  const originalDlopen = process.dlopen;
  // Override process.dlopen
  process.dlopen = function (module: any, filename: string): void {
    const normalizedFilename = normalize(filename);
    const remappedPath = pathSubstitutionDictionary[normalizedFilename];
    if (remappedPath) {
      filename = remappedPath;
    }
    return originalDlopen.call(this, module, filename);
  };
} else {
  console.warn('[dlopen override] WARNING: override-dlopen-paths-data.json not found at', substitutionDataFile);
}
