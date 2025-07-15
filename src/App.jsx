import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, BarChart3, Users, Target, Brain } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import DataUploadManager from './DataUploadManager';
import DashboardView from './DashboardView';
import ClientEnhancementForm from './ClientEnhancementForm';
import ClientListView from './ClientListView';
import AIAdvisor from './AIAdvisor';
import ScenarioModeler from './ScenarioModeler';
import LoginPage from './LoginPage';
import './App.css';

function App() {
  const {
    clients,
    currentView,
    setCurrentView,
    showEnhancementModal,
    setShowEnhancementModal,
    isAuthenticated,
    logout,
    checkAuth
  } = usePortfolioStore();

  const hasData = clients && clients.length > 0;

  // Re-hydrate auth state on initial mount
  useEffect(() => {
    checkAuth();
  }, []);

  const renderContent = () => {
    switch (currentView) {
      case 'upload':
        return <DataUploadManager />;
      case 'dashboard':
        return hasData ? <DashboardView /> : <DataUploadManager />;
      case 'enhancement':
        return hasData ? <ClientListView /> : <DataUploadManager />;
      case 'ai':
        return hasData ? <AIAdvisor /> : <DataUploadManager />;
      case 'scenarios':
        return hasData ? <ScenarioModeler /> : <DataUploadManager />;
      default:
        return <DataUploadManager />;
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
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Data Upload
                  {!hasData && <span className="ml-1 text-xs bg-green-500 text-white px-1 rounded">1</span>}
                </TabsTrigger>
                <TabsTrigger value="dashboard" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Dashboard
                  {hasData && <span className="ml-1 text-xs bg-blue-500 text-white px-1 rounded">2</span>}
                </TabsTrigger>
                <TabsTrigger value="enhancement" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Client Details
                  {hasData && <span className="ml-1 text-xs bg-orange-500 text-white px-1 rounded">3</span>}
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
        {!hasData && currentView !== 'upload' && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                No Data Available
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Please upload your client portfolio CSV file to begin analysis.
              </p>
              <Button onClick={() => setCurrentView('upload')}>
                Upload Data
              </Button>
            </CardContent>
          </Card>
        )}
        
        {renderContent()}
      </main>

      {/* Client Enhancement Modal */}
      {showEnhancementModal && (
        <ClientEnhancementForm 
          onClose={() => setShowEnhancementModal(false)}
        />
      )}

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

