import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Edit3,
  Calendar,
  Search,
  Bot,
  Loader2,
  ChevronDown,
  ChevronRight,
  Target,
  Save,
  Users
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { apiClient, apiErrorMessage } from '../../api';
import { formatClientName } from '../../utils/textUtils';
import {
  getSuccessionRiskVariant,
  getRelationshipTypeColor,
  groupClientsBySuccessionRisk
} from '../../utils/successionUtils';
import { candidateReason } from '../../utils/departure';
import { formatMoney } from '../../utils/load';
import { approvalBlocker, planRequest } from '../../utils/transitionPlans';
import TransitionSheetPanel from './TransitionSheetPanel';

// Stage 2 (docs/plans/people-and-second-chair.md, Phase 5): each affected
// client's plan. Its seats are a new lead and a new second chair, chosen from
// the departure engine's candidates (never someone leaving, never
// "Unassigned") and checked against P3, with the reason shown when a pick
// cannot hold; the AI's plan adds a strategy, risks, tasks and its own
// recommendation from the roster, which the partner may take. Approving pins
// the seats; the approved plan exports as an import sheet (CLIENT, Lead,
// Second Chair) that Data Upload checks and applies. Nothing here writes to
// the database.

const PRIORITY_LEVELS = {
  critical: { label: 'Critical', color: 'bg-red-500' },
  high: { label: 'High', color: 'bg-orange-500' },
  medium: { label: 'Medium', color: 'bg-yellow-500' },
  low: { label: 'Low', color: 'bg-green-500' }
};

const TRANSITION_STATUS = {
  pending: { label: 'Pending Review', color: 'bg-gray-500' },
  planned: { label: 'Plan Generated', color: 'bg-blue-500' },
  approved: { label: 'Approved', color: 'bg-green-500' },
  rejected: { label: 'Needs Revision', color: 'bg-red-500' }
};

const ROSTER_UNAVAILABLE =
  'The API does not take the roster yet (it runs an older version), so no plan was requested. Try again once the API has been deployed.';

const idOf = (person) => (person ? String(person.id) : '');

// One seat's picker: the engine's candidates in order, with why each ranks
// there, and the reason a pick was refused
const SeatPicker = ({ seat, side, onPick, clientId }) => {
  const label = seat === 'lead' ? 'Lead' : 'Second chair';
  const selectId = `${seat}-${clientId}`;
  const leaving = side.why === 'leaves';
  const note = seat === 'lead'
    ? (side.why === 'missing' ? ' (no active partner on record)' : '')
    : (side.why === 'promoted' ? ' (promoted to lead)' : side.why === 'inactive' ? ' (inactive)' : '');

  const changes = seat === 'lead' ? side.needed : true;
  return (
    <div className="space-y-1">
      <Label htmlFor={selectId} className="text-sm font-medium">{label}</Label>
      <div className="text-xs text-muted-foreground">
        Now: {side.before ? side.before.name : 'none'}
        {leaving && <span className="text-orange-700"> (leaving)</span>}
        {note}
      </div>
      {!changes ? (
        <div className="text-sm">{side.after ? `${side.after.name} stays` : 'none'}</div>
      ) : seat === 'lead' && side.candidates.length === 0 ? (
        <div className="text-sm font-medium text-red-700">No active partner who is staying can lead this client.</div>
      ) : (
        <NativeSelect
          id={selectId}
          value={idOf(side.after)}
          onChange={(e) => onPick(e.target.value === '' ? null : e.target.value)}
        >
          {seat === 'second' && <option value="">None</option>}
          {side.candidates.map((c) => (
            <option key={c.person.id} value={idOf(c.person)}>
              {c.person.name}: {seat === 'second' && !side.vacated && idOf(c.person) === idOf(side.before) ? 'stays in the seat' : candidateReason(c)}
            </option>
          ))}
        </NativeSelect>
      )}
      {side.problem && (
        <p className="text-xs text-red-700" role="alert">
          Your pick was not applied: {side.problem} The proposal stands until you pick again.
        </p>
      )}
      {seat === 'second' && side.noCandidate && (
        <p className="text-xs text-red-700">Nobody who is staying can take this seat.</p>
      )}
    </div>
  );
};

// The AI's recommendation, resolved against the roster on the server; the
// partner can take it, and the engine still checks it
const AiRecommendation = ({ plan, decision, onUse }) => {
  const lead = plan.recommendedLead;
  const second = plan.recommendedSecondChair;
  if (!lead && !second) return null;
  const usable = (lead?.person && decision.lead.needed) || second?.person || second?.none;
  const describe = (rec) => {
    if (!rec) return null;
    if (rec.person) return <span className="font-medium">{rec.person.name}</span>;
    if (rec.none) return <span className="font-medium">no second chair</span>;
    return <span className="text-red-700">nobody ({rec.problem})</span>;
  };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Bot className="inline h-4 w-4 mr-1 text-blue-700" />
          The AI recommends {describe(lead)} as lead and {describe(second)} as second chair.
        </div>
        <Button size="sm" variant="outline" disabled={!usable} onClick={onUse}>
          Use these picks
        </Button>
      </div>
      {lead?.text && <p className="text-xs text-gray-700 whitespace-pre-wrap">Lead: {lead.text}</p>}
      {second?.text && <p className="text-xs text-gray-700 whitespace-pre-wrap">Second chair: {second.text}</p>}
    </div>
  );
};

const BulkActionBar = ({ selected, leadOptions, onGeneratePlans, onAssignLead, onSetTimeline, onApprove, onClearSelection, isGeneratingPlans }) => {
  const [leadId, setLeadId] = useState('');
  const [bulkTimeline, setBulkTimeline] = useState(30);
  if (selected.length === 0) return null;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="font-medium text-blue-900">{selected.length} clients selected</div>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>Clear Selection</Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => onGeneratePlans(selected)} disabled={isGeneratingPlans} className="bg-blue-600 hover:bg-blue-700">
              {isGeneratingPlans ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
              ) : (
                <><Bot className="h-4 w-4 mr-2" />Generate AI Plans</>
              )}
            </Button>

            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-lead" className="text-sm whitespace-nowrap">New lead:</Label>
              <NativeSelect id="bulk-lead" className="w-40" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">Choose a partner</option>
                {leadOptions.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </NativeSelect>
              <Button variant="outline" size="sm" onClick={() => onAssignLead(selected, leadId)} disabled={!leadId}>
                Assign
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-timeline" className="text-sm">Timeline:</Label>
              <Input
                id="bulk-timeline"
                type="number"
                value={bulkTimeline}
                onChange={(e) => setBulkTimeline(Number(e.target.value))}
                className="w-20"
                min="1"
                max="365"
              />
              <span className="text-sm text-gray-600">days</span>
              <Button variant="outline" size="sm" onClick={() => onSetTimeline(selected, bulkTimeline)}>Apply</Button>
            </div>

            <Button onClick={() => onApprove(selected)} className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const PlanCard = ({ decision, plan, year, hasChoice, onPick, onResetPick, onUseAi, onUpdatePlan, onApprove, onReject, isExpanded, onToggleExpanded }) => {
  const client = decision.client;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const blocker = approvalBlocker(decision);
  const status = plan?.status || 'pending';
  const priority = PRIORITY_LEVELS[plan?.priority];

  const startEditing = () => {
    setDraft({ timelineDays: plan?.timelineDays ?? '', strategy: plan?.strategy || '', risks: plan?.risks || '' });
    setIsEditing(true);
  };
  const saveEdits = () => {
    const days = Number(draft.timelineDays);
    onUpdatePlan(client.id, {
      timelineDays: Number.isInteger(days) && days > 0 ? days : null,
      strategy: draft.strategy,
      risks: draft.risks
    });
    setIsEditing(false);
  };

  const seatSummary = (side) =>
    `${side.before ? side.before.name : 'none'} → ${side.after ? side.after.name : 'none'}`;

  return (
    <Card className="mb-4" data-client-card={String(client.id)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" aria-label={isExpanded ? 'Collapse' : 'Expand'} onClick={() => onToggleExpanded(client.id)}>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            <div>
              <CardTitle className="text-lg">{formatClientName(client.name)}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge className={`${TRANSITION_STATUS[status]?.color || 'bg-gray-500'} text-white`}>
                  {TRANSITION_STATUS[status]?.label || status}
                </Badge>
                {priority && <Badge className={`${priority.color} text-white`}>{priority.label} Priority</Badge>}
                <Badge variant={getSuccessionRiskVariant(client.successionRisk)}>Risk: {client.successionRisk}/10</Badge>
                <span className="text-xs text-muted-foreground">
                  Lead {seatSummary(decision.lead)} · Second chair {seatSummary(decision.secondChair)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Edit plan" onClick={() => (isEditing ? setIsEditing(false) : startEditing())}>
              <Edit3 className="h-4 w-4" />
            </Button>
            {status !== 'approved' && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Approve ${client.name}`}
                title={blocker || 'Approve these seats and this plan'}
                disabled={!!blocker}
                onClick={() => onApprove(decision)}
                className="text-green-600 border-green-600 hover:bg-green-50"
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {status !== 'rejected' && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Needs revision: ${client.name}`}
                onClick={() => onReject(client.id)}
                className="text-red-600 border-red-600 hover:bg-red-50"
              >
                <AlertTriangle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <Label className="text-sm font-medium">Revenue {year}</Label>
              <div className="font-semibold">{formatMoney(decision.revenue)}</div>
            </div>
            <div>
              <Label className="text-sm font-medium">Relationship Type</Label>
              <Badge variant="outline" className={getRelationshipTypeColor(client.relationshipType)}>
                {client.relationshipType?.toUpperCase()}
              </Badge>
            </div>
            <div>
              <Label className="text-sm font-medium">Practice areas</Label>
              <div className="text-sm">{(client.practiceArea || []).join(', ') || 'Not specified'}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border p-3">
            <SeatPicker
              seat="lead"
              clientId={client.id}
              side={decision.lead}
              onPick={(id) => onPick(client.id, { leadId: id })}
            />
            <SeatPicker
              seat="second"
              clientId={client.id}
              side={decision.secondChair}
              onPick={(id) => onPick(client.id, { secondChairId: id })}
            />
            {hasChoice && (
              <div className="md:col-span-2">
                <button type="button" className="text-xs text-blue-700 underline" onClick={() => onResetPick(client.id)}>
                  Back to the proposal for both seats
                </button>
              </div>
            )}
          </div>
          {blocker && <p className="text-sm text-red-700">Cannot be approved: {blocker}</p>}

          {plan && (plan.recommendedLead || plan.recommendedSecondChair) && (
            <AiRecommendation plan={plan} decision={decision} onUse={() => onUseAi(decision, plan)} />
          )}

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor={`timeline-${client.id}`}>Transition Timeline (days)</Label>
                <Input
                  id={`timeline-${client.id}`}
                  type="number"
                  value={draft.timelineDays}
                  onChange={(e) => setDraft({ ...draft, timelineDays: e.target.value })}
                  min="1"
                  max="365"
                />
              </div>
              <div>
                <Label htmlFor={`strategy-${client.id}`}>Transition Strategy</Label>
                <Textarea
                  id={`strategy-${client.id}`}
                  value={draft.strategy}
                  onChange={(e) => setDraft({ ...draft, strategy: e.target.value })}
                  rows={3}
                  placeholder="Describe the transition approach..."
                />
              </div>
              <div>
                <Label htmlFor={`risks-${client.id}`}>Key Risks & Mitigation</Label>
                <Textarea
                  id={`risks-${client.id}`}
                  value={draft.risks}
                  onChange={(e) => setDraft({ ...draft, risks: e.target.value })}
                  rows={3}
                  placeholder="Identify risks and mitigation strategies..."
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveEdits}><Save className="h-4 w-4 mr-2" />Save Changes</Button>
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : plan && (plan.strategy || plan.timelineDays || plan.risks || plan.tasks?.length) ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">
                  Timeline: {plan.timelineDays ? `${plan.timelineDays} days` : 'not set'}
                </span>
              </div>
              {plan.strategy && (
                <div>
                  <Label className="text-sm font-medium">Transition Strategy</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{plan.strategy}</div>
                </div>
              )}
              {plan.risks && (
                <div>
                  <Label className="text-sm font-medium">Key Risks & Mitigation</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{plan.risks}</div>
                </div>
              )}
              {plan.tasks && plan.tasks.length > 0 && (
                <div>
                  <Label className="text-sm font-medium">Action Items</Label>
                  <ul className="mt-1 space-y-1 list-disc pl-5 text-sm">
                    {plan.tasks.map((task, index) => <li key={index}>{task}</li>)}
                  </ul>
                </div>
              )}
              {plan.communicationTemplate && (
                <div>
                  <Label className="text-sm font-medium">Client Communication Template</Label>
                  <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
                    {plan.communicationTemplate}
                  </div>
                </div>
              )}
              {plan.truncated && (
                <p className="text-xs text-amber-700">The response was cut off; ask a narrower question.</p>
              )}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              <Bot className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No AI plan yet. Select this client and use &quot;Generate AI Plans&quot;, or approve the seats as they are.</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};

const ClientTriageGrid = ({ decisions, selected, onSelect, onSelectAll, renderCard, plans }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => decisions.filter((d) => {
    const client = d.client;
    const matchesSearch = formatClientName(client.name).toLowerCase().includes(searchTerm.toLowerCase());
    const risk = client.successionRisk;
    const matchesRisk = riskFilter === 'all' ||
      (riskFilter === 'low' && risk <= 3) ||
      (riskFilter === 'medium' && risk > 3 && risk <= 6) ||
      (riskFilter === 'high' && risk > 6);
    const plan = plans[String(client.id)];
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'no-plan' && !plan?.strategy) ||
      (plan?.status || 'pending') === statusFilter;
    return matchesSearch && matchesRisk && matchesStatus;
  }), [decisions, searchTerm, riskFilter, statusFilter, plans]);

  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };
  const allSelected = filtered.length > 0 && filtered.every((d) => selected.includes(String(d.client.id)));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Search clients..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
            <NativeSelect aria-label="Risk level" className="w-44" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk (7-10)</option>
              <option value="medium">Medium Risk (4-6)</option>
              <option value="low">Low Risk (1-3)</option>
            </NativeSelect>
            <NativeSelect aria-label="Plan status" className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="no-plan">No AI plan</option>
              {Object.entries(TRANSITION_STATUS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                aria-label="Select all"
                checked={allSelected}
                onCheckedChange={(checked) => onSelectAll(checked ? filtered.map((d) => String(d.client.id)) : [])}
              />
              <span className="font-medium">
                {filtered.length} clients{selected.length > 0 && ` (${selected.length} selected)`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setExpanded(new Set(filtered.map((d) => d.client.id)))}>Expand All</Button>
              <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>Collapse All</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {filtered.map((d) => (
          <div key={d.client.id} className="relative">
            <div className="absolute left-4 top-6 z-10">
              <Checkbox
                aria-label={`Select ${d.client.name}`}
                checked={selected.includes(String(d.client.id))}
                onCheckedChange={(checked) => onSelect(String(d.client.id), checked)}
              />
            </div>
            <div className="ml-8">{renderCard(d, expanded.has(d.client.id), toggle)}</div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="font-medium text-gray-700 mb-2">No clients match your filters</h3>
            <p className="text-gray-500">Try adjusting your search or filter criteria.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const ClientReviewInterface = ({ departure, reportingYear, onProceedToStage3, onBackToStage1 }) => {
  const plans = usePortfolioStore((s) => s.transitionPlans);
  const choices = usePortfolioStore((s) => s.successionWorkflow.choices);
  const setDepartureChoice = usePortfolioStore((s) => s.setDepartureChoice);
  const updateTransitionPlan = usePortfolioStore((s) => s.updateTransitionPlan);
  const approveTransitionPlans = usePortfolioStore((s) => s.approveTransitionPlans);
  const setTransitionPlanStatus = usePortfolioStore((s) => s.setTransitionPlanStatus);

  const [selected, setSelected] = useState([]);
  const [isGeneratingPlans, setIsGeneratingPlans] = useState(false);
  // { done, total, failed: [{ clientId, clientName, error }] } for the current / last run
  const [planProgress, setPlanProgress] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activeTab, setActiveTab] = useState('triage');

  const decisions = departure.decisions;
  const byId = useMemo(() => new Map(decisions.map((d) => [String(d.client.id), d])), [decisions]);
  const affectedClients = decisions.map((d) => d.client);
  const riskGroups = groupClientsBySuccessionRisk(affectedClients);
  const leadOptions = useMemo(() => {
    const leaving = new Set(departure.departing.map((p) => String(p.id)));
    return departure.before.rows
      .map((r) => r.person)
      .filter((p) => p.active && p.role === 'partner' && !leaving.has(String(p.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [departure]);

  const handleSelect = (clientId, checked) =>
    setSelected((prev) => (checked ? [...prev, clientId] : prev.filter((id) => id !== clientId)));

  // One request per selected client, two in flight at a time (D9), each with
  // the roster of people staying. An API older than the roster ignores it, so
  // ask /api/health first and send nothing unless it lists the feature.
  const handleGeneratePlans = async (clientIds) => {
    const queue = clientIds.map((id) => byId.get(id)).filter(Boolean);
    if (queue.length === 0) return;
    setNotice(null);

    const health = await apiClient.get('/api/health').catch(() => null);
    if (!Array.isArray(health?.features) || !health.features.includes('transition-plan-roster')) {
      setNotice(ROSTER_UNAVAILABLE);
      return;
    }

    setIsGeneratingPlans(true);
    setPlanProgress({ done: 0, total: queue.length, failed: [] });

    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const decision = queue[next++];
        const client = decision.client;
        try {
          const data = await apiClient.post('/scenarios/transition-plan', planRequest(decision, departure, reportingYear));
          if (!data?.success || !data.plan) {
            throw new Error(data?.error || 'No plan returned');
          }
          updateTransitionPlan(client.id, (current) => ({
            ...current,
            ...data.plan,
            clientId: String(client.id),
            status: current.status === 'approved' ? 'approved' : 'planned'
          }));
          setPlanProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        } catch (error) {
          console.error(`Error generating plan for ${client.name}:`, error);
          setPlanProgress((prev) => ({
            ...prev,
            done: prev.done + 1,
            failed: [...prev.failed, { clientId: client.id, clientName: client.name, error: apiErrorMessage(error) }]
          }));
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
    setIsGeneratingPlans(false);
  };

  const handleAssignLead = (clientIds, leadId) => {
    const needing = clientIds.map((id) => byId.get(id)).filter((d) => d && d.lead.needed);
    needing.forEach((d) => setDepartureChoice(d.client.id, { leadId }));
    const skipped = clientIds.length - needing.length;
    setNotice(skipped > 0 ? `${skipped} of the selected clients keep their lead, who is staying; their lead was not changed.` : null);
  };

  const handleSetTimeline = (clientIds, timelineDays) => {
    const days = Number.isInteger(timelineDays) && timelineDays > 0 ? timelineDays : null;
    clientIds.forEach((id) => updateTransitionPlan(id, { timelineDays: days }));
  };

  const handleApprove = (clientIds) => {
    const chosen = clientIds.map((id) => byId.get(id)).filter(Boolean);
    const blocked = chosen.filter((d) => approvalBlocker(d));
    approveTransitionPlans(chosen);
    setNotice(blocked.length > 0
      ? `Not approved: ${blocked.map((d) => `${formatClientName(d.client.name)} (${approvalBlocker(d)})`).join('; ')}`
      : null);
  };

  // The AI's picks become the partner's choices; the engine still checks them
  const handleUseAi = (decision, plan) => {
    const choice = {};
    if (decision.lead.needed && plan.recommendedLead?.person) choice.leadId = plan.recommendedLead.person.id;
    if (plan.recommendedSecondChair?.person) choice.secondChairId = plan.recommendedSecondChair.person.id;
    else if (plan.recommendedSecondChair?.none) choice.secondChairId = null;
    setDepartureChoice(decision.client.id, choice);
  };

  const approvedCount = decisions.filter((d) => plans[String(d.client.id)]?.status === 'approved').length;
  const generatedCount = decisions.filter((d) => plans[String(d.client.id)]?.strategy).length;

  return (
    <div className="space-y-6">
      <Card className="border-green-200 bg-green-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-green-800">Stage 2: Client Review & Triage</h3>
              <p className="text-sm text-green-600">
                Choose each affected client&apos;s lead and second chair and approve the plan for {decisions.length} affected clients
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-700">{approvedCount}</div>
                <div className="text-xs text-green-600">Plans Approved</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-700">{generatedCount}</div>
                <div className="text-xs text-blue-600">AI Plans</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <BulkActionBar
        selected={selected}
        leadOptions={leadOptions}
        onGeneratePlans={handleGeneratePlans}
        onAssignLead={handleAssignLead}
        onSetTimeline={handleSetTimeline}
        onApprove={handleApprove}
        onClearSelection={() => setSelected([])}
        isGeneratingPlans={isGeneratingPlans}
      />

      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {planProgress && (
        <Card className={planProgress.failed.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}>
          <CardContent className="py-3 text-sm">
            <div className="flex items-center gap-2">
              {isGeneratingPlans ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating plan {Math.min(planProgress.done + 1, planProgress.total)} of {planProgress.total}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>
                    {planProgress.done - planProgress.failed.length} of {planProgress.total} plans generated
                    {planProgress.failed.length > 0 && `, ${planProgress.failed.length} failed`}
                  </span>
                </>
              )}
            </div>
            {planProgress.failed.length > 0 && (
              <ul className="mt-2 space-y-1 text-red-700">
                {planProgress.failed.map((failure) => (
                  <li key={failure.clientId}>
                    <span className="font-medium">{formatClientName(failure.clientName)}</span>: {failure.error}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="triage">Client Triage ({decisions.length})</TabsTrigger>
          <TabsTrigger value="summary">Risk Summary</TabsTrigger>
          <TabsTrigger value="progress">Progress Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="triage" className="space-y-4">
          <ClientTriageGrid
            decisions={decisions}
            plans={plans}
            selected={selected}
            onSelect={handleSelect}
            onSelectAll={setSelected}
            renderCard={(d, isExpanded, toggle) => (
              <PlanCard
                decision={d}
                plan={plans[String(d.client.id)]}
                year={reportingYear}
                hasChoice={!!choices[String(d.client.id)]}
                onPick={setDepartureChoice}
                onResetPick={(id) => setDepartureChoice(id, null)}
                onUseAi={handleUseAi}
                onUpdatePlan={updateTransitionPlan}
                onApprove={(decision) => handleApprove([String(decision.client.id)])}
                onReject={(id) => setTransitionPlanStatus([id], 'rejected')}
                isExpanded={isExpanded}
                onToggleExpanded={toggle}
              />
            )}
          />
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(riskGroups).map(([riskLevel, clients]) => (
              <Card key={riskLevel}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      riskLevel === 'high' ? 'bg-red-500' : riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                    }`} />
                    {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)} Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold mb-2">{clients.length}</div>
                  <div className="text-sm text-gray-600">
                    {clients.filter((c) => plans[String(c.id)]?.status === 'approved').length} approved
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Transition Plan Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(TRANSITION_STATUS).map(([status, config]) => {
                  const count = decisions.filter((d) => (plans[String(d.client.id)]?.status || 'pending') === status).length;
                  return (
                    <div key={status} className="flex items-center justify-between p-3 border rounded-lg">
                      <Badge className={`${config.color} text-white`}>{config.label}</Badge>
                      <div className="font-semibold">{count} clients</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TransitionSheetPanel departure={departure} plans={plans} />

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBackToStage1}>
          <ArrowRight className="h-4 w-4 mr-2 rotate-180" />
          Back to Impact Analysis
        </Button>
        <Button onClick={onProceedToStage3} disabled={approvedCount === 0} className="bg-blue-600 hover:bg-blue-700">
          Proceed to Implementation
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

export default ClientReviewInterface;
