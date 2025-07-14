import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { 
  Target, 
  Users, 
  TrendingUp, 
  AlertTriangle,
  Calculator,
  BarChart3,
  PieChart,
  ArrowRight,
  CheckCircle,
  XCircle
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell
} from 'recharts';
import usePortfolioStore from './portfolioStore';

const ScenarioModeler = () => {
  const { clients } = usePortfolioStore();
  const [activeTab, setActiveTab] = useState('succession');
  const [selectedClients, setSelectedClients] = useState([]);
  const [scenarioParams, setScenarioParams] = useState({
    maxCapacity: 2000,
    targetRevenue: 500000,
    riskTolerance: 50,
    timeHorizon: 12
  });
  const [results, setResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const hasData = clients && clients.length > 0;

  // Calculate current portfolio metrics
  const currentMetrics = useMemo(() => {
    if (!hasData) return null;
    
    const totalRevenue = clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
    const totalHours = clients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
    const avgStrategicValue = clients.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clients.length;
    const highRiskClients = clients.filter(c => c.conflictRisk === 'High').length;
    
    return {
      totalRevenue,
      totalHours,
      avgStrategicValue,
      highRiskClients,
      clientCount: clients.length
    };
  }, [clients, hasData]);

  // Handle client selection
  const handleClientToggle = (clientId) => {
    setSelectedClients(prev => 
      prev.includes(clientId) 
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    );
  };

  // Calculate succession scenario
  const calculateSuccessionScenario = () => {
    if (!hasData || selectedClients.length === 0) return;
    
    setIsCalculating(true);
    
    // Simulate calculation delay
    setTimeout(() => {
      const remainingClients = clients.filter(c => !selectedClients.includes(c.id));
      const departingClients = clients.filter(c => selectedClients.includes(c.id));
      
      const currentRevenue = clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
      const remainingRevenue = remainingClients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
      const lostRevenue = departingClients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
      
      const currentHours = clients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
      const remainingHours = remainingClients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
      const freedHours = departingClients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
      
      const capacityUtilization = (remainingHours / scenarioParams.maxCapacity) * 100;
      const revenueImpact = ((currentRevenue - remainingRevenue) / currentRevenue) * 100;
      
      // Calculate recommendations
      const recommendations = [];
      if (capacityUtilization < 70) {
        recommendations.push({
          type: 'opportunity',
          message: `Low capacity utilization (${capacityUtilization.toFixed(1)}%) - opportunity to take on new clients`
        });
      }
      if (revenueImpact > 30) {
        recommendations.push({
          type: 'warning',
          message: `High revenue impact (${revenueImpact.toFixed(1)}%) - consider retention strategies`
        });
      }
      if (freedHours > 200) {
        recommendations.push({
          type: 'opportunity',
          message: `${freedHours} hours freed up - opportunity for practice development`
        });
      }

      setResults({
        type: 'succession',
        current: {
          revenue: currentRevenue,
          hours: currentHours,
          clients: clients.length
        },
        projected: {
          revenue: remainingRevenue,
          hours: remainingHours,
          clients: remainingClients.length
        },
        impact: {
          revenueChange: remainingRevenue - currentRevenue,
          hoursChange: remainingHours - currentHours,
          clientChange: remainingClients.length - clients.length,
          capacityUtilization,
          revenueImpact
        },
        recommendations,
        departingClients,
        remainingClients
      });
      
      setIsCalculating(false);
    }, 1500);
  };

  // Calculate capacity optimization
  const calculateCapacityOptimization = () => {
    if (!hasData) return;
    
    setIsCalculating(true);
    
    setTimeout(() => {
      const currentHours = clients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
      const currentRevenue = clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
      
      // Sort clients by revenue per hour efficiency
      const clientEfficiency = clients.map(c => ({
        ...c,
        efficiency: (c.averageRevenue || 0) / (c.timeCommitment || 40)
      })).sort((a, b) => b.efficiency - a.efficiency);
      
      // Optimize portfolio within capacity constraints
      let optimizedHours = 0;
      let optimizedRevenue = 0;
      const optimizedClients = [];
      
      for (const client of clientEfficiency) {
        if (optimizedHours + (client.timeCommitment || 40) <= scenarioParams.maxCapacity) {
          optimizedClients.push(client);
          optimizedHours += (client.timeCommitment || 40);
          optimizedRevenue += (client.averageRevenue || 0);
        }
      }
      
      const excludedClients = clients.filter(c => !optimizedClients.find(oc => oc.id === c.id));
      
      setResults({
        type: 'capacity',
        current: {
          revenue: currentRevenue,
          hours: currentHours,
          clients: clients.length,
          efficiency: currentRevenue / currentHours
        },
        optimized: {
          revenue: optimizedRevenue,
          hours: optimizedHours,
          clients: optimizedClients.length,
          efficiency: optimizedRevenue / optimizedHours
        },
        impact: {
          revenueChange: optimizedRevenue - currentRevenue,
          hoursChange: optimizedHours - currentHours,
          clientChange: optimizedClients.length - clients.length,
          efficiencyGain: (optimizedRevenue / optimizedHours) - (currentRevenue / currentHours)
        },
        optimizedClients,
        excludedClients
      });
      
      setIsCalculating(false);
    }, 1500);
  };

  // Calculate growth scenario
  const calculateGrowthScenario = () => {
    if (!hasData) return;
    
    setIsCalculating(true);
    
    setTimeout(() => {
      const currentRevenue = clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
      const currentHours = clients.reduce((sum, c) => sum + (c.timeCommitment || 40), 0);
      
      const revenueGap = scenarioParams.targetRevenue - currentRevenue;
      const availableHours = scenarioParams.maxCapacity - currentHours;
      
      // Calculate required new clients
      const avgClientRevenue = currentRevenue / clients.length;
      const avgClientHours = currentHours / clients.length;
      
      const newClientsNeeded = Math.ceil(revenueGap / avgClientRevenue);
      const hoursNeeded = newClientsNeeded * avgClientHours;
      
      const feasible = hoursNeeded <= availableHours;
      
      setResults({
        type: 'growth',
        current: {
          revenue: currentRevenue,
          hours: currentHours,
          clients: clients.length
        },
        target: {
          revenue: scenarioParams.targetRevenue,
          hours: currentHours + hoursNeeded,
          clients: clients.length + newClientsNeeded
        },
        requirements: {
          revenueGap,
          newClientsNeeded,
          hoursNeeded,
          availableHours,
          feasible
        },
        recommendations: feasible ? [
          { type: 'success', message: `Target achievable with ${newClientsNeeded} new clients` },
          { type: 'info', message: `Will utilize ${((currentHours + hoursNeeded) / scenarioParams.maxCapacity * 100).toFixed(1)}% of capacity` }
        ] : [
          { type: 'warning', message: `Target requires ${hoursNeeded} hours but only ${availableHours} available` },
          { type: 'info', message: 'Consider increasing capacity or adjusting target' }
        ]
      });
      
      setIsCalculating(false);
    }, 1500);
  };

  const formatCurrency = (amount) => `$${amount.toLocaleString()}`;
  const formatHours = (hours) => `${hours.toLocaleString()}h`;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No client data available. Please upload your portfolio data first to model scenarios.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Scenario Modeling & Optimization
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Model different scenarios for your practice including succession planning, capacity optimization, and growth strategies.
          </p>
          
          {/* Current Portfolio Metrics */}
          {currentMetrics && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="text-center">
                <p className="text-lg font-bold">{currentMetrics.clientCount}</p>
                <p className="text-xs text-muted-foreground">Clients</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{formatCurrency(currentMetrics.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">Revenue</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{formatHours(currentMetrics.totalHours)}</p>
                <p className="text-xs text-muted-foreground">Time</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{currentMetrics.avgStrategicValue.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Avg Strategic Value</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{currentMetrics.highRiskClients}</p>
                <p className="text-xs text-muted-foreground">High Risk</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenario Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="succession">Succession Planning</TabsTrigger>
          <TabsTrigger value="capacity">Capacity Optimization</TabsTrigger>
          <TabsTrigger value="growth">Growth Modeling</TabsTrigger>
        </TabsList>

        {/* Succession Planning Tab */}
        <TabsContent value="succession" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Succession Planning Scenario
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Model the impact of attorney departure or retirement on your practice.
              </p>
              
              {/* Client Selection */}
              <div className="space-y-4">
                <Label>Select clients that would be affected by succession:</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
                  {clients.map((client) => (
                    <div key={client.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={client.id}
                        checked={selectedClients.includes(client.id)}
                        onCheckedChange={() => handleClientToggle(client.id)}
                      />
                      <label htmlFor={client.id} className="text-sm flex-1 cursor-pointer">
                        <span className="font-medium">{client.name}</span>
                        <span className="text-muted-foreground ml-2">
                          {formatCurrency(client.averageRevenue || 0)} • {client.timeCommitment || 40}h
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
                
                <Button 
                  onClick={calculateSuccessionScenario}
                  disabled={selectedClients.length === 0 || isCalculating}
                  className="w-full"
                >
                  {isCalculating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Calculating...
                    </>
                  ) : (
                    <>
                      <Calculator className="h-4 w-4 mr-2" />
                      Model Succession Impact
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Capacity Optimization Tab */}
        <TabsContent value="capacity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Capacity Optimization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Optimize your client portfolio for maximum efficiency within capacity constraints.
              </p>
              
              <div className="space-y-4">
                <div>
                  <Label>Maximum Capacity (hours/month): {scenarioParams.maxCapacity}</Label>
                  <Slider
                    value={[scenarioParams.maxCapacity]}
                    onValueChange={(value) => setScenarioParams(prev => ({ ...prev, maxCapacity: value[0] }))}
                    max={3000}
                    min={1000}
                    step={100}
                    className="mt-2"
                  />
                </div>
                
                <Button 
                  onClick={calculateCapacityOptimization}
                  disabled={isCalculating}
                  className="w-full"
                >
                  {isCalculating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Optimize Portfolio
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Growth Modeling Tab */}
        <TabsContent value="growth" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Growth Scenario Modeling
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Model growth scenarios and determine requirements to reach revenue targets.
              </p>
              
              <div className="space-y-4">
                <div>
                  <Label>Target Revenue: {formatCurrency(scenarioParams.targetRevenue)}</Label>
                  <Slider
                    value={[scenarioParams.targetRevenue]}
                    onValueChange={(value) => setScenarioParams(prev => ({ ...prev, targetRevenue: value[0] }))}
                    max={1000000}
                    min={100000}
                    step={25000}
                    className="mt-2"
                  />
                </div>
                
                <div>
                  <Label>Maximum Capacity (hours/month): {scenarioParams.maxCapacity}</Label>
                  <Slider
                    value={[scenarioParams.maxCapacity]}
                    onValueChange={(value) => setScenarioParams(prev => ({ ...prev, maxCapacity: value[0] }))}
                    max={3000}
                    min={1000}
                    step={100}
                    className="mt-2"
                  />
                </div>
                
                <Button 
                  onClick={calculateGrowthScenario}
                  disabled={isCalculating}
                  className="w-full"
                >
                  {isCalculating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Modeling...
                    </>
                  ) : (
                    <>
                      <Target className="h-4 w-4 mr-2" />
                      Model Growth Scenario
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Results Display */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Scenario Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            {results.type === 'succession' && (
              <div className="space-y-6">
                {/* Impact Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold text-red-600">
                      {formatCurrency(results.impact.revenueChange)}
                    </p>
                    <p className="text-sm text-muted-foreground">Revenue Impact</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">
                      {formatHours(Math.abs(results.impact.hoursChange))}
                    </p>
                    <p className="text-sm text-muted-foreground">Hours Freed</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold">
                      {results.impact.capacityUtilization.toFixed(1)}%
                    </p>
                    <p className="text-sm text-muted-foreground">Capacity Utilization</p>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="space-y-2">
                  <h4 className="font-semibold">Recommendations:</h4>
                  {results.recommendations.map((rec, index) => (
                    <div key={index} className={`flex items-center gap-2 p-3 rounded-lg ${
                      rec.type === 'warning' ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800'
                    }`}>
                      {rec.type === 'warning' ? 
                        <AlertTriangle className="h-4 w-4" /> : 
                        <CheckCircle className="h-4 w-4" />
                      }
                      <span className="text-sm">{rec.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {results.type === 'capacity' && (
              <div className="space-y-6">
                {/* Before/After Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">Current Portfolio</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.current.revenue)}</p>
                      <p>Hours: {formatHours(results.current.hours)}</p>
                      <p>Clients: {results.current.clients}</p>
                      <p>Efficiency: ${results.current.efficiency.toFixed(0)}/hour</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3">Optimized Portfolio</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.optimized.revenue)}</p>
                      <p>Hours: {formatHours(results.optimized.hours)}</p>
                      <p>Clients: {results.optimized.clients}</p>
                      <p>Efficiency: ${results.optimized.efficiency.toFixed(0)}/hour</p>
                    </div>
                  </div>
                </div>

                {/* Impact Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className={`text-2xl font-bold ${results.impact.revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {results.impact.revenueChange >= 0 ? '+' : ''}{formatCurrency(results.impact.revenueChange)}
                    </p>
                    <p className="text-sm text-muted-foreground">Revenue Change</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className={`text-2xl font-bold ${results.impact.clientChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {results.impact.clientChange >= 0 ? '+' : ''}{results.impact.clientChange}
                    </p>
                    <p className="text-sm text-muted-foreground">Client Change</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold text-blue-600">
                      +${results.impact.efficiencyGain.toFixed(0)}/h
                    </p>
                    <p className="text-sm text-muted-foreground">Efficiency Gain</p>
                  </div>
                </div>
              </div>
            )}

            {results.type === 'growth' && (
              <div className="space-y-6">
                {/* Growth Requirements */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">Current State</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.current.revenue)}</p>
                      <p>Hours: {formatHours(results.current.hours)}</p>
                      <p>Clients: {results.current.clients}</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3">Target State</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.target.revenue)}</p>
                      <p>Hours: {formatHours(results.target.hours)}</p>
                      <p>Clients: {results.target.clients}</p>
                    </div>
                  </div>
                </div>

                {/* Requirements */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <h4 className="font-semibold mb-3">Requirements to Reach Target:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-xl font-bold">{results.requirements.newClientsNeeded}</p>
                      <p className="text-sm text-muted-foreground">New Clients Needed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold">{formatHours(results.requirements.hoursNeeded)}</p>
                      <p className="text-sm text-muted-foreground">Additional Hours</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-xl font-bold ${results.requirements.feasible ? 'text-green-600' : 'text-red-600'}`}>
                        {results.requirements.feasible ? 'Feasible' : 'Not Feasible'}
                      </p>
                      <p className="text-sm text-muted-foreground">Within Capacity</p>
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="space-y-2">
                  <h4 className="font-semibold">Analysis:</h4>
                  {results.recommendations.map((rec, index) => (
                    <div key={index} className={`flex items-center gap-2 p-3 rounded-lg ${
                      rec.type === 'warning' ? 'bg-yellow-50 text-yellow-800' : 
                      rec.type === 'success' ? 'bg-green-50 text-green-800' :
                      'bg-blue-50 text-blue-800'
                    }`}>
                      {rec.type === 'warning' ? <AlertTriangle className="h-4 w-4" /> : 
                       rec.type === 'success' ? <CheckCircle className="h-4 w-4" /> :
                       <BarChart3 className="h-4 w-4" />}
                      <span className="text-sm">{rec.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ScenarioModeler;

