const {
  createAnalysisPrompt,
  createStrategicPrompt,
  createClientRecommendationPrompt,
  createSuccessionScenarioPrompt,
  createCapacityScenarioPrompt,
  createGrowthScenarioPrompt,
  PROMPT_SETTINGS,
} = require('../../claude.cjs');

// Types
interface PortfolioSummary {
  totalClients: number;
  totalRevenue: number;
  avgStrategicValue: number;
  topClients: any[];
  practiceAreas: Record<string, number>;
  riskProfile: Record<string, number>;
  statusBreakdown: Record<string, number>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
}

/**
 * Azure OpenAI Service for handling AI-powered analysis and recommendations
 */
class AzureOpenAIService {
  private apiKey: string | null = null;
  private client: any = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      // Try to initialize with available API key
      this.apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY || null;
      
      if (this.apiKey) {
        const { Anthropic } = require('@anthropic-ai/sdk');
        this.client = new Anthropic({ apiKey: this.apiKey });
        console.log('✅ AI Service initialized successfully');
      } else {
        console.warn('⚠️ AI Service initialized without API key');
      }
    } catch (error) {
      console.error('❌ Failed to initialize AI Service:', error);
      this.client = null;
    }
  }

  private async getChatCompletions(options: ChatCompletionOptions): Promise<string> {
    if (!this.client) {
      throw new Error('AI service not initialized - check API key configuration');
    }

    try {
      const response = await this.client.messages.create({
        model: options.model || 'claude-sonnet-4-20250514',
        max_tokens: options.max_tokens || 2500,
        temperature: options.temperature || 0.3,
        top_p: options.top_p,
        frequency_penalty: options.frequency_penalty,
        messages: options.messages,
      });

      return response.content[0].text;
    } catch (error) {
      console.error('❌ AI API call failed:', error);
      throw new Error(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get portfolio analysis using AI
   */
  async getPortfolioAnalysis(portfolioSummary: PortfolioSummary): Promise<string> {
    try {
      const prompt = createAnalysisPrompt(portfolioSummary);
      const settings = PROMPT_SETTINGS.portfolioAnalysis;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior strategic consultant specializing in government relations law firms, with deep expertise in practice management, client portfolio optimization, and succession planning.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in portfolio analysis:', error);
      throw new Error('Failed to generate portfolio analysis. Please try again later.');
    }
  }

  /**
   * Get strategic advice using AI
   */
  async getStrategicAdvice(portfolioSummary: PortfolioSummary, query?: string, context?: string): Promise<string> {
    try {
      const prompt = createStrategicPrompt(portfolioSummary, query, context);
      const settings = PROMPT_SETTINGS.strategicAdvice;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior strategic advisor with 20+ years of experience in government relations law firm management, known for analytical rigor and strategic thinking.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in strategic advice generation:', error);
      throw new Error('Failed to generate strategic advice. Please try again later.');
    }
  }

  /**
   * Get client-specific recommendations using AI
   */
  async getClientRecommendations(client: any, portfolioContext?: string): Promise<string> {
    try {
      const prompt = createClientRecommendationPrompt(client, portfolioContext);
      const settings = PROMPT_SETTINGS.clientRecommendations;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior client relationship strategist for a premier government relations law firm, developing comprehensive client strategies for managing partners.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in client recommendations generation:', error);
      throw new Error('Failed to generate client recommendations. Please try again later.');
    }
  }

  /**
   * Get succession scenario analysis using AI
   */
  async getSuccessionScenarioAnalysis(
    scenarioData: any,
    portfolioSummary: PortfolioSummary
  ): Promise<string> {
    try {
      const prompt = createSuccessionScenarioPrompt(scenarioData, portfolioSummary);
      const settings = PROMPT_SETTINGS.successionScenario;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior succession planning consultant specializing in government relations law firms. You analyze critical partner transition scenarios and develop comprehensive strategic planning and risk mitigation strategies.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in succession scenario analysis:', error);
      throw new Error('Failed to generate succession scenario analysis. Please check your input data and try again.');
    }
  }

  /**
   * Get capacity optimization analysis using AI
   */
  async getCapacityOptimizationAnalysis(
    scenarioData: any,
    portfolioSummary: PortfolioSummary
  ): Promise<string> {
    try {
      const prompt = createCapacityScenarioPrompt(scenarioData, portfolioSummary);
      const settings = PROMPT_SETTINGS.capacityOptimization;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior capacity optimization consultant specializing in government relations law firms. You develop comprehensive capacity enhancement strategies that maximize revenue potential while maintaining service quality.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in capacity optimization analysis:', error);
      throw new Error('Failed to generate capacity optimization analysis. Please verify your scenario parameters and try again.');
    }
  }

  /**
   * Get growth modeling analysis using AI
   */
  async getGrowthModelingAnalysis(
    scenarioData: any,
    portfolioSummary: PortfolioSummary
  ): Promise<string> {
    try {
      const prompt = createGrowthScenarioPrompt(scenarioData, portfolioSummary);
      const settings = PROMPT_SETTINGS.growthModeling;
      
      return await this.getChatCompletions({
        messages: [
          {
            role: 'system',
            content: 'You are a senior growth strategy consultant specializing in government relations law firms. You develop comprehensive growth acceleration plans that deliver sustainable revenue expansion while strengthening market position.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        top_p: settings.top_p,
        frequency_penalty: settings.frequency_penalty
      });
    } catch (error) {
      console.error('Error in growth modeling analysis:', error);
      throw new Error('Failed to generate growth modeling analysis. Please review your growth parameters and try again.');
    }
  }

  /**
   * Check if the AI service is available
   */
  isAvailable(): boolean {
    return !!(this.client && this.apiKey);
  }

  /**
   * Get service status information
   */
  getStatus(): { available: boolean; hasApiKey: boolean; error?: string } {
    return {
      available: this.isAvailable(),
      hasApiKey: !!this.apiKey,
      error: !this.client ? 'Client not initialized' : undefined
    };
  }
}

// Export singleton instance
export const aiService = new AzureOpenAIService();
export default aiService;
