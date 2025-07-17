import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import jwt_decode from 'jwt-decode';
import { apiClient } from './api';
const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data
      clients: [
        {
          id: 'client_1',
          name: 'Pfizer',
          status: 'IF',
          practiceArea: ['Healthcare', 'Corporate'],
          relationshipStrength: 8,
          conflictRisk: 'Low',
          renewalProbability: 0.9,
          strategicFitScore: 9,
          strategicValue: 85.5,
          revenues: [{ year: '2025', revenue_amount: '150000' }],
          notes: 'High-value pharmaceutical client with strong relationship'
        },
        {
          id: 'client_2',
          name: 'Hartford Healthcare',
          status: 'IF',
          practiceArea: ['Healthcare'],
          relationshipStrength: 7,
          conflictRisk: 'Medium',
          renewalProbability: 0.8,
          strategicFitScore: 7,
          strategicValue: 72.3,
          revenues: [{ year: '2025', revenue_amount: '65000' }],
          notes: 'Regional healthcare provider'
        },
        {
          id: 'client_3',
          name: 'Eversource',
          status: 'IF',
          practiceArea: ['Energy', 'Municipal'],
          relationshipStrength: 6,
          conflictRisk: 'Medium',
          renewalProbability: 0.75,
          strategicFitScore: 8,
          strategicValue: 68.9,
          revenues: [{ year: '2025', revenue_amount: '95000' }],
          notes: 'Major utility company'
        }
      ],
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
      token: null,
      
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
          const response = await apiClient.get('/api/data/clients');
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
          const response = await apiClient.post('/api/data/clients', formattedData);
          const newClient = response.client;
          set((state) => ({
            clients: [...state.clients, newClient],
            selectedClient: null,
            isModalOpen: false
          }));
          return newClient;
        } catch (err) {
          console.error('Failed to add client', err);
          throw err;
        }
      },

      // Update existing client
      updateClient: async (clientId, clientData) => {
        try {
          const formattedData = get().formatClientForAPI(clientData);
          const response = await apiClient.put(`/api/data/clients/${clientId}`, formattedData);
          const updatedClient = response.client;
          set((state) => ({
            clients: state.clients.map(client =>
              client.id === clientId ? updatedClient : client
            ),
            selectedClient: null,
            isModalOpen: false
          }));
          return updatedClient;
        } catch (err) {
          console.error('Failed to update client', err);
          throw err;
        }
      },

      // Delete existing client
      deleteClient: async (clientId) => {
        try {
          await apiClient.del(`/api/clients/${clientId}`);
          set((state) => ({
            clients: state.clients.filter(client => client.id !== clientId),
            selectedClient: null,
            isModalOpen: false
          }));
        } catch (err) {
          console.error('Failed to delete client', err);
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
          practiceArea: clientData.practiceArea || [],
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
          clientsLoading: false,
          fetchError: null
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
        clients: state.clients,
        originalClients: state.originalClients,
        optimizationParams: state.optimizationParams,
        currentView: state.currentView,
        isModalOpen: state.isModalOpen,
        selectedClient: state.selectedClient
      })
    }
  )
);

export default usePortfolioStore;

