import fs from 'node:fs/promises';
import path from 'node:path';
// @ts-ignore - loadConfig is not exported in types but exists in the package
import { loadConfig } from '@capacitor/cli/dist/config.js';

// Patches a package.json in case it has variable substitution for
// the module's binary at runtime. Since we are cross-compiling
// for mobile, this substitution will have different values at
// build time and runtime, so we pre-substitute them with fixed
// values.
async function patchPackageJSON_preNodeGyp_modulePath(filePath: string): Promise<void> {
  const packageReadData = await fs.readFile(filePath, 'utf8');
  const packageJSON = JSON.parse(packageReadData);
  if (packageJSON?.binary?.module_path) {
    let binaryPathConfiguration = packageJSON.binary.module_path;
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{node_abi\}/g, "node_abi");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{platform\}/g, "platform");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{arch\}/g, "arch");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{target_arch\}/g, "target_arch");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{libc\}/g, "libc");
    packageJSON.binary.module_path = binaryPathConfiguration;
    const packageWriteData = JSON.stringify(packageJSON, null, 2);
    await fs.writeFile(filePath, packageWriteData);
  }
}

// Visits every package.json to apply patches in parallel.
async function visitPackageJSON(folderPath: string): Promise<void> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  
  const tasks: Promise<void>[] = [];
  
  for (const entry of entries) {
    const filePath = path.join(folderPath, entry.name);
    
    if (entry.isDirectory()) {
      tasks.push(visitPackageJSON(filePath));
    } else if (entry.name === 'package.json') {
      tasks.push(
        patchPackageJSON_preNodeGyp_modulePath(filePath).catch((e) => {
          console.warn(
            `Failed to patch the file: "${filePath}". The following error was thrown: ${JSON.stringify(e)}`
          );
        })
      );
    }
  }
  
  await Promise.all(tasks);
}

// Gets the platform's www path using Capacitor config.
async function getPlatformWWWPath(platform: string, config: any): Promise<string> {
  if (platform === 'android') {
    const androidConfig = config.android;
    if (androidConfig?.webDirAbs) {
      return androidConfig.webDirAbs;
    }
    // Fallback to standard Capacitor Android structure
    return path.join(config.app.rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');
  } else if (platform === 'ios') {
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

// Applies the patch to the selected platform
async function patchTargetPlatform(platform: string, config: any): Promise<void> {
  const wwwPath = await getPlatformWWWPath(platform, config);
  
  // Get the nodeDir from plugin config (defaults to "nodejs")
  const pluginConfig = config.app.extConfig.plugins?.CapacitorNodeJS;
  const nodeDir = pluginConfig?.nodeDir || 'nodejs';
  
  const nodeModulesPathToPatch = path.join(wwwPath, nodeDir, 'node_modules');
  try {
    await fs.access(nodeModulesPathToPatch);
    await visitPackageJSON(nodeModulesPathToPatch);
  } catch {
    // Directory doesn't exist, skip patching
  }
}

export default async function(): Promise<void> {
  // Get platforms from environment variable or process all
  const platformEnv = process.env.CAPACITOR_PLATFORM_NAME;
  
  // Load config once and reuse for all platforms
  const config = await loadConfig();
  
  const tasks: Promise<void>[] = [];
  
  if (platformEnv === 'android' || !platformEnv) {
    tasks.push(patchTargetPlatform('android', config));
  }
  
  if (platformEnv === 'ios' || !platformEnv) {
    tasks.push(patchTargetPlatform('ios', config));
  }
  
  await Promise.all(tasks);
}
