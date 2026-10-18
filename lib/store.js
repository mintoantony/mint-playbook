'use strict';
const fs = require('node:fs');
const path = require('node:path');

class StoreError extends Error {
  constructor(message, file) {
    super(message);
    this.name = 'StoreError';
    this.file = file;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new StoreError(`cannot read ${file}: ${e.message}`, file);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new StoreError(`invalid JSON in ${file}: ${e.message}`, file);
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  let lastErr;
  for (let i = 0; i < 40; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') break;
      sleep(25); // Windows: target briefly held open by a reader
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  throw new StoreError(`cannot write ${file}: ${lastErr.message}`, file);
}

const RETRY_MS = 50;
const TIMEOUT_MS = 5000;
const STALE_MS = 10000;

function withLock(file, fn) {
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const start = Date.now();
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch { /* lock vanished or is busy; retry */ }
      if (Date.now() - start > TIMEOUT_MS) throw new StoreError(`timed out waiting for lock ${lock}`, file);
      sleep(RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
  }
}

module.exports = { readJson, writeJsonAtomic, withLock, StoreError };
