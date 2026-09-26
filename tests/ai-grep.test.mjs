// The grep assertions from docs/plans/tier-0.md 5.3 / 5.4, widened in Tier 1's
// WP1 (docs/plans/tier-1.md, section 3 item 1), run in CI: no retired model
// ids, no sampling parameters, no OpenAI key fallback and no deleted endpoints
// anywhere in the app code; exactly one module that constructs an Anthropic
// client or calls the Messages API (create, stream or countTokens); and the
// one request carries only what T1 allows.
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

test('services/anthropic.cjs is the only module that builds an Anthropic client or calls the Messages API', () => {
  const sdkUse = /messages\.create\(|messages\.stream\(|countTokens\(|new Anthropic\(/;
  assert.deepEqual(filesMatching(sdkUse, files), ['services/anthropic.cjs']);
});

test('no sampling parameter or thinking budget anywhere in the app code', () => {
  assert.deepEqual(filesMatching(/temperature|top_p|top_k|budget_tokens/, files), []);
});

test('betas, fallbacks and output_config appear only in services/anthropic.cjs', () => {
  assert.deepEqual(filesMatching(/\bbetas\s*:|\bfallbacks\s*:|server-side-fallback-/, files), ['services/anthropic.cjs']);
  assert.deepEqual(filesMatching(/output_config/, files), ['services/anthropic.cjs']);
});

test('the one request: model, max_tokens, system, one user turn, and only the allowed additions', () => {
  const service = readFileSync(join(root, 'services/anthropic.cjs'), 'utf8');
  assert.doesNotMatch(service, /thinking:|tool_choice|tools:|stream:/);
  // output_config only as output_config: { effort } (T11).
  assert.deepEqual(service.match(/output_config\s*:[^}]*\}/g), ['output_config: { effort }']);

  const requests = service.match(/messages\.stream\(\{([\s\S]*?)\}\);/g) || [];
  assert.equal(requests.length, 1, 'one messages.stream call');
  const fields = requests[0];
  assert.match(fields, /model,/);
  assert.match(fields, /max_tokens: maxTokens/);
  assert.match(fields, /system/);
  assert.match(fields, /messages: \[\{ role: 'user', content: prompt \}\]/);
  assert.match(fields, /betas: \[FALLBACK_BETA\], fallbacks: 'default'/);
  assert.match(service, /const FALLBACK_BETA = 'server-side-fallback-2026-07-01';/);
  assert.match(service, /const FALLBACK_MODELS = \['claude-opus-5'\];/);
});
