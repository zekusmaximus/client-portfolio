import React, { useEffect, useMemo } from 'react';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ImpactAnalysisWorkbench from './ImpactAnalysisWorkbench';
import ClientReviewInterface from './ClientReviewInterface';
import TransitionPlanManager from './TransitionPlanManager';
import ScenarioBar from './ScenarioBar';
import HireScenario from './HireScenario';
import ClientSandbox from './ClientSandbox';
import usePortfolioStore from '../../portfolioStore';
import { departureModel } from '../../utils/departure';
import { revenueForYear } from '../../utils/revenue';
import { emptyStateOf, stateFromStore, stateJson, unsavedChanges } from '../../utils/scenarioState';
import { sandboxEntered } from '../../utils/clientFit';

type Stage = 'impact' | 'mitigation' | 'implementation';

interface SuccessionScenarioProps {
  portfolioId?: string;
}

// Three-stage succession workflow: impact analysis -> client review & triage ->
// transition execution. The legacy Stage 2 form and the endpoint only it called
// were unreachable and were removed in WP2 (docs/plans/tier-0.md, D8).
//
// The open stage, the people leaving and the partner's picks live in the store
// (docs/plans/people-and-second-chair.md, Phase 5, P11), so switching tabs
// keeps the scenario. The departure engine (src/utils/departure.js) turns them
// into the clients that need a decision and everyone's load before and after.
//
// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): with an API that lists
// saved-scenarios in /api/health, asked each time the tab opens, the scenario
// bar above the stepper names, saves and opens shared scenarios; the store's
// scenario state is then the open scenario's. Without it the tab works in the
// browser only, as before.
//
// An associate in Scenarios (docs/plans/tier-2.md, section 14, WP9): the tab
// starts with a choice of kind, "Someone leaves" (the three stages, as
// before) or "Add an associate" (HireScenario). One scenario is open at a
// time; choosing another kind starts a new one, asking first when the open
// one holds anything.
//
// Where a new client fits (docs/plans/tier-3.md, section 14, WP6): the third
// kind, "A new client" (ClientSandbox), page only and never saved; the store
// keeps its picks across tabs (clientSandbox) and clears them on logout.
const KINDS = [
  { key: 'departure', label: 'Someone leaves' },
  { key: 'hire', label: 'Add an associate' },
  { key: 'client', label: 'A new client' },
];

const SuccessionScenario: React.FC<SuccessionScenarioProps> = () => {
  const clients = usePortfolioStore((s: any) => s.clients);
  const people = usePortfolioStore((s: any) => s.people);
  const reportingYear = usePortfolioStore((s: any) => s.getReportingYear());
  const workflow = usePortfolioStore((s: any) => s.successionWorkflow);
  const setSuccessionStage = usePortfolioStore((s: any) => s.setSuccessionStage);
  const toggleDeparting = usePortfolioStore((s: any) => s.toggleDeparting);
  const clearDeparting = usePortfolioStore((s: any) => s.clearDeparting);
  const startExecution = usePortfolioStore((s: any) => s.startExecution);
  const resetSuccessionWorkflow = usePortfolioStore((s: any) => s.resetSuccessionWorkflow);
  const hasPlans = usePortfolioStore((s: any) => Object.keys(s.transitionPlans).length > 0);
  const scenarioFeature = usePortfolioStore((s: any) => s.scenarioFeature);
  const savedScenario = usePortfolioStore((s: any) => s.savedScenario);
  const checkScenarioFeature = usePortfolioStore((s: any) => s.checkScenarioFeature);
  const scenarioKind = usePortfolioStore((s: any) => s.scenarioKind);
  const newScenario = usePortfolioStore((s: any) => s.newScenario);
  const currentStage: Stage = workflow.currentStage;

  useEffect(() => {
    checkScenarioFeature();
  }, [checkScenarioFeature]);

  const revenueOf = useMemo(() => (client: any) => revenueForYear(client, reportingYear), [reportingYear]);
  const departure = useMemo(
    () => departureModel({
      people,
      clients,
      departingIds: workflow.departingIds,
      revenueOf,
      choices: workflow.choices,
    }),
    [people, clients, workflow.departingIds, workflow.choices, revenueOf]
  );

  // Another kind: a new scenario, after asking when the open one holds
  // anything (a saved one, or anything entered). The sandbox is not a saved
  // kind, so its "entered" is read from its own slice (WP6)
  const chooseKind = (kind: string) => {
    if (kind === scenarioKind) return;
    const state = usePortfolioStore.getState();
    const entered = scenarioKind === 'client'
      ? sandboxEntered(state.clientSandbox)
      : stateJson(stateFromStore(state)) !== stateJson(emptyStateOf(scenarioKind));
    if (entered || state.savedScenario) {
      const lost = unsavedChanges(state)
        ? 'Its unsaved changes will be lost.'
        : entered ? 'What is on screen is cleared.' : 'It stays saved.';
      const label = KINDS.find((k) => k.key === kind)?.label;
      const question = kind === 'client' ? `Open "${label}"? The open scenario is closed.` : `Start a new "${label}" scenario? The open one is closed.`;
      if (!window.confirm(`${question} ${lost} The book is not changed.`)) return;
    }
    newScenario(kind);
  };

  const renderKindChoice = () => (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">What to model:</span>
          <div className="flex gap-2" role="group" aria-label="Kind of scenario">
            {KINDS.map((kind) => (
              <Button
                key={kind.key}
                size="sm"
                variant={scenarioKind === kind.key ? 'default' : 'outline'}
                aria-pressed={scenarioKind === kind.key}
                data-scenario-kind={kind.key}
                onClick={() => chooseKind(kind.key)}
              >
                {kind.label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Stage transition handlers
  const handleProceedToStage2 = () => setSuccessionStage('mitigation');
  const handleBackToStage1 = () => setSuccessionStage('impact');
  const handleBackToStage2 = () => setSuccessionStage('mitigation');

  // Stage 3 takes the approved plans, keeping what was recorded for them
  const handleProceedToStage3 = () => startExecution(departure.decisions);
  const hasDecisions = departure.decisions.length > 0;

  // A new scenario: nobody leaving, no picks, no plans, no transitions
  const handleStartOver = () => {
    const saved = savedScenario ? ' The saved scenario changes only if you save.' : '';
    if (window.confirm(`Start over? This clears who is leaving, every pick and plan, and Stage 3. The book is not changed.${saved}`)) {
      resetSuccessionWorkflow();
    }
  };

  const renderProgressStepper = () => {
    const stages = [
      { key: 'impact', label: 'Impact Analysis', completed: hasDecisions && currentStage !== 'impact' },
      { key: 'mitigation', label: 'Client Review & Triage', completed: hasDecisions && currentStage === 'implementation' },
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
            {(workflow.departingIds.length > 0 || hasPlans) && (
              <Button variant="ghost" size="sm" onClick={handleStartOver}>
                Start over
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Saved Scenarios (WP8) */}
      {scenarioFeature === true && <ScenarioBar />}

      {/* Someone leaves, an associate is added (WP9), or a new client (Tier 3 WP6) */}
      {renderKindChoice()}

      {scenarioKind === 'hire' && <HireScenario />}

      {scenarioKind === 'client' && <ClientSandbox />}

      {scenarioKind !== 'hire' && scenarioKind !== 'client' && (
      <>
      {/* Progress Stepper */}
      {renderProgressStepper()}

      {/* Stage 1: Impact Analysis */}
      {currentStage === 'impact' && (
        <ImpactAnalysisWorkbench
          departure={departure}
          people={people}
          departingIds={workflow.departingIds}
          year={reportingYear}
          onToggleDeparting={toggleDeparting}
          onClearDeparting={clearDeparting}
          onProceedToStage2={handleProceedToStage2}
        />
      )}

      {/* Stage 2: Client Review & Triage */}
      {currentStage === 'mitigation' && hasDecisions && (
        <ClientReviewInterface
          departure={departure}
          reportingYear={reportingYear}
          onProceedToStage3={handleProceedToStage3}
          onBackToStage1={handleBackToStage1}
        />
      )}

      {/* Stage 2: Fallback when nobody leaving holds a seat (the People list or the book changed) */}
      {currentStage === 'mitigation' && !hasDecisions && (
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
              <h3 className="text-lg font-semibold mb-2">No Clients to Review</h3>
              <p className="text-gray-600 mb-4">
                Mark who is leaving in Stage 1 (Impact Analysis); the clients whose lead or second chair leaves are reviewed here.
              </p>
              <Button onClick={handleBackToStage1}>
                Go to Stage 1
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 3: Transition Execution */}
      {currentStage === 'implementation' && hasDecisions && (
        <TransitionPlanManager
          departure={departure}
          people={people}
          onBackToStage2={handleBackToStage2}
        />
      )}

      {/* Stage 3: Fallback for no data */}
      {currentStage === 'implementation' && !hasDecisions && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Stage 3: Transition Execution</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleBackToStage2}>
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
                Mark who is leaving in Stage 1 and approve the affected clients&apos; plans in Stage 2.
              </p>
              <Button onClick={handleBackToStage2}>
                Go to Stage 2
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  );
};

export default SuccessionScenario;
