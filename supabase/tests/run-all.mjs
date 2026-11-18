// Runs every SQL check registered in package.json (pretest + test) and reports all failures in one pass.
// Parse checks run first, then test files run in parallel; a crashed file is recorded and the rest keep running.
// Usage: node run-all.mjs [filter ...]   (filters match a command substring, e.g. "recurring" or "0058")
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const commands = [pkg.scripts.pretest, pkg.scripts.test]
  .flatMap((script) => (script ?? '').split('&&'))
  .map((command) => command.trim())
  .filter(Boolean);
for (const command of commands) {
  if (!/^node\s+\S+/.test(command)) throw new Error(`unsupported command in package.json: ${command}`);
}
const unique = [...new Set(commands)];
const filters = process.argv.slice(2);
const selected = filters.length ? unique.filter((c) => filters.some((f) => c.includes(f))) : unique;
const parseChecks = selected.filter((c) => c.split(/\s+/)[1] === 'parse.cjs');
const testFiles = selected.filter((c) => c.split(/\s+/)[1] !== 'parse.cjs');
const concurrency = Math.max(
  1,
  Number(process.env.SQL_TEST_CONCURRENCY) || (os.availableParallelism?.() ?? os.cpus().length),
);

function run(command) {
  const args = command.split(/\s+/).slice(1);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: here, env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => {
      const lines = output.split('\n').map((line) => (line.length > 600 ? `${line.slice(0, 600)} …[truncated]` : line));
      const failLines = lines.filter((line) => /^FAIL:|^ERR in /.test(line.trim()));
      const errorLines = lines.filter((line) => /^\s*(error:|Error:|TypeError:|SyntaxError:|ReferenceError:)/.test(line)
        || /^\s*(query|where|detail):/.test(line));
      resolve({
        command,
        ok: code === 0 && failLines.length === 0,
        code,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
        lines,
        failLines,
        errorLines: errorLines.slice(0, 12),
      });
    });
  });
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

const inActions = !!process.env.GITHUB_ACTIONS;
const group = (title) => console.log(inActions ? `::group::${title}` : `--- ${title}`);
const endGroup = () => inActions && console.log('::endgroup::');

console.log(`SQL checks: ${parseChecks.length} parse, ${testFiles.length} test files, concurrency ${concurrency}`);
const results = [
  ...(await pool(parseChecks, concurrency, run)),
  ...(await pool(testFiles, concurrency, run)),
];

for (const result of results) {
  group(`${result.ok ? 'PASS' : 'FAIL'} ${result.command} (${result.seconds}s)`);
  // Passing files only need their last lines; failing files print in full.
  console.log((result.ok ? result.lines.slice(-3) : result.lines).join('\n'));
  endGroup();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} SQL checks passed`);
for (const result of failed) {
  console.log(`\n✗ ${result.command} (exit ${result.code})`);
  for (const line of [...result.failLines, ...result.errorLines]) console.log(`    ${line.trim()}`);
  if (inActions) {
    const first = result.failLines[0] ?? result.errorLines[0] ?? `exit code ${result.code}`;
    console.log(`::error title=${result.command.split(/\s+/)[1]}::${first.replace(/\r?\n/g, ' ').slice(0, 300)}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) => `| ${r.ok ? '✅' : '❌'} | \`${r.command.replace(/^node\s+/, '')}\` | ${r.seconds}s | ${r.failLines.length} |`);
  const details = failed.map((r) => `\n### ❌ ${r.command}\n\n\`\`\`\n${[...r.failLines, ...r.errorLines].join('\n') || `exit ${r.code}`}\n\`\`\``);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `## SQL checks: ${results.length - failed.length}/${results.length} passed`,
    '', '| | Check | Time | FAIL lines |', '|---|---|---|---|', ...rows, ...details, '',
  ].join('\n'));
}

// Let stdout drain before exiting; process.exit() truncates piped CI logs.
process.exitCode = failed.length ? 1 : 0;
