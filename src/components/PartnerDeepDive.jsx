import { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';
import { formatClientName, formatPartnerName } from '../utils/textUtils';

const PartnerDeepDive = ({ partner, onClose }) => {
  const { clients, getClientById, getClientRevenue } = usePortfolioStore();

  const partnerData = useMemo(() => {
    if (!partner || !clients?.length) return {
      partnerClients: [],
      teamMemberClients: [],
      practiceAreaChartData: [],
      revenueAnalysis: [],
      monthlyWorkload: []
    };

    const partnerClients = partner.clients?.map(clientId => getClientById(clientId)).filter(Boolean) || [];
    const teamMemberClients = partner.teamMemberClients?.map(clientId => getClientById(clientId)).filter(Boolean) || [];
    
    // Practice area breakdown
    const practiceAreaData = {};
    partnerClients.forEach(client => {
      const areas = Array.isArray(client.practice_area) ? client.practice_area : [client.practice_area].filter(Boolean);
      areas.forEach(area => {
        if (!practiceAreaData[area]) practiceAreaData[area] = { count: 0, revenue: 0 };
        practiceAreaData[area].count++;
        practiceAreaData[area].revenue += getClientRevenue(client);
      });
    });

    const practiceAreaChartData = Object.entries(practiceAreaData).map(([area, data]) => ({
      name: area || 'Unspecified',
      value: data.count,
      revenue: data.revenue
    }));

    // Revenue analysis - simplified for demonstration
    const currentYear = new Date().getFullYear();
    const revenueAnalysis = [
      { year: currentYear - 2, revenue: partner.totalRevenue * 0.8 },
      { year: currentYear - 1, revenue: partner.totalRevenue * 0.9 },
      { year: currentYear, revenue: partner.totalRevenue }
    ];

    // Workload analysis - monthly grid
    const monthlyWorkload = Array.from({ length: 12 }, (_, month) => ({
      month: new Date(2025, month).toLocaleString('default', { month: 'short' }),
      activeClients: Math.floor(Math.random() * partnerClients.length) + 1 // Simplified
    }));

    return {
      partnerClients,
      teamMemberClients,
      practiceAreaChartData,
      revenueAnalysis,
      monthlyWorkload
    };
  }, [partner, clients, getClientById, getClientRevenue]);

  if (!partner) return null;

  const colors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];
  
  const formatRevenue = (revenue) => {
    if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
    if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
    return `$${revenue.toFixed(0)}`;
  };

  const getStrategicValueColor = (value) => {
    if (value > 7) return 'text-green-600';
    if (value > 4) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Sheet open={!!partner} onOpenChange={onClose}>
      <SheetContent className="w-[600px] sm:max-w-full">
        <SheetHeader>
          <SheetTitle>{formatPartnerName(partner.name)}'s Portfolio</SheetTitle>
          <SheetClose onClick={onClose} />
        </SheetHeader>
        
        {partner.isDeparting && (
          <Alert className="mx-6 mt-4 bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This partner is marked as departing. Consider redistribution planning.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="mx-6 grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="clients">Client List</TabsTrigger>
            <TabsTrigger value="revenue">Revenue Analysis</TabsTrigger>
            <TabsTrigger value="workload">Workload</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="px-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Total Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatRevenue(partner.totalRevenue)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Client Count</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{partner.clientCount}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Avg Strategic Value</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{partner.avgStrategicValue?.toFixed(1) || '0.0'}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Capacity Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{Math.round(partner.capacityUsed)}%</div>
                </CardContent>
              </Card>
            </div>

            {partnerData.practiceAreaChartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Practice Area Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={partnerData.practiceAreaChartData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {partnerData.practiceAreaChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="clients" className="px-6 space-y-6">
            {/* Primary Clients */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Primary Clients ({partnerData.partnerClients.length})</h3>
              {partnerData.partnerClients.length === 0 ? (
                <div className="text-center py-4 text-gray-500 bg-gray-50 rounded-lg">
                  No clients assigned as primary
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client Name</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Strategic Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partnerData.partnerClients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">{formatClientName(client.name)}</TableCell>
                        <TableCell>{formatRevenue(getClientRevenue(client))}</TableCell>
                        <TableCell className={getStrategicValueColor(client.strategicValue || 0)}>
                          {client.strategicValue?.toFixed(1) || '0.0'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{client.status || 'Unknown'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Team Member Clients */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Team Member Clients ({partnerData.teamMemberClients.length})</h3>
              <p className="text-sm text-gray-600 mb-3">
                Clients where this partner is part of the team but not the primary lobbyist. These don't count toward totals but indicate additional workload.
              </p>
              {partnerData.teamMemberClients.length === 0 ? (
                <div className="text-center py-4 text-gray-500 bg-gray-50 rounded-lg">
                  No team member assignments
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client Name</TableHead>
                      <TableHead>Primary Lobbyist</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Strategic Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partnerData.teamMemberClients.map((client) => (
                      <TableRow key={client.id} className="bg-blue-50">
                        <TableCell className="font-medium">{formatClientName(client.name)}</TableCell>
                        <TableCell className="text-sm text-gray-600">{client.primary_lobbyist || 'Unassigned'}</TableCell>
                        <TableCell>{formatRevenue(getClientRevenue(client))}</TableCell>
                        <TableCell className={getStrategicValueColor(client.strategicValue || 0)}>
                          {client.strategicValue?.toFixed(1) || '0.0'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{client.status || 'Unknown'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="px-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Revenue Trend (Last 3 Years)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={partnerData.revenueAnalysis}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={formatRevenue} />
                    <Tooltip formatter={(value) => [formatRevenue(value), 'Revenue']} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Total Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold">{formatRevenue(partner.totalRevenue)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Avg per Client</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold">
                    {partner.clientCount > 0 ? formatRevenue(partner.totalRevenue / partner.clientCount) : '$0'}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">YoY Growth</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold text-green-600">+11.1%</div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="workload" className="px-6">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Client Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {partnerData.monthlyWorkload.map((month) => (
                    <div
                      key={month.month}
                      className="p-3 rounded border text-center"
                      style={{
                        backgroundColor: `rgba(59, 130, 246, ${Math.min(month.activeClients / 10, 1) * 0.3 + 0.1})`
                      }}
                    >
                      <div className="text-sm font-medium">{month.month}</div>
                      <div className="text-lg font-bold">{month.activeClients}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default PartnerDeepDive;