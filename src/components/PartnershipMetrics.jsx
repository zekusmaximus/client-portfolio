import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Users, DollarSign, BarChart3 } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';

const PartnershipMetrics = ({ partners, transitions, clients }) => {
  const { getClientRevenue } = usePortfolioStore();

  // Helper function to calculate standard deviation
  const calculateStdDev = (values) => {
    if (values.length <= 1) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  };

  // Get empty metrics for edge cases
  const getEmptyMetrics = () => ({
    revenueVariance: '0.0',
    clientsAtRisk: 0,
    workloadBalance: '100',
    complexity: 'Low'
  });

  // Main metrics calculation with comprehensive edge case handling
  const calculateMetrics = useMemo(() => {
    // Handle empty or invalid data
    if (!partners || !Array.isArray(partners) || partners.length === 0) {
      return getEmptyMetrics();
    }

    const remaining = partners.filter(p => p && !p.isDeparting);
    
    // Handle case where all partners are departing
    if (remaining.length === 0) return getEmptyMetrics();

    try {
      // 1. Revenue Variance Calculation
      const revenues = remaining
        .map(p => p?.totalRevenue || 0)
        .filter(r => typeof r === 'number' && !isNaN(r));
      
      let revenueVariance = 0;
      if (revenues.length > 1) {
        const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
        if (mean > 0) {
          const variance = Math.sqrt(
            revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length
          );
          revenueVariance = (variance / mean) * 100;
        }
      }

      // 2. Client Retention Risk
      const departingPartners = partners.filter(p => p && p.isDeparting);
      const departingClients = departingPartners.flatMap(p => p?.clients || []);
      
      let highValueAtRisk = 0;
      if (Array.isArray(clients) && departingClients.length > 0) {
        highValueAtRisk = departingClients.filter(clientId => {
          const client = clients.find(c => c && c.id === clientId);
          return client && client.strategic_value && client.strategic_value > 7;
        }).length;
      }

      // 3. Workload Balance
      const capacities = remaining
        .map(p => p?.capacityUsed || 0)
        .filter(c => typeof c === 'number' && !isNaN(c));
      
      const capacityStdDev = calculateStdDev(capacities);
      const balanceScore = Math.max(0, Math.min(100, 100 - capacityStdDev));

      // 4. Transition Complexity
      const movesRequired = departingClients.length;
      let complexityScore = 'Low';
      if (movesRequired > 50) {
        complexityScore = 'High';
      } else if (movesRequired > 20) {
        complexityScore = 'Medium';
      }

      return {
        revenueVariance: Math.min(999.9, Math.max(0, revenueVariance)).toFixed(1),
        clientsAtRisk: Math.max(0, highValueAtRisk),
        workloadBalance: Math.round(balanceScore).toString(),
        complexity: complexityScore
      };

    } catch (error) {
      console.error('Error calculating partnership metrics:', error);
      return getEmptyMetrics();
    }
  }, [partners, transitions, clients, getClientRevenue]);

  // Metric formatting and display logic
  const formatMetricValue = (value, key) => {
    if (value === null || value === undefined) return 'N/A';
    
    switch (key) {
      case 'revenueVariance':
        return `${value}%`;
      case 'clientsAtRisk':
        return value.toString();
      case 'workloadBalance':
        return `${value}%`;
      case 'complexity':
        return value;
      default:
        return value.toString();
    }
  };

  const getMetricLabel = (key) => {
    switch (key) {
      case 'revenueVariance':
        return 'Revenue Variance';
      case 'clientsAtRisk':
        return 'High-Value Clients at Risk';
      case 'workloadBalance':
        return 'Workload Balance Score';
      case 'complexity':
        return 'Transition Complexity';
      default:
        return key;
    }
  };

  const getMetricIcon = (key) => {
    switch (key) {
      case 'revenueVariance':
        return DollarSign;
      case 'clientsAtRisk':
        return AlertTriangle;
      case 'workloadBalance':
        return BarChart3;
      case 'complexity':
        return Users;
      default:
        return BarChart3;
    }
  };

  const getMetricTrend = (key, value) => {
    const numValue = parseFloat(value);
    
    switch (key) {
      case 'revenueVariance':
        if (numValue < 10) return 'Excellent';
        if (numValue < 20) return 'Good';
        if (numValue < 35) return 'Fair';
        return 'Poor';
      case 'clientsAtRisk':
        if (numValue === 0) return 'No Risk';
        if (numValue <= 2) return 'Low Risk';
        if (numValue <= 5) return 'Medium Risk';
        return 'High Risk';
      case 'workloadBalance':
        if (numValue >= 90) return 'Excellent';
        if (numValue >= 75) return 'Good';
        if (numValue >= 50) return 'Fair';
        return 'Poor';
      case 'complexity':
        return null; // No trend for complexity
      default:
        return null;
    }
  };

  const getMetricVariant = (value, key) => {
    const numValue = parseFloat(value);
    
    switch (key) {
      case 'revenueVariance':
        if (numValue < 15) return 'secondary';
        if (numValue < 30) return 'default';
        return 'destructive';
      case 'clientsAtRisk':
        if (numValue === 0) return 'secondary';
        if (numValue <= 3) return 'default';
        return 'destructive';
      case 'workloadBalance':
        if (numValue >= 80) return 'secondary';
        if (numValue >= 60) return 'default';
        return 'destructive';
      case 'complexity':
        if (value === 'Low') return 'secondary';
        if (value === 'Medium') return 'default';
        return 'destructive';
      default:
        return 'default';
    }
  };

  const getTrendIcon = (key, value) => {
    const variant = getMetricVariant(value, key);
    
    if (variant === 'secondary') return TrendingUp;
    if (variant === 'destructive') return TrendingDown;
    return Minus;
  };

  const metrics = calculateMetrics;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Partnership Health Metrics</h2>
        <Badge variant="outline" className="text-sm">
          {partners?.filter(p => p?.isDeparting).length || 0} departing • {partners?.filter(p => !p?.isDeparting).length || 0} remaining
        </Badge>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(metrics).map(([key, value]) => {
          const Icon = getMetricIcon(key);
          const TrendIcon = getTrendIcon(key, value);
          const trend = getMetricTrend(key, value);
          const variant = getMetricVariant(value, key);
          
          return (
            <Card key={key} className="relative">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {trend && (
                    <Badge variant={variant} className="text-xs">
                      <TrendIcon className="h-3 w-3 mr-1" />
                      {trend}
                    </Badge>
                  )}
                </div>
                
                <div className="space-y-1">
                  <div className="text-2xl font-bold">
                    {formatMetricValue(value, key)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getMetricLabel(key)}
                  </p>
                </div>
                
                {/* Additional context for specific metrics */}
                {key === 'revenueVariance' && parseFloat(value) > 25 && (
                  <div className="mt-2 text-xs text-orange-600">
                    High variance may indicate workload imbalance
                  </div>
                )}
                
                {key === 'clientsAtRisk' && parseInt(value) > 0 && (
                  <div className="mt-2 text-xs text-red-600">
                    Strategic clients need special attention
                  </div>
                )}
                
                {key === 'workloadBalance' && parseInt(value) < 60 && (
                  <div className="mt-2 text-xs text-orange-600">
                    Consider redistribution to improve balance
                  </div>
                )}
                
                {key === 'complexity' && value === 'High' && (
                  <div className="mt-2 text-xs text-red-600">
                    Plan extended transition timeline
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Summary insights */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <BarChart3 className="h-5 w-5 text-blue-600 mt-0.5" />
            </div>
            <div>
              <h3 className="font-medium text-blue-900 mb-1">Quick Insights</h3>
              <div className="text-sm text-blue-800 space-y-1">
                {parseFloat(metrics.revenueVariance) > 25 && (
                  <p>• High revenue variance suggests uneven partner workloads</p>
                )}
                {parseInt(metrics.clientsAtRisk) > 0 && (
                  <p>• {metrics.clientsAtRisk} high-value clients require transition planning</p>
                )}
                {parseInt(metrics.workloadBalance) < 70 && (
                  <p>• Workload imbalance detected - consider redistribution strategies</p>
                )}
                {metrics.complexity === 'High' && (
                  <p>• Complex transition ahead - ensure adequate planning time</p>
                )}
                {parseFloat(metrics.revenueVariance) < 15 && parseInt(metrics.workloadBalance) > 85 && (
                  <p>• Partnership shows healthy balance across key metrics</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PartnershipMetrics;