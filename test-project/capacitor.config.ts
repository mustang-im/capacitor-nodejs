import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.capacitornodejs',
  appName: 'Capacitor NodeJS Test',
  webDir: 'dist',
  plugins: {
    CapacitorNodeJS: {
      nodeDir: 'nodejs',
    }
  }
};

export default config;

