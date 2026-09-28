// src/utils/clientHistory.js (docs/plans/tier-2.md, S9 and S10, WP6): a
// client's history rows as the client form shows them, the "Last changed by"
// line, and the notice a stale save's 409 turns into; held equal to the
// server's field list and firm time (utils/clientChanges.cjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import clientChanges from '../utils/clientChanges.cjs';
import askPrompts from '../utils/askPrompts.cjs';
import {
  FIRM_TIME_ZONE, HISTORY_FIELDS, FORM_LABELS, firmTime, historyEntry, lastChangedLine, conflictNotice,
} from '../src/utils/clientHistory.js';
import { FORM_FIELDS } from '../src/utils/clientForm.js';

const AT = '2026-09-28T20:34:00.006Z'; // 4:34 PM in Connecticut

test('the page\'s field list and firm time are the server\'s', () => {
  assert.deepEqual(HISTORY_FIELDS, [...clientChanges.FIELDS]);
  assert.equal(FIRM_TIME_ZONE, askPrompts.FIRM_TIME_ZONE);
  for (const when of [AT, '2026-01-15T20:34:00Z', '2026-03-08T06:59:59Z', '2026-11-01T05:30:00Z', '2026-12-31T23:59:59.999Z']) {
    assert.equal(firmTime(when), clientChanges.firmTime(when), when);
  }
  assert.equal(firmTime(AT), 'Sep 28, 2026, 4:34 PM');
  // Every form field has a label for the notice
  assert.deepEqual(Object.keys(FORM_LABELS).sort(), [...FORM_FIELDS].sort());
});

test('a change lists each field from and to, in the form\'s order, then revenue by year; notes only say they changed', () => {
  const entry = historyEntry({
    id: 9, source: 'form', changed_by_username: 'jeff', created_at: AT,
    changes: {
      revenue: { 2026: { from: 55000.5, to: 60000 }, 2025: { from: 40000, to: null } },
      notes: { from: 'Old note', to: 'R&D < 5%' },
      stickiness: { from: 3, to: 4 },
      interaction_frequency: { from: null, to: 'Weekly' },
      lead_id: { from: { id: 1, name: 'Kevin' }, to: { id: 2, name: 'Joe' } },
      second_chair_id: { from: { id: 3, name: null }, to: null },
      high_maintenance: { from: false, to: true },
      practice_area: { from: ['Energy', 'Healthcare'], to: null },
    },
  });
  assert.deepEqual([entry.id, entry.when, entry.who, entry.kind, entry.title], [9, 'Sep 28, 2026, 4:34 PM', 'jeff', 'changed', 'Changed on Client Details']);
  assert.deepEqual(entry.lines.map((l) => l.text), [
    'Lead: Kevin → Joe',
    'Second chair: person #3 → none',
    'Stickiness: 3 → 4',
    'Cadence: not set → Weekly',
    'High-maintenance: no → yes',
    'Practice areas: Energy, Healthcare → none',
    'Notes changed',
    'Revenue 2025: $40,000 → none',
    'Revenue 2026: $55,000.50 → $60,000',
  ]);
  const notes = entry.lines.find((l) => l.key === 'notes');
  assert.deepEqual([notes.long, notes.fromText, notes.toText], [true, 'Old note', 'R&D < 5%']);
  assert.equal(entry.lines.filter((l) => l.long).length, 1);
});

test('a client created lists what it was given, a deleted one what it had; the source names where it came from; an account gone is "a former account"', () => {
  const created = historyEntry({
    id: 1, source: 'import', changed_by_username: null, created_at: AT,
    changes: { name: { from: null, to: 'Acme' }, stickiness: { from: null, to: 4 }, notes: { from: null, to: 'n' }, revenue: { 2026: { from: null, to: 1000 } } },
  });
  assert.deepEqual([created.kind, created.title, created.who], ['created', 'Created on an import', 'a former account']);
  assert.deepEqual(created.lines.map((l) => l.text), ['Name: Acme', 'Stickiness: 4', 'Notes added', 'Revenue 2026: $1,000']);
  const deleted = historyEntry({
    id: 2, source: 'delete', changed_by_username: 'paula', created_at: AT,
    changes: { name: { from: 'Acme', to: null }, stickiness: { from: 4, to: null } },
  });
  assert.deepEqual([deleted.kind, deleted.title], ['deleted', 'Deleted']);
  assert.deepEqual(deleted.lines.map((l) => l.text), ['Name: Acme', 'Stickiness: 4']);
  const seat = historyEntry({
    id: 3, source: 'second-chair', changed_by_username: 'joe', created_at: AT,
    changes: { second_chair_id: { from: null, to: { id: 8, name: 'Ann' } } },
  });
  // A seat filled from none is a change, not a creation: only a creation gives a name from none
  assert.deepEqual([seat.kind, seat.title], ['changed', 'Changed on the associate split']);
  assert.deepEqual(seat.lines.map((l) => l.text), ['Second chair: none → Ann']);
});

test('"Last changed by" comes from the newest row, with where it came from beside the name; none without a row', () => {
  assert.equal(lastChangedLine([]), null);
  assert.equal(lastChangedLine(undefined), null);
  assert.equal(lastChangedLine([{ changed_by_username: 'jeff', source: 'form', created_at: AT }, { changed_by_username: 'x', source: 'form', created_at: AT }]),
    'Last changed by jeff on Sep 28, 2026, 4:34 PM');
  assert.equal(lastChangedLine([{ changed_by_username: 'jeff', source: 'import', created_at: AT }]), 'Last changed by jeff (an import) on Sep 28, 2026, 4:34 PM');
  assert.equal(lastChangedLine([{ changed_by_username: null, source: 'second-chair', created_at: AT }]),
    'Last changed by a former account (the associate split) on Sep 28, 2026, 4:34 PM');
});

test('the notice after a 409 names who and when, says nothing was saved, and what the form now shows', () => {
  const latest = { changed_by_username: 'jeff', source: 'form', created_at: AT };
  assert.equal(conflictNotice(latest, { theirs: ['stickiness'], kept: ['interaction_frequency'], clashes: [] }),
    'Not saved: jeff saved this client on Sep 28, 2026, 4:34 PM, after you opened it. The form now shows their changes to Stickiness. ' +
    'Your edits to Cadence are still in the form. Check the form and save again.');
  assert.equal(conflictNotice(latest, { theirs: ['stickiness', 'notes', 'revenues'], kept: ['name', 'lead_id'], clashes: ['notes'] }),
    'Not saved: jeff saved this client on Sep 28, 2026, 4:34 PM, after you opened it. The form now shows their changes to Stickiness, Notes and Revenue. ' +
    'Your edits to Name and Lead are still in the form. You both changed Notes: the form shows yours, and theirs is in the History below. ' +
    'Check the form and save again.');
  assert.equal(conflictNotice(null, { theirs: [], kept: [], clashes: [] }),
    'Not saved: someone saved this client after you opened it. The form now shows the client as it is saved. Nothing of yours was lost.');
  assert.match(conflictNotice({ changed_by_username: 'paula', source: 'import', created_at: AT }), /^Not saved: paula \(an import\) saved this client on /);
});
