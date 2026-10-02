import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart3,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  Target,
  AlertTriangle
} from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import usePortfolioStore from './portfolioStore';
import { formatClientName } from './utils/textUtils';
import { getSuccessionRiskVariant, getRelationshipTypeColor } from './utils/successionUtils';
import DataUploadManager from './DataUploadManager';
import PersonLoadSheet from './components/PersonLoadSheet';
import { partnershipModel, bookYears, formatMoney, practiceAreasOf } from './utils/load';
import { revenueForYear } from './utils/revenue';
import { areaRevenue, clientGroup, groupOf, legendGroups, orderAreas, NOT_SET } from './utils/practiceAreas';
import GroupLegend from './components/GroupLegend';
import { exposureModel } from './utils/exposure';
import { ratedForStickiness } from './utils/askTheBook';

// Exposure in the book's words (utils/book.cjs, exposureSection): "1 client",
// and the share only while the book has revenue in the year
const clientCount = (n) => `${n} ${n === 1 ? 'client' : 'clients'}`;
const bookShare = (band) => (band.share === null ? '' : ` (${band.share}% of the book's revenue)`);

// One band of the Exposure sub-tab: its count, revenue and share, then one row
// per lead in the book's order. A lead's name opens their sheet; the clients
// without a lead have no one to open, and get a lead on Client Details.
const ExposureBand = ({ testId, label, band, year, onSelect, onClientDetails }) => (
  <div data-testid={testId} className="space-y-2">
    <h3 className="text-sm font-semibold" data-testid="exposure-band-head">
      {label}: {clientCount(band.count)}, {formatMoney(band.revenue)}{bookShare(band)}
    </h3>
    {band.count > 0 ? (
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead className="w-24 text-right">Clients</TableHead>
            <TableHead className="w-40 text-right">Revenue {year}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {band.byLead.map((entry) => (
            <TableRow key={entry.person ? String(entry.person.id) : 'no-lead'} data-testid="exposure-lead-row">
              <TableCell>
                {entry.person ? (
                  <button
                    type="button"
                    data-testid="exposure-lead"
                    className="font-medium text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                    onClick={() => onSelect(entry.person.id)}
                  >
                    {entry.name}
                  </button>
                ) : (
                  <>
                    <span data-testid="exposure-lead">{entry.name}</span>
                    <span className="text-muted-foreground">
                      {' '}(set one in{' '}
                      <button type="button" className="underline" onClick={onClientDetails}>
                        Client Details
                      </button>
                      )
                    </span>
                  </>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{entry.count}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(entry.revenue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <p className="text-sm text-muted-foreground">No clients.</p>
    )}
  </div>
);

const DashboardView = () => {
  const {
    clients,
    fetchError,
    openClientModal,
    retryFetchClients,
    setCurrentView,
    getSuccessionAnalytics
  } = usePortfolioStore();
  const people = usePortfolioStore((s) => s.people);
  const reportingYear = usePortfolioStore((s) => s.getReportingYear());
  const revenueOf = useMemo(() => (client) => revenueForYear(client, reportingYear), [reportingYear]);
  // Exposure (T5): the book's figures, from the page's port of them
  const exposure = useMemo(() => exposureModel(clients, revenueOf), [clients, revenueOf]);
  // Who's carrying what (P10), for the sheet a lead's name opens
  const loadModel = useMemo(() => partnershipModel(people, clients, revenueOf), [people, clients, revenueOf]);
  const years = useMemo(() => bookYears(clients), [clients]);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const isSelected = (person) => person !== null && selectedLeadId !== null && String(person.id) === String(selectedLeadId);
  const selectedLeadRow = loadModel.rows.find((r) => isSelected(r.person)) || null;
  // The selected lead's entry in a band, or null when they have no client there
  const leadEntry = (band) => band.byLead.find((e) => isSelected(e.person)) || null;
  const [selectedTab, setSelectedTab] = useState('overview');
  const [showUpload, setShowUpload] = useState(false);

  // Calculate analytics data
  const analytics = useMemo(() => {
    if (!clients || clients.length === 0) return null;

    // Top clients by strategic value
    const topClients = [...clients]
      .sort((a, b) => {
        const aValue = parseFloat(a.strategicValue) || 0;
        const bValue = parseFloat(b.strategicValue) || 0;
        return bValue - aValue;
      })
      .slice(0, 10);

    // Calculate totals with robust null handling
    const totalRevenue = usePortfolioStore.getState().getTotalRevenue();

    const averageStrategicValue = clients.length > 0 ? 
      clients.reduce((sum, c) => {
        const value = parseFloat(c.strategicValue) || 0;
        return sum + value;
      }, 0) / clients.length : 0;

    // Succession analytics
    const successionAnalytics = getSuccessionAnalytics();

    return {
      topClients,
      totalRevenue,
      averageStrategicValue,
      successionAnalytics
    };
  }, [clients]);

  // Revenue by practice area, a bar each, coloured by the area's group
  // (docs/plans/tier-3.md, section 18, U45 (a)); until WP13 a pie of twelve
  // areas, five of them with a colour of their own
  const areaBars = useMemo(
    () => areaRevenue(clients, revenueOf).map((bar) => ({ ...bar, label: bar.retired ? `${bar.area} (retired)` : bar.area })),
    [clients, revenueOf]
  );

  // Prepare data for charts: one scatter series per group, each with its
  // colour and its own marker shape (seven hues cannot all be told apart
  // where any two points may touch; the shape is the second encoding)
  const scatterData = clients.map(client => {
    const revenue = usePortfolioStore.getState().getClientRevenue(client);
    return {
      x: revenue,
      y: parseFloat(client.strategicValue) || 0,
      name: formatClientName(client.name) || 'Unnamed Client',
      revenue: revenue,
      areas: orderAreas(practiceAreasOf(client)),
      group: clientGroup(client)
    };
  });
  const scatterGroups = legendGroups(scatterData.map((d) => d.group))
    .map((g) => ({ ...g, data: scatterData.filter((d) => d.group === g.group) }));

  if (!analytics) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-12 pb-12">
            <div className="text-center space-y-4">
              {fetchError ? (
                <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto" />
              ) : (
                <Users className="h-16 w-16 text-muted-foreground mx-auto" />
              )}
              <div>
                <h3 className="text-lg font-semibold">
                  {fetchError ? 'Connection Error' : 'No clients yet'}
                </h3>
                <p className="text-muted-foreground">
                  {fetchError || 'Get started by adding your first client or uploading your portfolio data.'}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => openClientModal(null)} size="lg">
                  <Users className="h-4 w-4 mr-2" />
                  {fetchError ? 'Add Client Offline' : 'Add Your First Client'}
                </Button>
                {fetchError ? (
                  <Button variant="outline" size="lg" onClick={retryFetchClients}>
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Retry Connection
                  </Button>
                ) : (
                  <Button variant="outline" size="lg" onClick={() => setShowUpload(true)}>
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Upload Portfolio Data
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Upload Modal - moved inside no-analytics return */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">Upload Client Data</h2>
                  <Button variant="ghost" size="sm" onClick={() => setShowUpload(false)}>
                    ×
                  </Button>
                </div>
                <DataUploadManager />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-semibold">{data.name || 'Unnamed Client'}</p>
          <p className="text-sm">Strategic Value: {(data.y || 0).toFixed(2)}</p>
          <p className="text-sm">Revenue: {formatMoney(data.revenue)}</p>
          <p className="text-sm">Practice areas: {data.areas?.length ? data.areas.join(', ') : NOT_SET}</p>
          <p className="text-sm text-muted-foreground">Group: {data.group}</p>
        </div>
      );
    }
    return null;
  };

  // A bar's tooltip: the area, its group, the revenue and the clients
  const AreaTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const bar = payload[0].payload;
    return (
      <div className="bg-background border rounded-lg p-3 shadow-lg">
        <p className="font-semibold">{bar.area}</p>
        <p className="text-sm text-muted-foreground">
          {bar.area === NOT_SET ? 'No practice area' : bar.retired ? `Retired from the list; counted with ${groupOf(bar.area)}` : `Group: ${bar.group}`}
        </p>
        <p className="text-sm">{reportingYear} revenue: {formatMoney(bar.revenue)}</p>
        <p className="text-sm">{bar.count} {bar.count === 1 ? 'client' : 'clients'}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">


      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">{formatMoney(analytics.totalRevenue)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Clients</p>
                <p className="text-2xl font-bold">{clients.length}</p>
              </div>
              <Users className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Strategic Value</p>
                <p className="text-2xl font-bold">{analytics.averageStrategicValue.toFixed(1)}</p>
              </div>
              <Target className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        {/* Exposure (T5): the book's thin-relationship revenue, with the
            clients nobody has rated beside it, never counted as safe */}
        <Card
          data-testid="exposure-card"
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedTab('exposure')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Exposure: thin relationships</p>
                {exposure.rated > 0 ? (
                  <>
                    <p className="text-2xl font-bold">{formatMoney(exposure.thin.revenue)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {`${exposure.thin.share === null ? `In ${reportingYear}` : `${exposure.thin.share}% of ${reportingYear} revenue`}, ${clientCount(exposure.thin.count)} rated 1 or 2`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`Not rated: ${formatMoney(exposure.unrated.revenue)}${exposure.unrated.share === null ? '' : ` (${exposure.unrated.share}%)`}, unknown`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold">Not rated yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      No client is rated for Stickiness: {formatMoney(exposure.unrated.revenue)} in {reportingYear}, unknown
                    </p>
                  </>
                )}
                <p className="text-xs text-muted-foreground">Click for each lead</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="exposure">Exposure</TabsTrigger>
          <TabsTrigger value="analysis">Strategic Analysis</TabsTrigger>
          <TabsTrigger value="succession">Succession Planning</TabsTrigger>
          <TabsTrigger value="clients">Client Rankings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Portfolio composition: revenue by practice area, sorted, each
              bar its group's colour (docs/plans/tier-3.md, section 18, U45 (a)) */}
          <Card data-testid="area-revenue">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Revenue by Practice Area, {reportingYear}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Each bar is a practice area&apos;s {reportingYear} revenue, largest first, coloured by its group. A client
                counts under each of its areas, so one with two areas adds to both bars.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ResponsiveContainer width="100%" height={Math.max(160, areaBars.length * 32 + 48)}>
                <BarChart data={areaBars} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="#e1e0d9" />
                  <XAxis type="number" tickFormatter={formatMoney} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="label" width={240} interval={0} tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ fill: 'rgba(11, 11, 11, 0.04)' }} content={<AreaTooltip />} />
                  <Bar dataKey="revenue" barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {areaBars.map((bar) => (
                      <Cell key={bar.area} fill={bar.color} />
                    ))}
                    <LabelList dataKey="revenue" position="right" formatter={(value) => formatMoney(value)} style={{ fontSize: 12, fill: '#52514e' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <GroupLegend items={legendGroups(areaBars.map((bar) => bar.group))} testId="area-revenue-legend" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exposure" className="space-y-6">
          {/* The book's `## Exposure` figures by lead (T5); no share per lead
              and no second-chair figure, as the book has neither */}
          <Card data-testid="exposure-breakdown">
            <CardHeader>
              <CardTitle className="flex items-center gap-2" data-testid="exposure-heading">
                <AlertTriangle className="h-5 w-5" />
                Exposure: {reportingYear} revenue on thin relationships
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                The {reportingYear} revenue of the clients rated Stickiness 1 or 2, by lead. Clients not rated are
                counted apart, as unknown, never as safe. These are the figures the AI is given. Rated for
                Stickiness: <span data-testid="exposure-rated">{ratedForStickiness(clients)} of {clients.length}</span>.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <ExposureBand
                testId="exposure-thin"
                label="Rated 1 or 2 (thin)"
                band={exposure.thin}
                year={reportingYear}
                onSelect={setSelectedLeadId}
                onClientDetails={() => setCurrentView('client-details')}
              />
              <ExposureBand
                testId="exposure-unrated"
                label="Not rated (unknown, not safe)"
                band={exposure.unrated}
                year={reportingYear}
                onSelect={setSelectedLeadId}
                onClientDetails={() => setCurrentView('client-details')}
              />
              <p className="text-sm" data-testid="exposure-solid">
                Rated 3 to 5: {clientCount(exposure.solid.count)}, {formatMoney(exposure.solid.revenue)}
                {bookShare(exposure.solid)}.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          {/* Strategic Quadrant Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Strategic Value vs Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart>
                  <CartesianGrid stroke="#e1e0d9" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Revenue"
                    tickFormatter={formatMoney}
                    domain={[0, 'dataMax + 10000']}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Strategic Value"
                    domain={[0, 'dataMax + 1']}
                  />
                  {/* One marker size, about 10px across, so the white ring leaves at least 8px of colour */}
                  <ZAxis range={[100, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  {scatterGroups.map((g) => (
                    <Scatter
                      key={g.group}
                      name={g.group}
                      data={g.data}
                      fill={g.color}
                      shape={g.shape}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                <GroupLegend items={scatterGroups} shapes testId="scatter-legend" />
                <p className="text-sm text-muted-foreground">
                  Each point is a client: its {reportingYear} revenue against its strategic value. Its colour and shape are the
                  group of its first practice area.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="succession" className="space-y-6">
          {/* Succession Planning Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">High Risk Clients</p>
                    <p className="text-2xl font-bold text-red-600">{analytics.successionAnalytics.riskDistribution.high}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Medium Risk Clients</p>
                    <p className="text-2xl font-bold text-yellow-600">{analytics.successionAnalytics.riskDistribution.medium}</p>
                  </div>
                  <Clock className="h-8 w-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Low Risk Clients</p>
                    <p className="text-2xl font-bold text-green-600">{analytics.successionAnalytics.riskDistribution.low}</p>
                  </div>
                  <Target className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Complexity</p>
                    <p className="text-2xl font-bold">{analytics.successionAnalytics.averageComplexity}</p>
                  </div>
                  <BarChart3 className="h-8 w-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Relationship Type Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Relationship Type Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(analytics.successionAnalytics.relationshipTypes).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${getRelationshipTypeColor(type).replace('bg', 'bg').replace('text-', 'bg-')}`} />
                        <span className="capitalize">{type}</span>
                      </div>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Clients Needing Attention */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Clients Needing Attention
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.successionAnalytics.highestRiskClients.map((client, index) => (
                    <div key={client.id || index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{formatClientName(client.name)}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge 
                            variant="outline"
                            className={`text-xs ${getRelationshipTypeColor(client.relationshipType)}`}
                          >
                            {client.relationshipType?.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-gray-600">
                            Complexity: {client.transitionComplexity}/10
                          </span>
                        </div>
                      </div>
                      <Badge variant={getSuccessionRiskVariant(client.successionRisk)}>
                        Risk: {client.successionRisk}/10
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="clients" className="space-y-6">
          {/* Client Rankings Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Top Clients by Strategic Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium">Rank</th>
                      <th className="text-left p-2 font-medium">Client</th>
                      <th className="text-left p-2 font-medium">Strategic Value</th>
                      <th className="text-left p-2 font-medium">Revenue</th>
                      <th className="text-left p-2 font-medium">Conflict Risk</th>
                      <th className="text-left p-2 font-medium">Succession Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topClients.map((client, index) => {
                      const strategicValue = parseFloat(client.strategicValue) || 0;
                      const revenue = usePortfolioStore.getState().getClientRevenue(client);

                      // Determine strategic value badge variant based on value
                      const getStrategicValueVariant = (value) => {
                        if (value >= 7) return 'default';
                        if (value >= 4) return 'secondary';
                        return 'destructive';
                      };

                      return (
                        <tr key={client.id || index} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">{index + 1}</td>
                          <td className="p-2">{formatClientName(client.name) || 'Unnamed Client'}</td>
                          <td className="p-2">
                            <Badge variant={getStrategicValueVariant(strategicValue)}>
                              {strategicValue.toFixed(1)}
                            </Badge>
                          </td>
                          <td className="p-2">{formatMoney(revenue)}</td>
                          <td className="p-2">
                            <Badge 
                              variant={
                                client.conflictRisk === 'High' ? 'destructive' : 
                                client.conflictRisk === 'Medium' ? 'outline' : 'secondary'
                              }
                            >
                              {client.conflictRisk || 'Medium'}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge variant={getSuccessionRiskVariant(client.successionRisk)}>
                              {client.successionRisk}/10
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* A lead's sheet, opened from the Exposure sub-tab: their thin and
          not-rated clients first, then the lead book as the Partnership tab
          shows it */}
      <PersonLoadSheet
        row={selectedLeadRow}
        year={reportingYear}
        years={years}
        revenueOf={revenueOf}
        revenueOfYear={revenueForYear}
        exposure={selectedLeadRow ? { thin: leadEntry(exposure.thin), unrated: leadEntry(exposure.unrated) } : null}
        onClose={() => setSelectedLeadId(null)}
      />
    </div>
  );
};

export default DashboardView;

