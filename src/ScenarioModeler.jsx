import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
  BarChart3,
  ArrowRight,
  CheckCircle,
  DollarSign,
  Flame
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { LOBBYISTS } from './constants';
import { apiClient } from './api';

const ScenarioModeler = () => {
  const { clients } = usePortfolioStore();
  const [activeTab, setActiveTab] = useState('succession');

  const [departingLobbyists, setDepartingLobbyists] = useState([]);
  const [scenarioParams, setScenarioParams] = useState({
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

    const totalRevenue = usePortfolioStore.getState().getTotalRevenue();
    const avgStrategicValue = clients.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clients.length;
    const highRiskClients = clients.filter(c => c.conflictRisk === 'High').length;

    return {
      totalRevenue,
      avgStrategicValue,
      highRiskClients,
      clientCount: clients.length
    };
  }, [clients, hasData]);

  // Analyze impact of departing lobbyists
  const departureAnalysis = useMemo(() => {
    if (departingLobbyists.length === 0) return null;

    // Clients affected by any departing lobbyist
    const affectedClients = clients.filter((c) =>
      (c.lobbyistTeam || []).some((l) => departingLobbyists.includes(l))
    );

    const revenueAtRisk = affectedClients.reduce(
      (sum, c) => sum + usePortfolioStore.getState().getClientRevenue(c),
      0
    );

    const orphanedClients = affectedClients.filter((c) => {
      const team = c.lobbyistTeam || [];
      return team.length === 1 && departingLobbyists.includes(team[0]);
    });

    const transitionPlan = affectedClients
      .filter((c) => !orphanedClients.includes(c))
      .map((c) => {
        const remaining = (c.lobbyistTeam || []).filter(
          (l) => !departingLobbyists.includes(l)
        );
        return { client: c, newLobbyist: remaining[0] || 'Unassigned' };
      });

    const highAttentionClients = affectedClients.filter((c) => {
      const freq = (c.interactionFrequency || '').toLowerCase();
      const isHighFreq = freq === 'daily' || freq === 'weekly';
      const isHighIntensity = (c.relationshipIntensity ?? 10) <= 5;
      return isHighFreq || isHighIntensity;
    });

    const highAttentionClientIds = highAttentionClients.map((c) => c.id);

    return {
      revenueAtRisk,
      orphanedClients,
      transitionPlan,
      highAttentionClients,
      highAttentionClientIds,
    };
  }, [departingLobbyists, clients]);





  // Calculate growth scenario
  const calculateGrowthScenario = async () => {
    if (!hasData) return;

    setIsCalculating(true);

    try {
      // Send only the necessary parameters to the backend
      const response = await apiClient.post('/scenarios/growth', {
        clientIds: clients.map(c => c.id),
        currentRevenue: usePortfolioStore.getState().getTotalRevenue(),
        targetRevenue: scenarioParams.targetRevenue,
      });

      if (response.success) {
        setResults(response.data);
      } else {
        throw new Error(response.error || 'Growth scenario calculation failed');
      }
    } catch (err) {
      console.error('Growth scenario error:', err);
      // Handle error (e.g., show notification)
    } finally {
      setIsCalculating(false);
    }
  };

  const formatCurrency = (amount) => `$${amount.toLocaleString()}`;

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Scenario Modeler
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">Strategic Scenario Planning</p>
            <p className="text-muted-foreground mb-4">
              Model "what-if" scenarios to understand the impact of departures, capacity changes, and strategic shifts on your portfolio. Add clients to unlock scenario modeling capabilities.
            </p>
            <Button 
              onClick={() => usePortfolioStore.getState().setCurrentView('client-details')}
              variant="outline"
            >
              Add Clients to Get Started
            </Button>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="text-center">
                <p className="text-lg font-bold">{currentMetrics.clientCount}</p>
                <p className="text-xs text-muted-foreground">Clients</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{formatCurrency(currentMetrics.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">Revenue</p>
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
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="succession">Succession Planning</TabsTrigger>
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
              
              {/* Departing Lobbyist Selection */}
              <div className="space-y-4">
                <Label>Select departing lobbyists:</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {LOBBYISTS.map((lob) => (
                    <div key={lob} className="flex items-center space-x-2">
                      <Checkbox
                        id={`lob-${lob}`}
                        checked={departingLobbyists.includes(lob)}
                        onCheckedChange={() =>
                          setDepartingLobbyists((prev) =>
                            prev.includes(lob)
                              ? prev.filter((l) => l !== lob)
                              : [...prev, lob]
                          )
                        }
                      />
                      <label htmlFor={`lob-${lob}`} className="text-sm flex-1 cursor-pointer">
                        {lob}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Departure Analysis Results */}
              {departureAnalysis && (
                <div className="space-y-6 pt-6">
                  {/* Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-red-600">
                        {formatCurrency(departureAnalysis.revenueAtRisk)}
                      </p>
                      <p className="text-sm text-muted-foreground flex justify-center items-center gap-1">
                        <DollarSign className="h-4 w-4" /> Revenue at Risk
                      </p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold">
                        {departureAnalysis.orphanedClients.length}
                      </p>
                      <p className="text-sm text-muted-foreground flex justify-center items-center gap-1">
                        <AlertTriangle className="h-4 w-4" /> Orphaned Clients
                      </p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-orange-600">
                        {departureAnalysis.highAttentionClients.length}
                      </p>
                      <p className="text-sm text-muted-foreground flex justify-center items-center gap-1">
                        <Flame className="h-4 w-4" /> High-Attention
                      </p>
                    </div>
                  </div>

                  {/* Orphaned Clients */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Orphaned Clients
                    </h4>
                    {departureAnalysis.orphanedClients.length === 0 ? (
                      <p className="text-muted-foreground text-sm">None</p>
                    ) : (
                      <ul className="space-y-1">
                        {departureAnalysis.orphanedClients.map((c) => (
                          <li key={c.id} className="flex items-center gap-2">
                            <span>{c.name}</span>
                            {departureAnalysis.highAttentionClientIds.includes(c.id) && (
                              <Badge variant="destructive" className="flex items-center gap-1">
                                <Flame className="h-3 w-3" /> High
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Transition Plan */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4" /> Transition Plan
                    </h4>
                    {departureAnalysis.transitionPlan.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No transitions required</p>
                    ) : (
                      <ul className="space-y-1">
                        {departureAnalysis.transitionPlan.map((item, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span>{item.client.name}</span>
                            <ArrowRight className="h-3 w-3" />
                            <Badge>{item.newLobbyist}</Badge>
                            {departureAnalysis.highAttentionClientIds.includes(item.client.id) && (
                              <Badge variant="destructive" className="flex items-center gap-1">
                                <Flame className="h-3 w-3" /> High
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold text-red-600">
                      {formatCurrency(results.impact.revenueChange)}
                    </p>
                    <p className="text-sm text-muted-foreground">Revenue Impact</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-2xl font-bold">
                      {results.impact.clientsAffected || 0}
                    </p>
                    <p className="text-sm text-muted-foreground">Clients Affected</p>
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



            {results.type === 'growth' && (
              <div className="space-y-6">
                {/* Growth Requirements */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">Current State</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.current.revenue)}</p>
                      <p>Clients: {results.current.clients}</p>
                      <p>Avg Revenue per Client: {formatCurrency(results.current.avgRevenuePerClient || 0)}</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3">Target State</h4>
                    <div className="space-y-2">
                      <p>Revenue: {formatCurrency(results.target.revenue)}</p>
                      <p>Clients: {results.target.clients}</p>
                      <p>Avg Revenue per Client: {formatCurrency(results.target.avgRevenuePerClient || 0)}</p>
                    </div>
                  </div>
                </div>

                {/* Requirements */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <h4 className="font-semibold mb-3">Requirements to Reach Target:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className="text-xl font-bold">{results.requirements.newClientsNeeded}</p>
                      <p className="text-sm text-muted-foreground">New Clients Needed</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-xl font-bold ${results.requirements.feasible ? 'text-green-600' : 'text-red-600'}`}>
                        {results.requirements.feasible ? 'Feasible' : 'Challenging'}
                      </p>
                      <p className="text-sm text-muted-foreground">Growth Assessment</p>
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

