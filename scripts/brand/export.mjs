#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export function renderSvg(svgSource) {
  if (typeof svgSource !== 'string' || svgSource.trim() === '') {
    throw new TypeError('SVG source must be a non-empty string');
  }

  return new Resvg(svgSource, {
    font: { loadSystemFonts: false },
  }).render().asPng();
}

function parseArgs(argv) {
  const options = { mode: null, input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write' || arg === '--check') {
      if (options.mode) throw new Error('Choose exactly one of --write or --check');
      options.mode = arg.slice(2);
    } else if (arg === '--input' || arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      options[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.mode) throw new Error('Use --write or --check');
  if (!options.input || !options.output) throw new Error('Both --input and --output are required');
  return options;
}

export async function exportSvg({ input, output, mode }) {
  if (!['write', 'check'].includes(mode)) throw new Error('Mode must be "write" or "check"');
  const svgSource = await readFile(input, 'utf8');
  const png = renderSvg(svgSource);

  if (mode === 'write') {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, png);
  } else {
    let existing;
    try {
      existing = await readFile(output);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Expected export is missing: ${output}`);
      throw error;
    }
    if (!existing.equals(png)) throw new Error(`Export is stale: ${output}`);
  }

  return {
    mode,
    output,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  };
}

async function main(argv) {
  const result = await exportSvg(parseArgs(argv));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`brand export: ${error.message}`);
    process.exitCode = 1;
  });
}
