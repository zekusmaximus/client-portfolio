import React, { useState, useEffect, useMemo } from 'react';
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
import { 
  GrowthModelingData, 
  ScenarioResults, 
  LoadingState, 
  ErrorState 
} from '../../types/scenario';
import { 
  checkAIServiceStatus,
  validateScenarioInputs,
  formatAIResponse as formatResponse,
  calculateGrowthResults,
  formatCurrency,
  formatPercentage,
  createErrorMessage,
  debounce
} from '../../utils/scenarioUtils';
import { 
  LoadingCard, 
  ResultsSection, 
  MetricCard, 
  AIInsightsCard, 
  Tooltip 
} from './ScenarioComponents';
import usePortfolioStore from '../../portfolioStore';

interface GrowthModelingProps {
  portfolioId: string;
}

export function GrowthModeling({ portfolioId }: GrowthModelingProps) {
  // Portfolio data
  const { clients, getTotalRevenue } = usePortfolioStore();
  
  // State for inputs with validation
  const [growthTarget, setGrowthTarget] = useState<number>(25);
  const [timeline, setTimeline] = useState<number>(24);
  const [investmentBudget, setInvestmentBudget] = useState<number>(750000);
  const [newHires, setNewHires] = useState<number[]>([3]);
  const [marketConditions, setMarketConditions] = useState<number[]>([7]);
  const [growthVector, setGrowthVector] = useState<string>('Organic Growth');
  const [targetMarkets, setTargetMarkets] = useState<string[]>(['Federal Government', 'State Government']);
  
  // State for results and UI
  const [results, setResults] = useState<any>(null);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>({ isLoading: false });
  const [errorState, setErrorState] = useState<ErrorState>({ hasError: false });

  // Memoized calculations
  const currentRevenue = useMemo(() => getTotalRevenue(), [clients]);
  const aiServiceStatus = useMemo(() => checkAIServiceStatus(), []);
  
  // Mathematical results preview (calculated in real-time)
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
    setLoadingState({ isLoading: true, stage: 'calculating' });
    setErrorState({ hasError: false });
    
    try {
      // Validate inputs
      const scenarioData: GrowthModelingData = {
        portfolioId,
        growthTarget,
        timeline,
        investmentBudget,
        newHires: newHires[0],
        marketConditions: marketConditions[0],
        growthVector,
        targetMarkets
      };

      const validation = validateScenarioInputs('growth', scenarioData);
      if (validation.hasError) {
        setErrorState(validation);
        return;
      }

      // Check AI service availability
      if (!aiServiceStatus.available) {
        setErrorState({
          hasError: true,
          message: `AI service unavailable: ${aiServiceStatus.error}`,
          type: 'ai-service'
        });
        return;
      }

      // Phase 1: Calculate mathematical results
      const mathResults = calculateGrowthResults(scenarioData, currentRevenue);
      setResults(mathResults);
      setLoadingState({ isLoading: true, stage: 'generating-insights' });

      // Phase 2: Get AI insights
      const response = await fetch('/api/scenarios/growth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId,
          scenarioData
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data: ScenarioResults = await response.json();
      
      if (data.success) {
        setAiInsights(data.strategic);
      } else {
        throw new Error(data.error || 'Failed to generate AI insights');
      }
      
    } catch (err) {
      console.error('Growth modeling error:', err);
      setErrorState({
        hasError: true,
        message: createErrorMessage(err),
        type: 'api'
      });
    } finally {
      setLoadingState({ isLoading: false });
    }
  };

  const isReadyToRun = portfolioId && clients?.length > 0 && aiServiceStatus.available;

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
                <Tooltip content="Desired percentage increase in revenue over the specified timeline">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
                <Tooltip content="Number of months to achieve the growth target">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
                <Tooltip content="Total budget allocated for growth initiatives">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
                <Tooltip content="Primary approach for achieving growth targets">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
                <Tooltip content="Number of additional team members needed to support growth">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
                <Tooltip content="Assessment of current market favorability for growth initiatives">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
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
              disabled={loadingState.isLoading || !isReadyToRun}
              size="lg"
              className="flex-1"
            >
              {loadingState.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {loadingState.stage === 'calculating' ? 'Modeling Growth...' : 'Generating Insights...'}
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Run Growth Scenario
                </>
              )}
            </Button>
            
            {!aiServiceStatus.available && (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">AI service unavailable</span>
              </div>
            )}
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

      {/* Loading States */}
      {loadingState.isLoading && (
        <LoadingCard stage={loadingState.stage === 'generating-insights' ? 'generating-insights' : 'calculating'} />
      )}

      {/* Error Display */}
      {errorState.hasError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Error</span>
            </div>
            <p className="text-sm text-red-700 mt-1">{errorState.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Mathematical Results */}
      {results && !loadingState.isLoading && (
        <ResultsSection title="Growth Model Results" icon={<TrendingUp className="h-5 w-5" />} variant="success">
          {/* Current vs Target State */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Incremental Revenue"
              value={results.incremental.revenue}
              format="currency"
              trend="up"
              description="Additional revenue to be generated"
            />
            <MetricCard
              label="Monthly Growth Rate"
              value={results.incremental.monthlyGrowthRate}
              format="percentage"
              description="Required monthly revenue growth"
            />
            <MetricCard
              label="Revenue per New Hire"
              value={results.incremental.revenuePerEmployee}
              format="currency"
              description="Expected revenue contribution per new hire"
            />
            <MetricCard
              label="Return on Investment"
              value={results.incremental.roi}
              format="percentage"
              trend={results.incremental.roi > 0 ? 'up' : 'down'}
              description="Expected ROI on growth investment"
            />
          </div>

          {/* Investment Analysis */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <MetricCard
              label="Total Investment"
              value={results.investment.total}
              format="currency"
              description="Total budget allocation"
            />
            <MetricCard
              label="Monthly Investment"
              value={results.investment.monthly}
              format="currency"
              description="Average monthly investment"
            />
            <MetricCard
              label="Payback Period"
              value={results.investment.paybackPeriod ? `${results.investment.paybackPeriod} mo` : 'N/A'}
              description="Time to recover investment"
            />
          </div>
        </ResultsSection>
      )}

      {/* AI Strategic Insights */}
      {aiInsights && !loadingState.isLoading && (
        <AIInsightsCard
          title="Strategic Growth Analysis"
          content={formatResponse(aiInsights)}
        />
      )}
    </div>
  );
}
