#!/usr/bin/env node

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadEnvFiles } from '../src/env.js';

loadEnvFiles();

const baseUrl = (process.env.LOCAL_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const verifyArgs = process.argv.slice(2);
let spawnedServer = null;

try {
  checkNodeVersion();
  checkChromium();

  const serverAlreadyRunning = await isServerReachable();
  if (!serverAlreadyRunning) {
    console.log('Local API is not running yet. Starting it for the first verification pass...');
    spawnedServer = spawn('node', ['src/index.js'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    pipeChildOutput(spawnedServer);
    await waitForServer();
  } else {
    console.log(`Local API is already reachable at ${baseUrl}.`);
  }

  console.log('Running verification...');
  await runChild('node', ['scripts/verify-local-api.mjs', ...verifyArgs]);

  console.log('');
  console.log('Setup complete.');
  console.log(`Server URL: ${baseUrl}`);
  console.log('Next steps:');
  console.log('  1. npm start');
  console.log('  2. npm run smoke -- "Hello"');
  console.log(`  3. npm run verify${verifyArgs.length ? ` -- ${verifyArgs.join(' ')}` : ''}`);
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (spawnedServer) {
    spawnedServer.kill('SIGTERM');
  }
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(major) || major < 25) {
    throw new Error(`Node.js 25+ is required. Current version: ${process.versions.node}`);
  }

  console.log(`Node.js version: ${process.versions.node}`);
}

function checkChromium() {
  if (!fs.existsSync(chromiumPath)) {
    throw new Error(`Chromium was not found at ${chromiumPath}. Set CHROMIUM_PATH to the correct binary.`);
  }

  console.log(`Chromium: ${chromiumPath}`);
}

async function isServerReachable() {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (await isServerReachable()) {
      return;
    }

    await sleep(500);
  }

  throw new Error('Timed out while waiting for the local API to start.');
}

function pipeChildOutput(child) {
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
}

async function runChild(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
