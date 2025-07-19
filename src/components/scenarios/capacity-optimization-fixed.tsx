import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function CapacityOptimization({ portfolioId }: { portfolioId: string }) {
  // State for inputs
  const [targetHours, setTargetHours] = useState(160);
  const [targetUtilization, setTargetUtilization] = useState([80]);
  const [minStrategicValue, setMinStrategicValue] = useState([6]);
  
  // State for results
  const [results, setResults] = useState<any>(null);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOptimize = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/scenarios/capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId,
          scenarioData: {
            targetHours: targetHours,
            currentUtilization: 75, // Default current utilization
            targetUtilization: targetUtilization[0],
            minStrategicValue: minStrategicValue[0],
            optimizationGoals: { targetUtilization: targetUtilization[0], minStrategicValue: minStrategicValue[0] },
          }
        })
      });

      if (!response.ok) throw new Error('Failed to run scenario');
      
      const data = await response.json();
      setResults(data.mathematical);
      setAiInsights(data.strategic);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Capacity Optimization Scenario</CardTitle>
          <CardDescription>
            Optimize partner time allocation across clients for maximum efficiency
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Input controls for scenario parameters */}
          <div className="space-y-4">
            <div>
              <Label>Target Partner Hours per Month</Label>
              <Input
                type="number"
                value={targetHours}
                onChange={(e) => setTargetHours(Number(e.target.value))}
              />
            </div>
            
            <div>
              <Label>Target Utilization Rate (%)</Label>
              <Slider
                value={targetUtilization}
                onValueChange={setTargetUtilization}
                min={50}
                max={100}
                step={5}
              />
              <span className="text-sm text-muted-foreground">{targetUtilization[0]}%</span>
            </div>

            <div>
              <Label>Minimum Strategic Value</Label>
              <Slider
                value={minStrategicValue}
                onValueChange={setMinStrategicValue}
                min={1}
                max={10}
                step={1}
              />
              <span className="text-sm text-muted-foreground">{minStrategicValue[0]}/10</span>
            </div>
          </div>

          <Button onClick={handleOptimize} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Optimizing...
              </>
            ) : (
              'Run Optimization'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results section */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Optimization Results</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Display mathematical optimization results */}
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold">Optimal Client Mix</h4>
                <p>Utilization Gap: {results.utilizationGap}%</p>
                <p>Monthly Investment: ${results.monthlyInvestment?.toLocaleString()}</p>
                <p>Cost per Hour: ${results.costPerHour?.toLocaleString()}</p>
              </div>
              <div>
                <h4 className="font-semibold">Revenue Impact</h4>
                <p>Potential Revenue Increase: ${results.potentialRevenueIncrease?.toLocaleString()}</p>
                <p>Break-even: {results.breakEvenMonths} months</p>
                <p>Total Capacity Increase: {results.totalCapacityIncrease} hours</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Insights section */}
      {isLoading && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Generating strategic insights...</span>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {aiInsights && (
        <Card>
          <CardHeader>
            <CardTitle>Strategic Capacity Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              <div dangerouslySetInnerHTML={{ __html: formatAIResponse(aiInsights) }} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Helper function to format AI response
function formatAIResponse(content: string): string {
  return content
    .replace(/## (.*?)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
    .replace(/### (.*?)$/gm, '<h4 class="text-md font-medium mt-3 mb-1">$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}
