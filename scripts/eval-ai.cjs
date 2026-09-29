#!/usr/bin/env node

/**
 * Model and effort from real answers (docs/plans/tier-2.md, S16, WP11): ask
 * 10 to 20 of the firm's saved questions again, on today's book, under each
 * configuration S16 names, and write the saved answer and each
 * configuration's answer side by side, with the tokens, the estimated cost
 * and the time. Jeff chooses the questions, approves the spend and runs it;
 * D7 and S16 are his.
 *
 * Usage: node scripts/eval-ai.cjs                        list the saved Asks (read-only)
 *        node scripts/eval-ai.cjs --plans                the transition-plan check (read-only)
 *        node scripts/eval-ai.cjs --ids 12,15,...        the estimate; sends nothing
 *        node scripts/eval-ai.cjs --ids 12,15,... --confirm <dollars>
 *                                                        run; <dollars> is the estimate's figure
 *    or: npm run eval:ai -- <the same arguments>
 * Options: --opus-5-5 <effort>[,<effort>] adds claude-opus-5-5 at each effort
 * (off unless given); --out <path> or --stdout for the side-by-side.
 *
 * Without arguments: today's book and every saved Ask, newest first (id,
 * date, who asked, the saved answer's tokens and cost, and marks: a
 * follow-up, hidden, declined, cut off, an earlier book), and exits 0.
 * --plans: how many saved transition plans have a RECOMMENDED LEAD or
 * RECOMMENDED SECOND CHAIR the parser resolves to nobody, resolved against
 * today's People list (a lower bound: utils/evalAi.cjs, planCheck), and
 * exits 0. Any argument it does not know: the usage message and exit 1,
 * without connecting to the database.
 *
 * With --ids and without --confirm: the estimate (utils/evalAi.cjs,
 * estimateRun, from utils/aiCost.cjs's prices and the chosen answers' saved
 * token counts), the command that spends it, and exit 1; nothing is sent.
 * With --confirm <dollars>: refuses unless <dollars> is the figure this
 * estimate prints (the same questions, configurations and book), then asks
 * each question through services/anthropic.cjs (createService, one per
 * configuration; the one call site, T1), one call at a time, every question
 * under one configuration before the next, with the Ask route's system
 * blocks, user turn and max_tokens. It stops before a call once the calls so
 * far have cost the approved figure, after an answer whose cost is unknown,
 * after a key the API refuses and after three errors in a row, and on the
 * first Ctrl-C after the call in flight. The side-by-side is rewritten after
 * every call, so a stop keeps what was paid for. Exits 0 when every call ran.
 *
 * Read-only: every read is in one REPEATABLE READ READ ONLY transaction,
 * closed before the first call; nothing is saved (no ai_answers row, no
 * client_changes row), so the run's cost shows in the Anthropic Console and
 * not in the AI tab's month total. The app's AI rate limiters do not apply
 * to a script; it takes at most 20 questions.
 *
 * Where to run it (deploy/README.md 7.6): the Render Shell (NODE_ENV is
 * production there, so the calls go to api.anthropic.com whatever
 * ANTHROPIC_BASE_URL says), or locally with DATABASE_URL set to the External
 * Database URL, DATABASE_SSL=no-verify and ANTHROPIC_API_KEY set. The
 * side-by-side holds the firm's questions, answers and client names: inside
 * the repository it may be written only under eval-ai-output/ (ignored by
 * git); Render's Shell has no download, so print it with --stdout there.
 */

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const E = require('../utils/evalAi.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

// Output for a person goes to stderr during a run, so that --stdout prints
// the side-by-side alone; services/anthropic.cjs's ai_call lines go there too.
const say = (line = '') => process.stderr.write(`${line}\n`);
const print = (lines) => lines.forEach((line) => console.log(line));

// A path whose directory may not exist yet, with the symbolic links of the
// part that exists resolved, so the repository check sees where it lands.
function realTarget(file) {
  const absolute = path.resolve(file);
  let dir = path.dirname(absolute);
  const rest = [path.basename(absolute)];
  while (!fs.existsSync(dir)) {
    rest.unshift(path.basename(dir));
    dir = path.dirname(dir);
  }
  return path.join(fs.realpathSync(dir), ...rest);
}

async function readOnly(client, fn) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

// Today's book as the Ask route builds it, its hash and its system blocks,
// and the blocks' size in tokens for the estimate.
async function readToday(client, now) {
  const { loadBook } = require('../models/bookModel.cjs');
  const { systemBlocks } = require('../utils/askPrompts.cjs');
  const { bookHash } = require('../utils/aiAnswers.cjs');
  const book = await loadBook(now, client);
  const system = systemBlocks(book.text);
  const sha = bookHash(book.text);
  const systemChars = system.reduce((sum, block) => sum + block.text.length, 0);
  const { rows: [measured] } = await client.query(E.TODAY_PREFIX_SQL, [sha]);
  return { book: { ...book, sha }, system, prefix: E.prefixEstimate({ measured, systemChars }) };
}

async function list(client, now) {
  const { today, rows } = await readOnly(client, async () => ({
    today: await readToday(client, now),
    rows: (await client.query(E.CANDIDATES_SQL)).rows,
  }));
  print(E.listLines({ book: today.book, prefix: today.prefix, rows, todaySha: today.book.sha }));
  return 0;
}

async function plans(client) {
  const { rows, people } = await readOnly(client, async () => ({
    rows: (await client.query(E.PLANS_SQL)).rows,
    people: (await client.query(E.PEOPLE_SQL)).rows,
  }));
  print(E.planLines(E.planCheck(rows, people), people));
  return 0;
}

// The reads and the checks before a run: an exit code, or what to spend.
async function prepare(client, args, now) {
  const read = await readOnly(client, async () => {
    const today = await readToday(client, now);
    const { rows } = await client.query(E.CHOSEN_SQL, [args.ids]);
    return { today, chosen: E.orderChosen(args.ids, rows) };
  });
  const { today, chosen } = read;
  if (chosen.error) {
    console.error(`Refused: ${chosen.error} Nothing was sent.`);
    return 1;
  }
  if (today.book.clientCount === 0) {
    console.error('Refused: the book has no clients yet. Nothing was sent.');
    return 1;
  }

  const configs = E.configurations(args);
  const estimate = E.estimateRun({ answers: chosen.answers, configs, prefix: today.prefix, now });
  let target = null;
  if (!args.stdout) {
    target = realTarget(args.out ?? E.defaultOutputPath(now));
    const problem = E.outputPathProblem({ repoRoot: fs.realpathSync(REPO_ROOT), target });
    if (problem) {
      console.error(`${problem} Nothing was sent.`);
      return 1;
    }
    if (fs.existsSync(target)) {
      console.error(`Refused: ${target} already exists. Choose another path or delete it. Nothing was sent.`);
      return 1;
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
  const lines = E.estimateLines({
    book: today.book,
    prefix: today.prefix,
    answers: chosen.answers,
    configs,
    estimate,
    target,
    keySet: apiKey !== '',
    callsTo: E.callTarget(process.env),
    args,
  });
  if (args.mode === 'estimate') {
    print(lines);
    return 1;
  }
  if (estimate.unpriced.length) {
    lines.forEach((line) => console.error(line));
    return 1;
  }

  // --confirm: the figure must be this estimate's
  const approvedCents = E.readConfirm(args.confirm);
  const figureCents = E.readConfirm(estimate.figure);
  if (approvedCents !== figureCents) {
    console.error(`Refused: --confirm ${args.confirm} is not this estimate's figure, $${estimate.figure} (the questions, the configurations or the book differ from the estimate you approved). Nothing was sent.`);
    return 1;
  }
  if (!apiKey) {
    console.error('Refused: ANTHROPIC_API_KEY is not set. Nothing was sent.');
    return 1;
  }
  // The estimate again, as the run's header, without its closing command
  ['Evaluation run: the estimate you approved.', ...lines.slice(1, -2)].forEach((line) => say(line));
  return { today, answers: chosen.answers, configs, estimate, target, apiKey, now };
}

async function spend({ today, answers, configs, estimate, target, apiKey, now }) {
  const { createService, describeError } = require('../services/anthropic.cjs');
  const { askTurn, ASK_MAX_TOKENS } = require('../utils/askPrompts.cjs');
  // The service's log lines to stderr, beside the progress lines
  console.log = (...parts) => console.error(...parts);

  const results = [];
  const planned = configs.length * answers.length;
  const approved = E.readConfirm(estimate.figure) / 100;
  let status = 'In progress';
  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    say('Stopping after the call in flight (Ctrl-C again to quit at once; that call is then lost, though paid for).');
  });

  const render = () => E.renderSideBySide({
    startedAt: now, book: today.book, prefix: today.prefix, configs, questions: answers, results, status, approved: estimate.figure,
  });
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, render(), { flag: 'wx', mode: 0o600 });
  }
  const save = () => { if (target) fs.writeFileSync(target, render(), { mode: 0o600 }); };

  let spent = 0;
  let errorsInARow = 0;
  outer:
  for (const config of configs) {
    const service = createService({ apiKey, model: config.model, effort: config.effort });
    for (const answer of answers) {
      if (stopRequested) { status = 'Stopped at Ctrl-C'; break outer; }
      if (spent >= approved) { status = `Stopped: the calls so far cost ${E.formatUsd(spent)}, at or over the approved figure`; break outer; }
      const started = Date.now();
      try {
        const result = await service.complete({
          system: today.system,
          prompt: askTurn(answer.question, new Date()),
          maxTokens: ASK_MAX_TOKENS,
          userId: null,
          label: E.LABEL,
        });
        const entry = {
          configKey: config.key,
          answerId: answer.id,
          text: result.text,
          truncated: result.truncated,
          refused: result.refused,
          refusalCategory: result.refusalCategory,
          servedBy: result.servedBy,
          fellBack: result.fellBack,
          tokens: result.tokens,
          costUsd: result.costUsd,
          ms: Date.now() - started,
        };
        results.push(entry);
        errorsInARow = 0;
        if (typeof entry.costUsd === 'number') spent += entry.costUsd;
        say(`[${results.length}/${planned}] ${config.title}  #${answer.id}  ${(entry.ms / 1000).toFixed(1)} s  ${E.formatUsd(entry.costUsd)}${entry.refused ? '  declined' : ''}${entry.truncated ? '  cut off' : ''}${entry.fellBack ? `  fell back to ${entry.servedBy}` : ''}  (so far ${E.formatUsd(spent)} of $${estimate.figure})`);
        save();
        if (typeof entry.costUsd !== 'number') { status = `Stopped: the cost of #${answer.id} under ${config.title} is unknown (served by ${entry.servedBy}, a model without a price), so the spend could not be kept under the approved figure`; break outer; }
      } catch (error) {
        const { message } = describeError(error);
        results.push({ configKey: config.key, answerId: answer.id, error: message, ms: Date.now() - started });
        errorsInARow += 1;
        say(`[${results.length}/${planned}] ${config.title}  #${answer.id}  error: ${message}`);
        save();
        if (error?.status === 401 || error?.code === 'AI_NOT_CONFIGURED') { status = `Stopped: ${message}`; break outer; }
        if (errorsInARow >= 3) { status = 'Stopped after three errors in a row'; break outer; }
      }
    }
  }
  if (status === 'In progress') status = 'Complete';
  save();
  const done = status === 'Complete' && results.length === planned;
  say(`${status}: ${results.length} of ${planned} calls, ${E.formatUsd(spent)} estimated.`);
  if (target) process.stdout.write(`Wrote ${target}. It holds the firm's questions, answers and client names: delete it when you are done.\n`);
  else process.stdout.write(render());
  return done ? 0 : 1;
}

async function main() {
  const args = E.parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    E.USAGE.forEach((line) => console.error(line));
    return 1;
  }

  // Required after the argument check so a usage error does not need a database.
  const db = require('../db.cjs');
  const now = new Date();
  let prepared;
  try {
    const client = await db.pool.connect();
    try {
      if (args.mode === 'list') return await list(client, now);
      if (args.mode === 'plans') return await plans(client);
      prepared = await prepare(client, args, now);
    } finally {
      client.release();
    }
  } finally {
    // Closed before any call: a run can take an hour and needs nothing more
    // from the database
    await db.pool.end();
  }
  return typeof prepared === 'number' ? prepared : spend(prepared);
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('Evaluation failed:', error.message);
    process.exitCode = 1;
  });
