import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { AlertTriangle, Download } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import CurrentPartnershipGrid from './components/CurrentPartnershipGrid';
import PartnerDeepDive from './components/PartnerDeepDive';
import RedistributionModeler from './components/RedistributionModeler';
import PostTransitionGrid from './components/PostTransitionGrid';
import ClientFlowVisualization from './components/ClientFlowVisualization';
import PartnershipMetrics from './components/PartnershipMetrics';
import ScenarioComparison from './components/ScenarioComparison';
import TransitionChecklist from './components/TransitionChecklist';
import AIErrorBoundary from './components/AIErrorBoundary';
import { 
  exportPartnershipPDF, 
  exportTransitionPlan,
  exportCapacityAnalysis 
} from './utils/partnershipExports';

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

  // Export handlers
  const handleExportPDF = () => {
    try {
      exportPartnershipPDF(partners, partnershipTransition, clients, getClientRevenue);
    } catch (error) {
      console.error('Export PDF failed:', error);
      setAIError('PDF export failed. Please try again.');
    }
  };

  const handleExportTransition = () => {
    try {
      exportTransitionPlan(
        partnershipTransition.customAssignments,
        partners,
        clients,
        getClientRevenue
      );
    } catch (error) {
      console.error('Export transition plan failed:', error);
      setAIError('Transition plan export failed. Please try again.');
    }
  };

  const handleExportCapacity = () => {
    try {
      exportCapacityAnalysis(partners, clients, getClientRevenue);
    } catch (error) {
      console.error('Export capacity analysis failed:', error);
      setAIError('Capacity analysis export failed. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Metrics Overview */}
      <PartnershipMetrics 
        partners={partners}
        transitions={partnershipTransition}
        clients={clients}
      />
      
      {/* Current Partnership State */}
      <CurrentPartnershipGrid 
        partners={partners}
        onPartnerClick={handlePartnerClick}
        onPartnerRightClick={handlePartnerRightClick}
      />
      
      {/* Transition Controls */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-4">
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
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Analysis
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleExportPDF}>
              Partnership Report (PDF)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportTransition}>
              Transition Plan (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportCapacity}>
              Capacity Analysis (CSV)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Redistribution Modeler */}
      <AIErrorBoundary fallbackAction={() => setRedistributionModel('balanced')}>
        <RedistributionModeler 
          model={redistributionModel}
          onModelChange={(model) => {
            setRedistributionModel(model);
            updatePartnershipTransition({ redistributionModel: model });
          }}
        />
      </AIErrorBoundary>

      {/* Export error display */}
      {aiError && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {aiError}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Transition View */}
      {showTransitionView && (
        <>
          <ScenarioComparison 
            scenarios={['balanced', 'expertise', 'relationship', 'custom']}
            onApply={(model) => {
              setRedistributionModel(model);
              updatePartnershipTransition({ redistributionModel: model });
            }}
          />
          
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
          
          <TransitionChecklist 
            assignments={partnershipTransition.customAssignments}
            clients={clients}
          />
        </>
      )}
      
      {/* Partner Deep Dive */}
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