import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { 
  Loader2, 
  TrendingUp, 
  Calculator, 
  AlertCircle, 
  Info,
  DollarSign,
  Clock,
  Target,
  Users,
  Building,
  Globe
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';

interface GrowthModelingProps {
  portfolioId: string;
}

// Simple utility functions
const formatCurrency = (value: number): string => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatPercentage = (value: number): string => `${value.toFixed(1)}%`;

const calculateGrowthResults = (data: any, currentRevenue: number = 0) => {
  const growthTarget = data.growthTarget || 25;
  const timeline = data.timeline || 24;
  const investmentBudget = data.investmentBudget || 750000;
  const newHires = data.newHires || 3;
  
  const targetRevenue = currentRevenue * (1 + growthTarget / 100);
  const incrementalRevenue = targetRevenue - currentRevenue;
  const monthlyGrowthRate = Math.pow(1 + growthTarget / 100, 1/timeline) - 1;
  const revenuePerEmployee = incrementalRevenue / newHires;
  const roi = ((incrementalRevenue - investmentBudget/2) / investmentBudget) * 100;

  return {
    current: {
      revenue: currentRevenue,
      clients: Math.round(currentRevenue / 50000),
      avgRevenuePerClient: 50000
    },
    target: {
      revenue: targetRevenue,
      clients: Math.round(targetRevenue / 50000),
      avgRevenuePerClient: 50000
    },
    incremental: {
      revenue: incrementalRevenue,
      clients: Math.round(incrementalRevenue / 50000),
      monthlyGrowthRate: monthlyGrowthRate * 100,
      revenuePerEmployee,
      roi
    },
    investment: {
      total: investmentBudget,
      monthly: investmentBudget / timeline,
      newHires,
      paybackPeriod: roi > 0 ? Math.round(investmentBudget / (incrementalRevenue / 12)) : null
    }
  };
};

const formatAIResponse = (content: string): string => {
  return content
    .replace(/## (.*?)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-3 text-blue-900 border-b border-blue-200 pb-1">$1</h3>')
    .replace(/### (.*?)$/gm, '<h4 class="text-md font-medium mt-4 mb-2 text-blue-800">$1</h4>')
    .replace(/#### (.*?)$/gm, '<h5 class="text-sm font-medium mt-3 mb-1 text-blue-700">$1</h5>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/^\- (.*?)$/gm, '<li class="ml-4 mb-1">• $1</li>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/^/, '<p class="mb-3">')
    .replace(/$/, '</p>')
    .replace(/\n/g, '<br />');
};

export function GrowthModeling({ portfolioId }: GrowthModelingProps) {
  // Portfolio data
  const { clients, getTotalRevenue } = usePortfolioStore();
  
  // State for inputs
  const [growthTarget, setGrowthTarget] = useState<number>(25);
  const [timeline, setTimeline] = useState<number>(24);
  const [investmentBudget, setInvestmentBudget] = useState<number>(750000);
  const [newHires, setNewHires] = useState<number[]>([3]);
  const [marketConditions, setMarketConditions] = useState<number[]>([7]);
  const [growthVector, setGrowthVector] = useState<string>('Organic Growth');
  
  // State for results and UI
  const [results, setResults] = useState<any>(null);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Memoized calculations
  const currentRevenue = useMemo(() => getTotalRevenue(), [clients]);
  
  // Mathematical results preview
  const previewResults = useMemo(() => {
    const scenarioData = {
      growthTarget,
      timeline,
      investmentBudget,
      newHires: newHires[0]
    };
    return calculateGrowthResults(scenarioData, currentRevenue);
  }, [growthTarget, timeline, investmentBudget, newHires, currentRevenue]);

  // Growth vector options
  const growthVectorOptions = [
    'Organic Growth',
    'Acquisition Strategy',
    'Strategic Partnerships',
    'Market Expansion',
    'Service Line Extension'
  ];

  // Market condition descriptions
  const getMarketConditionText = (value: number): string => {
    if (value <= 3) return 'Challenging';
    if (value <= 5) return 'Stable';
    if (value <= 7) return 'Favorable';
    return 'Excellent';
  };

  const handleRunScenario = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Validate inputs
      if (!portfolioId) {
        throw new Error('Portfolio ID is required');
      }
      if (growthTarget <= 0) {
        throw new Error('Growth target must be positive');
      }
      if (timeline <= 0) {
        throw new Error('Timeline must be positive');
      }

      // Phase 1: Calculate mathematical results
      const mathResults = calculateGrowthResults({
        growthTarget,
        timeline,
        investmentBudget,
        newHires: newHires[0],
        marketConditions: marketConditions[0],
        growthVector
      }, currentRevenue);
      
      setResults(mathResults);

      // Phase 2: Get AI insights (simulate for now)
      setTimeout(() => {
        const mockAIResponse = `## Executive Summary

Based on your ${growthTarget}% growth target over ${timeline} months with a ${formatCurrency(investmentBudget)} investment, this growth strategy shows strong potential for sustainable expansion.

## Growth Strategy Analysis

### Financial Projections
- **Target Revenue**: ${formatCurrency(mathResults.target.revenue)}
- **Incremental Revenue**: ${formatCurrency(mathResults.incremental.revenue)}
- **Expected ROI**: ${formatPercentage(mathResults.incremental.roi)}

### Investment Strategy
Your ${formatCurrency(investmentBudget)} investment over ${timeline} months (${formatCurrency(mathResults.investment.monthly)} monthly) with ${newHires[0]} new hires represents a strategic approach to scaling operations.

### Market Conditions Assessment
With ${getMarketConditionText(marketConditions[0])} market conditions, the ${growthVector.toLowerCase()} strategy aligns well with current opportunities.

### Key Success Factors
1. **Talent Acquisition**: Successful hiring of ${newHires[0]} qualified professionals
2. **Client Development**: Focus on expanding existing relationships and acquiring strategic new clients
3. **Operational Excellence**: Maintaining service quality during rapid growth
4. **Market Positioning**: Leveraging current strengths in target practice areas

### Risk Mitigation
- Monitor monthly growth rates to ensure ${formatPercentage(mathResults.incremental.monthlyGrowthRate)} target is achievable
- Maintain cash flow discipline during the ${mathResults.investment.paybackPeriod || 'N/A'}-month payback period
- Develop contingency plans for market condition changes

## Recommended Implementation
1. **Phase 1 (Months 1-${Math.round(timeline/3)})**: Foundation building and initial hiring
2. **Phase 2 (Months ${Math.round(timeline/3)+1}-${Math.round(2*timeline/3)})**: Market expansion and client acquisition
3. **Phase 3 (Months ${Math.round(2*timeline/3)+1}-${timeline})**: Optimization and sustainable scaling`;

        setAiInsights(mockAIResponse);
        setIsLoading(false);
      }, 2000);
      
    } catch (err) {
      console.error('Growth modeling error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsLoading(false);
    }
  };

  const isReadyToRun = portfolioId && clients?.length > 0;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Strategic Growth Analysis
          </CardTitle>
          <CardDescription>
            Model revenue growth scenarios to identify optimal expansion strategies. 
            This analysis evaluates different growth paths, investment requirements, and expected returns 
            to help you choose the best approach for sustainable firm expansion.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Input Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Growth Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Growth Target */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Growth Target (%)
              </Label>
              <Input
                type="number"
                value={growthTarget}
                onChange={(e) => setGrowthTarget(Number(e.target.value))}
                min={5}
                max={100}
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">
                Target: {growthTarget}% revenue increase
              </p>
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Timeline (months)
              </Label>
              <Input
                type="number"
                value={timeline}
                onChange={(e) => setTimeline(Number(e.target.value))}
                min={6}
                max={60}
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">{timeline} months timeline</p>
            </div>

            {/* Investment Budget */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Investment Budget
              </Label>
              <Input
                type="number"
                value={investmentBudget}
                onChange={(e) => setInvestmentBudget(Number(e.target.value))}
                min={100000}
                max={5000000}
                step={50000}
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">{formatCurrency(investmentBudget)} total budget</p>
            </div>

            {/* Growth Vector */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                Growth Strategy
              </Label>
              <select 
                value={growthVector} 
                onChange={(e) => setGrowthVector(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-lg"
              >
                {growthVectorOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                New Hires Required
              </Label>
              <Slider
                value={newHires}
                onValueChange={setNewHires}
                min={0}
                max={15}
                step={1}
                className="py-4"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>0 hires</span>
                <span className="font-medium text-gray-900">{newHires[0]} new hires</span>
                <span>15 hires</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Market Conditions
              </Label>
              <Slider
                value={marketConditions}
                onValueChange={setMarketConditions}
                min={1}
                max={10}
                step={1}
                className="py-4"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Challenging</span>
                <span className="font-medium text-gray-900">
                  {getMarketConditionText(marketConditions[0])} ({marketConditions[0]}/10)
                </span>
                <span>Excellent</span>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-gray-50 rounded-lg p-4 border">
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Growth Projection Preview
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Target Revenue</p>
                <p className="font-semibold">{formatCurrency(previewResults.target.revenue)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Incremental Revenue</p>
                <p className="font-semibold">{formatCurrency(previewResults.incremental.revenue)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Monthly Growth</p>
                <p className="font-semibold">{formatPercentage(previewResults.incremental.monthlyGrowthRate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Expected ROI</p>
                <p className="font-semibold">{formatPercentage(previewResults.incremental.roi)}</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex items-center gap-4">
            <Button 
              onClick={handleRunScenario} 
              disabled={isLoading || !isReadyToRun}
              size="lg"
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Analysis...
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Run Growth Scenario
                </>
              )}
            </Button>
          </div>
          
          {!isReadyToRun && clients?.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">No Portfolio Data</span>
              </div>
              <p className="text-sm text-amber-700 mt-1">
                Please upload client data first to run growth modeling scenarios.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="animate-pulse border-blue-200">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <Calculator className="h-6 w-6 text-blue-500" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Generating Growth Analysis</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Our AI is analyzing your growth parameters and generating strategic recommendations...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Error</span>
            </div>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Mathematical Results */}
      {results && !isLoading && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Growth Model Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current vs Target State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 rounded-lg p-4 border">
                <h4 className="font-semibold mb-3 text-gray-700">Current State</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Revenue:</span>
                    <span className="font-medium">{formatCurrency(results.current.revenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Clients:</span>
                    <span className="font-medium">{results.current.clients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Avg per Client:</span>
                    <span className="font-medium">{formatCurrency(results.current.avgRevenuePerClient)}</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <h4 className="font-semibold mb-3 text-green-700">Target State</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Revenue:</span>
                    <span className="font-medium text-green-800">{formatCurrency(results.target.revenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Clients:</span>
                    <span className="font-medium text-green-800">{results.target.clients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Avg per Client:</span>
                    <span className="font-medium text-green-800">{formatCurrency(results.target.avgRevenuePerClient)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="text-sm font-medium text-blue-700">Incremental Revenue</div>
                <div className="text-2xl font-bold text-blue-900">{formatCurrency(results.incremental.revenue)}</div>
                <div className="text-xs text-blue-600">Additional revenue target</div>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <div className="text-sm font-medium text-purple-700">Monthly Growth Rate</div>
                <div className="text-2xl font-bold text-purple-900">{formatPercentage(results.incremental.monthlyGrowthRate)}</div>
                <div className="text-xs text-purple-600">Required monthly growth</div>
              </div>
              
              <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                <div className="text-sm font-medium text-orange-700">Revenue per New Hire</div>
                <div className="text-2xl font-bold text-orange-900">{formatCurrency(results.incremental.revenuePerEmployee)}</div>
                <div className="text-xs text-orange-600">Expected contribution</div>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <div className="text-sm font-medium text-green-700">Return on Investment</div>
                <div className="text-2xl font-bold text-green-900">{formatPercentage(results.incremental.roi)}</div>
                <div className="text-xs text-green-600">Expected ROI</div>
              </div>
            </div>

            {/* Investment Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Total Investment</div>
                <div className="text-xl font-bold text-gray-900">{formatCurrency(results.investment.total)}</div>
                <div className="text-xs text-gray-600">Budget allocation</div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Monthly Investment</div>
                <div className="text-xl font-bold text-gray-900">{formatCurrency(results.investment.monthly)}</div>
                <div className="text-xs text-gray-600">Average monthly spend</div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Payback Period</div>
                <div className="text-xl font-bold text-gray-900">
                  {results.investment.paybackPeriod ? `${results.investment.paybackPeriod} mo` : 'N/A'}
                </div>
                <div className="text-xs text-gray-600">Time to recover investment</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Strategic Insights */}
      {aiInsights && !isLoading && (
        <Card className="border-blue-100 bg-blue-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Strategic Growth Analysis
            </CardTitle>
            <CardDescription>
              AI-powered strategic analysis and recommendations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div 
              className="prose prose-sm max-w-none prose-blue"
              dangerouslySetInnerHTML={{ __html: formatAIResponse(aiInsights) }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
