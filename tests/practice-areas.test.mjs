// src/utils/practiceAreas.js (docs/plans/tier-3.md, section 18, WP13): the
// picker's choices (U47), the other clients in the same areas (U42), Client
// Details' Practice Area sort and filter (U48 (a) and (b)), and the charts'
// groups and colours (U45 (a), candidate (ag)). The list itself, and its two
// copies held equal, are tests/client-rules.test.mjs's.
// Pure: never import db.cjs, data.cjs, models/*, a route file or utils/jwt.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import clientRules from '../utils/clientRules.cjs';
import {
  PRACTICE_AREAS,
  RETIRED_PRACTICE_AREAS,
  PRACTICE_AREA_GROUPS,
  NOT_SET,
  OTHER_GROUP,
  FILTER_ALL,
  FILTER_NONE,
  CHART_GROUPS,
  GROUP_COLORS,
  GROUP_SHAPES,
  isRetired,
  areaRank,
  orderAreas,
  pickerGroups,
  withArea,
  withoutArea,
  sameAreaClients,
  clientAreaRank,
  compareByArea,
  matchesPracticeAreaFilter,
  groupOf,
  clientGroup,
  areaRevenue,
  groupRevenue,
  clientsByArea,
  legendGroups,
} from '../src/utils/practiceAreas.js';
import { matchesPersonFilter } from '../src/utils/people.js';
import { clientFormData, clientRequestBody } from '../src/utils/clientForm.js';
import { validateClientForm, sanitizeFormData } from '../src/utils/validation.js';

const P = (id, name, role = 'partner') => ({ id, name, role, active: true });
const KEVIN = P(4, 'Kevin');
const PAULA = P(6, 'Paula');
const ANNA = P(8, 'Anna', 'associate');

// Clients as the API sends them: practiceArea, the nested lead and second chair
const C = (id, name, practiceArea, { lead = KEVIN, secondChair = null, revenue = 0 } = {}) => ({
  id, name, practiceArea, practice_area: practiceArea, lead, secondChair, revenue,
});
const BOOK = [
  C(1, 'Alder Health', ['Healthcare'], { revenue: 100 }),
  C(2, 'birch Services', ['Human Services', 'Justice and Legal'], { lead: PAULA, revenue: 40 }),
  C(3, 'Cedar Hall', ['Justice and Legal'], { lead: null, revenue: 30 }),
  // Four tags, stored in pick order: matched by any, the fourth included
  C(4, 'Dogwood Group', ['Energy', 'Arts and Culture', 'Municipal', 'Cannabis and Tobacco'], { secondChair: ANNA, revenue: 20 }),
  C(5, 'Elm Fund', [], { revenue: 10 }),
  C(6, 'Fir Works', ['Corporate', 'Healthcare'], { lead: PAULA, revenue: 5 }),
  C(7, 'Gum Trust', ['Corporate'], { revenue: 3 }),
  C(8, 'Hazel Co', ['Other'], { revenue: 2 }),
  { id: 'a9', name: 'Ivy Ltd', practice_area: null, lead: PAULA, secondChair: null, revenue: 1 },
];
const revenueOf = (c) => c.revenue;

test('the groups: seven named, then Other under none; each name once, each area in exactly one group, flattened the server\'s 21', () => {
  const named = PRACTICE_AREA_GROUPS.filter((g) => g.name);
  assert.equal(named.length, 7);
  assert.deepEqual(named.map((g) => g.name), [
    'Health and Human Services', 'Financial Services', 'Energy and Environment', 'Built Environment and Transportation',
    'Public Sector', 'Business and Consumer', 'Arts, Media and Culture',
  ]);
  assert.equal(new Set(named.map((g) => g.name)).size, 7);
  assert.deepEqual(PRACTICE_AREA_GROUPS.at(-1), { name: null, areas: ['Other'] });
  const flat = PRACTICE_AREA_GROUPS.flatMap((g) => g.areas);
  assert.equal(new Set(flat).size, flat.length, 'each area in one group');
  assert.deepEqual(flat, clientRules.PRACTICE_AREAS);
  assert.deepEqual(PRACTICE_AREAS, clientRules.PRACTICE_AREAS);
  assert.deepEqual(RETIRED_PRACTICE_AREAS, clientRules.RETIRED_PRACTICE_AREAS);
  for (const area of RETIRED_PRACTICE_AREAS) assert.equal(isRetired(area), true, area);
  for (const area of PRACTICE_AREAS) assert.equal(isRetired(area), false, area);
});

test('orderAreas: the 21 in list order, then a retired name, then any other by its text; each once; blanks dropped', () => {
  assert.deepEqual(orderAreas(['Technology', 'Corporate', 'Healthcare', 'Zoning', 'Energy', 'Healthcare', '', null, 7]),
    ['Healthcare', 'Energy', 'Technology', 'Corporate', 'Zoning']);
  assert.deepEqual(orderAreas(['Non-Profit', 'Financial', 'Environmental', 'Corporate']), RETIRED_PRACTICE_AREAS);
  assert.deepEqual(orderAreas([...PRACTICE_AREAS].reverse()), PRACTICE_AREAS);
  assert.deepEqual(orderAreas(undefined), []);
  assert.equal(areaRank('Healthcare'), 0);
  assert.equal(areaRank('Other'), 20);
  assert.equal(areaRank('Corporate'), 21);
  assert.equal(areaRank('Zoning'), 25);
});

test('the picker offers the 21 under their groups, never a retired name, and not what is chosen; a pick lands in list order; × removes any chip', () => {
  assert.deepEqual(pickerGroups([]), PRACTICE_AREA_GROUPS.map((g) => ({ name: g.name, areas: g.areas })));
  const offered = (chosen) => pickerGroups(chosen).flatMap((g) => g.areas);
  assert.deepEqual(offered([]), PRACTICE_AREAS);
  for (const chosen of [[], ['Corporate'], RETIRED_PRACTICE_AREAS, ['Healthcare', 'Financial']]) {
    assert.ok(!offered(chosen).some(isRetired), `no retired name offered: ${chosen}`);
  }
  // A chosen area is not offered again; a group with nothing left is gone
  const after = pickerGroups(['Banking and Finance', 'Insurance and Benefits', 'Healthcare']);
  assert.ok(!after.some((g) => g.name === 'Financial Services'));
  assert.deepEqual(after[0], { name: 'Health and Human Services', areas: ['Human Services', 'Senior Care'] });
  assert.deepEqual(pickerGroups(PRACTICE_AREAS), [], 'every area chosen: nothing to offer');

  // Picks land in list order, not pick order (18.9 trap 6), and a retired chip stays until its ×
  let chosen = ['Corporate'];
  chosen = withArea(chosen, 'Technology');
  chosen = withArea(chosen, 'Healthcare');
  assert.deepEqual(chosen, ['Healthcare', 'Technology', 'Corporate']);
  assert.deepEqual(withArea(chosen, 'Healthcare'), chosen, 'once');
  assert.deepEqual(withArea(chosen, 'Financial'), chosen, 'a retired name cannot be added');
  assert.deepEqual(withArea(chosen, 'Zoning'), chosen, 'nor a name off the list');
  assert.deepEqual(withoutArea(chosen, 'Corporate'), ['Healthcare', 'Technology']);
  assert.deepEqual(withoutArea(chosen, 'Technology'), ['Healthcare', 'Corporate']);
  // Two added, one removed, as a partner does in the form
  assert.deepEqual(withoutArea(withArea(withArea([], 'Water and Waste'), 'Municipal'), 'Water and Waste'), ['Municipal']);
});

test('a stored client holding a retired name: the form fills it, the page\'s check passes it, the save sends it; after its ×, the save sends the rest', () => {
  const stored = {
    id: 6, name: 'Fir Works', practiceArea: ['Corporate', 'Healthcare'], conflict_risk: 'Low', lead_id: 6, interaction_frequency: 'Monthly',
    stickiness: null, high_maintenance: false, notes: '', revenues: [{ year: 2026, revenue_amount: 5 }],
  };
  const form = clientFormData(stored);
  assert.deepEqual(form.practiceArea, ['Corporate', 'Healthcare']);
  // Saved for its Stickiness: no error, the retired name kept (U43 (b))
  const rated = { ...form, stickiness: 4 };
  assert.deepEqual(validateClientForm(rated), {});
  assert.deepEqual(clientRequestBody(sanitizeFormData(rated)).practice_area, ['Corporate', 'Healthcare']);
  assert.deepEqual(clientRules.checkClient({ ...clientRequestBody(sanitizeFormData(rated)), lead_id: 6 }), [], 'the server accepts it too');
  // The chip's ×, and a new area
  const retagged = { ...rated, practiceArea: withArea(withoutArea(rated.practiceArea, 'Corporate'), 'Professional Services') };
  assert.deepEqual(validateClientForm(retagged), {});
  assert.deepEqual(clientRequestBody(sanitizeFormData(retagged)).practice_area, ['Healthcare', 'Professional Services']);
  // A name off both lists (only SQL could store one) is still refused by both, as before
  const odd = { ...form, practiceArea: ['Zoning'] };
  assert.equal(validateClientForm(odd).practiceArea, 'Please select valid practice areas only');
  assert.equal(clientRules.checkClient({ ...clientRequestBody(odd), lead_id: 6 })[0].field, 'practice_area');
});

test('sameAreaClients: for each of the 21 picked, in list order, the other clients holding it by name with their lead; the client itself left out; a retired name not compared', () => {
  const { areas, notCompared } = sameAreaClients(BOOK, ['Justice and Legal', 'Healthcare', 'Corporate'], 6);
  assert.deepEqual(areas, [
    { area: 'Healthcare', clients: [{ id: 1, name: 'Alder Health', lead: 'Kevin' }] },
    { area: 'Justice and Legal', clients: [{ id: 2, name: 'birch Services', lead: 'Paula' }, { id: 3, name: 'Cedar Hall', lead: null }] },
  ], 'Fir Works (the client itself, id 6) left out of Healthcare; by name regardless of case; no lead is null');
  assert.deepEqual(notCompared, ['Corporate'], 'Gum Trust also holds Corporate and is not listed');
  // A client holding two of the areas is listed under each
  const both = sameAreaClients(BOOK, ['Human Services', 'Justice and Legal']).areas;
  assert.deepEqual(both.map((a) => [a.area, a.clients.map((c) => c.id)]), [['Human Services', [2]], ['Justice and Legal', [2, 3]]]);
  // The fourth tag counts as any other; an area nobody else holds is an empty list
  assert.deepEqual(sameAreaClients(BOOK, ['Cannabis and Tobacco', 'Senior Care']).areas,
    [{ area: 'Senior Care', clients: [] }, { area: 'Cannabis and Tobacco', clients: [{ id: 4, name: 'Dogwood Group', lead: 'Kevin' }] }]);
  // The id compared as text (a uuid or production's integer)
  assert.deepEqual(sameAreaClients(BOOK, ['Healthcare'], '1').areas[0].clients.map((c) => c.id), [6]);
  assert.deepEqual(sameAreaClients(BOOK, []), { areas: [], notCompared: [] });
  assert.deepEqual(sameAreaClients([], ['Energy']), { areas: [{ area: 'Energy', clients: [] }], notCompared: [] });
});

test('the Practice Area sort: by each client\'s first area in list order, then by name; untagged last; ↓ the reverse', () => {
  const up = [...BOOK].sort(compareByArea).map((c) => c.name);
  assert.deepEqual(up, [
    'Alder Health', // Healthcare
    'Fir Works', // Healthcare (its Corporate comes after in list order)
    'birch Services', // Human Services
    'Dogwood Group', // Energy, its first in list order, though stored first too
    'Cedar Hall', // Justice and Legal
    'Hazel Co', // Other
    'Gum Trust', // a retired name, after the 21
    'Elm Fund', // no area, last, by name
    'Ivy Ltd',
  ]);
  const down = [...BOOK].sort((a, b) => compareByArea(b, a)).map((c) => c.name);
  assert.deepEqual(down, [...up].reverse());
  assert.equal(clientAreaRank(BOOK[3]), areaRank('Energy'));
  assert.equal(clientAreaRank(BOOK[4]), clientAreaRank(BOOK[8]), 'no area: [] and null alike');
  assert.ok(clientAreaRank(BOOK[4]) > clientAreaRank(BOOK[6]));
  // Ties by name regardless of case, then id as text
  const twins = [C('b', 'Same', ['Energy']), C('a', 'same', ['Energy'])];
  assert.deepEqual([...twins].sort(compareByArea).map((c) => c.id), ['a', 'b']);
});

test('the Practice Area filter: every client holding the area, whichever tag; "none" the untagged; "all" everyone', () => {
  const listed = (filter, clients = BOOK) => clients.filter((c) => matchesPracticeAreaFilter(c, filter)).map((c) => c.name);
  // A client matched by its fourth tag, as by its first
  assert.deepEqual(listed('Cannabis and Tobacco'), ['Dogwood Group']);
  assert.deepEqual(listed('Energy'), ['Dogwood Group']);
  assert.deepEqual(listed('Municipal'), ['Dogwood Group']);
  // A client with two areas, matched by either
  assert.deepEqual(listed('Human Services'), ['birch Services']);
  assert.deepEqual(listed('Justice and Legal'), ['birch Services', 'Cedar Hall']);
  // Not the first tag only: Healthcare holds Fir Works, whose first stored tag is Corporate
  assert.deepEqual(listed('Healthcare'), ['Alder Health', 'Fir Works']);
  assert.deepEqual(listed(FILTER_NONE), ['Elm Fund', 'Ivy Ltd']);
  assert.deepEqual(listed(FILTER_ALL), BOOK.map((c) => c.name));
  assert.deepEqual(listed(undefined), BOOK.map((c) => c.name));
  assert.deepEqual(listed('Senior Care'), []);
  // An exact name: no partial or case-folded match
  assert.deepEqual(listed('Health'), []);
  assert.deepEqual(listed('healthcare'), []);
  // A retired name is never offered as a filter; one matches only as stored
  assert.deepEqual(listed('Corporate'), ['Fir Works', 'Gum Trust']);
});

test('the filter with the people filters and the sort, as Client Details runs them', () => {
  // ClientListView: every filter must match, then the sort
  const view = ({ area = FILTER_ALL, lead = 'all', second = 'all', sort = 'asc' }) => BOOK
    .filter((c) => matchesPersonFilter(c.lead, lead) && matchesPersonFilter(c.secondChair, second) && matchesPracticeAreaFilter(c, area))
    .sort((a, b) => (sort === 'asc' ? compareByArea(a, b) : compareByArea(b, a)))
    .map((c) => c.name);
  assert.deepEqual(view({ area: 'Healthcare', lead: String(PAULA.id) }), ['Fir Works']);
  assert.deepEqual(view({ area: 'Justice and Legal', lead: 'none' }), ['Cedar Hall']);
  assert.deepEqual(view({ area: 'Arts and Culture', second: String(ANNA.id) }), ['Dogwood Group']);
  assert.deepEqual(view({ area: 'Arts and Culture', second: 'none' }), []);
  assert.deepEqual(view({ area: FILTER_NONE, lead: String(PAULA.id) }), ['Ivy Ltd']);
  // Sorting by Practice Area groups whatever the filter shows
  assert.deepEqual(view({ lead: String(KEVIN.id) }), ['Alder Health', 'Dogwood Group', 'Hazel Co', 'Gum Trust', 'Elm Fund']);
  assert.deepEqual(view({ lead: String(KEVIN.id), sort: 'desc' }), ['Elm Fund', 'Gum Trust', 'Hazel Co', 'Dogwood Group', 'Alder Health']);
  assert.deepEqual(view({ area: 'Healthcare', sort: 'desc' }), ['Fir Works', 'Alder Health']);
});

test('groups for the charts: an area\'s group, Other for Other and a retired name, Not set for no area; a client by its first area in list order', () => {
  assert.equal(groupOf('Healthcare'), 'Health and Human Services');
  assert.equal(groupOf('Cannabis and Tobacco'), 'Business and Consumer');
  assert.equal(groupOf('Other'), OTHER_GROUP);
  for (const area of [...RETIRED_PRACTICE_AREAS, 'Zoning']) assert.equal(groupOf(area), OTHER_GROUP, area);
  assert.equal(clientGroup(BOOK[3]), 'Energy and Environment', 'Energy, first in list order');
  assert.equal(clientGroup(BOOK[5]), 'Health and Human Services', 'Healthcare before the retired Corporate');
  assert.equal(clientGroup(BOOK[6]), OTHER_GROUP);
  assert.equal(clientGroup(BOOK[4]), NOT_SET);
  assert.equal(clientGroup(BOOK[8]), NOT_SET);
  assert.deepEqual(CHART_GROUPS, [...PRACTICE_AREA_GROUPS.filter((g) => g.name).map((g) => g.name), 'Other', 'Not set']);
});

test('the colours: the dataviz skill\'s reference slots 1 to 7 in order for the seven groups, two neutrals for Other and Not set; a shape each for the scatters', () => {
  assert.deepEqual(Object.keys(GROUP_COLORS), CHART_GROUPS);
  assert.deepEqual(CHART_GROUPS.slice(0, 7).map((g) => GROUP_COLORS[g]),
    ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']);
  assert.deepEqual([GROUP_COLORS.Other, GROUP_COLORS[NOT_SET]], ['#898781', '#c3c2b7']);
  assert.equal(new Set(Object.values(GROUP_COLORS)).size, 9);
  assert.equal(new Set(CHART_GROUPS.slice(0, 7).map((g) => GROUP_SHAPES[g])).size, 7, 'the seven groups, seven shapes');
  assert.deepEqual(legendGroups(['Not set', 'Other', 'Public Sector', 'Public Sector']).map((g) => g.group), ['Public Sector', 'Other', 'Not set']);
});

test('areaRevenue: revenue by area, a client under each area, one with none under Not set; largest first, Not set last; a retired name coloured as Other', () => {
  const bars = areaRevenue(BOOK, revenueOf);
  assert.deepEqual(bars.map((b) => [b.area, b.revenue, b.count]), [
    ['Healthcare', 105, 2],
    ['Human Services', 40, 1],
    ['Justice and Legal', 70, 2],
    ['Energy', 20, 1],
    ['Municipal', 20, 1],
    ['Cannabis and Tobacco', 20, 1],
    ['Arts and Culture', 20, 1],
    ['Corporate', 8, 2],
    ['Other', 2, 1],
    ['Not set', 11, 2],
  ].sort((a, b) => (a[0] === 'Not set') - (b[0] === 'Not set') || b[1] - a[1] || areaRank(a[0]) - areaRank(b[0])));
  assert.equal(bars.at(-1).area, NOT_SET);
  const corporate = bars.find((b) => b.area === 'Corporate');
  assert.deepEqual([corporate.group, corporate.color, corporate.retired], [OTHER_GROUP, GROUP_COLORS.Other, true]);
  assert.equal(bars.find((b) => b.area === 'Healthcare').color, GROUP_COLORS['Health and Human Services']);
  assert.equal(bars.find((b) => b.area === NOT_SET).color, GROUP_COLORS[NOT_SET]);
});

test('Stage 1: the pie by group, each client once; the breakdown by area with an untagged client under Not set (candidate (ag))', () => {
  const pie = groupRevenue(BOOK, revenueOf);
  assert.deepEqual(pie.map((g) => [g.group, g.revenue, g.count]), [
    ['Health and Human Services', 145, 3],
    ['Energy and Environment', 20, 1],
    ['Public Sector', 30, 1],
    ['Other', 5, 2],
    ['Not set', 11, 2],
  ]);
  assert.equal(pie.reduce((s, g) => s + g.revenue, 0), BOOK.reduce((s, c) => s + c.revenue, 0), 'the slices add up to the revenue');
  const breakdown = clientsByArea(BOOK);
  assert.deepEqual(breakdown.map((a) => [a.area, a.clients.map((c) => c.id)]), [
    ['Healthcare', [1, 6]],
    ['Human Services', [2]],
    ['Energy', [4]],
    ['Municipal', [4]],
    ['Justice and Legal', [2, 3]],
    ['Cannabis and Tobacco', [4]],
    ['Arts and Culture', [4]],
    ['Other', [8]],
    ['Corporate', [6, 7]],
    ['Not set', [5, 'a9']],
  ]);
  // The API sends [] for a client with no area: until WP13 Stage 1's
  // `client.practiceArea || ['Other']` let it through and it counted nowhere
  assert.deepEqual(clientsByArea([C(1, 'Bare', [])]).map((a) => a.area), [NOT_SET]);
});

test('the page offers the list from one place: no component keeps its own copy of the areas', () => {
  for (const file of ['src/ClientEnhancementForm.jsx', 'src/DataUploadManager.jsx', 'src/components/succession/ClientSandbox.jsx',
    'src/components/succession/HireScenario.jsx', 'src/ClientListView.jsx', 'src/DashboardView.jsx', 'src/components/succession/ImpactAnalysisWorkbench.jsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const name of ['Human Services', 'Corporate', 'Financial', 'Environmental', 'Non-Profit']) {
      assert.ok(!source.includes(`'${name}'`), `${file} names '${name}'`);
    }
  }
});
