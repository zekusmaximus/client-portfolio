# Product Brief — Partner Book Cockpit

*A north-star document. Short on purpose. We point back here when a feature or a
weight argument threatens to pull us off course.*

---

## What this is

A low-friction cockpit for a six-partner government-relations firm to **see the
health of its book and ask questions about it** — not a CRM to feed and
maintain. You log on to glance at whether the book is balanced, ask the AI
something, or sandbox how a new client would plug in. Then you close it.

If using it ever feels like data entry, we've built the wrong thing.

## Who it's for

Six **equal** partners. No hierarchy, no admin, no roles. One shared book,
shared definitions, everyone sees everything. The tool's job is to make the
shared picture legible and answerable, so six peers can make staffing,
retention, and (eventually) compensation conversations from the same facts.

## Principles

1. **Look-and-ask over enter-and-maintain.** The default state is reading.
2. **The partner is the unit of decision**, not the client — because the value
   *is* the relationship, and relationships aren't fungible. We surface
   imbalances and candidates; humans decide the moves.
3. **Every client costs ~two quick picks**, from short lists with concrete
   words. Revenue comes from import. Nothing requires a number nobody can
   intuit.
4. **Anything worth knowing is answerable in plain language** by the AI.
5. **No weight committee.** The client score is a legible label, not a control
   surface six peers have to negotiate.

## The mental model — three axes + a flag

Every client sits on three axes, each captured by **one intuitive input**:

| Axis | What it means | How it's set |
|------|---------------|--------------|
| **Value** | Revenue at stake | Imported — no entry |
| **Effort** | How much work the client takes | **Contact cadence**: Daily / Weekly / Monthly / Quarterly / As-needed |
| **Stickiness** | How locked-in the relationship is (flight risk) | **One scale, concrete anchors** (below) |

Plus **Conflict** (Low / Medium / High) as a separate risk flag.

**The stickiness scale** (replaces today's three overlapping retention fields —
`relationship_strength`, `relationship_intensity`, `renewal_probability` — with
one fast pick):

- **Personal bond — won't leave** *(the high-school-roommate client)*
- **Strong, established**
- **Solid but transactional**
- **New / still shallow**
- **Cold — never met in person** *(the cold-call client)*

## What the tool shows you (three glanceable truths)

1. **Who's carrying what.** Per-partner revenue, effort-load (sum of cadence
   weights, *not* raw client count), and revenue-per-effort. Mike's
   low-revenue / high-contact book shows up on sight — you don't compute it.
2. **Where the exposure is.** High revenue sitting on thin relationships =
   the firm's flight risk. (Value × low stickiness = revenue at risk.) This is
   the most actionable single signal the tool produces.
3. **Where a new client fits.** A what-if sandbox: type a name, rough revenue,
   practice area, expected cadence → see where it lands on the map, which
   partner has the practice-area fit *and* the capacity, how it tips their
   balance, and any conflict flag. Nothing saved unless you want it.

Plus a persistent **Ask the AI** box with the per-partner picture loaded into
context ("Is Mike overloaded?", "Who's the natural home for a $300k healthcare
client?", "Where's our biggest retention risk?").

## What it deliberately does NOT do

- **No automated swap optimizer.** It flags imbalances and suggests *candidates*;
  it never tells you to move a specific client. Reassigning a relationship can
  destroy the value it's trying to balance.
- **No compensation math.** It can *surface the inputs* a comp conversation
  needs — origination credit (`client_originator`) vs. servicing load
  (`primary_lobbyist` / team) — but it won't compute a number. Those formulas
  are firm politics and change yearly; automating them bakes in false authority.
- **No weight-tuning UI.** See principle 5.

## The client "strategic value" score — its role

A fixed, legible label that ranks clients and feeds the "high-value" tier used
across the app. It is **supporting cast**, not the product. We keep one formula
(in `utils/strategic.cjs`), show its components when displayed ("Revenue 5.0 +
Stickiness 2.8 − Conflict 1"), and we do **not** litigate its weights. The
decisions that matter come from the partner view, which needs zero tuning.

## Build path (rough, value-first)

1. **Effort + stickiness foundation.** Turn contact cadence into a real effort
   number; collapse the three retention fields into the one stickiness pick.
   Update the score to use it. *(Small; unlocks everything below.)*
2. **Book-at-a-glance home.** Six partner lanes + the value×effort map colored
   by partner. The imbalance and the exposure become visible.
3. **Plug-in-a-client what-if.** The sandbox.
4. **Smarter Ask.** Load per-partner aggregates into the AI context.
5. *(Later, maybe)* Comp-input surfacing; richer redistribution candidates.

Much of the plumbing exists already — per-partner aggregation, capacity, a
redistribution modeler — so step 2 is assembly more than invention.

## Open questions

- **Confirm the retention consolidation.** Collapsing `relationship_strength` +
  `relationship_intensity` + `renewal_probability` into one stickiness scale
  changes the score's inputs. Agreed in principle here; flagging because it
  touches the formula.
- **Does effort need anything beyond cadence?** (e.g., a "this one's a handful"
  flag for the rare high-maintenance client whose cadence understates the work.)
- **Capacity baseline.** What's a "full" book for one partner, in effort terms?
  Needed before the balance flags mean anything.
