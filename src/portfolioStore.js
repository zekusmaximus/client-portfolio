import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from './api';
import { enhanceClientWithSuccessionMetrics, getSuccessionAnalytics } from './utils/successionUtils';
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
      
      // Partnership state
      partners: [],
      selectedPartner: null,
      partnershipTransition: { 
        departingPartners: [], 
        redistributionModel: 'balanced', 
        customAssignments: {} 
      },
      
      // Actions
      setClients: (clients) => {
        const enhancedClients = clients.map(client => enhanceClientWithSuccessionMetrics(client));
        set({ clients: enhancedClients });
      },

      // Fetch clients from backend
      fetchClients: async () => {
        const { clientsLoading } = get();
        if (clientsLoading) return;
        set({ clientsLoading: true, fetchError: null });
        try {
          const response = await apiClient.get('/data/clients');
          const clients = response.clients || [];
          const enhancedClients = clients.map(client => enhanceClientWithSuccessionMetrics(client));
          set({ clients: enhancedClients, clientsLoading: false, fetchError: null });
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

      // Partnership actions
      fetchPartners: () => {
        const state = get();
        const partnerMap = new Map();
        
        // First pass: collect primary clients
        state.clients.forEach(client => {
          const lobbyistName = client.primary_lobbyist || 'Unassigned';
          const revenue = state.getClientRevenue(client);
          const strategicValue = client.strategicValue || 0;
          const practiceArea = Array.isArray(client.practice_area) ? client.practice_area : [client.practice_area].filter(Boolean);
          
          if (!partnerMap.has(lobbyistName)) {
            partnerMap.set(lobbyistName, {
              id: `partner_${lobbyistName.toLowerCase().replace(/\s+/g, '_')}`,
              name: lobbyistName,
              isDeparting: false,
              clients: [],
              teamMemberClients: [],
              totalRevenue: 0,
              clientCount: 0,
              totalStrategicValue: 0,
              practiceAreas: new Set()
            });
          }
          
          const partner = partnerMap.get(lobbyistName);
          partner.clients.push(client.id);
          partner.totalRevenue += revenue;
          partner.clientCount += 1;
          partner.totalStrategicValue += strategicValue;
          practiceArea.forEach(area => partner.practiceAreas.add(area));
        });
        
        // Second pass: collect team member clients (where they're not primary)
        state.clients.forEach(client => {
          const lobbyistTeam = Array.isArray(client.lobbyist_team) ? client.lobbyist_team : [];
          const primaryLobbyist = client.primary_lobbyist || 'Unassigned';
          
          lobbyistTeam.forEach(teamMemberName => {
            // Skip if this is the same as primary lobbyist
            if (teamMemberName === primaryLobbyist) return;
            
            // Create partner entry if doesn't exist
            if (!partnerMap.has(teamMemberName)) {
              partnerMap.set(teamMemberName, {
                id: `partner_${teamMemberName.toLowerCase().replace(/\s+/g, '_')}`,
                name: teamMemberName,
                isDeparting: false,
                clients: [],
                teamMemberClients: [],
                totalRevenue: 0,
                clientCount: 0,
                totalStrategicValue: 0,
                practiceAreas: new Set()
              });
            }
            
            const partner = partnerMap.get(teamMemberName);
            partner.teamMemberClients.push(client.id);
          });
        });
        
        const partners = Array.from(partnerMap.values()).map(partner => ({
          ...partner,
          avgStrategicValue: partner.clientCount > 0 ? partner.totalStrategicValue / partner.clientCount : 0,
          capacityUsed: Math.min(100, (partner.clientCount / 15) * 100), // Assuming 15 clients = 100% capacity
          practiceAreas: Array.from(partner.practiceAreas),
          teamMemberClients: partner.teamMemberClients
        }));
        
        set({ partners });
      },
      
      setSelectedPartner: (partner) => set({ selectedPartner: partner }),
      
      updatePartnershipTransition: (updates) => set((state) => ({
        partnershipTransition: { ...state.partnershipTransition, ...updates }
      })),

      // Mark partner as departing
      markPartnerDeparting: (partnerId) => set((state) => ({
        partners: state.partners.map(partner =>
          partner.id === partnerId ? { ...partner, isDeparting: true } : partner
        ),
        partnershipTransition: {
          ...state.partnershipTransition,
          departingPartners: [...state.partnershipTransition.departingPartners, partnerId]
        }
      })),

      // Calculate redistribution preview
      calculateRedistribution: (model) => {
        const state = get();
        const departingPartners = state.partners.filter(p => p.isDeparting);
        const remainingPartners = state.partners.filter(p => !p.isDeparting);
        
        if (departingPartners.length === 0 || remainingPartners.length === 0) return [];

        const allDepartingClients = departingPartners.flatMap(p => p.clients);
        const departingClientsData = allDepartingClients.map(clientId => state.getClientById(clientId)).filter(Boolean);
        
        let redistribution = [];

        switch (model) {
          case 'balanced':
            const totalRevenue = departingClientsData.reduce((sum, client) => sum + state.getClientRevenue(client), 0);
            const revenuePerPartner = totalRevenue / remainingPartners.length;
            
            redistribution = remainingPartners.map(partner => ({
              partnerId: partner.id,
              partnerName: partner.name,
              assignedClients: [],
              targetRevenue: revenuePerPartner,
              currentCapacity: partner.capacityUsed
            }));
            
            // Assign clients to achieve balanced revenue
            let currentRevenues = redistribution.map(() => 0);
            departingClientsData.forEach(client => {
              const clientRevenue = state.getClientRevenue(client);
              const targetIndex = currentRevenues.reduce((minIndex, revenue, index) => 
                revenue < currentRevenues[minIndex] ? index : minIndex, 0);
              
              redistribution[targetIndex].assignedClients.push(client);
              currentRevenues[targetIndex] += clientRevenue;
            });
            break;

          case 'expertise':
            redistribution = remainingPartners.map(partner => ({
              partnerId: partner.id,
              partnerName: partner.name,
              assignedClients: [],
              targetRevenue: 0,
              currentCapacity: partner.capacityUsed
            }));
            
            departingClientsData.forEach(client => {
              const clientAreas = Array.isArray(client.practice_area) ? client.practice_area : [client.practice_area].filter(Boolean);
              
              // Find partner with matching expertise
              let bestMatch = redistribution[0];
              let maxMatch = 0;
              
              redistribution.forEach(partner => {
                const originalPartner = remainingPartners.find(p => p.id === partner.partnerId);
                const commonAreas = clientAreas.filter(area => originalPartner.practiceAreas.includes(area));
                if (commonAreas.length > maxMatch) {
                  maxMatch = commonAreas.length;
                  bestMatch = partner;
                }
              });
              
              bestMatch.assignedClients.push(client);
              bestMatch.targetRevenue += state.getClientRevenue(client);
            });
            break;

          case 'relationship':
            redistribution = remainingPartners.map(partner => ({
              partnerId: partner.id,
              partnerName: partner.name,
              assignedClients: [],
              targetRevenue: 0,
              currentCapacity: partner.capacityUsed
            }));
            
            departingClientsData.forEach(client => {
              const lobbyistTeam = Array.isArray(client.lobbyist_team) ? client.lobbyist_team : [];
              
              // Find partner in client's team
              let bestMatch = redistribution.find(partner => 
                lobbyistTeam.includes(partner.partnerName)
              );
              
              if (!bestMatch) {
                // Fallback to balanced distribution
                bestMatch = redistribution.reduce((min, partner) => 
                  partner.assignedClients.length < min.assignedClients.length ? partner : min
                );
              }
              
              bestMatch.assignedClients.push(client);
              bestMatch.targetRevenue += state.getClientRevenue(client);
            });
            break;

          case 'custom':
            const customAssignments = state.partnershipTransition.customAssignments;
            redistribution = remainingPartners.map(partner => ({
              partnerId: partner.id,
              partnerName: partner.name,
              assignedClients: [],
              targetRevenue: 0,
              currentCapacity: partner.capacityUsed
            }));
            
            departingClientsData.forEach(client => {
              const assignedPartnerId = customAssignments[client.id];
              if (assignedPartnerId) {
                const targetPartner = redistribution.find(p => p.partnerId === assignedPartnerId);
                if (targetPartner) {
                  targetPartner.assignedClients.push(client);
                  targetPartner.targetRevenue += state.getClientRevenue(client);
                }
              }
            });
            break;
        }

        return redistribution;
      },

      // Set custom client assignment
      setCustomAssignment: (clientId, partnerId) => set((state) => ({
        partnershipTransition: {
          ...state.partnershipTransition,
          customAssignments: {
            ...state.partnershipTransition.customAssignments,
            [clientId]: partnerId
          }
        }
      })),

      // Partnership health and analytics
      getPartnershipHealth: () => {
        const state = get();
        const partners = state.partners;
        
        if (!partners || partners.length === 0) return 100;
        
        try {
          // Calculate health based on multiple factors
          
          // 1. Revenue balance (40% weight)
          const revenues = partners.map(p => p?.totalRevenue || 0).filter(r => r > 0);
          const revenueScore = revenues.length > 1 ? (() => {
            const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
            const variance = revenues.length > 1 ? 
              Math.sqrt(revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length) : 0;
            const coefficientOfVariation = mean > 0 ? (variance / mean) * 100 : 0;
            return Math.max(0, 100 - coefficientOfVariation * 2);
          })() : 100;
          
          // 2. Capacity balance (30% weight)
          const capacities = partners.map(p => p?.capacityUsed || 0);
          const capacityScore = capacities.length > 1 ? (() => {
            const mean = capacities.reduce((a, b) => a + b, 0) / capacities.length;
            const variance = Math.sqrt(capacities.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / capacities.length);
            return Math.max(0, 100 - variance);
          })() : 100;
          
          // 3. No overloaded partners (30% weight)
          const overloadedCount = partners.filter(p => (p?.capacityUsed || 0) > 85).length;
          const overloadScore = 100 - (overloadedCount / partners.length * 100);
          
          const healthScore = Math.round(
            revenueScore * 0.4 + 
            capacityScore * 0.3 + 
            overloadScore * 0.3
          );
          
          return Math.max(0, Math.min(100, healthScore));
        } catch (error) {
          console.error('Error calculating partnership health:', error);
          return 50; // Return neutral score on error
        }
      },
      
      // Partnership transition state
      isPartnershipTransition: false,
      setPartnershipTransition: (value) => set({ isPartnershipTransition: value }),
      
      // Helper for variance calculation
      calculateVariance: (values) => {
        if (!Array.isArray(values) || values.length <= 1) return 0;
        try {
          const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
          if (validValues.length <= 1) return 0;
          
          const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
          const squaredDiffs = validValues.map(v => Math.pow(v - mean, 2));
          const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / validValues.length);
          
          return mean > 0 ? (variance / mean) * 100 : 0;
        } catch (error) {
          console.error('Error calculating variance:', error);
          return 0;
        }
      },

      // Get partnership analytics summary
      getPartnershipAnalytics: () => {
        const state = get();
        const partners = state.partners;
        
        if (!partners || partners.length === 0) {
          return {
            totalPartners: 0,
            departingPartners: 0,
            remainingPartners: 0,
            totalRevenue: 0,
            revenueAtRisk: 0,
            clientsAtRisk: 0,
            healthScore: 100
          };
        }
        
        try {
          const departing = partners.filter(p => p?.isDeparting);
          const remaining = partners.filter(p => !p?.isDeparting);
          
          const totalRevenue = partners.reduce((sum, p) => sum + (p?.totalRevenue || 0), 0);
          const revenueAtRisk = departing.reduce((sum, p) => sum + (p?.totalRevenue || 0), 0);
          
          const clientsAtRisk = departing.reduce((sum, p) => {
            if (!p?.clients || !Array.isArray(p.clients)) return sum;
            return sum + p.clients.filter(clientId => {
              const client = state.clients.find(c => c?.id === clientId);
              return client && (client.strategic_value || 0) > 7;
            }).length;
          }, 0);
          
          return {
            totalPartners: partners.length,
            departingPartners: departing.length,
            remainingPartners: remaining.length,
            totalRevenue,
            revenueAtRisk,
            clientsAtRisk,
            healthScore: state.getPartnershipHealth()
          };
        } catch (error) {
          console.error('Error calculating partnership analytics:', error);
          return {
            totalPartners: partners.length,
            departingPartners: 0,
            remainingPartners: partners.length,
            totalRevenue: 0,
            revenueAtRisk: 0,
            clientsAtRisk: 0,
            healthScore: 50
          };
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
      }),

      // Succession planning analytics
      getSuccessionAnalytics: () => {
        const state = get();
        return getSuccessionAnalytics(state.clients);
      }
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

