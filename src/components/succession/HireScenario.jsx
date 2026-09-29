import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2, UserPlus } from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { apiClient, apiErrorBody, apiErrorMessage, apiErrorStatus } from '../../api';
import { acceptance, hireScenarioModel, RELIEVED_LEAD_SHARE, targetText } from '../../utils/hireScenario';
import { formatEffort, formatMoney, formatRatio, practiceAreasOf, SECOND_CHAIR_EFFORT_SHARE } from '../../utils/load';
import { revenueForYear } from '../../utils/revenue';
import { formatClientName } from '../../utils/textUtils';
import { LIMITS, PRACTICE_AREAS } from '../../utils/scenarioState';

// An associate in Scenarios (docs/plans/tier-2.md, section 14, S18 and S19):
// hypothetical associates, the second-chair seats proposed for them from the
// partners' books (heaviest partner first; src/utils/hireScenario.js), the
// partner's picks over the proposals, and everyone's load before and after,
// with S19's reading beside P10's when the toggle is on. Nothing is written
// until, after the hire, a partner links a hypothetical to the person on the
// People list and accepts a pick: that one seat, through the associate
// split's write (assignSecondChair, P9). The hypothetical people live only
// here: never on the People list, in the book, the AI or another tab.

const num = 'text-right tabular-nums';
const share = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);
const leadShare = Math.round(RELIEVED_LEAD_SHARE * 100);
const UNAVAILABLE = 'Accepting is not available yet: the API runs an older version without it. Nothing was written.';

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

const signed = (n) => `${n >= 0 ? '+' : '−'}${formatEffort(Math.abs(n))}`;

const failureText = (error) => {
  const body = apiErrorBody(error);
  if (body?.error === 'Validation failed' && Array.isArray(body.details)) return body.details.map((d) => d.message).join(' ');
  return apiErrorMessage(error);
};

const SOURCE_LABELS = { proposal: 'Proposed', pick: 'Picked', done: 'Accepted' };

// One hypothetical associate: its label, focus, target, link, and seats.
// `associate` is the model's (goal, link, seats); `entered` the store's, as
// typed, which the inputs show
const AssociateCard = ({ associate, entered, model, people, year, available, busy, errors, onAccept }) => {
  const updateHireAssociate = usePortfolioStore((s) => s.updateHireAssociate);
  const removeHireAssociate = usePortfolioStore((s) => s.removeHireAssociate);
  const setHirePick = usePortfolioStore((s) => s.setHirePick);
  const [adding, setAdding] = useState('');
  const seats = model.seats.filter((s) => s.associateId === associate.id);
  const excessOf = new Map(model.partners.map((p) => [String(p.person.id), p.excess]));
  const own = new Set(seats.map((s) => s.clientId));
  const addable = model.open.filter((seat) => !own.has(seat.clientId));
  const linkedElsewhere = new Set(model.associates.filter((a) => a.id !== associate.id && a.personId).map((a) => String(a.personId)));
  const linkable = people.filter((p) => p.active && p.role === 'associate' && !linkedElsewhere.has(String(p.id)));
  const target = entered.target || { kind: 'count', count: 0 };
  const focus = entered.focus || [];
  const toggleFocus = (area) => updateHireAssociate(associate.id, {
    focus: focus.includes(area) ? focus.filter((a) => a !== area) : [...focus, area],
  });
  const count = seats.length;
  const name = associate.linked ? `${associate.label} (${associate.linked.name})` : associate.label;

  return (
    <Card data-hire-associate={associate.id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {name}
            {associate.hypothetical ? <Badge variant="outline">hypothetical</Badge> : <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">hired</Badge>}
          </span>
          <Button variant="ghost" size="sm" className="text-red-700" aria-label={`Remove ${associate.label}`} onClick={() => removeHireAssociate(associate.id)}>
            <Trash2 className="h-4 w-4 mr-1" />Remove
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`hire-label-${associate.id}`}>Label</Label>
            <Input
              id={`hire-label-${associate.id}`}
              value={entered.label}
              maxLength={LIMITS.label}
              placeholder="New associate"
              onChange={(e) => updateHireAssociate(associate.id, { label: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`hire-target-${associate.id}`}>Target</Label>
            <div className="flex gap-2">
              <NativeSelect
                id={`hire-target-${associate.id}`}
                aria-label={`Target for ${associate.label}`}
                value={target.kind}
                onChange={(e) => updateHireAssociate(associate.id, {
                  target: e.target.value === 'average' ? { kind: 'average' } : { kind: 'count', count: Math.max(count, 1) },
                })}
              >
                <option value="average">The active associates&apos; average load</option>
                <option value="count">A number of clients</option>
              </NativeSelect>
              {target.kind === 'count' && (
                <Input
                  type="number"
                  min={0}
                  max={LIMITS.clients}
                  className="w-24"
                  aria-label={`Number of clients for ${associate.label}`}
                  value={target.count}
                  onChange={(e) => updateHireAssociate(associate.id, {
                    target: { kind: 'count', count: Math.max(0, Math.min(LIMITS.clients, Math.round(Number(e.target.value)) || 0)) },
                  })}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {associate.goalProblem || `Proposals stop at ${targetText(associate.goal)}${associate.goal.kind === 'average' ? `, the ${associate.goal.members} active associates' average now` : ''}. ${associate.reached ? 'Reached.' : 'Not reached: no more open seats.'}`}
            </p>
          </div>
        </div>

        <div>
          <Label>Practice areas of focus <span className="font-normal text-muted-foreground">(break ties in effort)</span></Label>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {PRACTICE_AREAS.map((area) => {
              const id = `hire-focus-${associate.id}-${area.replace(/\W/g, '')}`;
              return (
                <div key={area} className="flex items-center gap-1.5">
                  <Checkbox id={id} checked={focus.includes(area)} onCheckedChange={() => toggleFocus(area)} />
                  <label htmlFor={id} className="text-sm cursor-pointer">{area}</label>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">Second-chair seats ({count})</h4>
          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No seat yet: set a target, or add a client below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Second chair now</TableHead>
                  <TableHead className="text-right">Effort</TableHead>
                  <TableHead className="text-right">Revenue {year}</TableHead>
                  <TableHead />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seats.map((seat) => {
                  const excess = excessOf.get(String(seat.lead.id));
                  const check = acceptance(seat, associate);
                  return (
                    <TableRow key={seat.clientId} data-hire-seat={seat.clientId} data-hire-source={seat.source}>
                      <TableCell>
                        <div className="font-medium">{formatClientName(seat.client.name)}</div>
                        <div className="text-xs text-muted-foreground">
                          {practiceAreasOf(seat.client).join(', ') || 'No practice area'}
                          {seat.sharedAreas.length > 0 && <span className="ml-1 text-green-700">(fits: {seat.sharedAreas.join(', ')})</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{seat.lead.name}</div>
                        {excess !== undefined && (
                          <div className="text-xs text-muted-foreground">{signed(excess)} against the partners&apos; average</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {!seat.holder ? 'None' : seat.source === 'done' ? seat.holder.name : `${seat.holder.name} (freed of ${share}%)`}
                      </TableCell>
                      <TableCell className={num}>{formatEffort(seat.effort)}</TableCell>
                      <TableCell className={num}>{formatMoney(seat.revenue)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={seat.source === 'done' ? 'border-green-300 bg-green-50 text-green-800' : seat.source === 'pick' ? 'border-blue-300 bg-blue-50 text-blue-800' : ''}>
                          {SOURCE_LABELS[seat.source]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap space-x-1">
                        {seat.source === 'proposal' && (
                          <Button size="sm" variant="outline" aria-label={`Keep ${seat.client.name}`} onClick={() => setHirePick(seat.client, associate.id)}>Keep</Button>
                        )}
                        {seat.source !== 'done' && (
                          <Button size="sm" variant="ghost" aria-label={`Remove ${seat.client.name}`} onClick={() => setHirePick(seat.client, null)}>Remove</Button>
                        )}
                        {associate.linked && seat.source !== 'done' && (
                          <Button
                            size="sm"
                            aria-label={`Accept ${seat.client.name}`}
                            disabled={!check.ok || available !== true || busy !== null}
                            onClick={() => onAccept(seat, associate)}
                          >
                            {busy === seat.clientId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Accept'}
                          </Button>
                        )}
                        {errors[seat.clientId] && <p className="text-xs text-red-700 text-left whitespace-normal" role="alert">{errors[seat.clientId]}</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1">
              <Label htmlFor={`hire-add-${associate.id}`} className="text-xs">Add a client</Label>
              <NativeSelect id={`hire-add-${associate.id}`} value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose an open seat…</option>
                {addable.map((seat) => (
                  <option key={seat.clientId} value={seat.clientId}>
                    {formatClientName(seat.client.name)}: {seat.lead.name}{seat.holder ? `, seconded by ${seat.holder.name}` : ''}, effort {formatEffort(seat.effort)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!adding}
              onClick={() => {
                const seat = model.open.find((s) => s.clientId === adding);
                if (seat) setHirePick(seat.client, associate.id);
                setAdding('');
              }}
            >
              <Plus className="h-4 w-4 mr-1" />Add
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor={`hire-link-${associate.id}`}>After the hire: link to a person</Label>
          <p className="text-xs text-muted-foreground">
            Once the associate is on the People list (the People button), link them here. Each seat can then be accepted one at
            a time: accepting sets that client&apos;s second chair and nothing else.
          </p>
          <NativeSelect
            id={`hire-link-${associate.id}`}
            className="max-w-sm"
            value={associate.personId ? String(associate.personId) : ''}
            onChange={(e) => updateHireAssociate(associate.id, { personId: e.target.value || null })}
          >
            <option value="">Not hired yet</option>
            {associate.personId && !linkable.some((p) => String(p.id) === String(associate.personId)) && (
              <option value={String(associate.personId)}>{people.find((p) => String(p.id) === String(associate.personId))?.name || 'Someone no longer on the People list'}</option>
            )}
            {linkable.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </NativeSelect>
          {associate.linkProblem && <p className="text-xs text-red-700" role="alert">{associate.linkProblem}</p>}
          {associate.linked && available === false && <p className="text-xs text-red-700">{UNAVAILABLE}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

// Everyone's load before and after, by role; S19's lead effort beside P10's when the toggle is on
const LoadTable = ({ model, relief }) => (
  <Card>
    <CardHeader>
      <CardTitle>Load before and after</CardTitle>
      <p className="text-sm text-muted-foreground">
        The firm&apos;s figures (P10): a lead carries a client&apos;s full effort and the second chair {share}% of it, so
        giving an associate an empty seat lowers no partner&apos;s figure; taking a partner&apos;s seat frees that
        partner&apos;s {share}%. Each ratio is against the average of the active people in the same role
        {' '}(lead books against the partners), now and with this scenario; the hypothetical associates count among the
        associates after.
        {relief && ` Associate relief (S19, this scenario only): a lead carries ${leadShare}% of each client an associate seconds.`}
      </p>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="text-right">Leads</TableHead>
            <TableHead className="text-right">Lead effort</TableHead>
            <TableHead className="text-right">vs average</TableHead>
            {relief && <TableHead className="text-right">Lead effort (S19)</TableHead>}
            {relief && <TableHead className="text-right">vs average (S19)</TableHead>}
            <TableHead className="text-right">Second chair on</TableHead>
            <TableHead className="text-right">Second-chair effort</TableHead>
            <TableHead className="text-right">vs average</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.groups.map((group) => [
            <TableRow key={`${group.role}-label`}>
              <TableCell colSpan={relief ? 9 : 7} className="bg-muted/40 text-xs font-semibold uppercase tracking-wide">{group.label}</TableCell>
            </TableRow>,
            ...group.rows.map((r) => (
              <TableRow key={`${group.role}-${r.person.id}`} data-load-person={r.person.name}>
                <TableCell className="font-medium">
                  {r.person.name}
                  {r.hypothetical && <Badge variant="outline" className="ml-2 text-xs">hypothetical</Badge>}
                  {r.person.active === false && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                </TableCell>
                <TableCell className={num}><BeforeAfter before={r.before.lead.count} after={r.after.lead.count} /></TableCell>
                <TableCell className={num} data-figure="lead-effort"><BeforeAfter before={r.before.lead.effort} after={r.after.lead.effort} format={formatEffort} /></TableCell>
                <TableCell className={num}><RatioChange before={r.before.leadRatio.effort} after={r.after.leadRatio.effort} /></TableCell>
                {relief && (
                  <TableCell className={num} data-figure="relief-lead-effort">
                    <BeforeAfter before={r.relief.before.leadEffort} after={r.relief.after.leadEffort} format={formatEffort} />
                  </TableCell>
                )}
                {relief && <TableCell className={num}><RatioChange before={r.relief.before.leadRatio} after={r.relief.after.leadRatio} /></TableCell>}
                <TableCell className={num}><BeforeAfter before={r.before.second.count} after={r.after.second.count} /></TableCell>
                <TableCell className={num}><BeforeAfter before={r.before.second.effort} after={r.after.second.effort} format={formatEffort} /></TableCell>
                <TableCell className={num}><RatioChange before={r.before.secondRatio.effort} after={r.after.secondRatio.effort} /></TableCell>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

const HireScenario = () => {
  const people = usePortfolioStore((s) => s.people);
  const clients = usePortfolioStore((s) => s.clients);
  const reportingYear = usePortfolioStore((s) => s.getReportingYear());
  const hire = usePortfolioStore((s) => s.hireScenario);
  const addHireAssociate = usePortfolioStore((s) => s.addHireAssociate);
  const setHirePick = usePortfolioStore((s) => s.setHirePick);
  const setHireRelief = usePortfolioStore((s) => s.setHireRelief);
  const assignSecondChair = usePortfolioStore((s) => s.assignSecondChair);
  const fetchClients = usePortfolioStore((s) => s.fetchClients);
  // null until /api/health answers; false for an API without the second-chair route
  const [available, setAvailable] = useState(null);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let live = true;
    apiClient.get('/api/health')
      .then((health) => live && setAvailable(Array.isArray(health?.features) && health.features.includes('second-chair-assign')))
      .catch(() => live && setAvailable(false));
    return () => { live = false; };
  }, []);

  const revenueOf = useMemo(() => (client) => revenueForYear(client, reportingYear), [reportingYear]);
  const model = useMemo(
    () => hireScenarioModel({ people, clients, revenueOf, associates: hire.associates, picks: hire.picks, relief: hire.relief }),
    [people, clients, revenueOf, hire]
  );

  // After the hire: one seat, with the second chair as the scenario saw it
  // (P9). A 409 reloads the book, after which the pick shows why it is not
  // applied
  const accept = async (seat, associate) => {
    const check = acceptance(seat, associate);
    if (!check.ok) return;
    setBusy(seat.clientId);
    setErrors((prev) => ({ ...prev, [seat.clientId]: null }));
    setNotice(null);
    try {
      await assignSecondChair(seat.client.id, associate.linked.id, check.expectedSecondChairId);
      setNotice(`${formatClientName(seat.client.name)}: ${associate.linked.name} is now its second chair. Nothing else was changed.`);
    } catch (error) {
      console.error(`Could not accept ${seat.client.name}:`, error);
      if (apiErrorStatus(error) === 409) {
        setNotice(`${formatClientName(seat.client.name)}: its second chair changed since this scenario saw it, so nothing was written. The seats below are up to date again.`);
        await fetchClients({ force: true });
      } else {
        setErrors((prev) => ({ ...prev, [seat.clientId]: failureText(error) }));
      }
    } finally {
      setBusy(null);
    }
  };

  const averages = model.averages;
  return (
    <div className="space-y-6" data-testid="hire-scenario">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add an associate
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Try out, before a hire, which clients a new associate would second-chair. Seats are proposed from the partners&apos;
            books, the partner whose total load (lead effort plus {share}% of second-chair effort) sits furthest above the
            partners&apos; average first, the heaviest client first, each proposal counted before the next so they spread.
            Only empty seats and seats a partner holds are proposed; a lead never changes. Keep, remove or add seats freely:
            nothing is written, and the hypothetical associate appears only here.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox id="hire-relief" checked={hire.relief === true} onCheckedChange={(on) => setHireRelief(on)} />
            <label htmlFor="hire-relief" className="text-sm cursor-pointer">
              <span className="font-medium">Associate relief (S19)</span>: also show each lead at {leadShare}% of the effort of every
              client an associate seconds, beside the firm&apos;s figures. This scenario only; the Partnership tab, the Dashboard and
              the AI keep the firm&apos;s figures, and the proposals do not change.
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button onClick={addHireAssociate}><Plus className="h-4 w-4 mr-2" />Add a hypothetical associate</Button>
            <span className="text-muted-foreground">
              Partners&apos; average total load {formatEffort(averages.partnerTotal)}; associates&apos; average second-chair effort{' '}
              {averages.associateSecond.members > 0 ? `${formatEffort(averages.associateSecond.effort)} (${averages.associateSecond.members} active)` : 'none (no active associate)'}.
            </span>
          </div>
          {notice && <Alert><AlertDescription role="status">{notice}</AlertDescription></Alert>}
        </CardContent>
      </Card>

      {model.associates.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">The partners, heaviest first</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {model.partners.map((p) => (
                <Badge key={p.person.id} variant="outline" className={p.excess > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}>
                  {p.person.name}: {formatEffort(p.total)} ({signed(p.excess)})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {model.associates.map((associate) => (
        <AssociateCard
          key={associate.id}
          associate={associate}
          entered={hire.associates.find((a) => a.id === associate.id) || associate}
          model={model}
          people={people}
          year={reportingYear}
          available={available}
          busy={busy}
          errors={errors}
          onAccept={accept}
        />
      ))}

      {(model.notApplied.length > 0 || model.removed.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Picks not applied, and clients taken out</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {model.notApplied.map((n) => (
              <div key={n.clientId} className="flex flex-wrap items-start justify-between gap-2 text-sm" data-hire-not-applied={n.clientId}>
                <div>
                  <span className="font-medium">{formatClientName(n.client.name)}</span>
                  {n.associate && <span className="text-muted-foreground"> (for {n.associate.label})</span>}
                  <p className="text-red-700" role="alert">{n.problem}</p>
                </div>
                <div className="space-x-1 whitespace-nowrap">
                  {n.stale && n.associate && (
                    <Button size="sm" variant="outline" onClick={() => setHirePick(n.client, n.associateId)}>Pick again</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setHirePick(n.client, undefined)}>Forget the pick</Button>
                </div>
              </div>
            ))}
            {model.removed.map((r) => (
              <div key={r.clientId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-hire-removed={r.clientId}>
                <span>
                  <span className="font-medium">{formatClientName(r.client.name)}</span>
                  <span className="text-muted-foreground"> is taken out of the proposals.</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setHirePick(r.client, undefined)}>Restore</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {model.associates.length > 0 && <LoadTable model={model} relief={hire.relief === true} />}
    </div>
  );
};

export default HireScenario;
