import { test, expect, vi } from 'vitest';
import { setupLib } from '../../install/hooks/both/fetch-libnode';

const platform = 'android';

test(`${platform} setupLib`, { timeout: 120000 }, async () => {
  const libDir = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip';
  
  // Spy on console.log to capture output
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  
  await setupLib(libDir, platform);
  
  // Assert on console.log calls
  expect(consoleSpy).toHaveBeenCalledWith('Downloading Node.js...');
  expect(consoleSpy).toHaveBeenCalledWith('Download finished!');
  expect(consoleSpy).toHaveBeenCalledWith('Extracting Node.js...');
  expect(consoleSpy).toHaveBeenCalledWith('Extraction finished!');
  
  // Get all console.log calls
  const logCalls = consoleSpy.mock.calls;
  console.log('All console.log calls:', logCalls);
  
  // Restore console.log
  consoleSpy.mockRestore();
});
