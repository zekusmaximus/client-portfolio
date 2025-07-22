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
import { formatClientName } from './utils/textUtils';

import ClientCardModal from './ClientCardModal';
import DataUploadManager from './DataUploadManager';

const DashboardView = () => {
  const {
    clients,
    fetchError,
    selectedClient,
    openClientModal,
    closeClientModal,
    retryFetchClients,
    getPartnershipHealth,
    setCurrentView
  } = usePortfolioStore();
  const [selectedTab, setSelectedTab] = useState('overview');
  const [showUpload, setShowUpload] = useState(false);

  // Color palette for charts
  const COLORS = {
    'Healthcare': '#8884d8',
    'Municipal': '#82ca9d',
    'Corporate': '#ffc658',
    'Energy': '#ff7300',
    'Financial': '#00ff88',
    'Other': '#8dd1e1',
    'Not Specified': '#d1d5db',
    // New status labels that match client cards
    'Active': '#22c55e',      // Green for active
    'Prospect': '#3b82f6',    // Blue for prospects
    'Inactive': '#6b7280',    // Gray for inactive
    'Former': '#f59e0b',      // Orange for former
    // Legacy status codes (for backward compatibility)
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
      const clientRevenue = usePortfolioStore.getState().getClientRevenue(client);

      if (client.practiceArea && Array.isArray(client.practiceArea) && client.practiceArea.length > 0) {
        client.practiceArea.forEach(area => {
          if (!practiceAreas[area]) {
            practiceAreas[area] = { count: 0, revenue: 0 };
          }
          practiceAreas[area].count++;
          practiceAreas[area].revenue += clientRevenue;
        });
      } else {
        // Handle clients without practice area or with empty array
        if (!practiceAreas['Not Specified']) {
          practiceAreas['Not Specified'] = { count: 0, revenue: 0 };
        }
        practiceAreas['Not Specified'].count++;
        practiceAreas['Not Specified'].revenue += clientRevenue;
      }
    });

    // Revenue by status - using new status labels that match client cards
    const revenueByStatus = {
      'Active': 0, 'Prospect': 0, 'Inactive': 0, 'Former': 0
    };
    const countByStatus = {
      'Active': 0, 'Prospect': 0, 'Inactive': 0, 'Former': 0
    };
    
    clients.forEach(client => {
      const clientRevenue = usePortfolioStore.getState().getClientRevenue(client); // This already returns 2025 revenue only
      const clientStatus = client.status || 'Prospect'; // Default to Prospect if status is null

      // Always use the status mapping to ensure consistency between legacy codes and new labels
      const statusMapping = {
        // New status labels (pass through as-is)
        'Active': 'Active',
        'Prospect': 'Prospect', 
        'Inactive': 'Inactive',
        'Former': 'Former',
        // Legacy status codes mapping
        'IF': 'Active',
        'P': 'Prospect', 
        'D': 'Former',
        'H': 'Inactive',
        // Handle lowercase versions (just in case)
        'active': 'Active',
        'prospect': 'Prospect',
        'inactive': 'Inactive',
        'former': 'Former'
      };
      
      const mappedStatus = statusMapping[clientStatus] || 'Prospect';
      revenueByStatus[mappedStatus] += clientRevenue;
      countByStatus[mappedStatus]++;
    });

    // Top clients by strategic value
    const topClients = [...clients]
      .sort((a, b) => {
        const aValue = parseFloat(a.strategicValue) || 0;
        const bValue = parseFloat(b.strategicValue) || 0;
        return bValue - aValue;
      })
      .slice(0, 10);

    // Risk analysis
    const highRiskClients = clients.filter(c => c.conflictRisk === 'High').length;
    const lowRenewalClients = clients.filter(c => {
      const renewalProb = parseFloat(c.renewalProbability);
      return !isNaN(renewalProb) && renewalProb < 0.5;
    }).length;

    // Calculate totals with robust null handling
    const totalRevenue = usePortfolioStore.getState().getTotalRevenue();

    const averageStrategicValue = clients.length > 0 ? 
      clients.reduce((sum, c) => {
        const value = parseFloat(c.strategicValue) || 0;
        return sum + value;
      }, 0) / clients.length : 0;

    return {
      practiceAreas,
      revenueByStatus,
      countByStatus,
      topClients,
      totalRevenue,
      averageStrategicValue,
      highRiskClients,
      lowRenewalClients
    };
  }, [clients]);



  // Prepare data for charts
  const scatterData = clients.map(client => {
    const revenue = usePortfolioStore.getState().getClientRevenue(client);
    return {
      x: revenue,
      y: parseFloat(client.strategicValue) || 0,
      name: formatClientName(client.name) || 'Unnamed Client',
      revenue: revenue,
      practiceArea: (client.practiceArea && Array.isArray(client.practiceArea) && client.practiceArea.length > 0)
        ? client.practiceArea[0]
        : 'Not Specified',
      status: client.status || 'H'
    };
  });

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
          <p className="text-sm">Revenue: ${(data.revenue || 0).toLocaleString()}</p>
          <p className="text-sm">Practice Area: {data.practiceArea || 'Not Specified'}</p>
          <p className="text-sm">Status: {data.status || 'Unknown'}</p>
        </div>
      );
    }
    return null;
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

        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setCurrentView('partnership')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Partnership Health</p>
                <p className="text-2xl font-bold">{getPartnershipHealth()}%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click for detailed analysis
                </p>
              </div>
              <Users className="h-8 w-8 text-green-500" />
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
                  2025 Revenue by Contract Status
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
                    <Badge variant="default" className="bg-green-500">Active</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="default" className="bg-blue-500">Prospect</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="secondary">Inactive</Badge>
                  </div>
                  <div className="text-center">
                    <Badge variant="outline">Former</Badge>
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
                Strategic Value vs Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart data={scatterData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Revenue"
                    unit="$"
                    domain={[0, 'dataMax + 10000']}
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
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Risk</th>
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
                          <td className="p-2">${revenue.toLocaleString()}</td>
                          <td className="p-2">
                            <Badge 
                              variant={client.status === 'IF' ? 'default' : 'secondary'}
                              className={client.status === 'IF' ? 'bg-green-500' : ''}
                            >
                              {client.status || 'Unknown'}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge 
                              variant={
                                client.conflictRisk === 'High' ? 'destructive' : 
                                client.conflictRisk === 'Medium' ? 'outline' : 'secondary'
                              }
                            >
                              {client.conflictRisk || 'Medium'} Conflict Risk
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

