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
  Users
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';

interface CapacityOptimizationProps {
  portfolioId: string;
}

// Simple utility functions
const formatCurrency = (value: number): string => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatPercentage = (value: number): string => `${value.toFixed(1)}%`;

const calculateCapacityResults = (data: any) => {
  const currentUtilization = data.currentUtilization || 75;
  const targetUtilization = data.targetUtilization || 85;
  const targetHours = data.targetHours || 160;
  const utilizationGap = targetUtilization - currentUtilization;
  
  const additionalCapacity = Math.round((utilizationGap / 100) * targetHours);
  const monthlyInvestment = data.investmentBudget ? Math.round(data.investmentBudget / 12) : 50000;
  const costPerHour = additionalCapacity > 0 ? Math.round(monthlyInvestment / additionalCapacity) : 0;
  const potentialRevenueIncrease = additionalCapacity * 300; // Assumed $300/hour rate
  const breakEvenMonths = potentialRevenueIncrease > 0 ? Math.ceil(monthlyInvestment / (potentialRevenueIncrease / 12)) : 0;

  return {
    utilizationGap,
    additionalCapacity,
    monthlyInvestment,
    costPerHour,
    potentialRevenueIncrease,
    breakEvenMonths,
    totalCapacityIncrease: additionalCapacity * 12
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

export function CapacityOptimization({ portfolioId }: CapacityOptimizationProps) {
  // Portfolio data
  const { clients, getTotalRevenue } = usePortfolioStore();
  
  // State for inputs
  const [targetHours, setTargetHours] = useState<number>(160);
  const [targetUtilization, setTargetUtilization] = useState<number[]>([80]);
  const [minStrategicValue, setMinStrategicValue] = useState<number[]>([6]);
  const [investmentBudget, setInvestmentBudget] = useState<number>(500000);
  
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
      targetHours,
      currentUtilization: 75,
      targetUtilization: targetUtilization[0],
      minStrategicValue: minStrategicValue[0],
      investmentBudget
    };
    return calculateCapacityResults(scenarioData);
  }, [targetHours, targetUtilization, minStrategicValue, investmentBudget]);

  const handleOptimize = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Validate inputs
      if (!portfolioId) {
        throw new Error('Portfolio ID is required');
      }
      if (targetUtilization[0] < 50 || targetUtilization[0] > 100) {
        throw new Error('Target utilization must be between 50% and 100%');
      }
      if (minStrategicValue[0] < 1 || minStrategicValue[0] > 10) {
        throw new Error('Strategic value must be between 1 and 10');
      }

      // Phase 1: Calculate mathematical results
      const mathResults = calculateCapacityResults({
        targetHours,
        currentUtilization: 75,
        targetUtilization: targetUtilization[0],
        minStrategicValue: minStrategicValue[0],
        investmentBudget
      });
      
      setResults(mathResults);

      // Phase 2: Get AI insights (simulate for now)
      setTimeout(() => {
        const mockAIResponse = `## Executive Summary

Your capacity optimization analysis shows significant potential for improving utilization from 75% to ${targetUtilization[0]}%, generating ${mathResults.additionalCapacity} additional billable hours per month.

## Capacity Enhancement Strategy

### Current State Analysis
- **Utilization Rate**: 75% baseline
- **Target Utilization**: ${targetUtilization[0]}%
- **Improvement Gap**: ${mathResults.utilizationGap}%

### Financial Impact
- **Additional Capacity**: ${mathResults.additionalCapacity} hours/month
- **Revenue Potential**: ${formatCurrency(mathResults.potentialRevenueIncrease)}/month
- **Investment Required**: ${formatCurrency(mathResults.monthlyInvestment)}/month
- **Break-even Timeline**: ${mathResults.breakEvenMonths} months

### Implementation Strategy
Your ${formatCurrency(investmentBudget)} annual investment (${formatCurrency(mathResults.monthlyInvestment)}/month) focuses on:

1. **Resource Optimization**: Streamlining workflows to reduce non-billable time
2. **Technology Enhancement**: Investing in tools that increase efficiency
3. **Strategic Client Focus**: Prioritizing clients with strategic value ≥${minStrategicValue[0]}
4. **Capacity Planning**: Systematic approach to partner time allocation

### Key Performance Indicators
- **Cost Efficiency**: ${formatCurrency(mathResults.costPerHour)} per additional billable hour
- **Annual Impact**: ${formatCurrency(mathResults.totalCapacityIncrease * 300)} potential annual revenue increase
- **ROI Projection**: Strong return expected within ${mathResults.breakEvenMonths} months

### Risk Mitigation
1. **Quality Maintenance**: Ensure service quality doesn't decline with higher utilization
2. **Burnout Prevention**: Monitor partner workload and well-being
3. **Client Satisfaction**: Track satisfaction metrics during optimization
4. **Market Responsiveness**: Maintain flexibility for urgent client needs

## Recommended Actions
1. **Immediate (30 days)**: Implement time tracking and workflow analysis
2. **Short-term (90 days)**: Deploy efficiency tools and optimize processes  
3. **Medium-term (6 months)**: Full capacity optimization implementation
4. **Long-term (12+ months)**: Sustain improved utilization rates`;

        setAiInsights(mockAIResponse);
        setIsLoading(false);
      }, 2000);
      
    } catch (err) {
      console.error('Capacity optimization error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsLoading(false);
    }
  };

  const isReadyToRun = portfolioId && clients?.length > 0;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-600" />
            Strategic Capacity Optimization
          </CardTitle>
          <CardDescription>
            Analyze partner capacity allocation and optimize utilization for maximum efficiency and revenue impact.
            This scenario helps identify the optimal distribution of time across clients to maximize both strategic value and financial returns.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Input Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Scenario Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Target Hours */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Target Partner Hours per Month
              </Label>
              <Input
                type="number"
                value={targetHours}
                onChange={(e) => setTargetHours(Number(e.target.value))}
                min={100}
                max={200}
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">Current: {targetHours} hours/month</p>
            </div>

            {/* Investment Budget */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Annual Investment Budget
              </Label>
              <Input
                type="number"
                value={investmentBudget}
                onChange={(e) => setInvestmentBudget(Number(e.target.value))}
                min={100000}
                max={2000000}
                step={50000}
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">{formatCurrency(investmentBudget)} annual budget</p>
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Target Utilization Rate
              </Label>
              <Slider
                value={targetUtilization}
                onValueChange={setTargetUtilization}
                min={50}
                max={95}
                step={5}
                className="py-4"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>50%</span>
                <span className="font-medium text-gray-900">{targetUtilization[0]}%</span>
                <span>95%</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Minimum Strategic Value
              </Label>
              <Slider
                value={minStrategicValue}
                onValueChange={setMinStrategicValue}
                min={1}
                max={10}
                step={1}
                className="py-4"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>1 (Low)</span>
                <span className="font-medium text-gray-900">{minStrategicValue[0]}/10</span>
                <span>10 (High)</span>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-gray-50 rounded-lg p-4 border">
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Live Preview
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Additional Capacity</p>
                <p className="font-semibold">{previewResults.additionalCapacity} hrs</p>
              </div>
              <div>
                <p className="text-muted-foreground">Monthly Investment</p>
                <p className="font-semibold">{formatCurrency(previewResults.monthlyInvestment)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Revenue Potential</p>
                <p className="font-semibold">{formatCurrency(previewResults.potentialRevenueIncrease)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Break-even</p>
                <p className="font-semibold">{previewResults.breakEvenMonths} months</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex items-center gap-4">
            <Button 
              onClick={handleOptimize} 
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
                  <Target className="mr-2 h-4 w-4" />
                  Run Capacity Optimization
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
                Please upload client data first to run capacity optimization scenarios.
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
            <h3 className="font-semibold text-lg mb-2">Running Capacity Analysis</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Analyzing your capacity parameters and generating optimization recommendations...
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
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              Capacity Analysis Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="text-sm font-medium text-blue-700">Utilization Improvement</div>
                <div className="text-2xl font-bold text-blue-900">{formatPercentage(results.utilizationGap)}</div>
                <div className="text-xs text-blue-600">Increase in utilization rate</div>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <div className="text-sm font-medium text-green-700">Additional Capacity</div>
                <div className="text-2xl font-bold text-green-900">{results.additionalCapacity}</div>
                <div className="text-xs text-green-600">Extra billable hours/month</div>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <div className="text-sm font-medium text-purple-700">Revenue Potential</div>
                <div className="text-2xl font-bold text-purple-900">{formatCurrency(results.potentialRevenueIncrease)}</div>
                <div className="text-xs text-purple-600">Monthly revenue potential</div>
              </div>
              
              <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                <div className="text-sm font-medium text-orange-700">Break-even Period</div>
                <div className="text-2xl font-bold text-orange-900">{results.breakEvenMonths} mo</div>
                <div className="text-xs text-orange-600">Time to recover investment</div>
              </div>
            </div>

            {/* Investment Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Monthly Investment</div>
                <div className="text-xl font-bold text-gray-900">{formatCurrency(results.monthlyInvestment)}</div>
                <div className="text-xs text-gray-600">Required monthly budget</div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Cost per Hour</div>
                <div className="text-xl font-bold text-gray-900">{formatCurrency(results.costPerHour)}</div>
                <div className="text-xs text-gray-600">Investment per additional hour</div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 border">
                <div className="text-sm font-medium text-gray-700">Annual Capacity Gain</div>
                <div className="text-xl font-bold text-gray-900">{results.totalCapacityIncrease}</div>
                <div className="text-xs text-gray-600">Total additional hours/year</div>
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
              <Target className="h-5 w-5 text-blue-600" />
              Strategic Capacity Analysis
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
