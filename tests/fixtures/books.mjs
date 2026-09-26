// The fixture book of tests/load.test.mjs, shared with tests/book.test.mjs so
// the server's port (utils/book.cjs) is held to the page's partnershipModel on
// exactly the books the page's own tests use.

export const person = (id, name, role, active = true) => ({ id, name, role, active });

export const PEOPLE = [
  person(1, 'Brendan', 'partner'), person(2, 'Jeff', 'partner'), person(3, 'Joe', 'partner'),
  person(4, 'Kevin', 'partner'), person(5, 'Mike', 'partner'), person(6, 'Paula', 'partner'),
  person(7, 'Jay', 'emeritus'), person(8, 'Anna', 'associate'), person(9, 'Ben', 'associate'),
  person(10, 'Steve', 'partner', false),
];
const byId = new Map(PEOPLE.map((p) => [p.id, p]));

// A client as the API sends it: lead and secondChair nested, effort computed
let nextId = 1;
export const client = (leadId, secondId, amounts, effort = 2) => ({
  id: nextId++,
  name: `Client ${nextId}`,
  lead: leadId ? byId.get(leadId) : null,
  secondChair: secondId ? byId.get(secondId) : null,
  effort,
  revenues: Object.entries(amounts).map(([year, amount]) => ({ year: Number(year), revenue_amount: String(amount) })),
});

export const CLIENTS = [
  client(4, 7, { 2025: 50000, 2026: 60000 }, 3),     // Kevin lead, Jay second
  client(4, 8, { 2026: 40000 }, 4.5),                 // Kevin lead, Anna second
  client(6, 8, { 2025: 20000, 2026: 30000 }, 2),     // Paula lead, Anna second
  client(6, null, { 2026: 10000 }, 1),                // Paula lead, no second chair
  client(1, 4, { 2026: 20000 }, 2),                   // Brendan lead, Kevin second
  client(null, null, { 2026: 5000 }, 1),              // no lead (saved before the People list)
];
