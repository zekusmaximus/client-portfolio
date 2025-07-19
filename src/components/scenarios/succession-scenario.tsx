import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface SuccessionScenarioProps {
  portfolioId?: string;
}

const SuccessionScenario: React.FC<SuccessionScenarioProps> = ({ portfolioId }) => {
  // Form state
  const [partnerName, setPartnerName] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [transitionPeriod, setTransitionPeriod] = useState(3);
  const [successorPartner, setSuccessorPartner] = useState('');
  const [retentionStrategy, setRetentionStrategy] = useState('');
  const [riskMitigation, setRiskMitigation] = useState('');
  const [knowledgeTransfer, setKnowledgeTransfer] = useState('');
  const [affectedClients, setAffectedClients] = useState<any[]>([]);

  // Results state
  const [results, setResults] = useState<any>(null);
  
  // AI insights state
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatAIResponse = (response: string): string => {
    // Convert markdown headers to HTML
    let formatted = response
      // Convert ## headers to h2
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3 text-gray-900">$1</h2>')
      // Convert ### headers to h3
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-gray-800">$1</h3>')
      // Convert #### headers to h4
      .replace(/^#### (.*$)/gim, '<h4 class="text-base font-semibold mt-3 mb-2 text-gray-700">$1</h4>')
      // Convert **bold** text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      // Convert *italic* text
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      // Convert bullet points
      .replace(/^- (.*$)/gim, '<li class="ml-4 mb-1">$1</li>')
      // Convert numbered lists
      .replace(/^(\d+)\. (.*$)/gim, '<li class="ml-4 mb-1" style="list-style-type: decimal;">$2</li>')
      // Convert line breaks to paragraphs
      .replace(/\n\n/g, '</p><p class="mb-3">')
      // Wrap in paragraph tags
      .replace(/^(?!<[h2-4]|<li|<\/p>|<p)(.+)$/gim, '<p class="mb-3">$1</p>');

    // Wrap consecutive list items in ul tags
    formatted = formatted.replace(/(<li[^>]*>.*?<\/li>)+/gs, (match) => {
      if (match.includes('list-style-type: decimal')) {
        return `<ol class="list-decimal ml-6 mb-4">${match}</ol>`;
      }
      return `<ul class="list-disc ml-6 mb-4">${match}</ul>`;
    });

    // Clean up any empty paragraphs
    formatted = formatted.replace(/<p[^>]*><\/p>/g, '');
    
    return formatted;
  };

  const handleRunScenario = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Calculate succession metrics (existing mathematical calculations)
      const totalAffectedRevenue = affectedClients.reduce((sum, client) => sum + (client.revenue || 0), 0);
      const clientCount = affectedClients.length;
      const avgClientValue = clientCount > 0 ? totalAffectedRevenue / clientCount : 0;
      
      // Calculate risk scores
      const highRiskClients = affectedClients.filter(client => 
        client.relationshipStrength < 6 || client.strategicValue > 8
      ).length;
      
      const riskLevel = highRiskClients / Math.max(clientCount, 1);
      
      // Estimate retention probability
      const avgRelationshipStrength = affectedClients.reduce((sum, client) => 
        sum + (client.relationshipStrength || 5), 0) / Math.max(clientCount, 1);
      
      const estimatedRetentionRate = Math.min(0.95, Math.max(0.6, avgRelationshipStrength / 10));
      
      // Calculate projected revenue impact
      const projectedRevenueLoss = totalAffectedRevenue * (1 - estimatedRetentionRate);
      const projectedRevenueRetained = totalAffectedRevenue - projectedRevenueLoss;

      const mathematicalResults = {
        totalAffectedRevenue,
        clientCount,
        avgClientValue,
        highRiskClients,
        riskLevel,
        estimatedRetentionRate,
        projectedRevenueLoss,
        projectedRevenueRetained,
        transitionPeriod,
        partnerName,
        departureDate,
        successorPartner
      };

      setResults(mathematicalResults);

      // Prepare scenario data for AI analysis
      const scenarioData = {
        partnerName,
        departureDate,
        transitionPeriod,
        affectedClients,
        successorPartner,
        retentionStrategy,
        riskMitigation,
        knowledgeTransfer,
        totalAffectedRevenue,
        clientCount,
        avgClientValue,
        estimatedRetentionRate,
        projectedRevenueLoss
      };

      // Make POST request to succession scenario API
      const response = await fetch('/api/scenarios/succession', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}` // Assuming JWT token storage
        },
        body: JSON.stringify({
          scenarioData,
          portfolioId: portfolioId || 'default',
          mathematicalResults
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.analysis) {
        setAiInsights(data.analysis);
      } else {
        throw new Error(data.message || 'No AI insights received');
      }

    } catch (err) {
      console.error('Error running succession scenario:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred while generating insights');
    } finally {
      setIsLoading(false);
    }
  };

  const addAffectedClient = () => {
    setAffectedClients([
      ...affectedClients,
      {
        name: '',
        revenue: 0,
        relationshipStrength: 5,
        strategicValue: 5,
        riskLevel: 'Medium',
        practiceArea: []
      }
    ]);
  };

  const updateAffectedClient = (index: number, field: string, value: any) => {
    const updated = [...affectedClients];
    updated[index] = { ...updated[index], [field]: value };
    setAffectedClients(updated);
  };

  const removeAffectedClient = (index: number) => {
    setAffectedClients(affectedClients.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Partner Succession Scenario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="partnerName">Departing Partner Name</Label>
              <Input
                id="partnerName"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="Partner Name"
              />
            </div>
            <div>
              <Label htmlFor="departureDate">Departure Date</Label>
              <Input
                id="departureDate"
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="transitionPeriod">Transition Period (months)</Label>
              <Input
                id="transitionPeriod"
                type="number"
                value={transitionPeriod}
                onChange={(e) => setTransitionPeriod(Number(e.target.value))}
                min="1"
                max="24"
              />
            </div>
            <div>
              <Label htmlFor="successorPartner">Successor Partner</Label>
              <Input
                id="successorPartner"
                value={successorPartner}
                onChange={(e) => setSuccessorPartner(e.target.value)}
                placeholder="TBD"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="retentionStrategy">Client Retention Strategy</Label>
            <Textarea
              id="retentionStrategy"
              value={retentionStrategy}
              onChange={(e) => setRetentionStrategy(e.target.value)}
              placeholder="Describe the strategy for retaining clients during transition..."
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="riskMitigation">Risk Mitigation Measures</Label>
            <Textarea
              id="riskMitigation"
              value={riskMitigation}
              onChange={(e) => setRiskMitigation(e.target.value)}
              placeholder="Describe risk mitigation strategies..."
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="knowledgeTransfer">Knowledge Transfer Plan</Label>
            <Textarea
              id="knowledgeTransfer"
              value={knowledgeTransfer}
              onChange={(e) => setKnowledgeTransfer(e.target.value)}
              placeholder="Describe the knowledge transfer process..."
              rows={3}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <Label>Affected Clients</Label>
              <Button onClick={addAffectedClient} variant="outline" size="sm">
                Add Client
              </Button>
            </div>
            {affectedClients.map((client, index) => (
              <Card key={index} className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    placeholder="Client Name"
                    value={client.name}
                    onChange={(e) => updateAffectedClient(index, 'name', e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Annual Revenue"
                    value={client.revenue}
                    onChange={(e) => updateAffectedClient(index, 'revenue', Number(e.target.value))}
                  />
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Relationship Strength (1-10)"
                      min="1"
                      max="10"
                      value={client.relationshipStrength}
                      onChange={(e) => updateAffectedClient(index, 'relationshipStrength', Number(e.target.value))}
                    />
                    <Button
                      onClick={() => removeAffectedClient(index)}
                      variant="destructive"
                      size="sm"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Button onClick={handleRunScenario} className="w-full">
            Run Succession Scenario Analysis
          </Button>
        </CardContent>
      </Card>

      {/* Mathematical Results Display */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Succession Impact Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  ${results.totalAffectedRevenue?.toLocaleString()}
                </div>
                <div className="text-sm text-blue-800">Revenue at Risk</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {results.clientCount}
                </div>
                <div className="text-sm text-orange-800">Affected Clients</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {(results.estimatedRetentionRate * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-green-800">Expected Retention</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  ${results.projectedRevenueLoss?.toLocaleString()}
                </div>
                <div className="text-sm text-red-800">Projected Loss</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Generating strategic insights...</span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* AI Insights Display */}
      {aiInsights && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Strategic Succession Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              {/* Render AI insights with proper formatting */}
              <div dangerouslySetInnerHTML={{ __html: formatAIResponse(aiInsights) }} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SuccessionScenario;
