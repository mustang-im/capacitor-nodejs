// Simple Node.js test script for Capacitor NodeJS plugin
const bridge = require('bridge');

console.log('Node.js process started!');
console.log('Platform:', process.platform);
console.log('Node version:', process.version);

// Test native module loading
let nativeModuleTest = {
  loaded: false,
  error: null,
  modules: {}
};

try {
  // Test 1: Try to load our custom native module
  try {
    const testNative = require('./build/Release/test_native_module.node');
    nativeModuleTest.modules.test_native_module = {
      loaded: true,
      result: testNative.hello()
    };
    console.log('Custom native module loaded:', testNative.hello());
  } catch (e) {
    nativeModuleTest.modules.test_native_module = {
      loaded: false,
      error: e.message
    };
    console.log('Custom native module test:', e.message);
  }

  // Test 2: Try to load fsevents (a native module that should be rebuilt)
  // Note: fsevents is macOS-specific, but the rebuild process should still work
  try {
    const fsevents = require('fsevents');
    nativeModuleTest.modules.fsevents = {
      loaded: true,
      name: 'fsevents'
    };
    console.log('Native module fsevents loaded successfully');
  } catch (e) {
    // fsevents might not be available on iOS, but that's OK
    // We're testing that the rebuild process runs, not that fsevents works
    nativeModuleTest.modules.fsevents = {
      loaded: false,
      error: e.message
    };
    console.log('Native module fsevents test (expected on iOS):', e.message);
  }

  // Check if at least one module loaded
  nativeModuleTest.loaded = Object.values(nativeModuleTest.modules).some(m => m.loaded);
} catch (e) {
  nativeModuleTest.error = e.message;
  console.error('Error testing native modules:', e.message);
}

// Listen for messages from Capacitor
bridge.on('test-event', (args) => {
  console.log('Received message from Capacitor:', args);
  
  // Send response back to Capacitor including native module test results
  bridge.send('response', {
    message: 'Hello from Node.js!',
    received: args,
    timestamp: new Date().toISOString(),
    nativeModuleTest: nativeModuleTest
  });
});

// Handle process arguments
if (process.argv.length > 2) {
  console.log('Process arguments:', process.argv.slice(2));
}

// Keep process alive
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

console.log('Node.js script is ready and listening for messages');

