import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart3,
  PieChart,
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import usePortfolioStore from './portfolioStore';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import ClientCard from './ClientCard';
import ClientCardModal from './ClientCardModal';

const DashboardView = () => {
  const {
    clients,
    clientsLoading,
    selectedClient,
    openClientModal,
    closeClientModal,
  } = usePortfolioStore();
  const [selectedTab, setSelectedTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [practiceFilter, setPracticeFilter] = useState('');
  const [lobbyistFilter, setLobbyistFilter] = useState('');

  // Color palette for charts
  const COLORS = {
    'Healthcare': '#8884d8',
    'Municipal': '#82ca9d',
    'Corporate': '#ffc658',
    'Energy': '#ff7300',
    'Financial': '#00ff88',
    'Other': '#8dd1e1',
    'IF': '#22c55e',
    'P': '#3b82f6',
    'D': '#6b7280',
    'H': '#f59e0b'
  };

  // Calculate analytics data
  const analytics = useMemo(() => {
    if (!clients || clients.length === 0) return null;

    // Practice area breakdown
    const practiceAreas = {};
    clients.forEach(client => {
      if (client.practiceArea && Array.isArray(client.practiceArea)) {
        client.practiceArea.forEach(area => {
          if (!practiceAreas[area]) {
            practiceAreas[area] = { count: 0, revenue: 0 };
          }
          practiceAreas[area].count++;
          practiceAreas[area].revenue += client.averageRevenue || 0;
        });
      } else {
        // Handle clients without practice area
        if (!practiceAreas['Other']) {
          practiceAreas['Other'] = { count: 0, revenue: 0 };
        }
        practiceAreas['Other'].count++;
        practiceAreas['Other'].revenue += client.averageRevenue || 0;
      }
    });

    // Revenue by status
    const revenueByStatus = {
      'IF': 0, 'P': 0, 'D': 0, 'H': 0
    };
    const countByStatus = {
      'IF': 0, 'P': 0, 'D': 0, 'H': 0
    };
    
    clients.forEach(client => {
      revenueByStatus[client.status] += client.averageRevenue || 0;
      countByStatus[client.status]++;
    });

    // Top clients by strategic value
    const topClients = [...clients]
      .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0))
      .slice(0, 10);

    // Risk analysis
    const highRiskClients = clients.filter(c => c.conflictRisk === 'High').length;
    const lowRenewalClients = clients.filter(c => (c.renewalProbability || 0) < 0.5).length;

    return {
      practiceAreas,
      revenueByStatus,
      countByStatus,
      topClients,
      totalRevenue: clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
      averageStrategicValue: clients.length > 0 ? 
        clients.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clients.length : 0,
      highRiskClients,
      lowRenewalClients
    };
  }, [clients]);

  /* ---------- Client grid helpers ---------- */
  const filteredClients = useMemo(() => {
    return clients
      .filter((c) =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase().trim())
      )
      .filter((c) =>
        practiceFilter ? c.practiceArea?.includes(practiceFilter) : true
      )
      .filter((c) =>
        lobbyistFilter ? c.primaryLobbyist === lobbyistFilter : true
      );
  }, [clients, searchTerm, practiceFilter, lobbyistFilter]);

  // Prepare data for charts
  const scatterData = clients.map(client => ({
    x: client.timeCommitment || 0,
    y: client.strategicValue || 0,
    name: client.name,
    revenue: client.averageRevenue || 0,
    practiceArea: client.practiceArea?.[0] || 'Other',
    status: client.status
  }));

  const pieData = analytics ? Object.entries(analytics.practiceAreas).map(([area, data]) => ({
    name: area,
    value: data.revenue,
    count: data.count
  })) : [];

  const barData = analytics ? Object.entries(analytics.revenueByStatus).map(([status, revenue]) => ({
    status,
    revenue,
    count: analytics.countByStatus[status]
  })) : [];

  if (!analytics) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            No client data available. Please upload your portfolio data first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm">Strategic Value: {data.y?.toFixed(2)}</p>
          <p className="text-sm">Time Commitment: {data.x} hrs/month</p>
          <p className="text-sm">Revenue: ${data.revenue?.toLocaleString()}</p>
          <p className="text-sm">Practice Area: {data.practiceArea}</p>
          <p className="text-sm">Status: {data.status}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* ---------- Phase 3: Client Grid & Filters ---------- */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <Input
            placeholder="Search clients…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="md:flex-1"
          />
          <Select
            value={practiceFilter}
            onChange={(e) => setPracticeFilter(e.target.value)}
          >
            <option value="">All Practice Areas</option>
            {Array.from(
              new Set(clients.flatMap((c) => c.practiceArea || []))
            ).map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </Select>
          <Select
            value={lobbyistFilter}
            onChange={(e) => setLobbyistFilter(e.target.value)}
          >
            <option value="">All Lobbyists</option>
            {Array.from(new Set(clients.map((c) => c.primaryLobbyist))).map(
              (lb) => (
                <option key={lb} value={lb}>
                  {lb}
                </option>
              )
            )}
          </Select>
          <Button onClick={() => openClientModal(null)}>Add New Client</Button>
        </div>

        {clientsLoading ? (
          <p className="text-center py-8">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredClients.map((c) => (
              <ClientCard key={c.id} client={c} />
            ))}
            {filteredClients.length === 0 && (
              <p className="col-span-full text-center text-muted-foreground">
                No clients match the current filters.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">${analytics.totalRevenue.toLocaleString()}</p>
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

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Risk Clients</p>
                <p className="text-2xl font-bold">{analytics.highRiskClients}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analysis">Strategic Analysis</TabsTrigger>
          <TabsTrigger value="clients">Client Rankings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Portfolio Composition */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5" />
                  Portfolio Composition by Practice Area
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.name] || COLORS.Other} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Revenue Pipeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Revenue by Contract Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']} />
                    <Bar dataKey="revenue" fill="#8884d8">
                      {barData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.status]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
                  <div className="text-center">
                    <Badge variant="default" className="bg-green-500">IF: In Force</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="default" className="bg-blue-500">P: Proposal</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="secondary">D: Done</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="outline">H: Hold</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          {/* Strategic Quadrant Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Strategic Value vs Time Commitment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart data={scatterData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="x" 
                    name="Time Commitment" 
                    unit=" hrs/month"
                    domain={[0, 'dataMax + 10']}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="y" 
                    name="Strategic Value" 
                    domain={[0, 'dataMax + 1']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Scatter 
                    name="Clients" 
                    data={scatterData} 
                    fill="#8884d8"
                  >
                    {scatterData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[entry.practiceArea] || COLORS.Other} 
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">
                  Bubble size represents revenue. Top-right quadrant shows high-value, efficient clients.
                </p>
              </div>
            </CardContent>
          </Card>
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
                      <th className="text-left p-2 font-medium">Time (hrs/month)</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topClients.map((client, index) => (
                      <tr key={client.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-medium">{index + 1}</td>
                        <td className="p-2">{client.name}</td>
                        <td className="p-2">
                          <Badge variant="outline">
                            {(client.strategicValue || 0).toFixed(1)}
                          </Badge>
                        </td>
                        <td className="p-2">${(client.averageRevenue || 0).toLocaleString()}</td>
                        <td className="p-2">{client.timeCommitment || 0}</td>
                        <td className="p-2">
                          <Badge 
                            variant={client.status === 'IF' ? 'default' : 'secondary'}
                            className={client.status === 'IF' ? 'bg-green-500' : ''}
                          >
                            {client.status}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge 
                            variant={
                              client.conflictRisk === 'High' ? 'destructive' : 
                              client.conflictRisk === 'Medium' ? 'outline' : 'secondary'
                            }
                          >
                            {client.conflictRisk}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {/* Modal hub */}
      <ClientCardModal
        open={Boolean(selectedClient)}
        onOpenChange={(open) => {
          if (!open) closeClientModal();
        }}
        client={selectedClient}
      />
    </div>
  );
};

export default DashboardView;

