import { Capacitor } from '@capacitor/core';
import { NodeJS } from 'capacitor-nodejs';

const output = document.getElementById('output') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  output.textContent += `[${timestamp}] ${message}\n`;
  output.scrollTop = output.scrollHeight;
}

function setStatus(message: string, isError = false) {
  status.textContent = message;
  status.className = `status ${isError ? 'error' : 'success'}`;
}

async function startNode() {
  try {
    log('Starting Node.js process...');
    setStatus('Starting...');
    
    await NodeJS.start({
      script: './nodejs/index.js',
      args: ['Hello from Capacitor!']
    });
    
    log('Node.js process started successfully!');
    setStatus('Node.js is running');
    startBtn.disabled = true;
    sendBtn.disabled = false;
    stopBtn.disabled = false;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error starting Node.js: ${errorMsg}`);
    setStatus(`Error: ${errorMsg}`, true);
  }
}

async function sendMessage() {
  try {
    log('Sending message to Node.js...');
    const result = await NodeJS.send({
      eventName: 'test-event',
      args: ['Test message from Capacitor']
    });
    log(`Response: ${JSON.stringify(result)}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error sending message: ${errorMsg}`);
    setStatus(`Error: ${errorMsg}`, true);
  }
}

async function stopNode() {
  try {
    log('Stopping Node.js process...');
    await NodeJS.stop();
    log('Node.js process stopped');
    setStatus('Node.js stopped');
    startBtn.disabled = false;
    sendBtn.disabled = false;
    stopBtn.disabled = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error stopping Node.js: ${errorMsg}`);
    setStatus(`Error: ${errorMsg}`, true);
  }
}

// Initialize UI
startBtn.addEventListener('click', startNode);
sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', stopNode);

sendBtn.disabled = true;
stopBtn.disabled = true;

log('Test app initialized');
log(`Platform: ${Capacitor.getPlatform()}`);

