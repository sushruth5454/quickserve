#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('File is not a complete PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error(`PNG chunk ${type} exceeds file length`);

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('PNG must begin with a 13-byte IHDR chunk');
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      if (width < 1 || height < 1) throw new Error('PNG dimensions must be positive');
      sawHeader = true;
    }

    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== buffer.length) throw new Error('PNG IEND must be empty and end the file');
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader || !sawEnd) throw new Error('PNG is missing IHDR or IEND');
  return { width, height, bytes: buffer.length };
}

export function validatePng(buffer, expected = {}) {
  const metadata = inspectPng(buffer);
  for (const dimension of ['width', 'height']) {
    if (expected[dimension] !== undefined && metadata[dimension] !== expected[dimension]) {
      throw new Error(`PNG ${dimension} is ${metadata[dimension]}, expected ${expected[dimension]}`);
    }
  }
  return metadata;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file' || arg === '--width' || arg === '--height') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2);
      options[key] = key === 'file' ? value : Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.file) throw new Error('--file is required');
  for (const dimension of ['width', 'height']) {
    if (options[dimension] !== undefined && (!Number.isSafeInteger(options[dimension]) || options[dimension] < 1)) {
      throw new Error(`--${dimension} must be a positive integer`);
    }
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const metadata = validatePng(await readFile(options.file), options);
  console.log(JSON.stringify({ file: options.file, ...metadata }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`brand validate: ${error.message}`);
    process.exitCode = 1;
  });
}
