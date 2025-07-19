// TypeScript types for scenario components

export interface PortfolioSummary {
  totalClients: number;
  totalRevenue: number;
  avgStrategicValue: number;
  topClients: any[];
  practiceAreas: Record<string, number>;
  riskProfile: Record<string, number>;
  statusBreakdown: Record<string, number>;
}

export interface BaseScenarioData {
  portfolioId: string;
}

export interface CapacityOptimizationData extends BaseScenarioData {
  targetHours: number;
  currentUtilization: number;
  targetUtilization: number;
  minStrategicValue: number;
  additionalCapacity?: number;
  timeframe?: number;
  investmentBudget?: number;
  practiceAreaFocus?: string[];
  expectedROI?: number;
  optimizationGoals: {
    targetUtilization: number;
    minStrategicValue: number;
  };
}

export interface GrowthModelingData extends BaseScenarioData {
  growthTarget: number;
  timeline: number;
  investmentBudget: number;
  newHires: number;
  marketConditions: number;
  growthVector: string;
  targetMarkets: string[];
}

export interface SuccessionScenarioData extends BaseScenarioData {
  partnerName: string;
  departureDate: string;
  transitionPeriod: number;
  affectedClients: any[];
  successorPartner: string;
  retentionStrategy: string;
  riskMitigation: string;
  knowledgeTransfer?: string;
}

export interface ScenarioResults {
  mathematical: any;
  strategic: string;
  success: boolean;
  error?: string;
}

export interface AIServiceStatus {
  available: boolean;
  hasApiKey: boolean;
  error?: string;
}

export interface LoadingState {
  isLoading: boolean;
  stage?: 'calculating' | 'generating-insights' | 'complete';
  progress?: number;
}

export interface ErrorState {
  hasError: boolean;
  message?: string;
  type?: 'validation' | 'api' | 'network' | 'ai-service';
}
