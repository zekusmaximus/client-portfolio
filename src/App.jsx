import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Target, Brain, Upload, Users } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import DashboardView from './DashboardView';
import AIAdvisor from './AIAdvisor';
import ScenarioModeler from './ScenarioModeler';
import DataUploadManager from './DataUploadManager';
import ClientListView from './ClientListView';
import ClientEnhancementForm from './ClientEnhancementForm';
import LoginPage from './LoginPage';
import './App.css';

function App() {
  const {
    clients,
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

  // Set default view based on data availability
  useEffect(() => {
    if (isAuthenticated) {
      if (!hasData && currentView !== 'data-upload') {
        setCurrentView('data-upload');
      }
    }
  }, [isAuthenticated, hasData, currentView, setCurrentView]);

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
              <Button variant="outline" onClick={() => logout()}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b bg-muted/30">
        <div className="container mx-auto px-4">
          <Tabs value={currentView} onValueChange={setCurrentView} className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="data-upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Data Upload
              </TabsTrigger>
              <TabsTrigger value="dashboard" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="client-details" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Client Details
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                AI Advisor
              </TabsTrigger>
              <TabsTrigger value="scenarios" className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Scenarios
              </TabsTrigger>
            </TabsList>

            <TabsContent value="data-upload" className="mt-6">
              <DataUploadManager />
            </TabsContent>

            <TabsContent value="dashboard" className="mt-6">
              <DashboardView />
            </TabsContent>

            <TabsContent value="client-details" className="mt-6">
              <ClientListView />
            </TabsContent>

            <TabsContent value="ai" className="mt-6">
              <AIAdvisor />
            </TabsContent>

            <TabsContent value="scenarios" className="mt-6">
              <ScenarioModeler />
            </TabsContent>
          </Tabs>
        </div>
      </nav>

      {/* Client Enhancement Modal */}
      <ClientEnhancementForm />

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

