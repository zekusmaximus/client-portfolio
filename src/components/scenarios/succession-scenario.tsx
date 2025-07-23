import React, { useState } from 'react';
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import ImpactAnalysisWorkbench from '../succession/ImpactAnalysisWorkbench';
import ClientReviewInterface from '../succession/ClientReviewInterface';

interface SuccessionScenarioProps {
  portfolioId?: string;
}

const SuccessionScenario: React.FC<SuccessionScenarioProps> = ({ portfolioId }) => {
  // Workflow state
  const [currentStage, setCurrentStage] = useState<'impact' | 'mitigation' | 'implementation'>('impact');
  const [stage1Data, setStage1Data] = useState<any>(null);
  
  // Form state for Stage 2 & 3
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

  // Stage transition handlers
  const handleProceedToStage2 = (analysisData: any) => {
    setStage1Data(analysisData);
    setCurrentStage('mitigation');
    
    // Pre-populate form data from analysis
    if (analysisData.selectedPartners.length > 0) {
      const firstPartner = analysisData.selectedPartners[0]; // Could enhance to handle multiple
      setPartnerName(firstPartner);
    }
    setAffectedClients(analysisData.affectedClients);
  };

  const handleBackToStage1 = () => {
    setCurrentStage('impact');
  };

  const handleProceedToStage3 = (transitionPlans: any) => {
    setStage1Data({ ...stage1Data, transitionPlans });
    setCurrentStage('implementation');
  };

  const renderProgressStepper = () => {
    const stages = [
      { key: 'impact', label: 'Impact Analysis', completed: stage1Data !== null },
      { key: 'mitigation', label: 'Client Review & Triage', completed: stage1Data?.transitionPlans !== undefined },
      { key: 'implementation', label: 'Implementation', completed: false }
    ];

    return (
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            {stages.map((stage, index) => (
              <div key={stage.key} className="flex items-center">
                <div className={`flex items-center gap-2 ${
                  currentStage === stage.key ? 'text-blue-600 font-medium' : 
                  stage.completed ? 'text-green-600' : 'text-gray-400'
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    currentStage === stage.key ? 'border-blue-600 bg-blue-50' :
                    stage.completed ? 'border-green-600 bg-green-50' : 'border-gray-300'
                  }`}>
                    {stage.completed ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <span className="text-sm font-medium">{index + 1}</span>
                    )}
                  </div>
                  <span className="text-sm">{stage.label}</span>
                </div>
                {index < stages.length - 1 && (
                  <div className={`w-12 h-px mx-4 ${
                    stages[index + 1].completed || currentStage === stages[index + 1].key 
                      ? 'bg-blue-300' : 'bg-gray-300'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

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
      {/* Progress Stepper */}
      {renderProgressStepper()}

      {/* Stage 1: Impact Analysis */}
      {currentStage === 'impact' && (
        <ImpactAnalysisWorkbench onProceedToStage2={handleProceedToStage2} />
      )}

      {/* Stage 2: Client Review & Triage */}
      {currentStage === 'mitigation' && stage1Data && (
        <ClientReviewInterface
          stage1Data={stage1Data}
          onProceedToStage3={handleProceedToStage3}
          onBackToStage1={handleBackToStage1}
        />
      )}

      {/* Legacy Stage 2: Mitigation Planning Form (kept for backward compatibility) */}
      {currentStage === 'mitigation' && !stage1Data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Stage 2: Mitigation Planning</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleBackToStage1}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Analysis
                  </Button>
                  <Badge variant="outline">Stage 2 of 3</Badge>
                </div>
              </CardTitle>
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

          <div className="flex gap-4">
            <Button onClick={handleRunScenario} className="flex-1">
              Generate Mitigation Strategy
            </Button>
            <Button onClick={handleProceedToStage3} variant="outline">
              Skip to Implementation
            </Button>
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {/* Stage 3: Implementation Planning */}
      {currentStage === 'implementation' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Stage 3: Implementation Planning</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setCurrentStage('mitigation')}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Mitigation
                </Button>
                <Badge variant="outline">Stage 3 of 3</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <h3 className="text-lg font-semibold mb-2">Implementation Planning</h3>
              <p className="text-gray-600 mb-4">
                Create detailed implementation timeline and action plans based on your mitigation strategy.
              </p>
              <Badge variant="secondary">Coming Soon</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mathematical Results Display - Only for Stage 2 */}
      {results && currentStage === 'mitigation' && (
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

      {/* Loading State - Only for Stage 2 */}
      {isLoading && currentStage === 'mitigation' && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Generating strategic insights...</span>
        </div>
      )}

      {/* Error Display - Only for Stage 2 */}
      {error && currentStage === 'mitigation' && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* AI Insights Display - Only for Stage 2 */}
      {aiInsights && currentStage === 'mitigation' && (
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
