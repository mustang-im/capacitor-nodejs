import fs from 'node:fs/promises';
import path from 'node:path';
// @ts-ignore - loadConfig is not exported in types but exists in the package
import { loadConfig } from '@capacitor/cli/dist/config.js';

// Gets the platform's www path using Capacitor config.
async function getPlatformWWWPath(platform: string, config: any): Promise<string> {
  if (platform === 'android') {
    // For Android, the www folder is typically at android/app/src/main/assets/public
    // But we check the actual config structure
    const androidConfig = config.android;
    if (androidConfig?.webDirAbs) {
      return androidConfig.webDirAbs;
    }
    // Fallback to standard Capacitor Android structure
    return path.join(config.app.rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');
  } else if (platform === 'ios') {
    // For iOS, the www folder is typically at ios/App/App/public
    const iosConfig = config.ios;
    if (iosConfig?.webDirAbs) {
      // webDirAbs is a lazy getter, so we need to await it
      return await iosConfig.webDirAbs;
    }
    // Fallback to standard Capacitor iOS structure
    return path.join(config.app.rootDir, 'ios', 'App', 'App', 'public');
  }
  
  // Fallback to webDir from config
  return config.app.webDirAbs;
}

// Adds a file to save the contents of the NODEJS_MOBILE_BUILD_NATIVE_MODULES
// environment variable if it is set during the prepare step.
async function saveBuildNativeModulesPreference(platform: string, config: any): Promise<void> {
  const wwwPath = await getPlatformWWWPath(platform, config);
  const saveBuildNativeModulesPreferencePath = path.join(wwwPath, 'NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt');
  
  if (process.env.NODEJS_MOBILE_BUILD_NATIVE_MODULES !== undefined) {
    // Ensure the directory exists
    const dir = path.dirname(saveBuildNativeModulesPreferencePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory might already exist, ignore error
    }
    await fs.writeFile(saveBuildNativeModulesPreferencePath, process.env.NODEJS_MOBILE_BUILD_NATIVE_MODULES);
  }
}

export default async function(): Promise<void> {
  // Get platforms from environment variable or process all
  const platformEnv = process.env.CAPACITOR_PLATFORM_NAME;
  
  // Load config once and reuse for all platforms
  const config = await loadConfig();
  
  const tasks: Promise<void>[] = [];
  
  if (platformEnv === 'android' || !platformEnv) {
    tasks.push(saveBuildNativeModulesPreference('android', config));
  }
  
  if (platformEnv === 'ios' || !platformEnv) {
    tasks.push(saveBuildNativeModulesPreference('ios', config));
  }
  
  await Promise.all(tasks);
}
