import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import SuccessionScenario from './components/succession/SuccessionScenario';

// The Scenarios tab is the succession workflow. The Growth tab, the capacity
// scenario and their endpoints were removed in WP2 (docs/plans/tier-0.md, D8).
const ScenarioModeler = () => {
  const { clients } = usePortfolioStore();

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
            <p className="text-lg font-medium mb-2">Succession Scenario Planning</p>
            <p className="text-muted-foreground mb-4">
              Model the impact of a partner departure on the book and plan each client's transition. Add clients to unlock scenario modeling.
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
            Scenario Modeling
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Model a partner departure in three stages: impact analysis, client review and triage, then transition execution.
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
                <p className="text-xs text-muted-foreground">High Conflict Risk</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Succession Planning Workflow */}
      <SuccessionScenario portfolioId="default" />
    </div>
  );
};

export default ScenarioModeler;
