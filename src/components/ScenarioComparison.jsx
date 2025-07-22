import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Check, TrendingUp } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';

const ScenarioComparison = ({ scenarios, onApply }) => {
  const { 
    partners, 
    clients, 
    calculateRedistribution, 
    getClientRevenue,
    partnershipTransition 
  } = usePortfolioStore();

  // Calculate standard deviation for variance
  const calculateVariance = (values) => {
    if (!values || values.length <= 1) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
    return mean > 0 ? (variance / mean) * 100 : 0;
  };

  // Calculate risk score based on multiple factors
  const calculateRiskScore = (scenario) => {
    if (!scenario || !scenario.assignments) return 0;
    
    let riskScore = 0;
    
    // Risk from capacity overload (40% of score)
    if (scenario.maxCapacity > 95) riskScore += 40;
    else if (scenario.maxCapacity > 85) riskScore += 25;
    else if (scenario.maxCapacity > 75) riskScore += 10;
    
    // Risk from revenue imbalance (30% of score)
    if (scenario.revenueVariance > 30) riskScore += 30;
    else if (scenario.revenueVariance > 20) riskScore += 20;
    else if (scenario.revenueVariance > 10) riskScore += 10;
    
    // Risk from high client movement (20% of score)
    const movementRatio = scenario.clientsMoved / Math.max(1, clients?.length || 1);
    if (movementRatio > 0.3) riskScore += 20;
    else if (movementRatio > 0.15) riskScore += 12;
    else if (movementRatio > 0.05) riskScore += 5;
    
    // Risk from high-value client moves (10% of score)
    const highValueMoves = Object.keys(scenario.assignments).filter(clientId => {
      const client = clients?.find(c => c.id === clientId);
      return client && client.strategic_value > 7;
    }).length;
    
    if (highValueMoves > 5) riskScore += 10;
    else if (highValueMoves > 2) riskScore += 5;
    
    return Math.min(100, riskScore);
  };

  // Get scenario data based on model
  const getScenario = (model) => {
    const redistribution = calculateRedistribution(model);
    
    if (!redistribution || redistribution.length === 0) {
      return {
        name: model,
        assignments: {},
        partnerLoads: [],
        revenueVariance: 0,
        maxCapacity: 0,
        clientsMoved: 0
      };
    }

    // Build assignments object
    const assignments = {};
    redistribution.forEach(partner => {
      if (partner.assignedClients) {
        partner.assignedClients.forEach(client => {
          // Only count new assignments (not existing clients)
          const originalPartner = partners?.find(p => p.clients?.includes(client.id));
          if (originalPartner?.isDeparting) {
            assignments[client.id] = partner.partnerId;
          }
        });
      }
    });

    // Calculate partner loads (capacity percentages)
    const partnerLoads = redistribution.map(partner => {
      const projectedClients = partner.assignedClients?.length || 0;
      return Math.min(100, (projectedClients / 30) * 100); // 30 clients = 100% capacity
    });

    // Calculate revenue variance
    const revenues = redistribution.map(partner => partner.targetRevenue || 0);
    const revenueVariance = calculateVariance(revenues);

    return {
      name: model,
      assignments,
      partnerLoads,
      revenueVariance: Math.round(revenueVariance * 10) / 10,
      maxCapacity: Math.max(...partnerLoads, 0),
      clientsMoved: Object.keys(assignments).length
    };
  };

  // Calculate metrics for each scenario
  const scenarioMetrics = useMemo(() => {
    if (!scenarios || !Array.isArray(scenarios)) return [];
    
    return scenarios.map(model => {
      const scenario = getScenario(model);
      const riskScore = calculateRiskScore(scenario);
      
      return {
        model,
        ...scenario,
        riskScore: Math.round(riskScore)
      };
    });
  }, [scenarios, partners, clients, partnershipTransition.customAssignments]);

  const getRiskVariant = (riskScore) => {
    if (riskScore < 20) return 'secondary';
    if (riskScore < 40) return 'default';
    if (riskScore < 70) return 'destructive';
    return 'destructive';
  };

  const getRiskLabel = (riskScore) => {
    if (riskScore < 20) return 'Low Risk';
    if (riskScore < 40) return 'Medium Risk';
    if (riskScore < 70) return 'High Risk';
    return 'Critical Risk';
  };

  const getModelDisplayName = (model) => {
    switch (model) {
      case 'balanced':
        return 'Balanced Revenue';
      case 'expertise':
        return 'Expertise Matching';
      case 'relationship':
        return 'Relationship Based';
      case 'custom':
        return 'Custom Assignments';
      default:
        return model.charAt(0).toUpperCase() + model.slice(1);
    }
  };

  const getBestScenario = () => {
    if (scenarioMetrics.length === 0) return null;
    
    // Score each scenario (lower is better)
    const scoredScenarios = scenarioMetrics.map(scenario => {
      let score = 0;
      
      // Penalize high risk
      score += scenario.riskScore * 2;
      
      // Penalize high variance
      score += scenario.revenueVariance;
      
      // Penalize excessive capacity usage
      if (scenario.maxCapacity > 90) score += 50;
      else if (scenario.maxCapacity > 85) score += 20;
      
      // Slight preference for fewer moves (stability)
      score += scenario.clientsMoved * 0.1;
      
      return { ...scenario, score };
    });
    
    return scoredScenarios.reduce((best, current) => 
      current.score < best.score ? current : best
    );
  };

  const bestScenario = getBestScenario();

  if (!scenarios || scenarios.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scenario Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No scenarios available for comparison.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Redistribution Strategy Comparison
          {bestScenario && (
            <Badge className="bg-green-100 text-green-800">
              <TrendingUp className="h-3 w-3 mr-1" />
              {getModelDisplayName(bestScenario.model)} Recommended
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Strategy</TableHead>
              <TableHead>Revenue Variance</TableHead>
              <TableHead>Max Capacity</TableHead>
              <TableHead>Clients Moved</TableHead>
              <TableHead>Risk Level</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenarioMetrics.map((scenario) => (
              <TableRow 
                key={scenario.model}
                className={bestScenario?.model === scenario.model ? 'bg-green-50' : ''}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {getModelDisplayName(scenario.model)}
                    {bestScenario?.model === scenario.model && (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </div>
                </TableCell>
                
                <TableCell>
                  <div className="flex items-center gap-2">
                    {scenario.revenueVariance.toFixed(1)}%
                    {scenario.revenueVariance > 25 && (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    )}
                  </div>
                </TableCell>
                
                <TableCell>
                  <div className="flex items-center gap-2">
                    {Math.round(scenario.maxCapacity)}%
                    {scenario.maxCapacity > 85 && (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    )}
                    {scenario.maxCapacity > 95 && (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                </TableCell>
                
                <TableCell>
                  <div className="text-center">
                    {scenario.clientsMoved}
                    <div className="text-xs text-gray-500">
                      ({Math.round((scenario.clientsMoved / Math.max(1, clients?.length || 1)) * 100)}% of total)
                    </div>
                  </div>
                </TableCell>
                
                <TableCell>
                  <Badge variant={getRiskVariant(scenario.riskScore)}>
                    {getRiskLabel(scenario.riskScore)}
                  </Badge>
                </TableCell>
                
                <TableCell>
                  <Button 
                    size="sm" 
                    variant={bestScenario?.model === scenario.model ? "default" : "outline"}
                    onClick={() => onApply(scenario.model)}
                    disabled={scenario.clientsMoved === 0 && scenario.model !== 'balanced'}
                  >
                    {bestScenario?.model === scenario.model ? 'Apply Best' : 'Apply'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        
        {/* Summary insights */}
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium mb-2">Scenario Analysis</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {bestScenario && (
              <p>
                <strong>Recommended:</strong> {getModelDisplayName(bestScenario.model)} strategy 
                offers the best balance of risk ({bestScenario.riskScore}% risk score) and 
                operational efficiency ({bestScenario.revenueVariance.toFixed(1)}% variance).
              </p>
            )}
            
            {scenarioMetrics.some(s => s.maxCapacity > 95) && (
              <p className="text-orange-700">
                <strong>Warning:</strong> Some scenarios result in critical capacity overload. 
                Consider hiring or alternative redistribution.
              </p>
            )}
            
            {scenarioMetrics.some(s => s.revenueVariance > 35) && (
              <p className="text-orange-700">
                <strong>Notice:</strong> High revenue variance detected in some scenarios. 
                This may indicate workload imbalance.
              </p>
            )}
            
            {scenarioMetrics.every(s => s.riskScore < 30) && (
              <p className="text-green-700">
                <strong>Good news:</strong> All scenarios show relatively low risk profiles. 
                Choose based on strategic priorities.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScenarioComparison;