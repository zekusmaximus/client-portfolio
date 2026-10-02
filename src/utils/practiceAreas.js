// Practice areas on the page (docs/plans/tier-3.md, section 18, WP13): the
// picker's choices, the other clients in the same areas, the Client Details
// sort and filter, and the charts' groups and colours. Pure: no store, no
// React; tests/practice-areas.test.mjs covers it.
//
// The list is src/utils/validation.js's (held equal to utils/clientRules.cjs):
// the 21 areas in seven groups, which is what the page offers, and the four
// names the list retired, which a client may still hold (there is no retag,
// U46 (b)) and every write still accepts (U43 (b)), but nothing offers.
import { PRACTICE_AREAS, RETIRED_PRACTICE_AREAS, PRACTICE_AREA_GROUPS } from './validation.js';
import { practiceAreasOf } from './load.js';

export { PRACTICE_AREAS, RETIRED_PRACTICE_AREAS, PRACTICE_AREA_GROUPS };

/** What a client with no practice area is called on the page: the filter, the charts and Stage 1. */
export const NOT_SET = 'Not set';

/** The group of Other, of a retired name and of a name off both lists. */
export const OTHER_GROUP = 'Other';

export const isRetired = (area) => RETIRED_PRACTICE_AREAS.includes(area);

// A name's place in list order: the 21 first, then a retired name in the
// retired list's order, then any other name (only direct SQL can store one),
// and a client with no area last of all
const RANK = new Map([...PRACTICE_AREAS, ...RETIRED_PRACTICE_AREAS].map((area, i) => [area, i]));
const UNKNOWN_RANK = RANK.size;
const NONE_RANK = RANK.size + 1;

/** An area's place in list order (`RANK`); any name off both lists after every listed one. */
export const areaRank = (area) => (RANK.has(area) ? RANK.get(area) : UNKNOWN_RANK);

const byText = (a, b) => {
  const x = String(a ?? '').toLowerCase();
  const y = String(b ?? '').toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Areas in list order (U44 (a): tags are equal, kept and shown in list
 * order): the 21 as the list orders them, then a retired name, then any other
 * name by its text; each once. Not text, or blank, is dropped.
 */
export function orderAreas(areas = []) {
  const unique = [...new Set((Array.isArray(areas) ? areas : []).filter((a) => typeof a === 'string' && a.trim() !== ''))];
  return unique.sort((a, b) => areaRank(a) - areaRank(b) || byText(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * What the picker's dropdown offers (U47): each group with the areas of the
 * 21 not yet chosen, in list order, a group with none left out. A retired
 * name is never offered. Other's group has no name (no heading).
 */
export function pickerGroups(chosen = []) {
  const taken = new Set(Array.isArray(chosen) ? chosen : []);
  return PRACTICE_AREA_GROUPS
    .map((group) => ({ name: group.name, areas: group.areas.filter((area) => !taken.has(area)) }))
    .filter((group) => group.areas.length > 0);
}

/**
 * The chosen areas with one more, in list order (the form appends in list
 * order, not pick order: 18.9 trap 6). Only one of the 21 can be added; a
 * retired name already held stays where orderAreas puts it.
 */
export function withArea(chosen = [], area) {
  const current = Array.isArray(chosen) ? chosen : [];
  if (!PRACTICE_AREAS.includes(area) || current.includes(area)) return orderAreas(current);
  return orderAreas([...current, area]);
}

/** The chosen areas without one (the chip's ×), retired or not; the rest as they were. */
export function withoutArea(chosen = [], area) {
  return (Array.isArray(chosen) ? chosen : []).filter((a) => a !== area);
}

/* ------------------------- other clients in the same areas -------------- */

/**
 * Other clients in the same areas (U42): for each of the 21 among `areas`,
 * in list order, the clients holding it, by name (regardless of case) then
 * id, each `{ id, name, lead }` (the lead's name, or null for none); a client
 * holding two of the areas is listed under each. The client itself
 * (`excludeId`, compared as text) is left out. A retired name is not compared
 * (the four are the breadth the list retired): it is in `notCompared`.
 * Nothing is flagged or ranked: sharing an area is not a conflict.
 * @returns {{ areas: Array<{ area, clients }>, notCompared: string[] }}
 */
export function sameAreaClients(clients = [], areas = [], excludeId = null) {
  const picked = orderAreas(areas);
  const exclude = excludeId === null || excludeId === undefined ? null : String(excludeId);
  const others = (Array.isArray(clients) ? clients : []).filter((c) => c && (exclude === null || String(c.id) !== exclude));
  const shown = picked.filter((area) => PRACTICE_AREAS.includes(area));
  return {
    areas: shown.map((area) => ({
      area,
      clients: others
        .filter((c) => practiceAreasOf(c).includes(area))
        .map((c) => ({ id: c.id, name: c.name, lead: c.lead?.name ?? null }))
        .sort((a, b) => byText(a.name, b.name) || byText(String(a.id), String(b.id))),
    })),
    notCompared: picked.filter((area) => !PRACTICE_AREAS.includes(area)),
  };
}

/* ------------------------- Client Details: the sort and the filter ------- */

/** A client's place for the Practice Area sort: its first area in list order, untagged last. */
export function clientAreaRank(client) {
  const [first] = orderAreas(practiceAreasOf(client));
  return first === undefined ? NONE_RANK : areaRank(first);
}

/**
 * The Practice Area sort (U48 (a)), ↑: by each client's first area in list
 * order, so each group's clients sit together, then by name (regardless of
 * case), then id; untagged last. ↓ is the reverse: `compareByArea(b, a)`.
 */
export function compareByArea(a, b) {
  return clientAreaRank(a) - clientAreaRank(b)
    || byText(a?.name, b?.name)
    || byText(String(a?.id ?? ''), String(b?.id ?? ''));
}

/** The filter's two fixed choices; any other value is an area's name. */
export const FILTER_ALL = 'all';
export const FILTER_NONE = 'none';

/**
 * The Practice Area filter (U48 (b)): `all`, every client; `none`, a client
 * with no area; an area's name, every client holding it, whichever of its
 * tags it is (`includes`, never the first tag only).
 */
export function matchesPracticeAreaFilter(client, filter = FILTER_ALL) {
  if (filter === FILTER_ALL || filter === undefined || filter === null || filter === '') return true;
  const areas = practiceAreasOf(client);
  if (filter === FILTER_NONE) return areas.length === 0;
  return areas.includes(filter);
}

/* ------------------------- the charts (U45 (a)) -------------------------- */

const GROUP_OF = new Map(PRACTICE_AREA_GROUPS.flatMap((g) => g.areas.map((area) => [area, g.name ?? OTHER_GROUP])));

/** An area's group: its group's name; Other for Other, a retired name or a name off both lists. */
export const groupOf = (area) => GROUP_OF.get(area) ?? OTHER_GROUP;

/** A client's group for a chart: the group of its first area in list order, or Not set. */
export function clientGroup(client) {
  const [first] = orderAreas(practiceAreasOf(client));
  return first === undefined ? NOT_SET : groupOf(first);
}

/** The charts' groups in legend order: the seven, then Other, then Not set. */
export const CHART_GROUPS = [...PRACTICE_AREA_GROUPS.filter((g) => g.name).map((g) => g.name), OTHER_GROUP, NOT_SET];

// The dataviz skill's reference categorical slots 1 to 7, in its fixed order
// (blue, orange, aqua, yellow, magenta, green, violet), for the seven groups
// in list order; Other takes the skill's muted ink and Not set its baseline
// gray, neutrals that read as "no group". Checked with the skill's
// validate_palette.js on the light chart surface: every adjacent pair passes;
// all pairs (a scatter) do not, so the scatters add a shape per group
// (GROUP_SHAPES). Aqua, yellow and magenta sit below 3:1 on the surface: the
// bars' labels and the tooltips are the relief.
export const GROUP_COLORS = Object.freeze(Object.fromEntries(CHART_GROUPS.map((group, i) => [
  group,
  ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#898781', '#c3c2b7'][i],
])));

// The scatters' second encoding: one Recharts symbol per group, the seven it
// has for the seven groups; Other and Not set are circles in their grays
export const GROUP_SHAPES = Object.freeze(Object.fromEntries(CHART_GROUPS.map((group, i) => [
  group,
  ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'wye', 'circle', 'circle'][i],
])));

/**
 * The Dashboard's bars (U45 (a)): reporting-year revenue by area, a client
 * counted under each of its areas (as the pie counted it) and one with none
 * under Not set; largest first, ties in list order, Not set last. Each
 * `{ area, group, color, revenue, count, retired }`.
 */
export function areaRevenue(clients = [], revenueOf = () => 0) {
  const byArea = new Map();
  for (const client of Array.isArray(clients) ? clients : []) {
    const areas = orderAreas(practiceAreasOf(client));
    const revenue = Number(revenueOf(client)) || 0;
    for (const area of areas.length > 0 ? areas : [NOT_SET]) {
      const entry = byArea.get(area) || { area, revenue: 0, count: 0 };
      entry.revenue += revenue;
      entry.count += 1;
      byArea.set(area, entry);
    }
  }
  const rank = (area) => (area === NOT_SET ? NONE_RANK : areaRank(area));
  return [...byArea.values()]
    .map((entry) => {
      const group = entry.area === NOT_SET ? NOT_SET : groupOf(entry.area);
      return { ...entry, group, color: GROUP_COLORS[group], retired: isRetired(entry.area) };
    })
    .sort((a, b) => (a.area === NOT_SET) - (b.area === NOT_SET) || b.revenue - a.revenue || rank(a.area) - rank(b.area) || byText(a.area, b.area));
}

/**
 * Revenue by group, each client once, under its clientGroup (Stage 1's pie of
 * the revenue at risk): `{ group, color, revenue, count }` in CHART_GROUPS
 * order, groups with no client left out.
 */
export function groupRevenue(clients = [], revenueOf = () => 0) {
  const byGroup = new Map();
  for (const client of Array.isArray(clients) ? clients : []) {
    const group = clientGroup(client);
    const entry = byGroup.get(group) || { group, color: GROUP_COLORS[group], revenue: 0, count: 0 };
    entry.revenue += Number(revenueOf(client)) || 0;
    entry.count += 1;
    byGroup.set(group, entry);
  }
  return CHART_GROUPS.filter((g) => byGroup.has(g)).map((g) => byGroup.get(g));
}

/**
 * Clients by area (Stage 1's breakdown): `{ area, group, color, clients }`
 * for each area held, in list order, a client under each of its areas, and
 * one with none under Not set, last (candidate (ag): until WP13 such a client
 * counted under no area).
 */
export function clientsByArea(clients = []) {
  const byArea = new Map();
  for (const client of Array.isArray(clients) ? clients : []) {
    const areas = orderAreas(practiceAreasOf(client));
    for (const area of areas.length > 0 ? areas : [NOT_SET]) {
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(client);
    }
  }
  const rank = (area) => (area === NOT_SET ? NONE_RANK : areaRank(area));
  return [...byArea.keys()]
    .sort((a, b) => rank(a) - rank(b) || byText(a, b))
    .map((area) => {
      const group = area === NOT_SET ? NOT_SET : groupOf(area);
      return { area, group, color: GROUP_COLORS[group], clients: byArea.get(area) };
    });
}

/** The groups a chart shows, in legend order: `[{ group, color, shape }]` for those present. */
export function legendGroups(groups = []) {
  const present = new Set(groups);
  return CHART_GROUPS.filter((g) => present.has(g)).map((group) => ({ group, color: GROUP_COLORS[group], shape: GROUP_SHAPES[group] }));
}
