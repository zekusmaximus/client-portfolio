import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Users,
  AlertTriangle,
  DollarSign,
  TrendingDown,
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
  BarChart,
  Bar,
  PieChart,
  Pie,
  Legend
} from 'recharts';
import usePortfolioStore from '../../portfolioStore';
import { formatClientName } from '../../utils/textUtils';
import { 
  getSuccessionRiskVariant, 
  getRelationshipTypeColor, 
  groupClientsBySuccessionRisk 
} from '../../utils/successionUtils';

// Risk level colors for heat map
const RISK_COLORS = {
  1: '#22c55e', 2: '#22c55e', 3: '#22c55e', // Low risk - Green
  4: '#f59e0b', 5: '#f59e0b', 6: '#f59e0b', // Medium risk - Orange  
  7: '#ef4444', 8: '#ef4444', 9: '#ef4444', 10: '#ef4444' // High risk - Red
};

const PRACTICE_AREA_COLORS = {
  'Healthcare': '#8884d8',
  'Municipal': '#82ca9d',
  'Corporate': '#ffc658',
  'Energy': '#ff7300',
  'Financial': '#00ff88',
  'Other': '#8dd1e1'
};

// Partner Selection Panel Component
const PartnerSelectionPanel = ({ partners, selectedPartners, onPartnerToggle, impactPreview }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Select Departing Partners
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
          {partners.map((partner) => (
            <div key={partner.id} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50">
              <Checkbox
                id={partner.id}
                checked={selectedPartners.includes(partner.id)}
                onCheckedChange={() => onPartnerToggle(partner.id)}
              />
              <label htmlFor={partner.id} className="flex-1 cursor-pointer">
                <div className="font-medium">{partner.name}</div>
                <div className="text-sm text-gray-600">
                  {partner.clientCount || 0} clients • ${(partner.totalRevenue || 0).toLocaleString()}
                </div>
              </label>
            </div>
          ))}
        </div>

        {/* Real-time Impact Preview */}
        {selectedPartners.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <h4 className="font-medium text-orange-800 mb-2">Impact Preview</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-orange-700">Affected Clients:</span>
                <span className="font-semibold ml-1">{impactPreview.affectedClients}</span>
              </div>
              <div>
                <span className="text-orange-700">Revenue at Risk:</span>
                <span className="font-semibold ml-1">${impactPreview.revenueAtRisk.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-orange-700">High Risk Clients:</span>
                <span className="font-semibold ml-1">{impactPreview.highRiskClients}</span>
              </div>
              <div>
                <span className="text-orange-700">Affected Practice Areas:</span>
                <span className="font-semibold ml-1">{impactPreview.practiceAreas}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

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

// Financial Impact Summary Component
const FinancialImpactSummary = ({ impactData, affectedClients }) => {
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
          Financial Impact Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-700">Total Revenue at Risk</p>
                <p className="text-2xl font-bold text-blue-900">
                  ${impactData.totalRevenueAtRisk.toLocaleString()}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-red-700">High Risk Clients</p>
                <p className="text-2xl font-bold text-red-900">{riskGroups.high.length}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </div>

          <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-700">Retention Probability</p>
                <p className="text-2xl font-bold text-orange-900">
                  {(impactData.estimatedRetentionRate * 100).toFixed(1)}%
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-700">Projected Loss</p>
                <p className="text-2xl font-bold text-purple-900">
                  ${impactData.projectedRevenueLoss.toLocaleString()}
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>

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

  const activeClients = categories.find(cat => cat.key === activeCategory)?.clients || [];

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

// Main Impact Analysis Workbench Component
const ImpactAnalysisWorkbench = ({ onProceedToStage2 }) => {
  const { clients, partners, fetchPartners } = usePortfolioStore();
  const [selectedPartners, setSelectedPartners] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  
  // Fetch partners on mount
  React.useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  // Calculate partners with client data
  const partnersWithData = useMemo(() => {
    return partners.map(partner => {
      const partnerClients = clients.filter(client => client.primary_lobbyist === partner.name);
      return {
        ...partner,
        clientCount: partnerClients.length,
        totalRevenue: partnerClients.reduce((sum, client) => 
          sum + usePortfolioStore.getState().getClientRevenue(client), 0
        )
      };
    });
  }, [partners, clients]);

  // Calculate affected clients based on selected partners
  const affectedClients = useMemo(() => {
    const selectedPartnerNames = selectedPartners.map(id => 
      partnersWithData.find(p => p.id === id)?.name
    ).filter(Boolean);

    return clients.filter(client => 
      selectedPartnerNames.includes(client.primary_lobbyist)
    );
  }, [selectedPartners, partnersWithData, clients]);

  // Calculate impact preview data
  const impactPreview = useMemo(() => {
    const totalRevenue = affectedClients.reduce((sum, client) => 
      sum + usePortfolioStore.getState().getClientRevenue(client), 0
    );
    const highRiskCount = affectedClients.filter(client => client.successionRisk > 6).length;
    const practiceAreas = [...new Set(
      affectedClients.flatMap(client => client.practiceArea || ['Other'])
    )].length;

    return {
      affectedClients: affectedClients.length,
      revenueAtRisk: totalRevenue,
      highRiskClients: highRiskCount,
      practiceAreas
    };
  }, [affectedClients]);

  // Calculate detailed impact data
  const impactData = useMemo(() => {
    const totalRevenueAtRisk = affectedClients.reduce((sum, client) => 
      sum + usePortfolioStore.getState().getClientRevenue(client), 0
    );
    
    // Calculate estimated retention rate based on relationship strength and succession risk
    const avgRelationshipStrength = affectedClients.reduce((sum, client) => 
      sum + (client.relationshipStrength || 5), 0) / Math.max(affectedClients.length, 1);
    
    const avgSuccessionRisk = affectedClients.reduce((sum, client) => 
      sum + (client.successionRisk || 5), 0) / Math.max(affectedClients.length, 1);
    
    // Retention rate calculation: higher relationship strength = better retention, higher risk = worse retention
    const estimatedRetentionRate = Math.min(0.95, Math.max(0.4, 
      (avgRelationshipStrength / 10) * (1 - (avgSuccessionRisk - 1) / 9 * 0.4)
    ));
    
    const projectedRevenueLoss = totalRevenueAtRisk * (1 - estimatedRetentionRate);

    return {
      totalRevenueAtRisk,
      estimatedRetentionRate,
      projectedRevenueLoss,
      avgSuccessionRisk,
      avgRelationshipStrength
    };
  }, [affectedClients]);

  const handlePartnerToggle = (partnerId) => {
    setSelectedPartners(prev => 
      prev.includes(partnerId) 
        ? prev.filter(id => id !== partnerId)
        : [...prev, partnerId]
    );
  };

  const handleClientClick = (data) => {
    if (data && data.client) {
      setSelectedClient(data.client);
    }
  };

  const handleProceedToStage2 = () => {
    const analysisData = {
      selectedPartners,
      affectedClients,
      impactData,
      impactPreview
    };
    onProceedToStage2(analysisData);
  };

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
            Analyze the potential impact of partner departures across your client portfolio. 
            Select departing partners to see real-time impact calculations and risk analysis.
          </p>
        </CardHeader>
      </Card>

      {/* Partner Selection */}
      <PartnerSelectionPanel
        partners={partnersWithData}
        selectedPartners={selectedPartners}
        onPartnerToggle={handlePartnerToggle}
        impactPreview={impactPreview}
      />

      {/* Analysis Results - Only show when partners are selected */}
      {selectedPartners.length > 0 && affectedClients.length > 0 && (
        <>
          {/* Financial Impact Summary */}
          <FinancialImpactSummary
            impactData={impactData}
            affectedClients={affectedClients}
          />

          {/* Impact Heat Map */}
          <ImpactHeatMap
            affectedClients={affectedClients}
            onClientClick={handleClientClick}
          />

          {/* Client Categorization */}
          <ClientCategorization
            affectedClients={affectedClients}
            onClientSelect={setSelectedClient}
          />

          {/* Proceed to Stage 2 */}
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-green-800">Ready for Stage 2: Mitigation Planning</h4>
                  <p className="text-sm text-green-600 mt-1">
                    Impact analysis complete. Proceed to develop mitigation strategies for the identified risks.
                  </p>
                </div>
                <Button onClick={handleProceedToStage2} className="bg-green-600 hover:bg-green-700">
                  Proceed to Stage 2
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {selectedPartners.length === 0 && (
        <Card>
          <CardContent className="pt-12 pb-12">
            <div className="text-center space-y-4">
              <Users className="h-16 w-16 text-gray-400 mx-auto" />
              <div>
                <h3 className="text-lg font-semibold text-gray-700">Select Partners to Begin Analysis</h3>
                <p className="text-gray-500">
                  Choose the partners who may be departing to see the potential impact on your client portfolio.
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