/**
 * Shared utilities for reading Capacitor configuration
 * Used by multiple scripts to avoid code duplication
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * Uses findCapacitorProjectRoot to locate the project, then loads the config from there
 */
export async function findCapacitorConfig(): Promise<CapacitorConfig> {
  // First try to find the project root using the static calculation
  const projectRoot = await findCapacitorProjectRoot();
  
  if (projectRoot) {
    // Load config from the known project root
    const configPatterns = [
      join(projectRoot, 'capacitor.config.ts'),
      join(projectRoot, 'capacitor.config.js'),
      join(projectRoot, 'capacitor.config.json'),
    ];

    for (const configPath of configPatterns) {
      if (existsSync(configPath)) {
        try {
          if (configPath.endsWith('.json')) {
            const content = await readFile(configPath, 'utf8');
            return JSON.parse(content) as CapacitorConfig;
          } else {
            // For TS/JS files, use dynamic import
            const fileUrl = pathToFileURL(configPath).href;
            const module = await import(fileUrl);
            return (module.default || module) as CapacitorConfig;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load config from ${configPath}: ${message}`);
        }
      }
    }
    
    throw new Error(
      `Could not find Capacitor config file in project root: ${projectRoot}\n\nMake sure capacitor.config.ts, capacitor.config.js, or capacitor.config.json exists in your app root.`
    );
  }

  // Fallback: try current working directory (shouldn't normally be needed)
  const searchRoot = process.cwd();
  const configPatterns = [
    join(searchRoot, 'capacitor.config.ts'),
    join(searchRoot, 'capacitor.config.js'),
    join(searchRoot, 'capacitor.config.json'),
  ];

  for (const configPath of configPatterns) {
    if (existsSync(configPath)) {
      try {
        if (configPath.endsWith('.json')) {
          const content = await readFile(configPath, 'utf8');
          return JSON.parse(content) as CapacitorConfig;
        } else {
          const fileUrl = pathToFileURL(configPath).href;
          const module = await import(fileUrl);
          return (module.default || module) as CapacitorConfig;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load config from ${configPath}: ${message}`);
      }
    }
  }

  throw new Error(
    `Could not find Capacitor config file. Searched in:\n  - ${searchRoot}\n\nMake sure capacitor.config.ts, capacitor.config.js, or capacitor.config.json exists in your app root.`
  );
}

/**
 * Find the Capacitor project root by calculating path from script location
 * Returns the app root directory by going up ../../../../../ from scripts/dist/assets/
 * This is a static calculation - always goes up 5 levels from assets/ to reach app root
 * Verifies the path is correct by checking for a Capacitor config file
 */
export async function findCapacitorProjectRoot(): Promise<string | null> {
  const scriptDir = dirname(__filename);

  // Script is always at: node_modules/capacitor-nodejs/scripts/dist/assets/config-utils-*.js
  // From dist/assets/ -> ../../../../../ to get to app root (5 levels: assets->dist->scripts->capacitor-nodejs->node_modules->app)
  if (scriptDir.includes('node_modules/capacitor-nodejs') && scriptDir.includes('dist/assets')) {
    // Static calculation: always go up 5 levels from assets/ to reach app root
    const projectRoot = resolve(scriptDir, '../../../../../');
    
    // Verify the path is correct by checking for a Capacitor config file
    const configPatterns = [
      join(projectRoot, 'capacitor.config.ts'),
      join(projectRoot, 'capacitor.config.js'),
      join(projectRoot, 'capacitor.config.json'),
    ];
    
    for (const configPath of configPatterns) {
      if (existsSync(configPath)) {
        return projectRoot;
      }
    }
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

