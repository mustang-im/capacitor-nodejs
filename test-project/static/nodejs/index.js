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
  // Test 1: Try to load better-sqlite3 (requires native rebuild for iOS)
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO test (name) VALUES (?)').run('test');
    const row = db.prepare('SELECT * FROM test').get();
    db.close();
    
    nativeModuleTest.modules['better-sqlite3'] = {
      loaded: true,
      tested: true,
      result: row
    };
    console.log('Native module better-sqlite3 loaded and tested successfully');
  } catch (e) {
    nativeModuleTest.modules['better-sqlite3'] = {
      loaded: false,
      error: e.message
    };
    console.log('Native module better-sqlite3 test:', e.message);
  }

  // Test 2: Try to load bufferutil (requires native rebuild for iOS)
  try {
    const bufferutil = require('bufferutil');
    nativeModuleTest.modules.bufferutil = {
      loaded: true,
      name: 'bufferutil'
    };
    console.log('Native module bufferutil loaded successfully');
  } catch (e) {
    nativeModuleTest.modules.bufferutil = {
      loaded: false,
      error: e.message
    };
    console.log('Native module bufferutil test:', e.message);
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

