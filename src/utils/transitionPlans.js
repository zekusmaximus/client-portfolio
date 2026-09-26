// Scenarios' Stage 2 and Stage 3 (docs/plans/people-and-second-chair.md,
// Phase 5): the roster a transition-plan request carries, the import sheet the
// accepted plan exports, and Stage 3's transitions. Pure: the departure model
// (./departure.js) and the plans in, plain objects and text out.
//
// A client's plan is its entry in the store's transitionPlans (the AI's
// answer, the timeline, the status) together with its seats: the lead and the
// second chair the departure model applies for it, the partner's choices over
// the engine's candidates. Approving a plan pins its seats as choices, so a
// later pick on another client cannot move them.

import { personLabel } from './people.js';
import { unescapeStored } from './escaping.js';

const key = (id) => String(id);

/**
 * The people who are staying, with their lead and second-chair loads as the
 * Partnership tab computes them (the departure model's `before`): the roster
 * POST /api/scenarios/transition-plan checks and the prompt lists.
 */
export function rosterFor(departure) {
  const leaving = new Set(departure.departing.map((p) => key(p.id)));
  const load = (l) => ({ count: l.count, revenue: l.revenue, effort: Math.round(l.effort * 100) / 100 });
  return departure.before.rows
    .filter((r) => r.person.active && !leaving.has(key(r.person.id)))
    .map((r) => ({ name: r.person.name, role: r.person.role, lead: load(r.lead), second: load(r.second) }));
}

/** The request body for one client's transition plan. */
export function planRequest(decision, departure, reportingYear) {
  return {
    client: decision.client,
    stage1Data: {
      departing: departure.departing.map((p) => ({ name: p.name, role: p.role })),
      impactData: { totalRevenueAtRisk: departure.totals.revenue },
      reportingYear,
    },
    roster: rosterFor(departure),
  };
}

/** The choice that pins a decision's seats as they stand: { leadId, secondChairId }. */
export function pinnedChoice(decision) {
  const choice = { secondChairId: decision.secondChair.after ? decision.secondChair.after.id : null };
  if (decision.lead.needed && decision.lead.after) choice.leadId = decision.lead.after.id;
  return choice;
}

/**
 * Why a decision cannot be approved, or null: a client needs a lead, and a
 * pick the model refused must be settled first.
 */
export function approvalBlocker(decision) {
  if (!decision.lead.after) return 'No active partner who is staying can lead this client.';
  if (decision.lead.problem) return `The lead you picked was not applied: ${decision.lead.problem}`;
  if (decision.secondChair.problem) return `The second chair you picked was not applied: ${decision.secondChair.problem}`;
  return null;
}

/** One import-sheet cell: quoted when it holds a comma, a quote or a line break, and nothing else, so the import reads the name exactly. */
export function sheetCell(text) {
  const value = String(text ?? '');
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The accepted plan as an import sheet (plan section 3): CLIENT, Lead, Second
 * Chair, one row per approved client, the seats as the departure model
 * applies them. A blank Second Chair clears the seat, so a kept second chair
 * is written out. An approved plan the model can no longer apply (no lead, or
 * a pinned pick that someone now leaving holds) is left out, with the reason.
 * A client's name is written unescaped: the API returns a name the client form
 * saved as sanitizeRequestBody stored it (`Barnes &amp; Noble`), and the import
 * refuses a CLIENT holding a `;`, so the sheet spells it as a partner would.
 * @returns {{ csv: string, rows: Array<{ client, lead, secondChair }>, skipped: Array<{ client, reason }> }}
 */
export function buildTransitionSheet(decisions = [], plans = {}) {
  const rows = [];
  const skipped = [];
  for (const d of decisions) {
    if (plans[key(d.client.id)]?.status !== 'approved') continue;
    const blocker = approvalBlocker(d);
    if (blocker) {
      skipped.push({ client: d.client, reason: blocker });
      continue;
    }
    rows.push({ client: d.client, lead: d.lead.after, secondChair: d.secondChair.after });
  }
  const clientName = (r) => unescapeStored(String(r.client.name ?? ''));
  rows.sort((a, b) => clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' }));
  const lines = [
    'CLIENT,Lead,Second Chair',
    ...rows.map((r) => [clientName(r), r.lead.name, r.secondChair ? r.secondChair.name : ''].map(sheetCell).join(',')),
  ];
  return { csv: `${lines.join('\r\n')}\r\n`, rows, skipped };
}

/**
 * Who among the people leaving still holds a seat once the sheet is applied:
 * the seats on the clients the sheet leaves out. [{ person, clients }], empty
 * when everyone leaving can be deactivated on the People list (P5).
 */
export function seatsLeftAfterSheet(departure, sheetRows = []) {
  const inSheet = new Set(sheetRows.map((r) => key(r.client.id)));
  return departure.departing
    .map((person) => ({
      person,
      clients: departure.decisions
        .filter((d) => !inSheet.has(key(d.client.id)))
        .filter((d) => key(d.lead.before?.id) === key(person.id) || key(d.secondChair.before?.id) === key(person.id))
        .map((d) => d.client),
    }))
    .filter((entry) => entry.clients.length > 0);
}

/** Download the sheet as transition_sheet_<date>.csv, without a BOM, as the import reads it. */
export function exportTransitionSheet(csv, now = new Date()) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transition_sheet_${now.toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

const changed = (side) => !!side.before && key(side.before.id) !== key(side.after?.id);

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
};

/**
 * Stage 3's transitions from the approved plans, keeping what the partner
 * already recorded: a transition already under way keeps its start date and
 * status, its tasks and its client's communications; a client no longer
 * approved is dropped with its tasks. Everything shown comes from the plan or
 * the partner: the end date only when the plan has a timeline, a task's due
 * date only once someone sets it, and no retention or duration estimate.
 * `today` is 'YYYY-MM-DD'.
 * @returns {{ transitions: Array, tasks: Array }}
 */
export function syncTransitions({ decisions = [], plans = {}, transitions = [], tasks = [], today }) {
  const existing = new Map(transitions.map((t) => [key(t.clientId), t]));
  const next = [];
  const newTasks = [];
  for (const d of decisions) {
    const clientId = key(d.client.id);
    const plan = plans[clientId];
    if (plan?.status !== 'approved' || approvalBlocker(d)) continue;
    const kept = existing.get(clientId);
    const timelineDays = Number.isInteger(plan.timelineDays) && plan.timelineDays > 0 ? plan.timelineDays : null;
    const startDate = kept?.startDate || today;
    next.push({
      clientId,
      clientName: d.client.name,
      successionRisk: d.client.successionRisk ?? null,
      // Who held each seat before, only where the seat changes hands
      leadBefore: changed(d.lead) ? personLabel(d.lead.before) : null,
      secondChairBefore: changed(d.secondChair) ? personLabel(d.secondChair.before) : null,
      lead: d.lead.after.name,
      secondChair: d.secondChair.after ? d.secondChair.after.name : null,
      timelineDays,
      startDate,
      endDate: timelineDays ? addDays(startDate, timelineDays) : null,
      status: kept?.status || 'in-progress',
    });
    if (!kept) {
      (Array.isArray(plan.tasks) ? plan.tasks : []).forEach((title, index) => {
        newTasks.push({
          id: `${clientId}-${index}`,
          title,
          description: '',
          assignee: d.lead.after.name,
          dueDate: '',
          priority: 'medium',
          status: 'pending',
          clientId,
          category: 'transition',
        });
      });
    }
  }
  const live = new Set(next.map((t) => t.clientId));
  return {
    transitions: next,
    tasks: [...tasks.filter((t) => !t.clientId || live.has(key(t.clientId))), ...newTasks],
  };
}

/** Stage 3's counts, from the transitions and tasks as recorded. */
export function executionSummary(transitions = [], tasks = [], today) {
  const count = (status) => transitions.filter((t) => t.status === status).length;
  return {
    totalTransitions: transitions.length,
    completedTransitions: count('completed'),
    inProgressTransitions: count('in-progress'),
    atRiskTransitions: count('at-risk'),
    delayedTransitions: count('delayed'),
    totalTasks: tasks.length,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    overdueTasks: tasks.filter((t) => t.status !== 'completed' && t.dueDate && today && t.dueDate < today).length,
  };
}
