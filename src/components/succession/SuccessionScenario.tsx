import React, { useState } from 'react';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ImpactAnalysisWorkbench from './ImpactAnalysisWorkbench';
import ClientReviewInterface from './ClientReviewInterface';
import TransitionPlanManager from './TransitionPlanManager';
import usePortfolioStore from '../../portfolioStore';

interface SuccessionScenarioProps {
  portfolioId?: string;
  initialStage?: 'impact' | 'mitigation' | 'implementation';
}

// Three-stage succession workflow: impact analysis -> client review & triage ->
// transition execution. The legacy Stage 2 form and the endpoint only it called
// were unreachable and were removed in WP2 (docs/plans/tier-0.md, D8).
const SuccessionScenario: React.FC<SuccessionScenarioProps> = ({ initialStage = 'impact' }) => {
  // Workflow state
  const [currentStage, setCurrentStage] = useState<'impact' | 'mitigation' | 'implementation'>(initialStage);
  const [stage1Data, setStage1Data] = useState<any>(null);
  const [stage2Data, setStage2Data] = useState<any>(null);

  // Stage transition handlers
  const handleProceedToStage2 = (analysisData: any) => {
    setStage1Data(analysisData);
    setCurrentStage('mitigation');
  };

  const handleBackToStage1 = () => {
    setCurrentStage('impact');
  };

  const handleBackToStage2 = () => {
    setCurrentStage('mitigation');
  };

  const handleProceedToStage3 = (transitionPlans: any) => {
    const stage2Data = { ...stage1Data, transitionPlans };
    setStage2Data(stage2Data);
    setCurrentStage('implementation');
    
    // Initialize transitions in the store for Stage 3
    usePortfolioStore.getState().initializeTransitionsFromPlans(stage2Data);
  };

  const renderProgressStepper = () => {
    const stages = [
      { key: 'impact', label: 'Impact Analysis', completed: stage1Data !== null },
      { key: 'mitigation', label: 'Client Review & Triage', completed: stage2Data !== null },
      { key: 'implementation', label: 'Transition Execution', completed: false }
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

      {/* Stage 2: Fallback for no data (only reachable via initialStage) */}
      {currentStage === 'mitigation' && !stage1Data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Stage 2: Client Review & Triage</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleBackToStage1}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Analysis
                </Button>
                <Badge variant="outline">Stage 2 of 3</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <h3 className="text-lg font-semibold mb-2">No Impact Analysis Yet</h3>
              <p className="text-gray-600 mb-4">
                Complete Stage 1 (Impact Analysis) to review the affected clients.
              </p>
              <Button onClick={handleBackToStage1}>
                Go to Stage 1
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 3: Transition Execution */}
      {currentStage === 'implementation' && stage2Data && (
        <TransitionPlanManager
          stage2Data={stage2Data}
          onBackToStage2={handleBackToStage2}
        />
      )}

      {/* Stage 3: Fallback for no data */}
      {currentStage === 'implementation' && !stage2Data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Stage 3: Transition Execution</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setCurrentStage('mitigation')}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Review
                </Button>
                <Badge variant="outline">Stage 3 of 3</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <h3 className="text-lg font-semibold mb-2">No Execution Data</h3>
              <p className="text-gray-600 mb-4">
                Complete Stage 2 (Client Review & Triage) to access transition execution management.
              </p>
              <Button onClick={() => setCurrentStage('mitigation')}>
                Go to Stage 2
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SuccessionScenario;
