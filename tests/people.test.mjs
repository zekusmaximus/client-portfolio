// People and a client's three people (docs/plans/people-and-second-chair.md,
// P1-P6): the server's validators and legacy-field shim in utils/people.cjs,
// and the page's picker rules in src/utils/people.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import people from '../utils/people.cjs';
import {
  groupPeople,
  leadCandidates,
  secondChairCandidates,
  originatorCandidates,
  personLabel,
  originatorLabel,
  toPersonId,
  legacyPeopleFields,
} from '../src/utils/people.js';

const { validatePersonInput, parseId, validateAssignment, legacyText, personChangeBlockers, withPeopleFields } = people;

const KEVIN = { id: 1, name: 'Kevin', role: 'partner', active: true };
const PAULA = { id: 2, name: 'Paula', role: 'partner', active: true };
const JAY = { id: 3, name: 'Jay', role: 'emeritus', active: true };
const ANNA = { id: 4, name: 'Anna', role: 'associate', active: true };
const STEVE = { id: 5, name: 'Steve', role: 'partner', active: false };
const ROSTER = [KEVIN, PAULA, JAY, ANNA, STEVE];

describe('validatePersonInput', () => {
  test('accepts a name and role, trimming and collapsing spaces', () => {
    const { errors, value } = validatePersonInput({ name: "  Mary   O'Brien-Smith ", role: 'associate' });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, { name: "Mary O'Brien-Smith", role: 'associate' });
  });

  test('requires name and role on create', () => {
    const { errors } = validatePersonInput({});
    assert.deepEqual(errors.map((e) => e.field), ['name', 'role']);
  });

  test('refuses digits, markup, reserved names and unknown roles', () => {
    assert.equal(validatePersonInput({ name: 'Agent 007', role: 'partner' }).errors[0].field, 'name');
    assert.equal(validatePersonInput({ name: '<b>x</b>', role: 'partner' }).errors[0].field, 'name');
    assert.match(validatePersonInput({ name: 'firm', role: 'partner' }).errors[0].message, /reserved/);
    assert.equal(validatePersonInput({ name: 'Unassigned', role: 'partner' }).errors.length, 1);
    assert.equal(validatePersonInput({ name: 'Ann', role: 'admin' }).errors[0].field, 'role');
    assert.equal(validatePersonInput({ name: 'A'.repeat(101), role: 'partner' }).errors[0].field, 'name');
  });

  test('partial: only the fields present, and active must be a boolean', () => {
    assert.deepEqual(validatePersonInput({ active: false }, { partial: true }), { errors: [], value: { active: false } });
    assert.equal(validatePersonInput({ active: 'no' }, { partial: true }).errors[0].field, 'active');
    assert.deepEqual(validatePersonInput({}, { partial: true }), { errors: [], value: {} });
  });
});

test('parseId: integers and decimal strings; blank is null; anything else NaN', () => {
  assert.equal(parseId(3), 3);
  assert.equal(parseId(' 12 '), 12);
  assert.equal(parseId(''), null);
  assert.equal(parseId(null), null);
  assert.equal(parseId(undefined), null);
  assert.ok(Number.isNaN(parseId(0)));
  assert.ok(Number.isNaN(parseId(-1)));
  assert.ok(Number.isNaN(parseId(1.5)));
  assert.ok(Number.isNaN(parseId('3abc')));
  assert.ok(Number.isNaN(parseId({})));
});

describe('validateAssignment', () => {
  test('an active partner lead, any other active second chair, any originator', () => {
    const result = validateAssignment(
      { lead_id: '1', second_chair_id: 4, originator_id: 5, originator_is_firm: true },
      ROSTER
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.value, { lead_id: 1, second_chair_id: 4, originator_id: 5, originator_is_firm: true });
    assert.equal(result.lead, KEVIN);
    assert.equal(result.secondChair, ANNA);
    assert.equal(result.originator, STEVE);
  });

  test('a partner, emeritus or associate can be second chair', () => {
    for (const second of [PAULA, JAY, ANNA]) {
      assert.deepEqual(validateAssignment({ lead_id: 1, second_chair_id: second.id }, ROSTER).errors, []);
    }
  });

  test('the lead is required and must be an active partner', () => {
    assert.equal(validateAssignment({}, ROSTER).errors[0].message, 'Choose a lead partner.');
    for (const id of [3, 4, 5, 99, 'x']) {
      const { errors, value } = validateAssignment({ lead_id: id }, ROSTER);
      assert.deepEqual(errors, [{ field: 'lead_id', message: 'The lead must be an active partner.' }]);
      assert.equal(value.lead_id, null);
    }
  });

  test('the second chair cannot be the lead, inactive, or unknown', () => {
    assert.equal(validateAssignment({ lead_id: 1, second_chair_id: 1 }, ROSTER).errors[0].message, 'The second chair cannot be the lead.');
    assert.equal(validateAssignment({ lead_id: 1, second_chair_id: 5 }, ROSTER).errors[0].field, 'second_chair_id');
    assert.equal(validateAssignment({ lead_id: 1, second_chair_id: 99 }, ROSTER).errors[0].field, 'second_chair_id');
  });

  test('an unknown originator is refused; none is fine; the firm flag is strict', () => {
    assert.equal(validateAssignment({ lead_id: 1, originator_id: 99 }, ROSTER).errors[0].field, 'originator_id');
    const none = validateAssignment({ lead_id: 1, second_chair_id: '', originator_id: null }, ROSTER);
    assert.deepEqual(none.errors, []);
    assert.deepEqual(none.value, { lead_id: 1, second_chair_id: null, originator_id: null, originator_is_firm: false });
    assert.equal(validateAssignment({ lead_id: 1, originator_is_firm: 'true' }, ROSTER).value.originator_is_firm, true);
    assert.equal(validateAssignment({ lead_id: 1, originator_is_firm: 'yes' }, ROSTER).value.originator_is_firm, false);
  });
});

test('legacyText: lead, [lead, second chair], and Firm or the originator', () => {
  assert.deepEqual(legacyText({ lead: KEVIN, secondChair: JAY, originator: JAY, originatorIsFirm: false }), {
    primary_lobbyist: 'Kevin',
    lobbyist_team: ['Kevin', 'Jay'],
    client_originator: 'Jay',
  });
  assert.deepEqual(legacyText({ lead: KEVIN, secondChair: null, originator: JAY, originatorIsFirm: true }), {
    primary_lobbyist: 'Kevin',
    lobbyist_team: ['Kevin'],
    client_originator: 'Firm',
  });
  assert.equal(legacyText({ lead: KEVIN, originator: null, originatorIsFirm: false }).client_originator, '');
});

describe('personChangeBlockers (P5)', () => {
  const counts = { lead_count: 3, second_chair_count: 1 };

  test('a partner who leads clients cannot become an associate or be deactivated', () => {
    assert.deepEqual(personChangeBlockers(KEVIN, { role: 'associate' }, counts), [
      'Kevin leads 3 clients. Give them a new lead partner first.',
    ]);
    assert.deepEqual(personChangeBlockers(KEVIN, { active: false }, counts), [
      'Kevin leads 3 clients. Give them a new lead partner first.',
      'Kevin is second chair on 1 client. Change it first.',
    ]);
  });

  test('anyone who is second chair somewhere cannot be deactivated', () => {
    assert.deepEqual(personChangeBlockers(ANNA, { active: false }, { lead_count: 0, second_chair_count: 2 }), [
      'Anna is second chair on 2 clients. Change them first.',
    ]);
  });

  test('allowed: renames, other role changes, reactivation, and anything with no clients', () => {
    assert.deepEqual(personChangeBlockers(KEVIN, { name: 'Kevin B' }, counts), []);
    assert.deepEqual(personChangeBlockers(KEVIN, { role: 'partner' }, counts), []);
    assert.deepEqual(personChangeBlockers(ANNA, { role: 'partner' }, counts), []);
    assert.deepEqual(personChangeBlockers(STEVE, { active: true }, counts), []);
    assert.deepEqual(personChangeBlockers(KEVIN, { role: 'emeritus', active: false }, {}), []);
  });
});

describe('withPeopleFields (P6)', () => {
  const joined = {
    id: 'c1',
    name: 'Client',
    primary_lobbyist: 'Old Text',
    lobbyist_team: ['A', 'B'],
    client_originator: 'Old',
    lead_id: 1, lead_name: 'Kevin', lead_role: 'partner', lead_active: true,
    second_chair_id: 3, second_chair_name: 'Jay', second_chair_role: 'emeritus', second_chair_active: true,
    originator_id: 5, originator_name: 'Steve', originator_role: 'partner', originator_active: false,
    originator_is_firm: true,
  };

  test('nests the people, fills the legacy fields and drops the join columns', () => {
    const out = withPeopleFields(joined);
    assert.deepEqual(out.lead, KEVIN);
    assert.deepEqual(out.secondChair, JAY);
    assert.deepEqual(out.originator, STEVE);
    assert.equal(out.primary_lobbyist, 'Kevin');
    assert.deepEqual(out.lobbyist_team, ['Kevin', 'Jay']);
    assert.equal(out.client_originator, 'Firm');
    assert.equal(out.originator_is_firm, true);
    for (const key of ['lead_name', 'lead_role', 'lead_active', 'second_chair_name', 'originator_active']) {
      assert.ok(!(key in out), key);
    }
    assert.equal(out.lead_id, 1);
  });

  test('a client with no lead keeps its stored legacy values', () => {
    const legacy = {
      id: 'c2', primary_lobbyist: 'Steve', lobbyist_team: ['Fritz'], client_originator: 'Steve',
      lead_id: null, lead_name: null, second_chair_id: null, second_chair_name: null,
      originator_id: null, originator_name: null, originator_is_firm: false,
    };
    const out = withPeopleFields(legacy);
    assert.equal(out.lead, null);
    assert.equal(out.secondChair, null);
    assert.equal(out.primary_lobbyist, 'Steve');
    assert.deepEqual(out.lobbyist_team, ['Fritz']);
    assert.equal(out.client_originator, 'Steve');
  });

  test('no second chair gives a team of the lead alone', () => {
    const out = withPeopleFields({ ...joined, second_chair_id: null, second_chair_name: null, originator_is_firm: false });
    assert.deepEqual(out.lobbyist_team, ['Kevin']);
    assert.equal(out.client_originator, 'Steve');
  });

  test('the retired status column never reaches a response (P13)', () => {
    assert.ok(!('status' in withPeopleFields({ ...joined, status: 'IF' })));
    assert.ok(!('status' in withPeopleFields({ ...joined, lead_id: null, lead_name: null, status: 'Prospect' })));
  });
});

describe('src/utils/people.js pickers', () => {
  test('leads are active partners; second chairs are active people except the lead', () => {
    assert.deepEqual(leadCandidates(ROSTER).map((p) => p.name), ['Kevin', 'Paula']);
    assert.deepEqual(secondChairCandidates(ROSTER, 1).map((p) => p.name), ['Paula', 'Jay', 'Anna']);
    assert.deepEqual(secondChairCandidates(ROSTER, null).map((p) => p.name), ['Kevin', 'Paula', 'Jay', 'Anna']);
  });

  test('originators are active people plus the current one if inactive', () => {
    assert.deepEqual(originatorCandidates(ROSTER).map((p) => p.name), ['Kevin', 'Paula', 'Jay', 'Anna']);
    assert.deepEqual(originatorCandidates(ROSTER, 5).map((p) => p.name), ['Kevin', 'Paula', 'Steve', 'Jay', 'Anna']);
  });

  test('groupPeople: active by role, then inactive', () => {
    const groups = groupPeople(ROSTER);
    assert.deepEqual(groups.map((g) => [g.label, g.people.map((p) => p.name)]), [
      ['Partners', ['Kevin', 'Paula']],
      ['Emeritus', ['Jay']],
      ['Associates', ['Anna']],
      ['Inactive', ['Steve']],
    ]);
  });

  test('labels', () => {
    assert.equal(personLabel(JAY), 'Jay (Emeritus)');
    assert.equal(personLabel(STEVE), 'Steve (Partner, inactive)');
    assert.equal(originatorLabel({ originator: KEVIN, originator_is_firm: false }), 'Kevin');
    assert.equal(originatorLabel({ originator: KEVIN, originator_is_firm: true }), 'Firm (originated by Kevin)');
    assert.equal(originatorLabel({ originator: null, originator_is_firm: true }), 'Firm');
    assert.equal(originatorLabel({ originator: null, client_originator: 'Steve' }), 'Steve');
    assert.equal(originatorLabel({}), '');
  });

  test('legacyPeopleFields matches legacyText for the same selections', () => {
    const selection = { lead_id: '1', second_chair_id: '3', originator_id: '5', originator_is_firm: false };
    assert.deepEqual(legacyPeopleFields(selection, ROSTER),
      legacyText({ lead: KEVIN, secondChair: JAY, originator: STEVE, originatorIsFirm: false }));
    assert.deepEqual(legacyPeopleFields({ lead_id: '', originator_is_firm: true }, ROSTER),
      { primary_lobbyist: '', lobbyist_team: [], client_originator: 'Firm' });
  });

  test('toPersonId', () => {
    assert.equal(toPersonId('4'), 4);
    assert.equal(toPersonId(''), null);
    assert.equal(toPersonId('none'), null);
  });
});
