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
| **Effort** | How much work the client takes | **Contact cadence**: Daily / Weekly / Monthly / Quarterly / As-needed — plus an optional **"handful" flag** (see below) |
| **Stickiness** | How locked-in the relationship is (flight risk) | **One scale, concrete anchors** (below) |

Plus **Conflict** (Low / Medium / High) as a separate risk flag.

**The "handful" flag.** Cadence captures *how often* you touch a client, not
*how heavy each touch is*. For the rare client whose every interaction is a fire
drill, a single optional checkbox bumps their effort weight above what cadence
implies. Default off — it's the exception, not a field to fill in on everyone.
Keeps effort honest without adding a second slider to every client.

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
   **Balance is relative, not absolute:** each partner is compared to the
   six-partner average/median, not to a fixed "full book" ceiling. Off-balance
   = an outlier from the pack. (See "How balance is defined.")
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

## How "balanced" is defined

**Peer-relative, no anchor.** There is no objective "full book" number, and we
don't ask the partners to invent one. Each partner's effort, revenue, and
revenue-per-effort are compared to the group (six-partner average/median). The
signal is the *spread*: who's an outlier above or below the pack. With only six,
this is mostly a glance at six bars against a reference line.

- Pro: needs no subjective capacity ceiling; suits six equals; directly answers
  "who's carrying more than their share."
- The one blind spot: it can't tell you if *all six* are collectively
  overloaded (even-but-drowning reads as "balanced"). If that ever matters,
  we add it as a **trend** signal ("total load up 30% since spring"), never as
  a forced anchor.

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
(in `utils/strategic.cjs`) and we do **not** litigate its weights. The decisions
that matter come from the partner view, which needs zero tuning.

Post-consolidation the formula has just **two weighted terms minus a penalty**:

```
strategicValue = Value(revenue) × W1  +  Stickiness × W2  −  Conflict penalty
```

where Stickiness is the 5-point scale mapped to 0–10 (Personal bond = 10 …
Cold = 0). This replaces the three retention inputs that fed the old formula
(`relationship_strength`, `renewal_probability`) with the single stickiness
pick. Shown with its parts when displayed ("Revenue 5.0 + Stickiness 2.8 −
Conflict 1") so it reads itself.

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

## Resolved decisions

- **Retention consolidation — confirmed.** `relationship_strength` +
  `relationship_intensity` + `renewal_probability` collapse into the one
  stickiness scale. The score becomes Value + Stickiness − Conflict (above).
  *(Build note: existing rows need a one-time migration to derive stickiness;
  the three old columns can then be retired.)*
- **"Handful" flag — confirmed.** Optional per-client checkbox that bumps effort
  above what cadence implies. Default off.
- **Balancing — peer-relative, no anchor.** See "How balance is defined."

## Open questions

- None blocking. Next decisions surface during the step-1 build (e.g., the exact
  cadence→effort weights and the stickiness 0–10 mapping — both easy to tune
  once the partner view makes their effect visible).
