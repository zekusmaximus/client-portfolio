import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from './api';
const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data - fetched from server, not persisted locally
      clients: [],
      originalClients: [], // Keep original data for comparison
      clientsLoading: false,
      fetchError: null,
      
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
      
      // UI state
      selectedClient: null,
      isModalOpen: false,
      currentView: 'data-upload', // 'data-upload', 'dashboard', 'client-details', 'ai', 'scenarios'
      
      // Actions
      setClients: (clients) => set({ clients }),

      // Fetch clients from backend
      fetchClients: async () => {
        const { clientsLoading } = get();
        if (clientsLoading) return;
        set({ clientsLoading: true, fetchError: null });
        try {
          const response = await apiClient.get('/data/clients');
          const clients = response.clients || [];
          set({ clients, clientsLoading: false, fetchError: null });
        } catch (err) {
          console.error('Failed to fetch clients', err);
          
          // If it's an authentication error, logout the user
          if (err.message.includes('401') || err.message.includes('403')) {
            get().logout();
            return;
          }
          
          // On API failure, clear clients to show fallback UI and set error
          set({ 
            clients: [], 
            clientsLoading: false, 
            fetchError: 'Unable to connect to server. Please try again later or add clients manually.' 
          });
        }
      },
      
      // Retry fetching clients (useful when connection is restored)
      retryFetchClients: async () => {
        set({ fetchError: null });
        await get().fetchClients();
      },
      
      setOriginalClients: (clients) => set({ originalClients: clients }),
      
      // Add new client
      addClient: async (clientData) => {
        try {
          const formattedData = get().formatClientForAPI(clientData);
          const response = await apiClient.post('/data/clients', formattedData);
          // On success, re-fetch the entire list to ensure perfect sync with the DB
          await get().fetchClients();
          set({
            selectedClient: null,
            isModalOpen: false
          });
          return response.client;
        } catch (err) {
          console.error('Failed to add client:', err);
          throw err;
        }
      },

      // Update existing client
      updateClient: async (clientId, clientData) => {
        try {
          const formattedData = get().formatClientForAPI(clientData);
          const response = await apiClient.put(`/data/clients/${clientId}`, formattedData);
          // On success, re-fetch the entire list to ensure perfect sync with the DB
          await get().fetchClients();
          set({
            selectedClient: null,
            isModalOpen: false
          });
          return response.client;
        } catch (err) {
          console.error('Failed to update client:', err);
          throw err;
        }
      },

      // Delete existing client
      deleteClient: async (clientId) => {
        try {
          await apiClient.del(`/data/clients/${clientId}`);
          // On success, re-fetch the entire list to ensure perfect sync with the DB
          await get().fetchClients();
          set({
            selectedClient: null,
            isModalOpen: false
          });
        } catch (err) {
          console.error('Failed to delete client:', err);
          throw err;
        }
      },
      
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

      // Helper function to format client data for API
      formatClientForAPI: (clientData) => {
        return {
          name: clientData.name || '',
          status: clientData.status || 'Prospect',
          practice_area: clientData.practiceArea || [],
          relationship_strength: clientData.relationship_strength || 5,
          conflict_risk: clientData.conflict_risk || 'Medium',
          renewal_probability: clientData.renewal_probability || 0.7,
          strategic_fit_score: clientData.strategic_fit_score || 5,
          notes: clientData.notes || '',
          primary_lobbyist: clientData.primary_lobbyist || '',
          client_originator: clientData.client_originator || '',
          lobbyist_team: clientData.lobbyist_team || [],
          interaction_frequency: clientData.interaction_frequency || '',
          relationship_intensity: clientData.relationship_intensity || 5,
          revenues: clientData.revenues || []
        };
      },
      
      // Modal helpers for unified Client interface
      // Passing `null` opens the modal in "create" mode.
      openClientModal: (client = null) => set({ 
        selectedClient: client, 
        isModalOpen: true 
      }),
      // Clears the selection to close the modal.
      closeClientModal: () => set({ 
        selectedClient: null, 
        isModalOpen: false 
      }),
      
      setCurrentView: (view) => set({ currentView: view }),

      // Authentication actions
      login: async (username, password) => {
        try {
          const response = await apiClient.post('/auth/login', { username, password });
          if (response.success && response.user) {
            set({
              user: response.user,
              isAuthenticated: true
            });
            return response;
          } else {
            throw new Error('Login failed');
          }
        } catch (err) {
          console.error('Login error:', err);
          throw err;
        }
      },

      logout: async () => {
        try {
          await apiClient.post('/auth/logout');
        } catch (err) {
          console.error('Logout error:', err);
          // Continue with logout even if server call fails
        } finally {
          set({
            user: null,
            isAuthenticated: false,
            clients: [],
            clientsLoading: false,
            fetchError: null
          });
        }
      },

      checkAuth: async () => {
        try {
          const response = await apiClient.get('/auth/me');
          if (response.user) {
            set({
              user: response.user,
              isAuthenticated: true
            });
          } else {
            set({
              user: null,
              isAuthenticated: false
            });
          }
        } catch (err) {
          // If authentication check fails, user is not authenticated
          set({
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
      
      // Helper function to get 2025 revenue from revenues array
      getClientRevenue: (client) => {
        if (client.revenues && Array.isArray(client.revenues) && client.revenues.length > 0) {
          // Find 2025 revenue specifically
          const revenue2025 = client.revenues.find(rev => String(rev.year) === '2025');
          return parseFloat(revenue2025?.revenue_amount) || 0;
        }
        return 0;
      },

      getTotalRevenue: () => {
        const state = get();
        return state.clients.reduce((sum, client) => {
          return sum + state.getClientRevenue(client);
        }, 0);
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
        // Persist only non-authoritative, UI-specific state
        // Removed clients and originalClients - these should come from server
        optimizationParams: state.optimizationParams,
        currentView: state.currentView,
        isModalOpen: state.isModalOpen,
        selectedClient: state.selectedClient
      })
    }
  )
);

export default usePortfolioStore;

