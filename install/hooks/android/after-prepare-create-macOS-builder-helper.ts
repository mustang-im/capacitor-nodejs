import fs from 'node:fs/promises';
import path from 'node:path';
// @ts-ignore - loadConfig is not exported in types but exists in the package
import { loadConfig } from '@capacitor/cli/dist/config.js';

// Gets the Android www path using Capacitor config.
async function getAndroidWWWPath(config: any): Promise<string> {
  const androidConfig = config.android;
  if (androidConfig?.webDirAbs) {
    return androidConfig.webDirAbs;
  }
  // Fallback to standard Capacitor Android structure
  return path.join(config.app.rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');
}

// Adds a helper script to run "npm rebuild" with the current PATH.
// This workaround is needed for Android Studio on macOS when it is not started
// from the command line, as npm probably won't be in the PATH at build time.
async function buildMacOSHelperNpmBuildScript(config: any): Promise<void> {
  const wwwPath = await getAndroidWWWPath(config);
  const helperMacOSBuildScriptPath = path.join(wwwPath, 'build-native-modules-MacOS-helper-script.sh');
  
  // Ensure the directory exists
  const dir = path.dirname(helperMacOSBuildScriptPath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist, ignore error
  }
  
  await fs.writeFile(helperMacOSBuildScriptPath, `#!/bin/bash
export PATH=$PATH:${process.env.PATH}
npm $@
`, { mode: 0o755 });
}

export default async function(): Promise<void> {
  // Only run for Android platform on macOS
  const platformEnv = process.env.CAPACITOR_PLATFORM_NAME;
  if ((platformEnv === 'android' || !platformEnv) && process.platform === 'darwin') {
    const config = await loadConfig();
    await buildMacOSHelperNpmBuildScript(config);
  }
}
