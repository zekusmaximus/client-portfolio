import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle, Loader2, Users } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';
import { apiClient, apiErrorBody, apiErrorMessage } from '../api';
import { associateSplitModel } from '../utils/associateSplit';
import { candidateReason } from '../utils/departure';
import { formatEffort, formatMoney, formatRatio, practiceAreasOf, SECOND_CHAIR_EFFORT_SHARE } from '../utils/load';

// The associate split (docs/plans/people-and-second-chair.md, Phase 6, P9):
// each associate's second-chair load against the associates' average, the
// clients with a lead and no second chair, and a proposed associate for each.
// A partner accepts each proposal, or picks someone else first; accepting
// writes that one client's second chair and nothing else. Lead changes are
// never proposed here.

const UNAVAILABLE =
  'Accepting is not available yet: the API runs an older version without it. Nothing was written.';
const NOT_NOW = 'not-now';
const num = 'text-right tabular-nums';

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

const failureText = (error) => {
  const body = apiErrorBody(error);
  if (body?.error === 'Validation failed' && Array.isArray(body.details)) {
    return body.details.map((d) => d.message).join(' ');
  }
  return apiErrorMessage(error);
};

const AssociateSplit = ({ people, clients, revenueOf, year }) => {
  const assignSecondChair = usePortfolioStore((s) => s.assignSecondChair);
  const fetchClients = usePortfolioStore((s) => s.fetchClients);
  const [notice, setNotice] = useState(null);
  // { [clientId]: personId | null }: the partner's edits over the proposals
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [accepted, setAccepted] = useState([]);
  // null until /api/health answers; false for an API without the endpoint
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    let live = true;
    apiClient.get('/api/health')
      .then((health) => live && setAvailable(Array.isArray(health?.features) && health.features.includes('second-chair-assign')))
      .catch(() => live && setAvailable(false));
    return () => { live = false; };
  }, []);

  const model = useMemo(() => associateSplitModel({ people, clients, revenueOf, picks }), [people, clients, revenueOf, picks]);
  const share = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);

  const choose = (clientId, value) => {
    setErrors((prev) => ({ ...prev, [clientId]: null }));
    setPicks((prev) => ({ ...prev, [String(clientId)]: value === NOT_NOW ? null : value }));
  };

  const accept = async (row) => {
    const id = String(row.client.id);
    setBusy(id);
    setErrors((prev) => ({ ...prev, [id]: null }));
    try {
      await assignSecondChair(row.client.id, row.after.id, null);
      setAccepted((prev) => [`${row.client.name}: ${row.after.name}`, ...prev].slice(0, 5));
      setPicks((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error(`Could not assign a second chair to ${row.client.name}:`, error);
      if (/status 409\b/.test(error?.message || '')) {
        // Someone else changed the client: say so above the list and reload
        // the book, which drops the row if its seat is now filled
        setNotice(`${row.client.name}: someone changed its second chair after this page loaded, so nothing was written. The list below is up to date again.`);
        await fetchClients();
      } else {
        setErrors((prev) => ({ ...prev, [id]: failureText(error) }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Associate split
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The clients with a lead and no second chair, each with an associate proposed: the one who seconds the most of
          the client&apos;s practice areas, then the lighter total load (lead effort plus {share}% of second-chair effort),
          each proposal counting the ones above it. Accept each one, or pick someone else first. Accepting sets that
          client&apos;s second chair and nothing else.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {available === false && (
          <Alert variant="destructive"><AlertDescription>{UNAVAILABLE}</AlertDescription></Alert>
        )}
        {notice && (
          <Alert><AlertDescription role="status">{notice}</AlertDescription></Alert>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Associates&apos; second-chair load</h3>
          {model.associates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active associates on the People list. Add them with the People button; until then nothing is proposed,
              and you can still pick anyone else below.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Associate</TableHead>
                  <TableHead className="text-right">Second chair on</TableHead>
                  <TableHead className="text-right">Revenue {year}</TableHead>
                  <TableHead className="text-right">Effort ({share}%)</TableHead>
                  <TableHead className="text-right">vs associates&apos; average</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.associates.map((r) => (
                  <TableRow key={r.person.id}>
                    <TableCell className="font-medium">{r.person.name}</TableCell>
                    <TableCell className={num}><BeforeAfter before={r.before.second.count} after={r.after.second.count} /></TableCell>
                    <TableCell className={num}><BeforeAfter before={r.before.second.revenue} after={r.after.second.revenue} format={formatMoney} /></TableCell>
                    <TableCell className={num}><BeforeAfter before={r.before.second.effort} after={r.after.second.effort} format={formatEffort} /></TableCell>
                    <TableCell className={num}>
                      {formatRatio(r.before.secondRatio.count)}
                      {formatRatio(r.before.secondRatio.count) !== formatRatio(r.after.secondRatio.count) && ` → ${formatRatio(r.after.secondRatio.count)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {model.associates.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Now, and with every proposal below accepted. The ratio is clients against the average of the active associates.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">
            Clients without a second chair ({model.totals.open})
          </h3>
          {accepted.length > 0 && (
            <p className="mb-2 flex items-center gap-1 text-sm text-green-700">
              <CheckCircle className="h-4 w-4" />
              Saved: {accepted.join('; ')}
            </p>
          )}
          {model.totals.open === 0 ? (
            <p className="text-sm text-muted-foreground">Every client with a lead has a second chair.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead className="text-right">Revenue {year}</TableHead>
                  <TableHead className="text-right">Effort</TableHead>
                  <TableHead className="w-[30%]">Second chair</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.proposals.map((row) => {
                  const id = String(row.client.id);
                  const associates = row.candidates.filter((c) => c.person.role === 'associate');
                  const others = row.candidates.filter((c) => c.person.role !== 'associate');
                  const value = row.after ? String(row.after.id) : NOT_NOW;
                  return (
                    <TableRow key={id} data-split-client={id}>
                      <TableCell>
                        <div className="font-medium">{row.client.name}</div>
                        <div className="text-xs text-muted-foreground">{practiceAreasOf(row.client).join(', ') || 'No practice area'}</div>
                      </TableCell>
                      <TableCell>{row.lead.name}</TableCell>
                      <TableCell className={num}>{formatMoney(row.revenue)}</TableCell>
                      <TableCell className={num}>{formatEffort(row.effort)}</TableCell>
                      <TableCell>
                        {row.blocker ? (
                          <span className="text-sm text-red-700">{row.blocker}</span>
                        ) : (
                          <>
                            <NativeSelect
                              aria-label={`Second chair for ${row.client.name}`}
                              value={value}
                              disabled={busy === id}
                              onChange={(e) => choose(id, e.target.value)}
                            >
                              <option value={NOT_NOW}>Not now</option>
                              {associates.length > 0 && (
                                <optgroup label="Associates">
                                  {associates.map((c) => (
                                    <option key={c.person.id} value={String(c.person.id)}>{c.person.name}: {candidateReason(c)}</option>
                                  ))}
                                </optgroup>
                              )}
                              {others.length > 0 && (
                                <optgroup label="Everyone else">
                                  {others.map((c) => (
                                    <option key={c.person.id} value={String(c.person.id)}>{c.person.name}: {candidateReason(c)}</option>
                                  ))}
                                </optgroup>
                              )}
                            </NativeSelect>
                            {row.proposal && row.after && String(row.after.id) !== String(row.proposal.id) && (
                              <div className="text-xs text-muted-foreground">Proposed: {row.proposal.name}</div>
                            )}
                            {!row.proposal && <div className="text-xs text-muted-foreground">No associate to propose.</div>}
                          </>
                        )}
                        {row.problem && (
                          <p className="text-xs text-red-700" role="alert">Your pick was not applied: {row.problem}</p>
                        )}
                        {errors[id] && <p className="text-xs text-red-700" role="alert">{errors[id]}</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          aria-label={`Accept ${row.client.name}`}
                          disabled={!row.after || available !== true || busy !== null}
                          onClick={() => accept(row)}
                        >
                          {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Accept'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        {model.totals.open > 0 && (
          <Badge variant="outline">
            {model.totals.proposed} of {model.totals.open} proposed · {formatMoney(model.totals.revenue)} in {year}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
};

export default AssociateSplit;
