import { aiService } from '../lib/ai-service';
import { AIServiceStatus, ErrorState } from '../types/scenario';

/**
 * Utility functions for scenario components
 */

/**
 * Check if AI service is properly initialized and available
 */
export function checkAIServiceStatus(): AIServiceStatus {
  try {
    if (!aiService) {
      return {
        available: false,
        hasApiKey: false,
        error: 'AI service not initialized'
      };
    }

    const status = aiService.getStatus();
    return status;
  } catch (error) {
    return {
      available: false,
      hasApiKey: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Validate scenario input data before making API calls
 */
export function validateScenarioInputs(scenarioType: string, data: any): ErrorState {
  try {
    switch (scenarioType) {
      case 'capacity':
        if (!data.portfolioId) {
          return { hasError: true, message: 'Portfolio ID is required', type: 'validation' };
        }
        if (data.targetUtilization < 50 || data.targetUtilization > 100) {
          return { hasError: true, message: 'Target utilization must be between 50% and 100%', type: 'validation' };
        }
        if (data.minStrategicValue < 1 || data.minStrategicValue > 10) {
          return { hasError: true, message: 'Strategic value must be between 1 and 10', type: 'validation' };
        }
        break;
      
      case 'growth':
        if (!data.portfolioId) {
          return { hasError: true, message: 'Portfolio ID is required', type: 'validation' };
        }
        if (data.growthTarget <= 0) {
          return { hasError: true, message: 'Growth target must be positive', type: 'validation' };
        }
        if (data.timeline <= 0) {
          return { hasError: true, message: 'Timeline must be positive', type: 'validation' };
        }
        if (data.investmentBudget < 0) {
          return { hasError: true, message: 'Investment budget cannot be negative', type: 'validation' };
        }
        break;
      
      default:
        return { hasError: true, message: 'Unknown scenario type', type: 'validation' };
    }
    
    return { hasError: false };
  } catch (error) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Validation failed',
      type: 'validation'
    };
  }
}

/**
 * Format AI response content for display
 */
export function formatAIResponse(content: string): string {
  if (!content) return '';
  
  return content
    // Headers
    .replace(/## (.*?)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-3 text-blue-900 border-b border-blue-200 pb-1">$1</h3>')
    .replace(/### (.*?)$/gm, '<h4 class="text-md font-medium mt-4 mb-2 text-blue-800">$1</h4>')
    .replace(/#### (.*?)$/gm, '<h5 class="text-sm font-medium mt-3 mb-1 text-blue-700">$1</h5>')
    
    // Bold text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    
    // Lists
    .replace(/^\- (.*?)$/gm, '<li class="ml-4 mb-1">• $1</li>')
    
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/^/, '<p class="mb-3">')
    .replace(/$/, '</p>')
    
    // Line breaks
    .replace(/\n/g, '<br />');
}

/**
 * Calculate mathematical results for capacity optimization
 */
export function calculateCapacityResults(data: any) {
  const currentUtilization = data.currentUtilization || 75;
  const targetUtilization = data.targetUtilization || 85;
  const targetHours = data.targetHours || 160;
  const utilizationGap = targetUtilization - currentUtilization;
  
  const additionalCapacity = Math.round((utilizationGap / 100) * targetHours);
  const monthlyInvestment = data.investmentBudget ? Math.round(data.investmentBudget / 12) : 50000;
  const costPerHour = additionalCapacity > 0 ? Math.round(monthlyInvestment / additionalCapacity) : 0;
  const potentialRevenueIncrease = additionalCapacity * 300; // Assumed $300/hour rate
  const breakEvenMonths = potentialRevenueIncrease > 0 ? Math.ceil(monthlyInvestment / (potentialRevenueIncrease / 12)) : 0;

  return {
    utilizationGap,
    additionalCapacity,
    monthlyInvestment,
    costPerHour,
    potentialRevenueIncrease,
    breakEvenMonths,
    totalCapacityIncrease: additionalCapacity * 12
  };
}

/**
 * Calculate mathematical results for growth modeling
 */
export function calculateGrowthResults(data: any, currentRevenue: number = 0) {
  const growthTarget = data.growthTarget || 25;
  const timeline = data.timeline || 24;
  const investmentBudget = data.investmentBudget || 750000;
  const newHires = data.newHires || 3;
  
  const targetRevenue = currentRevenue * (1 + growthTarget / 100);
  const incrementalRevenue = targetRevenue - currentRevenue;
  const monthlyGrowthRate = Math.pow(1 + growthTarget / 100, 1/timeline) - 1;
  const revenuePerEmployee = incrementalRevenue / newHires;
  const roi = ((incrementalRevenue - investmentBudget/2) / investmentBudget) * 100;

  return {
    current: {
      revenue: currentRevenue,
      clients: Math.round(currentRevenue / 50000), // Estimated clients
      avgRevenuePerClient: 50000
    },
    target: {
      revenue: targetRevenue,
      clients: Math.round(targetRevenue / 50000),
      avgRevenuePerClient: 50000
    },
    incremental: {
      revenue: incrementalRevenue,
      clients: Math.round(incrementalRevenue / 50000),
      monthlyGrowthRate: monthlyGrowthRate * 100,
      revenuePerEmployee,
      roi
    },
    investment: {
      total: investmentBudget,
      monthly: investmentBudget / timeline,
      newHires,
      paybackPeriod: roi > 0 ? Math.round(investmentBudget / (incrementalRevenue / 12)) : null
    }
  };
}

/**
 * Format currency values for display
 */
export function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  } else {
    return `$${value.toLocaleString()}`;
  }
}

/**
 * Format percentage values for display
 */
export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Create error message for different error types
 */
export function createErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  
  if (error?.response?.data?.error) {
    return error.response.data.error;
  }
  
  if (error?.message) {
    return error.message;
  }
  
  if (error?.name === 'NetworkError') {
    return 'Network connection failed. Please check your internet connection and try again.';
  }
  
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Debounce function for input handling
 */
export function debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
