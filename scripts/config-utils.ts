/**
 * Shared utilities for reading Capacitor configuration
 * Used by multiple scripts to avoid code duplication
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glob } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);

export interface CapacitorConfig {
  webDir?: string;
  plugins?: {
    CapacitorNodeJS?: {
      nodeDir?: string;
      androidLibNode?: string;
      iosLibNode?: string;
      startMode?: string;
    };
  };
}

/**
 * Find and load Capacitor config file
 * Looks for config file relative to the current working directory (where Capacitor CLI runs)
 * Also searches from the script's location to handle cases where hooks run from different directories
 */
export async function findCapacitorConfig(): Promise<CapacitorConfig> {
  // Start from current working directory (where Capacitor CLI executes)
  // This should be the app root when run as a Capacitor hook
  const searchRoot = process.cwd();

  // Also try to find config relative to where this script is located
  // The script might be in scripts/dist/assets/ when bundled
  const scriptDir = dirname(__filename);

  // Build comprehensive list of possible roots to search
  // 1. Current working directory (should be app root when run as hook)
  // 2. Script location and parent directories (in case run from plugin dir)
  // 3. Go up from script location to find app root
  const possibleRoots = [
    searchRoot, // Primary: where Capacitor CLI runs (should be app root)
  ];

  // Add paths going up from script location
  let currentScriptDir = scriptDir;
  for (let i = 0; i < 10; i++) { // Search up to 10 levels
    possibleRoots.push(currentScriptDir);
    const parent = resolve(currentScriptDir, '..');
    if (parent === currentScriptDir) break; // Reached filesystem root
    currentScriptDir = parent;
  }

  // Remove duplicates and normalize paths
  const uniqueRoots = Array.from(new Set(possibleRoots.map(r => resolve(r))));

  for (const root of uniqueRoots) {
    const configPatterns = [
      join(root, 'capacitor.config.ts'),
      join(root, 'capacitor.config.js'),
      join(root, 'capacitor.config.json'),
    ];

    // Also check parent directories (for monorepos)
    const parentPatterns = [
      join(root, '..', 'capacitor.config.ts'),
      join(root, '..', 'capacitor.config.js'),
      join(root, '..', 'capacitor.config.json'),
    ];

    for (const configPath of [...configPatterns, ...parentPatterns]) {
      if (existsSync(configPath)) {
        try {
          if (configPath.endsWith('.json')) {
            const content = readFileSync(configPath, 'utf8');
            return JSON.parse(content) as CapacitorConfig;
          } else {
            // For TS/JS files, use dynamic import
            // Use pathToFileURL for proper file URL handling (fixes macOS file:// URL warning)
            const fileUrl = pathToFileURL(configPath).href;
            const module = await import(fileUrl);
            return (module.default || module) as CapacitorConfig;
          }
        } catch (error) {
          const err = error as Error;
          console.warn(`Failed to load config from ${configPath}:`, err.message);
        }
      }
    }
  }

  // Try using glob to find config files in current and parent directories
  // This is a fallback that searches more broadly
  try {
    const searchDirs = [...uniqueRoots];
    // Also search parent directories of each root (for monorepos)
    for (const root of uniqueRoots) {
      let current = root;
      for (let i = 0; i < 5; i++) { // Search up to 5 levels up
        searchDirs.push(current);
        const parent = resolve(current, '..');
        if (parent === current) break; // Reached filesystem root
        current = parent;
      }
    }

    const uniqueSearchDirs = Array.from(new Set(searchDirs.map(d => resolve(d))));

    for (const searchDir of uniqueSearchDirs) {
      if (!existsSync(searchDir)) continue;

      try {
        const globIter = glob('capacitor.config.{ts,js,json}', {
          cwd: searchDir,
          ignore: ['**/node_modules/**'],
        });
        const configFiles: string[] = [];
        for await (const file of globIter) {
          configFiles.push(resolve(searchDir, file));
        }

        for (const configPath of configFiles) {
          try {
            if (configPath.endsWith('.json')) {
              const content = readFileSync(configPath, 'utf8');
              return JSON.parse(content) as CapacitorConfig;
            } else {
              // For TS/JS files, try dynamic import
              const fileUrl = pathToFileURL(configPath).href;
              const module = await import(fileUrl);
              return (module.default || module) as CapacitorConfig;
            }
          } catch (error) {
            // Continue to next file
            continue;
          }
        }
      } catch (error) {
        // Continue to next directory
        continue;
      }
    }
  } catch (error) {
    // Fall through to error
  }

  // If we still haven't found it, provide helpful error message
  const searchedPaths = uniqueRoots.map(r => `  - ${r}`).join('\n');
  throw new Error(`Could not find Capacitor config file. Searched in:\n${searchedPaths}\n\nMake sure capacitor.config.ts, capacitor.config.js, or capacitor.config.json exists in your app root.`);
}

/**
 * Find the Capacitor project root by locating the config file
 * Returns the directory containing the config file, or null if not found
 * Prioritizes the current working directory (where Capacitor CLI runs)
 */
export async function findCapacitorProjectRoot(): Promise<string | null> {
  const searchRoot = process.cwd();
  const scriptDir = dirname(__filename);

  // Helper to check if a directory is a plugin (not an app)
  const isPluginDirectory = (dir: string): boolean => {
    // Plugins have ios/Plugin/ or android/src/main/ structure
    return existsSync(join(dir, 'ios', 'Plugin')) ||
           existsSync(join(dir, 'android', 'src', 'main'));
  };

  // Helper to check if a directory should be excluded (test/example projects)
  const shouldExcludeProject = (dir: string): boolean => {
    const dirName = dir.split('/').pop() || '';
    // Exclude known test/example project directories
    const excludePatterns = ['ios-nodejs', 'Capacitor-NodeJS', 'Capacitor-NodeJS_Examples'];
    return excludePatterns.some(pattern => dir.includes(pattern));
  };

  // Helper to verify a directory is a valid Capacitor app project (not a plugin)
  const isValidCapacitorProject = (dir: string): boolean => {
    // Must have package.json and either ios/ or android/ directory
    if (!existsSync(join(dir, 'package.json'))) {
      return false;
    }

    // Exclude test/example projects
    if (shouldExcludeProject(dir)) {
      return false;
    }

    // Must have ios/ or android/ directory
    const hasIOS = existsSync(join(dir, 'ios'));
    const hasAndroid = existsSync(join(dir, 'android'));

    if (!hasIOS && !hasAndroid) {
      return false;
    }

    // Check if it's a plugin directory - if so, it's not an app
    if (isPluginDirectory(dir)) {
      return false;
    }

    // For iOS, look for App.xcodeproj or App.xcworkspace (app structure)
    // or Plugin.xcodeproj (plugin structure - skip)
    if (hasIOS) {
      const hasAppProject = existsSync(join(dir, 'ios', 'App', 'App.xcodeproj')) ||
                           existsSync(join(dir, 'ios', 'App', 'App.xcworkspace')) ||
                           existsSync(join(dir, 'ios', 'App.xcodeproj')) ||
                           existsSync(join(dir, 'ios', 'App.xcworkspace'));
      const hasPluginProject = existsSync(join(dir, 'ios', 'Plugin.xcodeproj'));

      // If it has a plugin project but no app project, it's a plugin directory
      if (hasPluginProject && !hasAppProject) {
        return false;
      }

      // Must have an app project structure
      if (!hasAppProject) {
        return false;
      }
    }

    // For Android, check if it has app/ directory (app structure)
    // vs src/main/ (plugin structure)
    if (hasAndroid) {
      const hasAppStructure = existsSync(join(dir, 'android', 'app'));
      const hasPluginStructure = existsSync(join(dir, 'android', 'src', 'main')) &&
                                 !hasAppStructure;

      // If it only has plugin structure, it's a plugin directory
      if (hasPluginStructure) {
        return false;
      }

      // Must have app structure
      if (!hasAppStructure) {
        return false;
      }
    }

    return true;
  };

  // Check if we're starting from a plugin directory or node_modules
  // If so, we need to search up more aggressively
  const isInPluginOrNodeModules = searchRoot.includes('node_modules') ||
                                   searchRoot.includes('capacitor-nodejs') ||
                                   isPluginDirectory(searchRoot);

  // Priority 1: Search from current working directory first (where Capacitor CLI runs)
  // This is most likely to be the correct project root
  // But if we're in a plugin/node_modules, search up more levels and skip the plugin itself
  const maxLevels = isInPluginOrNodeModules ? 15 : 5;
  let current = searchRoot;
  for (let i = 0; i < maxLevels; i++) {
    // Skip the current directory if it's a plugin directory (but still search its contents)
    const isCurrentPlugin = isPluginDirectory(current) || shouldExcludeProject(current);

    const configPatterns = [
      join(current, 'capacitor.config.ts'),
      join(current, 'capacitor.config.js'),
      join(current, 'capacitor.config.json'),
    ];

    for (const configPath of configPatterns) {
      if (existsSync(configPath)) {
        const configDir = dirname(configPath);
        // Skip if it's the plugin directory we started from
        if (isCurrentPlugin && configDir === current) {
          continue;
        }
        // Verify it's a valid Capacitor project (not a plugin)
        if (isValidCapacitorProject(configDir)) {
          return configDir;
        }
      }
    }

    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  // Priority 2: Search from script location (in case we're in a plugin directory)
  // Walk up from the script location to find the app
  // Script might be in: plugin/scripts/dist/ or app/node_modules/plugin/scripts/dist/
  current = scriptDir;
  for (let i = 0; i < 15; i++) {
    const configPatterns = [
      join(current, 'capacitor.config.ts'),
      join(current, 'capacitor.config.js'),
      join(current, 'capacitor.config.json'),
    ];

    for (const configPath of configPatterns) {
      if (existsSync(configPath)) {
        const configDir = dirname(configPath);
        // Verify it's a valid project
        if (isValidCapacitorProject(configDir)) {
          return configDir;
        }
      }
    }

    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  // Final fallback: Try glob search, but prioritize results that look like project directories
  try {
    const searchDirs = [searchRoot];
    let currentDir = searchRoot;
    for (let i = 0; i < 5; i++) {
      searchDirs.push(currentDir);
      const parent = resolve(currentDir, '..');
      if (parent === currentDir) break;
      currentDir = parent;
    }

    for (const searchDir of searchDirs) {
      if (!existsSync(searchDir)) continue;

      try {
        const globIter = glob('capacitor.config.{ts,js,json}', {
          cwd: searchDir,
          ignore: ['**/node_modules/**'],
        });
        const configFiles: string[] = [];
        for await (const file of globIter) {
          configFiles.push(resolve(searchDir, file));
        }

        // Prefer config files that are in valid Capacitor project directories
        for (const configPath of configFiles) {
          const configDir = dirname(configPath);
          // Skip excluded projects
          if (shouldExcludeProject(configDir)) {
            continue;
          }
          // Only return if it's a valid Capacitor project
          if (isValidCapacitorProject(configDir)) {
            return configDir;
          }
        }
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    // Fall through
  }

  return null;
}

/**
 * Get plugin settings from Capacitor config
 */
export function getPluginSettings(config: CapacitorConfig) {
  return {
    nodeDir: config.plugins?.CapacitorNodeJS?.nodeDir ?? 'nodejs',
    startMode: config.plugins?.CapacitorNodeJS?.startMode ?? 'auto',
    webDir: config.webDir ?? 'dist',
  };
}

/**
 * Get the nodejs project directory path from config
 */
export function getNodeJSProjectPath(config: CapacitorConfig, projectRoot: string): string {
  const settings = getPluginSettings(config);
  return join(projectRoot, settings.webDir, settings.nodeDir);
}

