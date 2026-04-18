import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WASM_FILE = 'sha3_wasm_bg.7b9ca65ddd.wasm';
const wasmPath = path.join(path.dirname(fileURLToPath(import.meta.url)), DEFAULT_WASM_FILE);

export class DeepSeekHash {
  constructor() {
    this.wasmInstance = null;
    this.offset = 0;
    this.cachedUint8Memory = null;
    this.cachedTextEncoder = new TextEncoder();
  }

  async init() {
    if (this.wasmInstance) {
      return this.wasmInstance;
    }

    const wasmBuffer = await fs.readFile(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBuffer, { wbg: {} });
    this.wasmInstance = instance.exports;
    return this.wasmInstance;
  }

  calculateHash(algorithm, challenge, salt, difficulty, expireAt) {
    if (algorithm !== 'DeepSeekHashV1') {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }

    const prefix = `${salt}_${expireAt}_`;
    const retptr = this.wasmInstance.__wbindgen_add_to_stack_pointer(-16);

    try {
      const challengePtr = this.encodeString(
        challenge,
        this.wasmInstance.__wbindgen_export_0,
        this.wasmInstance.__wbindgen_export_1
      );
      const challengeLength = this.offset;

      const prefixPtr = this.encodeString(
        prefix,
        this.wasmInstance.__wbindgen_export_0,
        this.wasmInstance.__wbindgen_export_1
      );
      const prefixLength = this.offset;

      this.wasmInstance.wasm_solve(
        retptr,
        challengePtr,
        challengeLength,
        prefixPtr,
        prefixLength,
        difficulty
      );

      const view = new DataView(this.wasmInstance.memory.buffer);
      const status = view.getInt32(retptr, true);
      const value = view.getFloat64(retptr + 8, true);

      if (status === 0) {
        throw new Error('DeepSeek PoW solver did not produce an answer.');
      }

      return value;
    } finally {
      this.wasmInstance.__wbindgen_add_to_stack_pointer(16);
    }
  }

  encodeString(text, allocate, reallocate) {
    if (!reallocate) {
      const encoded = this.cachedTextEncoder.encode(text);
      const ptr = allocate(encoded.length, 1) >>> 0;
      const memory = this.getCachedUint8Memory();
      memory.subarray(ptr, ptr + encoded.length).set(encoded);
      this.offset = encoded.length;
      return ptr;
    }

    const strLength = text.length;
    let ptr = allocate(strLength, 1) >>> 0;
    const memory = this.getCachedUint8Memory();
    let asciiLength = 0;

    for (; asciiLength < strLength; asciiLength += 1) {
      const charCode = text.charCodeAt(asciiLength);
      if (charCode > 127) {
        break;
      }

      memory[ptr + asciiLength] = charCode;
    }

    if (asciiLength !== strLength) {
      if (asciiLength > 0) {
        text = text.slice(asciiLength);
      }

      ptr = reallocate(ptr, strLength, asciiLength + text.length * 3, 1) >>> 0;
      const encodeResult = this.cachedTextEncoder.encodeInto(
        text,
        this.getCachedUint8Memory().subarray(ptr + asciiLength, ptr + asciiLength + text.length * 3)
      );
      asciiLength += encodeResult.written;
      ptr = reallocate(ptr, asciiLength + text.length * 3, asciiLength, 1) >>> 0;
    }

    this.offset = asciiLength;
    return ptr;
  }

  getCachedUint8Memory() {
    if (!this.cachedUint8Memory || this.cachedUint8Memory.byteLength === 0) {
      this.cachedUint8Memory = new Uint8Array(this.wasmInstance.memory.buffer);
    }

    return this.cachedUint8Memory;
  }
}

const solver = new DeepSeekHash();

export async function buildPowResponse(challenge, targetPath) {
  await solver.init();

  const answer = solver.calculateHash(
    challenge.algorithm,
    challenge.challenge,
    challenge.salt,
    challenge.difficulty,
    challenge.expire_at
  );

  return Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: targetPath
  })).toString('base64');
}
