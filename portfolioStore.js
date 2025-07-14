import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data
      clients: [],
      originalClients: [], // Keep original data for comparison
      
      // Upload state
      isUploading: false,
      uploadError: null,
      
      // Analysis state
      isAnalyzing: false,
      analysisError: null,
      analytics: null,
      
      // Optimization state
      optimization: null,
      optimizationParams: {
        maxCapacity: 2000
      },
      
      // UI state
      selectedClient: null,
      showEnhancementModal: false,
      currentView: 'upload', // 'upload', 'dashboard', 'enhancement', 'scenarios'
      
      // Actions
      setClients: (clients) => set({ clients }),
      
      setOriginalClients: (clients) => set({ originalClients: clients }),
      
      updateClient: (updatedClient) => set((state) => ({
        clients: state.clients.map(client => 
          client.id === updatedClient.id ? { ...client, ...updatedClient } : client
        )
      })),
      
      setUploadState: (isUploading, error = null) => set({ 
        isUploading, 
        uploadError: error 
      }),
      
      setAnalysisState: (isAnalyzing, error = null) => set({ 
        isAnalyzing, 
        analysisError: error 
      }),
      
      setAnalytics: (analytics) => set({ analytics }),
      
      setOptimization: (optimization) => set({ optimization }),
      
      setOptimizationParams: (params) => set((state) => ({
        optimizationParams: { ...state.optimizationParams, ...params }
      })),
      
      setSelectedClient: (client) => set({ selectedClient: client }),
      
      setShowEnhancementModal: (show) => set({ showEnhancementModal: show }),
      
      setCurrentView: (view) => set({ currentView: view }),
      
      // Computed getters
      getClientById: (id) => {
        const state = get();
        return state.clients.find(client => client.id === id);
      },
      
      getClientsByStatus: (status) => {
        const state = get();
        return state.clients.filter(client => client.status === status);
      },
      
      getTotalRevenue: () => {
        const state = get();
        return state.clients.reduce((sum, client) => sum + (client.averageRevenue || 0), 0);
      },
      
      getTopClients: (limit = 10) => {
        const state = get();
        return [...state.clients]
          .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0))
          .slice(0, limit);
      },
      
      // Reset functions
      resetUpload: () => set({ 
        clients: [], 
        originalClients: [],
        uploadError: null,
        analytics: null,
        optimization: null,
        currentView: 'upload'
      }),
      
      resetAnalysis: () => set({ 
        analytics: null, 
        analysisError: null 
      }),
      
      resetOptimization: () => set({ 
        optimization: null 
      })
    }),
    {
      name: 'portfolio-storage',
      partialize: (state) => ({
        clients: state.clients,
        originalClients: state.originalClients,
        optimizationParams: state.optimizationParams,
        currentView: state.currentView
      })
    }
  )
);

export default usePortfolioStore;

