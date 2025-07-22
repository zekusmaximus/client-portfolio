import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import DOMPurify from 'isomorphic-dompurify';
import usePortfolioStore from './portfolioStore';
import { apiClient } from './api';
import CurrentPartnershipGrid from './components/CurrentPartnershipGrid';
import PartnerDeepDive from './components/PartnerDeepDive';
import RedistributionModeler from './components/RedistributionModeler';
import PostTransitionGrid from './components/PostTransitionGrid';
import ClientFlowVisualization from './components/ClientFlowVisualization';
import AIErrorBoundary from './components/AIErrorBoundary';

const PartnershipAnalytics = () => {
  const { 
    partners, 
    selectedPartner, 
    clients,
    fetchPartners, 
    setSelectedPartner,
    markPartnerDeparting,
    partnershipTransition,
    updatePartnershipTransition,
    getClientRevenue
  } = usePortfolioStore();

  const [showTransitionView, setShowTransitionView] = useState(false);
  const [redistributionModel, setRedistributionModel] = useState('balanced');
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState(null);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handlePartnerClick = (partner) => {
    setSelectedPartner(partner);
  };

  const handlePartnerRightClick = (partner, e) => {
    e.preventDefault();
    markPartnerDeparting(partner.id);
  };

  // Secure AI optimization with comprehensive validation
  const requestAIOptimization = async () => {
    try {
      setAILoading(true);
      setAIError(null);
      
      // Validate prerequisites
      const departingPartners = partners.filter(p => p.isDeparting);
      const remainingPartners = partners.filter(p => !p.isDeparting);
      
      if (!departingPartners.length) {
        throw new Error('No departing partners selected for optimization');
      }
      
      if (!remainingPartners.length) {
        throw new Error('No remaining partners available for redistribution');
      }

      // Prepare structured data with input sanitization
      const sanitizedDepartingData = departingPartners.map(p => ({
        name: DOMPurify.sanitize(p.name || '', { ALLOWED_TAGS: [] }),
        clients: (p.clients || []).map(id => {
          const client = clients.find(c => c.id === id);
          if (!client) return null;
          
          return {
            id: DOMPurify.sanitize(String(client.id), { ALLOWED_TAGS: [] }),
            name: DOMPurify.sanitize(client.name || '', { ALLOWED_TAGS: [] }),
            revenue: Math.max(0, getClientRevenue(client) || 0),
            practiceAreas: Array.isArray(client.practice_area) ? 
              client.practice_area.map(area => DOMPurify.sanitize(String(area), { ALLOWED_TAGS: [] })) : [],
            strategicValue: Math.max(0, Math.min(10, client.strategic_value || 0))
          };
        }).filter(Boolean)
      }));

      const sanitizedRemainingData = remainingPartners.map(p => ({
        name: DOMPurify.sanitize(p.name || '', { ALLOWED_TAGS: [] }),
        currentLoad: Math.max(0, p.clientCount || 0),
        capacity: 30, // Fixed capacity limit
        expertise: Array.isArray(p.practiceAreas) ? 
          p.practiceAreas.map(area => DOMPurify.sanitize(String(area), { ALLOWED_TAGS: [] })) : [],
        currentRevenue: Math.max(0, p.totalRevenue || 0)
      }));

      const prompt = `Analyze this partnership transition and provide optimal client redistribution.
      
      DEPARTING PARTNERS:
      ${JSON.stringify(sanitizedDepartingData, null, 2)}
      
      REMAINING PARTNERS:
      ${JSON.stringify(sanitizedRemainingData, null, 2)}
      
      CONSTRAINTS:
      1. No partner should exceed 85% capacity (25 clients)
      2. Revenue variance between partners should be <15%
      3. Match client practice areas to partner expertise
      4. Consider existing relationships in lobbyist_team
      
      Return ONLY valid JSON in this exact format:
      {
        "assignments": [
          {
            "clientId": "string",
            "clientName": "string", 
            "toPartner": "partner name",
            "reason": "brief explanation"
          }
        ],
        "metrics": {
          "maxCapacityPercent": number,
          "revenueVariancePercent": number,
          "expertiseMatchPercent": number
        }
      }`;

      const response = await apiClient.post('/api/claude/analyze', {
        prompt: DOMPurify.sanitize(prompt, { ALLOWED_TAGS: [] }),
        context: 'partnership_transition'
      });

      // SECURITY: Comprehensive response validation
      if (!response?.data?.analysis) {
        throw new Error('Invalid AI response structure');
      }

      // Sanitize response before parsing
      const sanitizedResponse = DOMPurify.sanitize(String(response.data.analysis), { 
        ALLOWED_TAGS: [] 
      });

      let parsed;
      try {
        parsed = JSON.parse(sanitizedResponse);
      } catch (parseError) {
        throw new Error('AI response is not valid JSON');
      }

      // Validate response structure with type checking
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI response is not a valid object');
      }

      if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
        throw new Error('AI response missing valid assignments array');
      }

      if (!parsed.metrics || typeof parsed.metrics !== 'object') {
        throw new Error('AI response missing valid metrics object');
      }

      // Validate each assignment with security checks
      const customAssignments = {};
      let validAssignments = 0;

      parsed.assignments.forEach(assignment => {
        // Input validation and sanitization
        if (!assignment || typeof assignment !== 'object') return;
        
        const clientId = DOMPurify.sanitize(String(assignment.clientId || ''), { ALLOWED_TAGS: [] });
        const toPartner = DOMPurify.sanitize(String(assignment.toPartner || ''), { ALLOWED_TAGS: [] });
        
        if (!clientId.trim() || !toPartner.trim()) return;

        // Verify client exists and belongs to departing partner
        const client = clients.find(c => c.id === clientId);
        if (!client) return;
        
        const isDepartingClient = departingPartners.some(dp => 
          dp.clients && dp.clients.includes(clientId)
        );
        if (!isDepartingClient) return;

        // Verify target partner exists and is not departing
        const targetPartner = remainingPartners.find(rp => 
          rp.name === toPartner && !rp.isDeparting
        );
        if (!targetPartner) return;

        customAssignments[clientId] = targetPartner.id;
        validAssignments++;
      });

      if (validAssignments === 0) {
        throw new Error('No valid assignments found in AI response');
      }

      // Validate metrics with bounds checking
      const metrics = {
        maxCapacityPercent: Math.max(0, Math.min(200, parsed.metrics.maxCapacityPercent || 0)),
        revenueVariancePercent: Math.max(0, Math.min(100, parsed.metrics.revenueVariancePercent || 0)),
        expertiseMatchPercent: Math.max(0, Math.min(100, parsed.metrics.expertiseMatchPercent || 0))
      };

      // Update store with validated assignments
      updatePartnershipTransition({
        redistributionModel: 'custom',
        customAssignments,
        aiMetrics: metrics
      });

      setRedistributionModel('custom');

    } catch (error) {
      console.error('AI optimization failed:', error);
      
      // Set user-friendly error message based on error type
      let errorMessage = 'AI optimization failed. Please try manual assignment.';
      
      if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('authentication')) {
        errorMessage = 'Authentication error. Please refresh and try again.';
      } else if (error.message.includes('JSON') || error.message.includes('response')) {
        errorMessage = 'AI service returned invalid data. Please try again later.';
      }
      
      setAIError(errorMessage);
    } finally {
      setAILoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <CurrentPartnershipGrid 
        partners={partners}
        onPartnerClick={handlePartnerClick}
        onPartnerRightClick={handlePartnerRightClick}
      />
      
      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
        <Switch
          checked={showTransitionView}
          onCheckedChange={setShowTransitionView}
        />
        <Label className="text-sm font-medium">Show Post-Transition Model</Label>
        {showTransitionView && (
          <div className="text-xs text-gray-600">
            Showing projected partner states after redistribution
          </div>
        )}
      </div>

      <AIErrorBoundary fallbackAction={() => setRedistributionModel('balanced')}>
        <RedistributionModeler 
          model={redistributionModel}
          onModelChange={(model) => {
            setRedistributionModel(model);
            updatePartnershipTransition({ redistributionModel: model });
          }}
          onRequestAI={requestAIOptimization}
          aiLoading={aiLoading}
        />
      </AIErrorBoundary>

      {/* AI Error Display */}
      {aiError && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {aiError}
          </AlertDescription>
        </Alert>
      )}
      
      {showTransitionView && (
        <>
          <PostTransitionGrid 
            partners={partners}
            model={redistributionModel}
            clients={clients}
            customAssignments={partnershipTransition.customAssignments}
          />
          <ClientFlowVisualization 
            partners={partners}
            assignments={partnershipTransition.customAssignments}
            clients={clients}
          />
        </>
      )}
      
      {selectedPartner && (
        <PartnerDeepDive 
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
          isTransitionView={showTransitionView}
        />
      )}
    </div>
  );
};

export default PartnershipAnalytics;