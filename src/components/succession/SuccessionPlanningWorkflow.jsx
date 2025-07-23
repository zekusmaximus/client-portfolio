import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Users,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  RotateCcw,
  FileText,
  Target
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import SuccessionScenario from '../scenarios/succession-scenario';

// Workflow Status Component
const WorkflowStatus = ({ stage, completedStages, onStageClick }) => {
  const stages = [
    { 
      key: 'impact', 
      label: 'Impact Analysis', 
      description: 'Analyze partner departure impact',
      icon: TrendingUp,
      color: 'blue'
    },
    { 
      key: 'triage', 
      label: 'Client Review & Triage', 
      description: 'Review and approve transition plans',
      icon: Users,
      color: 'green'
    },
    { 
      key: 'execution', 
      label: 'Transition Execution', 
      description: 'Manage active transitions',
      icon: Target,
      color: 'purple'
    }
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Succession Planning Workflow
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          {stages.map((stageInfo, index) => {
            const Icon = stageInfo.icon;
            const isActive = stage === stageInfo.key;
            const isCompleted = completedStages.includes(stageInfo.key);
            const isClickable = index === 0 || completedStages.includes(stages[index - 1].key);
            
            return (
              <div key={stageInfo.key} className="flex items-center">
                <div 
                  className={`relative cursor-pointer group ${!isClickable ? 'cursor-not-allowed opacity-50' : ''}`}
                  onClick={() => isClickable && onStageClick?.(stageInfo.key)}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                    isActive 
                      ? `border-${stageInfo.color}-600 bg-${stageInfo.color}-50` 
                      : isCompleted 
                        ? 'border-green-600 bg-green-50' 
                        : 'border-gray-300 bg-gray-50'
                  }`}>
                    {isCompleted ? (
                      <CheckCircle className="h-6 w-6 text-green-600" />
                    ) : (
                      <Icon className={`h-6 w-6 ${
                        isActive 
                          ? `text-${stageInfo.color}-600` 
                          : 'text-gray-400'
                      }`} />
                    )}
                  </div>
                  
                  {/* Stage Info Tooltip */}
                  <div className="absolute top-14 left-1/2 transform -translate-x-1/2 w-48 bg-white border rounded-lg shadow-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <div className="font-medium text-sm">{stageInfo.label}</div>
                    <div className="text-xs text-gray-600 mt-1">{stageInfo.description}</div>
                    {isCompleted && (
                      <Badge variant="outline" className="mt-2 text-xs">
                        Completed
                      </Badge>
                    )}
                  </div>
                </div>
                
                {index < stages.length - 1 && (
                  <ArrowRight className={`h-4 w-4 mx-4 ${
                    completedStages.includes(stageInfo.key) ? 'text-green-500' : 'text-gray-300'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Current Stage Description */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="font-medium">Current: {stages.find(s => s.key === stage)?.label}</span>
          </div>
          <p className="text-sm text-gray-600">
            {stages.find(s => s.key === stage)?.description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

// Workflow Statistics Component
const WorkflowStatistics = () => {
  const { 
    successionWorkflow, 
    transitionPlans, 
    activeTransitions, 
    executionMetrics 
  } = usePortfolioStore();

  const stats = [
    {
      label: 'Workflow Stage',
      value: successionWorkflow.currentStage === 'impact' ? '1 of 3' :
             successionWorkflow.currentStage === 'mitigation' ? '2 of 3' : '3 of 3',
      icon: Clock,
      color: 'text-blue-600'
    },
    {
      label: 'Transition Plans',
      value: Object.keys(transitionPlans).length,
      icon: FileText,
      color: 'text-green-600'
    },
    {
      label: 'Active Transitions',
      value: activeTransitions.length,
      icon: Users,
      color: 'text-purple-600'
    },
    {
      label: 'Success Rate',
      value: `${executionMetrics.successRate || 0}%`,
      icon: TrendingUp,
      color: 'text-orange-600'
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card key={index}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <Icon className={`h-8 w-8 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

// Main Succession Planning Workflow Component
const SuccessionPlanningWorkflow = ({ portfolioId = 'default', onClose }) => {
  const { 
    successionWorkflow, 
    setSuccessionStage, 
    resetSuccessionWorkflow,
    activeTransitions,
    executionAlerts
  } = usePortfolioStore();

  const [currentStage, setCurrentStage] = useState(successionWorkflow.currentStage || 'impact');
  
  // Determine completed stages based on data availability
  const completedStages = [];
  if (successionWorkflow.stage1Data) completedStages.push('impact');
  if (successionWorkflow.stage2Data || Object.keys(usePortfolioStore.getState().transitionPlans).length > 0) {
    completedStages.push('triage');
  }
  if (activeTransitions.length > 0) completedStages.push('execution');

  const handleStageClick = (stage) => {
    setCurrentStage(stage);
  };

  const handleResetWorkflow = () => {
    if (window.confirm('Are you sure you want to reset the entire succession planning workflow? This will clear all data and progress.')) {
      resetSuccessionWorkflow();
      setCurrentStage('impact');
    }
  };

  // Map internal stage names to SuccessionScenario stage names
  const getSuccessionScenarioStage = () => {
    switch (currentStage) {
      case 'impact': return 'impact';
      case 'triage': return 'mitigation';
      case 'execution': return 'implementation';
      default: return 'impact';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-blue-900">
                Succession Planning Workflow
              </h2>
              <p className="text-sm text-blue-700 mt-1">
                Comprehensive three-stage succession planning for managing partner transitions
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleResetWorkflow}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Workflow
              </Button>
              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Statistics */}
      <WorkflowStatistics />

      {/* Workflow Status Navigation */}
      <WorkflowStatus 
        stage={currentStage}
        completedStages={completedStages}
        onStageClick={handleStageClick}
      />

      {/* Active Alerts */}
      {executionAlerts.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span>
                <strong>{executionAlerts.length} active alerts</strong> require attention in the execution stage.
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentStage('execution')}
              >
                View Alerts
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Workflow Content */}
      <SuccessionScenario 
        portfolioId={portfolioId} 
        initialStage={getSuccessionScenarioStage()}
      />

      {/* Workflow Guidance */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg">Workflow Guidance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <span className="font-medium">Stage 1: Impact Analysis</span>
                </div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Select departing partners</li>
                  <li>• View impact heat map</li>
                  <li>• Analyze financial risk</li>
                  <li>• Categorize affected clients</li>
                </ul>
              </div>
              
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-5 w-5 text-green-600" />
                  <span className="font-medium">Stage 2: Client Review</span>
                </div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Generate AI transition plans</li>
                  <li>• Review and modify plans</li>
                  <li>• Assign successor partners</li>
                  <li>• Approve final plans</li>
                </ul>
              </div>
              
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-5 w-5 text-purple-600" />
                  <span className="font-medium">Stage 3: Execution</span>
                </div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Timeline & Gantt management</li>
                  <li>• Task assignment & tracking</li>
                  <li>• Communication logging</li>
                  <li>• Success metrics monitoring</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-gray-100 p-4 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>Pro Tip:</strong> Complete each stage thoroughly before proceeding to the next. 
                You can navigate back to previous stages to make adjustments, but ensure all critical 
                decisions are finalized before moving forward.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuccessionPlanningWorkflow;