import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Brain, 
  MessageSquare, 
  BarChart3, 
  User, 
  Lightbulb,
  AlertCircle,
  Clock,
  Sparkles
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { apiClient } from './api';
import { getEnhancedClientCount } from './utils/clientUtils';

const AIAdvisor = () => {
  const { clients, fetchClients, clientsLoading } = usePortfolioStore();
  const [activeTab, setActiveTab] = useState('portfolio');
  const [isLoading, setIsLoading] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [results, setResults] = useState({
    portfolioAnalysis: null,
    strategicAdvice: null,
    clientRecommendations: null
  });
  const [error, setError] = useState(null);

  const hasData = clients && clients.length > 0;

  const handlePortfolioAnalysis = async () => {
    if (!hasData) return;
    try {
      setIsLoading(true);
      setError(null);

      // Extract only necessary client IDs for analysis, filtering out clients without valid IDs
      const clientIds = clients.filter(c => c.id && String(c.id).trim() !== '').map(c => String(c.id).trim());
      
      if (clientIds.length === 0) {
        throw new Error('No valid client IDs found. Please ensure clients are properly loaded.');
      }
      
      const data = await apiClient.post('/claude/analyze-portfolio', { clientIds });

      if (data.success) {
        setResults(prev => ({ ...prev, portfolioAnalysis: data }));
      } else {
        throw new Error(data.error || 'Analysis failed');
      }

    } catch (err) {
      console.error('Portfolio analysis error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStrategicAdvice = async () => {
    if (!hasData) return;

    setIsLoading(true);
    setError(null);

    try {
      // Extract only necessary client IDs for advice
      const clientIds = clients.map(c => c.id);
      const data = await apiClient.post('/claude/strategic-advice', {
        clientIds,
        query: customQuery || undefined,
        context: 'Government relations law firm portfolio optimization',
      });

      if (data.success) {
        setResults(prev => ({ ...prev, strategicAdvice: data }));
        setCustomQuery(''); // Clear the query after successful request
      } else {
        throw new Error(data.error || 'Advice generation failed');
      }

    } catch (err) {
      console.error('Strategic advice error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClientRecommendations = async (client) => {
    if (!client) {
      setError('No client selected.');
      return;
    }

    // Validate client has a proper ID
    if (!client.id || (typeof client.id !== 'string' && typeof client.id !== 'number') || String(client.id).trim() === '') {
      setError('Client is missing a valid ID. Please refresh the client list and try again.');
      return;
    }

    // Validate client has a name
    if (!client.name || typeof client.name !== 'string' || client.name.trim() === '') {
      setError('Client data is incomplete. Please refresh the client list and try again.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSelectedClient(client);

    try {
      // Only send the client ID and basic context, not the entire clients array
      const payload = {
        clientId: String(client.id).trim(),
        clientName: client.name.trim(),
        clientRevenue: usePortfolioStore.getState().getClientRevenue(client),
        portfolioSize: clients.length,
      };
      
      const data = await apiClient.post('/claude/client-recommendations', payload);

      if (data.success) {
        setResults(prev => ({ ...prev, clientRecommendations: data }));
      } else {
        throw new Error(data.error || 'Recommendations generation failed');
      }

    } catch (err) {
      console.error('Client recommendations error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formatAIResponse = (text) => {
    // Simple formatting to make AI responses more readable
    return text
      .split('\n')
      .map((line, index) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return <h3 key={index} className="font-semibold text-lg mt-4 mb-2">{line.replace(/\*\*/g, '')}</h3>;
        } else if (line.startsWith('*') || line.startsWith('-')) {
          return <li key={index} className="ml-4 mb-1">{line.substring(1).trim()}</li>;
        } else if (line.trim() === '') {
          return <br key={index} />;
        } else {
          return <p key={index} className="mb-2">{line}</p>;
        }
      });
  };

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Strategic Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="text-center">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">Ready to provide AI-powered insights</p>
            <p className="text-muted-foreground mb-4">
              Once you have clients in your portfolio, I can analyze your data and provide strategic recommendations for portfolio optimization, client prioritization, and growth opportunities.
            </p>
            <Button 
              onClick={() => usePortfolioStore.getState().setCurrentView('client-details')}
              variant="outline"
            >
              Add Clients to Get Started
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Strategic Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Get AI-powered strategic recommendations and insights for your client portfolio using advanced analysis.
          </p>
          
          {/* Portfolio Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
            <div className="text-center">
              <p className="text-2xl font-bold">{clients.length}</p>
              <p className="text-sm text-muted-foreground">Total Clients</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                ${usePortfolioStore.getState().getTotalRevenue().toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {getEnhancedClientCount(clients)}
              </p>
              <p className="text-sm text-muted-foreground">Enhanced Clients</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="portfolio">Portfolio Analysis</TabsTrigger>
          <TabsTrigger value="strategic">Strategic Advice</TabsTrigger>
          <TabsTrigger value="client">Client Insights</TabsTrigger>
        </TabsList>

        {/* Portfolio Analysis Tab */}
        <TabsContent value="portfolio" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Comprehensive Portfolio Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Get a detailed SWOT analysis and strategic assessment of your entire client portfolio.
              </p>
              
              <Button
                onClick={handlePortfolioAnalysis}
                disabled={isLoading}
                className="mb-4"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analyze Portfolio
                  </>
                )}
              </Button>

              {isLoading && activeTab === 'portfolio' && (
                <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    <span>Generating portfolio analysis...</span>
                  </div>
                </div>
              )}

              {results.portfolioAnalysis && (
                <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    <span className="font-semibold">AI Analysis Results</span>
                    <Badge variant="outline" className="text-xs">
                      {new Date(results.portfolioAnalysis.timestamp).toLocaleString()}
                    </Badge>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    {formatAIResponse(results.portfolioAnalysis.analysis)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Strategic Advice Tab */}
        <TabsContent value="strategic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Strategic Consultation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Ask specific questions or get general strategic recommendations for your practice.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Ask a specific question (optional):
                  </label>
                  <Textarea
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    placeholder="e.g., How can I improve client retention? What are the best growth opportunities? How should I handle succession planning?"
                    rows={3}
                  />
                </div>
                
                <Button
                  onClick={handleStrategicAdvice}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Generating Advice...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-2" />
                      Get Strategic Advice
                    </>
                  )}
                </Button>

                {isLoading && activeTab === 'strategic' && (
                  <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      <span>Generating strategic advice...</span>
                    </div>
                  </div>
                )}
              </div>

              {results.strategicAdvice && (
                <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    <span className="font-semibold">Strategic Recommendations</span>
                    <Badge variant="outline" className="text-xs">
                      {new Date(results.strategicAdvice.timestamp).toLocaleString()}
                    </Badge>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    {formatAIResponse(results.strategicAdvice.advice)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Client Insights Tab */}
        <TabsContent value="client" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Client-Specific Recommendations
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchClients}
                  disabled={clientsLoading}
                >
                  {clientsLoading ? 'Refreshing...' : 'Refresh Clients'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Get tailored recommendations for individual clients based on their profile and your portfolio context.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {clients.filter(client => client.id && client.name && String(client.id).trim() !== '').map((client) => (
                  <div 
                    key={client.id} 
                    className="p-3 border rounded-lg hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => handleClientRecommendations(client)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">{client.name}</h4>
                      <Badge variant={client.status === 'IF' ? 'default' : 'secondary'}>
                        {client.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>2025 Revenue: ${usePortfolioStore.getState().getClientRevenue(client).toLocaleString()}</p>
                      <p>Strategic Value: {(client.strategicValue || 0).toFixed(1)}</p>
                      {client.practiceArea && client.practiceArea.length > 0 && (
                        <p>Practice Areas: {client.practiceArea.join(', ')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {clients.filter(client => client.id && client.name && String(client.id).trim() !== '').length === 0 && (
                <div className="mt-4 p-4 bg-muted/30 rounded-lg text-center">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    No clients available for AI recommendations. Please ensure clients are properly loaded from the database.
                  </p>
                </div>
              )}

              {isLoading && selectedClient && (
                <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    <span>Generating recommendations for {selectedClient.name}...</span>
                  </div>
                </div>
              )}

              {results.clientRecommendations && (
                <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    <span className="font-semibold">
                      Recommendations for {results.clientRecommendations.client}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {new Date(results.clientRecommendations.timestamp).toLocaleString()}
                    </Badge>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    {formatAIResponse(results.clientRecommendations.recommendations)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIAdvisor;

