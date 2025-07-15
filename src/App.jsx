import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Target, Brain } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import DashboardView from './DashboardView';
import AIAdvisor from './AIAdvisor';
import ScenarioModeler from './ScenarioModeler';
import LoginPage from './LoginPage';
import './App.css';

function App() {
  const {
    clients,
    clientsLoading,
    fetchClients,
    currentView,
    setCurrentView,
    isAuthenticated,
    logout,
    checkAuth
  } = usePortfolioStore();

  const hasData = clients && clients.length > 0;

  // Re-hydrate auth state on initial mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Fetch clients after authentication
  useEffect(() => {
    if (isAuthenticated && clients.length === 0) {
      fetchClients();
    }
  }, [isAuthenticated]);

  const renderContent = () => {
    if (clientsLoading) {
      return <p className="text-center py-12">Loading clients…</p>;
    }
    switch (currentView) {
      case 'dashboard':
        return hasData ? <DashboardView /> : <p>No clients found.</p>;
      case 'ai':
        return hasData ? <AIAdvisor /> : <p>No clients found.</p>;
      case 'scenarios':
        return hasData ? <ScenarioModeler /> : <p>No clients found.</p>;
      default:
        return hasData ? <DashboardView /> : <p>No clients found.</p>;
    }
  };

  // Gate the UI behind authentication
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Client Portfolio Optimization Dashboard
              </h1>
              <p className="text-muted-foreground">
                Strategic analysis for government relations practice
              </p>
            </div>
            <div className="flex items-center gap-4">
              {hasData && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">
                    {clients.length} clients loaded
                  </p>
                  <p className="text-lg font-semibold">
                    ${usePortfolioStore.getState().getTotalRevenue().toLocaleString()}
                  </p>
                </div>
              )}
              <Button variant="outline" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      {hasData && (
        <nav className="border-b bg-muted/30">
          <div className="container mx-auto px-4">
            <Tabs value={currentView} onValueChange={setCurrentView} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="dashboard" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Dashboard
                  {hasData && <span className="ml-1 text-xs bg-blue-500 text-white px-1 rounded">2</span>}
                </TabsTrigger>
                <TabsTrigger value="ai" className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  AI Advisor
                  {hasData && <span className="ml-1 text-xs bg-purple-500 text-white px-1 rounded">4</span>}
                </TabsTrigger>
                <TabsTrigger value="scenarios" className="flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Scenarios
                  {hasData && <span className="ml-1 text-xs bg-indigo-500 text-white px-1 rounded">5</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {!hasData && !clientsLoading && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>No Client Data Available</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                No client records were found for your account.
              </p>
            </CardContent>
          </Card>
        )}
        
        {renderContent()}
      </main>

      {/* ClientCardModal handled in DashboardView */}

      {/* Footer */}
      <footer className="border-t bg-muted/30 mt-12">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              © 2025 Gaffney, Bennett & Associates - Portfolio Optimization Dashboard
            </p>
            <div className="flex items-center gap-4">
              <span>Built with React & AI</span>
              <Brain className="h-4 w-4" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

