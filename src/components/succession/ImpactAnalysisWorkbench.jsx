import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Users,
  AlertTriangle,
  Target,
  ArrowRight,
  Building,
  Clock,
  Zap,
  Calculator
} from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import usePortfolioStore from '../../portfolioStore';
import { formatClientName } from '../../utils/textUtils';
import { 
  getSuccessionRiskVariant, 
  getRelationshipTypeColor, 
  groupClientsBySuccessionRisk 
} from '../../utils/successionUtils';
import { groupPeople } from '../../utils/people';
import { formatMoney, formatEffort, practiceAreasOf, SECOND_CHAIR_EFFORT_SHARE } from '../../utils/load';
import { candidateReason } from '../../utils/departure';

const PRACTICE_AREA_COLORS = {
  'Healthcare': '#8884d8',
  'Municipal': '#82ca9d',
  'Corporate': '#ffc658',
  'Energy': '#ff7300',
  'Financial': '#00ff88',
  'Other': '#8dd1e1'
};

const num = 'text-right tabular-nums';
const LeavingBadge = () => (
  <Badge variant="outline" className="ml-1 border-orange-300 bg-orange-50 text-orange-800 text-xs">leaving</Badge>
);

// Who is leaving: every active person, by role (docs/plans/people-and-second-chair.md,
// Phase 5). Anyone can leave, not only partners.
const WhoIsLeavingPanel = ({ people, departingIds, rowsById, onToggle, onClear }) => {
  const groups = groupPeople(people).filter((g) => g.key !== 'inactive' && g.people.length > 0);
  const isLeaving = (id) => departingIds.some((x) => String(x) === String(id));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Who is leaving
          </span>
          {departingIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Mark everyone who may leave. Each client they lead needs a new lead, and each client they
          second-chair loses its second chair.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">The People list is empty. Add people with the People button in the header.</p>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            <h4 className="text-sm font-semibold mb-2">{group.label}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {group.people.map((person) => {
                const row = rowsById.get(String(person.id));
                const inputId = `leaving-${person.id}`;
                return (
                  <div key={person.id} className="flex items-center gap-2 rounded-lg border p-3 hover:bg-gray-50">
                    <Checkbox
                      id={inputId}
                      checked={isLeaving(person.id)}
                      onCheckedChange={() => onToggle(person.id)}
                    />
                    <label htmlFor={inputId} className="flex-1 cursor-pointer">
                      <div className="font-medium">{person.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {person.role === 'partner' || (row?.lead.count || 0) > 0 ? `leads ${row?.lead.count || 0} · ` : ''}
                        second chair on {row?.second.count || 0}
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

// One seat's proposal: who takes it and why, or why nobody does
const SeatProposal = ({ seat, side }) => {
  const reasonFor = (person) => {
    if (!person) return '';
    if (side.choice !== undefined && !side.problem) return 'your pick';
    const candidate = side.candidates.find((c) => String(c.person.id) === String(person.id));
    return candidateReason(candidate);
  };
  const others = side.candidates
    .filter((c) => String(c.person.id) !== String(side.after?.id))
    .slice(0, 3)
    .map((c) => c.person.name);

  const changes = seat === 'lead' ? side.needed : side.vacated;
  if (!changes) {
    return <span className="text-muted-foreground">{side.after ? `${side.after.name} stays` : 'none'}</span>;
  }
  if (!side.after) {
    return (
      <span className="font-medium text-red-700">
        {seat === 'lead'
          ? 'No active partner who is staying can lead this client'
          : side.noCandidate ? 'Nobody who is staying can take this seat' : 'Left empty'}
      </span>
    );
  }
  return (
    <div>
      <span className="font-medium">{side.after.name}</span>
      <span className="text-xs text-muted-foreground"> ({reasonFor(side.after)})</span>
      {side.problem && <div className="text-xs text-red-700">{side.problem}</div>}
      {others.length > 0 && <div className="text-xs text-muted-foreground">next: {others.join(', ')}</div>}
    </div>
  );
};

const seatNote = (side, seat) => {
  if (seat === 'lead') return side.why === 'missing' ? ' (no active partner on record)' : '';
  return side.why === 'promoted' ? ' (promoted to lead)' : side.why === 'inactive' ? ' (inactive)' : '';
};

// The clients that need a decision, each with its proposed lead and second chair
const AffectedClientsTable = ({ decisions, year, onClientSelect }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Target className="h-5 w-5" />
        Clients that need a decision ({decisions.length})
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        The proposed lead is the client&apos;s second chair when that is a partner who is staying, then the partner
        whose lead book shares the most of the client&apos;s practice areas, then the lighter total load: lead effort
        plus the second-chair share. A second chair is proposed the same way from everyone staying. Each proposal counts
        the clients this scenario has already given that person, heaviest clients first. You choose in Stage 2.
      </p>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Revenue {year}</TableHead>
            <TableHead className="text-right">Effort</TableHead>
            <TableHead>Lead now</TableHead>
            <TableHead>Second chair now</TableHead>
            <TableHead>Proposed lead</TableHead>
            <TableHead>Proposed second chair</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.map((d) => (
            <TableRow key={d.client.id}>
              <TableCell>
                <button
                  type="button"
                  className="font-medium text-left underline-offset-4 hover:underline"
                  onClick={() => onClientSelect(d.client)}
                >
                  {formatClientName(d.client.name)}
                </button>
                <div className="text-xs text-muted-foreground">{practiceAreasOf(d.client).join(', ') || 'No practice area'}</div>
              </TableCell>
              <TableCell className={num}>{formatMoney(d.revenue)}</TableCell>
              <TableCell className={num}>{formatEffort(d.effort)}</TableCell>
              <TableCell>
                {d.lead.before ? d.lead.before.name : '—'}
                {d.lead.why === 'leaves' && <LeavingBadge />}
                <span className="text-xs text-muted-foreground">{seatNote(d.lead, 'lead')}</span>
              </TableCell>
              <TableCell>
                {d.secondChair.before ? d.secondChair.before.name : '—'}
                {d.secondChair.why === 'leaves' && <LeavingBadge />}
                <span className="text-xs text-muted-foreground">{seatNote(d.secondChair, 'second')}</span>
              </TableCell>
              <TableCell><SeatProposal seat="lead" side={d.lead} /></TableCell>
              <TableCell><SeatProposal seat="second" side={d.secondChair} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

// "3 → 5", or "3" when it does not change
const BeforeAfter = ({ before, after, format = (v) => v }) => {
  const same = Math.abs((before || 0) - (after || 0)) < 1e-9;
  if (same) return <span>{format(before)}</span>;
  return (
    <span>
      <span className="text-muted-foreground">{format(before)}</span>
      {' → '}
      <span className={`font-semibold ${after > before ? 'text-orange-700' : 'text-green-700'}`}>{format(after)}</span>
    </span>
  );
};

// Everyone's lead and second-chair load before and after, by role (P10)
const LoadComparison = ({ groups, year }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Users className="h-5 w-5" />
        Load before and after
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        Each person&apos;s lead book and second-chair seats now and with the proposals applied. The lead carries a
        client&apos;s full effort and the second chair {Math.round(SECOND_CHAIR_EFFORT_SHARE * 100)}% of it; the people
        leaving end at zero.
      </p>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Leads</TableHead>
            <TableHead className="text-right">Lead revenue {year}</TableHead>
            <TableHead className="text-right">Lead effort</TableHead>
            <TableHead className="text-right">Second chair on</TableHead>
            <TableHead className="text-right">Second-chair revenue {year}</TableHead>
            <TableHead className="text-right">Second-chair effort</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <React.Fragment key={group.role}>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="pt-4 text-sm font-semibold">{group.label}</TableCell>
              </TableRow>
              {group.rows.map((r) => (
                <TableRow key={r.person.id} className={r.departing ? 'bg-orange-50' : undefined}>
                  <TableCell className="font-medium">
                    {r.person.name}
                    {r.departing && <LeavingBadge />}
                  </TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.lead.count} after={r.after.lead.count} /></TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.lead.revenue} after={r.after.lead.revenue} format={formatMoney} /></TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.lead.effort} after={r.after.lead.effort} format={formatEffort} /></TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.second.count} after={r.after.second.count} /></TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.second.revenue} after={r.after.second.revenue} format={formatMoney} /></TableCell>
                  <TableCell className={num}><BeforeAfter before={r.before.second.effort} after={r.after.second.effort} format={formatEffort} /></TableCell>
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

// Impact Heat Map Component
const ImpactHeatMap = ({ affectedClients, onClientClick }) => {
  const heatMapData = affectedClients.map(client => ({
    x: client.successionRisk || 5,
    y: usePortfolioStore.getState().getClientRevenue(client) || 0,
    name: formatClientName(client.name),
    client: client,
    risk: client.successionRisk || 5,
    revenue: usePortfolioStore.getState().getClientRevenue(client) || 0,
    practiceArea: (client.practiceArea && Array.isArray(client.practiceArea) && client.practiceArea.length > 0) 
      ? client.practiceArea[0] 
      : 'Other'
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border rounded-lg p-3 shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm">Succession Risk: {data.risk}/10</p>
          <p className="text-sm">Revenue: ${data.revenue.toLocaleString()}</p>
          <p className="text-sm">Practice Area: {data.practiceArea}</p>
          <p className="text-xs text-gray-500 mt-1">Click for details</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Impact Heat Map
        </CardTitle>
        <p className="text-sm text-gray-600">
          Clients positioned by succession risk (X-axis) and revenue (Y-axis). 
          Color indicates practice area.
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart data={heatMapData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              type="number" 
              dataKey="x" 
              name="Succession Risk"
              domain={[0, 10]}
              tickCount={11}
              label={{ value: 'Succession Risk (1-10)', position: 'insideBottom', offset: -10 }}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              name="Revenue"
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
              label={{ value: 'Annual Revenue', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter 
              name="Clients" 
              data={heatMapData} 
              fill="#8884d8"
              onClick={onClientClick}
              cursor="pointer"
            >
              {heatMapData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={PRACTICE_AREA_COLORS[entry.practiceArea] || PRACTICE_AREA_COLORS.Other}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        
        {/* Risk Zone Legend */}
        <div className="flex justify-between items-center mt-4 text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span>Low Risk (1-3)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-orange-500 rounded"></div>
              <span>Medium Risk (4-6)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-red-500 rounded"></div>
              <span>High Risk (7-10)</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Risk by practice area and succession risk, for the affected clients
const RiskSummary = ({ affectedClients }) => {
  const riskGroups = groupClientsBySuccessionRisk(affectedClients);
  
  const practiceAreaBreakdown = affectedClients.reduce((acc, client) => {
    const areas = client.practiceArea || ['Other'];
    const revenue = usePortfolioStore.getState().getClientRevenue(client);
    
    areas.forEach(area => {
      if (!acc[area]) acc[area] = { revenue: 0, count: 0, highRisk: 0 };
      acc[area].revenue += revenue;
      acc[area].count += 1;
      if (client.successionRisk > 6) acc[area].highRisk += 1;
    });
    
    return acc;
  }, {});

  const pieData = Object.entries(practiceAreaBreakdown).map(([area, data]) => ({
    name: area,
    value: data.revenue,
    count: data.count,
    highRisk: data.highRisk
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Risk on the Affected Clients
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Practice Area Vulnerability */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Building className="h-4 w-4" />
              Practice Area Vulnerability
            </h4>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={60}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PRACTICE_AREA_COLORS[entry.name] || PRACTICE_AREA_COLORS.Other} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue at Risk']} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h4 className="font-medium mb-3">Practice Area Risk Breakdown</h4>
            <div className="space-y-3">
              {Object.entries(practiceAreaBreakdown).map(([area, data]) => (
                <div key={area} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">{area}</div>
                    <div className="text-sm text-gray-600">
                      {data.count} clients • ${data.revenue.toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={data.highRisk > data.count / 2 ? 'destructive' : 'secondary'}>
                    {data.highRisk} high risk
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Risk Distribution Timeline */}
        <div>
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Risk Distribution
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{riskGroups.low.length}</div>
              <div className="text-sm text-green-800">Low Risk Clients</div>
              <div className="text-xs text-green-600 mt-1">Likely to retain</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{riskGroups.medium.length}</div>
              <div className="text-sm text-yellow-800">Medium Risk Clients</div>
              <div className="text-xs text-yellow-600 mt-1">Require attention</div>
            </div>
            <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{riskGroups.high.length}</div>
              <div className="text-sm text-red-800">High Risk Clients</div>
              <div className="text-xs text-red-600 mt-1">Critical intervention needed</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Client Categorization Component
const ClientCategorization = ({ affectedClients, onClientSelect }) => {
  const riskGroups = groupClientsBySuccessionRisk(affectedClients);
  const [activeCategory, setActiveCategory] = useState('high');

  const categories = [
    { key: 'high', label: 'Critical Risk', clients: riskGroups.high, color: 'red', bgColor: 'bg-red-50' },
    { key: 'medium', label: 'Moderate Risk', clients: riskGroups.medium, color: 'yellow', bgColor: 'bg-yellow-50' },
    { key: 'low', label: 'Low Risk', clients: riskGroups.low, color: 'green', bgColor: 'bg-green-50' }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Client Risk Categorization
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="grid w-full grid-cols-3">
            {categories.map(category => (
              <TabsTrigger key={category.key} value={category.key} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full bg-${category.color}-500`}></div>
                {category.label} ({category.clients.length})
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map(category => (
            <TabsContent key={category.key} value={category.key} className="space-y-3">
              <div className="max-h-64 overflow-y-auto space-y-2">
                {category.clients.map((client, index) => (
                  <div 
                    key={client.id || index} 
                    className={`p-3 border rounded-lg cursor-pointer hover:shadow-md ${category.bgColor}`}
                    onClick={() => onClientSelect(client)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{formatClientName(client.name)}</div>
                        <div className="text-sm text-gray-600">
                          ${usePortfolioStore.getState().getClientRevenue(client).toLocaleString()} • 
                          {client.practiceArea?.[0] || 'Other'}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge 
                            variant="outline"
                            className={getRelationshipTypeColor(client.relationshipType)}
                          >
                            {client.relationshipType?.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            Complexity: {client.transitionComplexity}/10
                          </span>
                        </div>
                      </div>
                      <Badge variant={getSuccessionRiskVariant(client.successionRisk)}>
                        {client.successionRisk}/10
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              {category.clients.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No clients in this risk category
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
};

// Main Impact Analysis Workbench Component. The scenario (who is leaving, the
// partner's picks) is in the store; SuccessionScenario runs the departure
// engine and passes its model in.
const ImpactAnalysisWorkbench = ({
  departure,
  people,
  departingIds,
  year,
  onToggleDeparting,
  onClearDeparting,
  onProceedToStage2
}) => {
  const [selectedClient, setSelectedClient] = useState(null);
  const rowsById = new Map(departure.before.rows.map((r) => [String(r.person.id), r]));
  const affectedClients = departure.decisions.map((d) => d.client);
  const highRisk = affectedClients.filter((client) => client.successionRisk > 6).length;
  const { totals } = departure;

  const handleClientClick = (data) => {
    if (data && data.client) {
      setSelectedClient(data.client);
    }
  };

  const tiles = [
    ['Clients affected', totals.clients],
    [`Revenue ${year} on them`, formatMoney(totals.revenue)],
    ['New leads needed', totals.newLeads],
    ['Second-chair seats to fill', totals.seatsToFill],
    ['High succession risk', highRisk],
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              Stage 1: Impact Analysis Workbench
            </div>
            <Badge variant="outline">
              Stage 1 of 3
            </Badge>
          </CardTitle>
          <p className="text-gray-600">
            Mark who may leave to see the clients that need a new lead or second chair, the proposed replacements,
            and everyone&apos;s load before and after.
          </p>
        </CardHeader>
      </Card>

      <WhoIsLeavingPanel
        people={people}
        departingIds={departingIds}
        rowsById={rowsById}
        onToggle={onToggleDeparting}
        onClear={onClearDeparting}
      />

      {departingIds.length > 0 && departure.decisions.length === 0 && (
        <Alert>
          <AlertDescription>
            {departure.departing.map((p) => p.name).join(', ') || 'Nobody marked'} {departure.departing.length === 1 ? 'holds' : 'hold'} no
            seat on any client: nobody&apos;s clients change.
          </AlertDescription>
        </Alert>
      )}

      {departure.decisions.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {tiles.map(([label, value]) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-xl font-semibold tabular-nums">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {departure.unresolved.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No active partner who is staying can lead{' '}
                {departure.unresolved.map((d) => formatClientName(d.client.name)).join(', ')}. The scenario leaves{' '}
                {departure.unresolved.length === 1 ? 'it' : 'them'} without a lead; add a partner on the People list or
                keep someone from leaving.
              </AlertDescription>
            </Alert>
          )}

          <AffectedClientsTable decisions={departure.decisions} year={year} onClientSelect={setSelectedClient} />

          <LoadComparison groups={departure.groups} year={year} />

          <RiskSummary affectedClients={affectedClients} />

          <ImpactHeatMap
            affectedClients={affectedClients}
            onClientClick={handleClientClick}
          />

          <ClientCategorization
            affectedClients={affectedClients}
            onClientSelect={setSelectedClient}
          />

          {/* Proceed to Stage 2 */}
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-green-800">Ready for Stage 2: Client Review</h4>
                  <p className="text-sm text-green-600 mt-1">
                    Review each affected client&apos;s transition and generate plans.
                  </p>
                </div>
                <Button onClick={onProceedToStage2} className="bg-green-600 hover:bg-green-700">
                  Proceed to Stage 2
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {departingIds.length === 0 && (
        <Card>
          <CardContent className="pt-12 pb-12">
            <div className="text-center space-y-4">
              <Users className="h-16 w-16 text-gray-400 mx-auto" />
              <div>
                <h3 className="text-lg font-semibold text-gray-700">Mark Who Is Leaving to Begin</h3>
                <p className="text-gray-500">
                  Choose the people who may leave to see the clients that need a decision and the load it moves.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Client Detail Modal would go here if needed */}
      {selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{formatClientName(selectedClient.name)}</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                  ×
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Client details would be rendered here */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Succession Risk</label>
                  <div className="text-2xl font-bold">
                    <Badge variant={getSuccessionRiskVariant(selectedClient.successionRisk)}>
                      {selectedClient.successionRisk}/10
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Annual Revenue</label>
                  <div className="text-2xl font-bold">
                    ${usePortfolioStore.getState().getClientRevenue(selectedClient).toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Relationship Type</label>
                  <div>
                    <Badge 
                      variant="outline"
                      className={getRelationshipTypeColor(selectedClient.relationshipType)}
                    >
                      {selectedClient.relationshipType?.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Transition Complexity</label>
                  <div className="text-xl font-bold">{selectedClient.transitionComplexity}/10</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ImpactAnalysisWorkbench;
