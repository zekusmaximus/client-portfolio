import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import jwt_decode from 'jwt-decode';
import { apiClient } from './api';
const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data
      clients: [],
      originalClients: [], // Keep original data for comparison
      clientsLoading: false,
      
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

      // Authentication state
      isAuthenticated: false,
      user: null,
      token: null,
      
      // UI state
      selectedClient: null,
      showEnhancementModal: false,
      currentView: 'dashboard', // 'dashboard', 'enhancement', 'ai', 'scenarios'
      
      // Actions
      setClients: (clients) => set({ clients }),

      // Fetch clients from backend
      fetchClients: async () => {
        const { isAuthenticated, clientsLoading, clients } = get();
        if (!isAuthenticated || clientsLoading || (clients && clients.length > 0)) return;
        set({ clientsLoading: true });
        try {
          const data = await apiClient.get('/api/clients');
          set({ clients: data, clientsLoading: false });
        } catch (err) {
          console.error('Failed to fetch clients', err);
          set({ clientsLoading: false });
        }
      },
      
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
      
      // Modal helpers for unified Client Card interface (Phase 3)
      // Passing `null` opens the modal in “create” mode.
      openClientModal: (client = null) => set({ selectedClient: client }),
      // Clears the selection to close the modal.
      closeClientModal: () => set({ selectedClient: null }),
      
      setShowEnhancementModal: (show) => set({ showEnhancementModal: show }),
      
      setCurrentView: (view) => set({ currentView: view }),

      // Authentication actions
      login: (token) => {
        try {
          const decoded = jwt_decode(token);
          localStorage.setItem('authToken', token);
          set({
            token,
            user: decoded,
            isAuthenticated: true
          });
        } catch (err) {
          console.error('Invalid JWT token', err);
        }
      },

      logout: () => {
        localStorage.removeItem('authToken');
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          clients: [],
          clientsLoading: false
        });
      },

      checkAuth: () => {
        const storedToken = localStorage.getItem('authToken');
        if (storedToken) {
          get().login(storedToken);
        } else {
          set({
            token: null,
            user: null,
            isAuthenticated: false
          });
        }
      },
      
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

