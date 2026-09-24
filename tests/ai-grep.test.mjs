// The grep assertions from docs/plans/tier-0.md 5.3 / 5.4, run in CI: no
// retired model ids, no sampling parameters, no OpenAI key fallback and no
// deleted endpoints anywhere in the app code, and exactly one module that
// constructs an Anthropic client or calls messages.create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'docs', '.git', 'coverage']);
const EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.tsx']);

function sourceFiles(dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

function filesMatching(pattern, files) {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file).split('\\').join('/'))
    .sort();
}

const files = sourceFiles();

test('no retired model, sampling parameter, OpenAI fallback or deleted endpoint survives in app code', () => {
  const legacy = /temperature|claude-3-5|claude-sonnet-4|OPENAI_API_KEY|\/api\/claude\/analyze|bulk-transition-plans|scenarios\/growth|scenarios\/capacity|scenarios\/succession/;
  assert.deepEqual(filesMatching(legacy, files), []);
});

test('services/anthropic.cjs is the only module that builds an Anthropic client or calls messages.create', () => {
  const sdkUse = /messages\.create\(|new Anthropic\(/;
  assert.deepEqual(filesMatching(sdkUse, files), ['services/anthropic.cjs']);
});

test('the one request builder passes only model, max_tokens, system and messages', () => {
  const service = readFileSync(join(root, 'services/anthropic.cjs'), 'utf8');
  assert.doesNotMatch(service, /top_p|thinking:|output_config|tool_choice|stream:/);
  const requestFields = service.match(/messages\.create\(\{([\s\S]*?)\}\);/);
  assert.ok(requestFields, 'messages.create call found');
  assert.match(requestFields[1], /model: AI_MODEL/);
  assert.match(requestFields[1], /max_tokens: maxTokens/);
  assert.match(requestFields[1], /system/);
  assert.match(requestFields[1], /messages: \[\{ role: 'user', content: prompt \}\]/);
});
