import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, FilePlus, RotateCcw, UserPlus } from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import {
  CADENCES,
  CONFLICT_RISKS,
  PRACTICE_AREAS,
  clientDraft,
  clientFitModel,
  reasonText,
} from '../../utils/clientFit';
import { formatEffort, formatMoney, formatRatio, SECOND_CHAIR_EFFORT_SHARE } from '../../utils/load';
import { STICKINESS_LABELS } from '../../utils/exposure';
import { revenueForYear } from '../../utils/revenue';
import { ROLE_LABELS } from '../../utils/people';

// Where a new client fits (docs/plans/tier-3.md, section 14, WP6; the
// brief's third glanceable truth): a partner types a prospect, the client
// form's picks, and reads the lead Stage 1's engine would propose (fit
// before load, with the reason and the load on every row), the second chair
// the associate split would propose, the client's own figures in words (its
// effort, its strategic value with its parts, where it ranks among the
// book's clients, its exposure band) and everyone's load before and after,
// with the partners' average moving (src/utils/clientFit.js). Nothing is
// written and nothing is saved: the hypothetical client lives only here, and
// "Add on Client Details" opens the client form prefilled, whose own Save
// then creates the client (U26 (b)).

const num = 'text-right tabular-nums';
const share = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);
const STICKINESS_PICKS = [5, 4, 3, 2, 1];

const BeforeAfter = ({ before, after, format = (v) => v }) =>
  Math.abs((before || 0) - (after || 0)) < 1e-9 ? (
    <span>{format(before)}</span>
  ) : (
    <span>
      <span className="text-muted-foreground">{format(before)}</span>
      {' → '}
      <span className="font-semibold">{format(after)}</span>
    </span>
  );

const RatioChange = ({ before, after }) => {
  const b = formatRatio(before);
  const a = formatRatio(after);
  return <span>{b === a ? b : `${b} → ${a}`}</span>;
};

// "total load 5.0 (lead 5.0, second chair 0), $91,000"
const loadText = (load) =>
  `total load ${formatEffort(load.effort)} (lead ${formatEffort(load.lead.effort)}, second chair ${formatEffort(load.second.effort)}), ${formatMoney(load.revenue)}`;

const personText = (person) => (person ? `${person.name}${person.role !== 'partner' ? ` (${ROLE_LABELS[person.role] || person.role})` : ''}` : '');

// The picks: the client form's fields, as the hire view lays out an associate's
const PicksCard = ({ picks, year, setPicks, model }) => {
  const toggleArea = (area) => setPicks({
    practiceArea: picks.practiceArea.includes(area) ? picks.practiceArea.filter((a) => a !== area) : [...picks.practiceArea, area],
  });
  const { lines, score } = model;
  return (
    <Card data-testid="sandbox-picks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          A new client
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Type a prospect to see which partner has the practice-area fit and the capacity, how it tips their balance,
          and where it lands among the book&apos;s clients. The picks are the client form&apos;s; nothing is written, and
          the client appears only here until you add it on Client Details.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sandbox-name">Name</Label>
            <Input
              id="sandbox-name"
              value={picks.name}
              maxLength={255}
              placeholder="New client"
              onChange={(e) => setPicks({ name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sandbox-revenue">Revenue {year}</Label>
            <Input
              id="sandbox-revenue"
              type="number"
              min={0}
              step="any"
              value={picks.revenue}
              placeholder="Blank for none"
              onChange={(e) => setPicks({ revenue: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label>Practice areas</Label>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {PRACTICE_AREAS.map((area) => {
              const id = `sandbox-area-${area.replace(/\W/g, '')}`;
              return (
                <div key={area} className="flex items-center gap-1.5">
                  <Checkbox id={id} checked={picks.practiceArea.includes(area)} onCheckedChange={() => toggleArea(area)} />
                  <label htmlFor={id} className="text-sm cursor-pointer">{area}</label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="sandbox-cadence">Cadence</Label>
            <NativeSelect id="sandbox-cadence" value={picks.interaction_frequency} onChange={(e) => setPicks({ interaction_frequency: e.target.value })}>
              <option value="">Not set</option>
              {CADENCES.map((cadence) => <option key={cadence} value={cadence}>{cadence}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sandbox-stickiness">Stickiness</Label>
            <NativeSelect
              id="sandbox-stickiness"
              value={picks.stickiness === null || picks.stickiness === undefined ? '' : String(picks.stickiness)}
              onChange={(e) => setPicks({ stickiness: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">Not rated</option>
              {STICKINESS_PICKS.map((pick) => <option key={pick} value={String(pick)}>{pick} {STICKINESS_LABELS[pick]}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sandbox-conflict">Conflict risk</Label>
            <NativeSelect id="sandbox-conflict" value={picks.conflict_risk} onChange={(e) => setPicks({ conflict_risk: e.target.value })}>
              {CONFLICT_RISKS.map((risk) => <option key={risk} value={risk}>{risk}</option>)}
            </NativeSelect>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="sandbox-handful" checked={picks.high_maintenance === true} onCheckedChange={(on) => setPicks({ high_maintenance: on === true })} />
          <label htmlFor="sandbox-handful" className="text-sm cursor-pointer">A handful (each interaction is heavy: effort × 1.5)</label>
        </div>

        <div className="rounded-lg border p-3 text-sm space-y-1" data-testid="sandbox-lines">
          <p className="font-medium" data-sandbox-line="facts">{lines.facts}</p>
          <p data-sandbox-line="effort">{lines.effort}</p>
          <p data-sandbox-line="score">{lines.score}</p>
          {lines.standIn && <p className="text-muted-foreground" data-sandbox-line="stand-in">{lines.standIn}</p>}
          <p data-sandbox-line="exposure">{lines.exposure}</p>
          {score.high && (
            <p className="flex items-center gap-1 text-red-700" data-sandbox-line="conflict" role="alert">
              <AlertTriangle className="h-4 w-4" />
              High conflict risk: the score carries its penalty of {score.penalty}. This is the pick above, not a conflict check; the book records no adverse party.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// One seat: the candidates in the engine's order with the reason and the
// load each was ranked on, the proposal marked, and the partner's pick
const SeatCard = ({ seat, title, intro, side, people, value, onPick, noneOption, empty }) => {
  const proposed = side.proposal;
  const pickedIds = new Set(side.candidates.map((c) => String(c.person.id)));
  // Everyone else active, so a pick P3 refuses can be tried and its reason read
  const others = people.filter((p) => p.active && !pickedIds.has(String(p.id)));
  const heading = side.noCandidate
    ? empty
    : proposed
      ? `${proposed.name} proposed (${reasonText(side.candidates.find((c) => String(c.person.id) === String(proposed.id)))})`
      : 'none proposed';
  return (
    <Card data-testid={`sandbox-${seat}`}>
      <CardHeader>
        <CardTitle className="text-base">
          {title}: <span data-sandbox-proposal={seat}>{heading}</span>
          {side.after && side.choice !== undefined && !side.problem && (
            <Badge variant="outline" className="ml-2 border-blue-300 bg-blue-50 text-blue-800">your pick: {side.after.name}</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {side.candidates.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Why here</TableHead>
                <TableHead>Load now</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {side.candidates.map((c, i) => (
                <TableRow key={c.person.id} data-sandbox-candidate={c.person.name}>
                  <TableCell className="tabular-nums">{i + 1}.</TableCell>
                  <TableCell className="font-medium">{personText(c.person)}</TableCell>
                  <TableCell>{reasonText(c)}</TableCell>
                  <TableCell className="tabular-nums" data-figure="load">{loadText(c.load)}</TableCell>
                  <TableCell>
                    {proposed && String(c.person.id) === String(proposed.id) && <Badge variant="outline">proposed</Badge>}
                    {side.after && String(c.person.id) === String(side.after.id) && side.choice !== undefined && !side.problem && (
                      <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">your pick</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {side.noCandidate && !side.after && <p className="text-sm text-red-700" role="alert">{empty}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <Label htmlFor={`sandbox-pick-${seat}`} className="text-xs">Your pick</Label>
            <NativeSelect id={`sandbox-pick-${seat}`} value={value} onChange={(e) => onPick(e.target.value)} disabled={!!side.disabled}>
              <option value="">{proposed ? `The proposal (${proposed.name})` : 'The proposal (none)'}</option>
              {noneOption && <option value="none">None</option>}
              {side.candidates.map((c) => <option key={c.person.id} value={String(c.person.id)}>{personText(c.person)}</option>)}
              {others.map((p) => <option key={p.id} value={String(p.id)}>{personText(p)}</option>)}
            </NativeSelect>
          </div>
        </div>
        {side.problem && (
          <p className="text-sm text-red-700" role="alert" data-sandbox-problem={seat}>
            {side.problem} The proposal stands.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

// Everyone's load before and after, by role, with the reporting-year revenue
const LoadTable = ({ model, year }) => {
  const avg = model.averages;
  const partners = { before: avg.before.partner, after: avg.after.partner };
  return (
    <Card data-testid="sandbox-loads">
      <CardHeader>
        <CardTitle>Load before and after</CardTitle>
        <p className="text-sm text-muted-foreground">
          The firm&apos;s figures (P10): the lead carries the new client&apos;s full effort and the second chair {share}% of it;
          nobody else moves. Each ratio is against the average of the active people in the same role (lead books against
          the partners), now and with the client: the average moves too, so every other partner&apos;s ratio falls a notch.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Lead revenue {year}</TableHead>
              <TableHead className="text-right">Lead effort</TableHead>
              <TableHead className="text-right">vs partners</TableHead>
              <TableHead className="text-right">Second on</TableHead>
              <TableHead className="text-right">Second-chair revenue {year}</TableHead>
              <TableHead className="text-right">Second-chair effort</TableHead>
              <TableHead className="text-right">vs role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.groups.map((group) => [
              <TableRow key={`${group.role}-label`}>
                <TableCell colSpan={9} className="bg-muted/40 text-xs font-semibold uppercase tracking-wide">{group.label}</TableCell>
              </TableRow>,
              ...group.rows.map((r) => (
                <TableRow key={`${group.role}-${r.person.id}`} data-load-person={r.person.name} data-load-seat={r.seat || ''} className={r.seat ? 'bg-blue-50/40' : undefined}>
                  <TableCell className="font-medium">
                    {r.person.name}
                    {r.person.active === false && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                    {r.seat && <Badge variant="outline" className="ml-2 text-xs">{r.seat === 'lead' ? 'new lead' : 'new second chair'}</Badge>}
                  </TableCell>
                  <TableCell className={num} data-figure="lead-count"><BeforeAfter before={r.before.lead.count} after={r.after.lead.count} /></TableCell>
                  <TableCell className={num} data-figure="lead-revenue"><BeforeAfter before={r.before.lead.revenue} after={r.after.lead.revenue} format={formatMoney} /></TableCell>
                  <TableCell className={num} data-figure="lead-effort"><BeforeAfter before={r.before.lead.effort} after={r.after.lead.effort} format={formatEffort} /></TableCell>
                  <TableCell className={num} data-figure="lead-ratio"><RatioChange before={r.before.leadRatio.effort} after={r.after.leadRatio.effort} /></TableCell>
                  <TableCell className={num} data-figure="second-count"><BeforeAfter before={r.before.second.count} after={r.after.second.count} /></TableCell>
                  <TableCell className={num} data-figure="second-revenue"><BeforeAfter before={r.before.second.revenue} after={r.after.second.revenue} format={formatMoney} /></TableCell>
                  <TableCell className={num} data-figure="second-effort"><BeforeAfter before={r.before.second.effort} after={r.after.second.effort} format={formatEffort} /></TableCell>
                  <TableCell className={num} data-figure="second-ratio"><RatioChange before={r.before.secondRatio.effort} after={r.after.secondRatio.effort} /></TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
        <p className="text-sm" data-testid="sandbox-averages">
          Partners&apos; average ({partners.after.members} active): lead effort{' '}
          <BeforeAfter before={partners.before.lead.effort} after={partners.after.lead.effort} format={formatEffort} />, lead revenue{' '}
          <BeforeAfter before={partners.before.lead.revenue} after={partners.after.lead.revenue} format={formatMoney} />, leads{' '}
          <BeforeAfter before={partners.before.lead.count} after={partners.after.lead.count} format={(n) => formatEffort(n)} />
        </p>
      </CardContent>
    </Card>
  );
};

const ClientSandbox = () => {
  const people = usePortfolioStore((s) => s.people);
  const clients = usePortfolioStore((s) => s.clients);
  const reportingYear = usePortfolioStore((s) => s.getReportingYear());
  const sandbox = usePortfolioStore((s) => s.clientSandbox);
  const setSandboxPicks = usePortfolioStore((s) => s.setSandboxPicks);
  const setSandboxChoice = usePortfolioStore((s) => s.setSandboxChoice);
  const resetSandbox = usePortfolioStore((s) => s.resetSandbox);
  const draftClient = usePortfolioStore((s) => s.draftClient);

  const revenueOf = useMemo(() => (client) => revenueForYear(client, reportingYear), [reportingYear]);
  const model = useMemo(
    () => clientFitModel({ people, clients, revenueOf, reportingYear, picks: sandbox.picks, choice: sandbox.choice }),
    [people, clients, revenueOf, reportingYear, sandbox]
  );

  const leadValue = sandbox.choice.leadId === undefined ? '' : String(sandbox.choice.leadId);
  const secondValue = sandbox.choice.secondChairId === undefined ? ''
    : sandbox.choice.secondChairId === null ? 'none' : String(sandbox.choice.secondChairId);

  const handleStartOver = () => {
    if (window.confirm('Start over? This clears the client and your picks. The book is not changed.')) resetSandbox();
  };
  const handleAdd = () => draftClient(clientDraft(model, reportingYear));

  return (
    <div className="space-y-6" data-testid="client-sandbox">
      <PicksCard picks={sandbox.picks} year={reportingYear} setPicks={setSandboxPicks} model={model} />

      {model.lead.noCandidate && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            No active partner can lead this client: the People list has none. Add a partner with the People button in the header.
          </AlertDescription>
        </Alert>
      )}

      <SeatCard
        seat="lead"
        title="Lead"
        intro={`The active partners as Stage 1 ranks them: the partner whose lead book shares the most of the client's practice areas first, then the lighter total load (lead effort plus the second-chair ${share}% share), then revenue, then the name. A shared practice area ranks above any load; the load shows beside it, and you decide.`}
        side={model.lead}
        people={people}
        value={leadValue}
        onPick={(value) => setSandboxChoice({ leadId: value === '' ? undefined : value })}
        noneOption={false}
        empty="No active partner can lead this client."
      />

      <SeatCard
        seat="second"
        title="Second chair"
        intro="As the associate split proposes one for an empty seat: the active associates first, by practice-area fit with every client they hold and then the lighter total load, then everyone else P3 allows. The best-ranked associate is proposed, or none when the firm has no active associate; pick anyone, or None."
        side={{ ...model.secondChair, disabled: !model.lead.after }}
        people={model.lead.after ? people.filter((p) => String(p.id) !== String(model.lead.after.id)) : []}
        value={secondValue}
        onPick={(value) => setSandboxChoice({ secondChairId: value === '' ? undefined : value === 'none' ? null : value })}
        noneOption
        empty={model.lead.after ? 'Nobody else is active to take this seat.' : 'A second chair needs a lead first.'}
      />

      <LoadTable model={model} year={reportingYear} />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm text-muted-foreground">
            Nothing is saved here. Adding the client opens the client form on Client Details filled with these picks, the lead
            and the second chair; its Save creates the client, with its checks and its history.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleStartOver}>
              <RotateCcw className="h-4 w-4 mr-2" />Start over
            </Button>
            <Button size="sm" onClick={handleAdd} data-testid="sandbox-add">
              <FilePlus className="h-4 w-4 mr-2" />Add on Client Details
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientSandbox;
