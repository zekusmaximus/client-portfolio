import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from './api';
import { enhanceClientWithSuccessionMetrics, getSuccessionAnalytics } from './utils/successionUtils';
import { computeReportingYear, revenueForYear } from './utils/revenue';

// AI Advisor answers start empty and go back to empty on logout.
const EMPTY_AI_RESULTS = { portfolioAnalysis: null, strategicAdvice: null, clientRecommendations: null };
const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data - fetched from server, not persisted locally
      clients: [],
      originalClients: [], // Keep original data for comparison
      reportingYear: null, // D4: latest year with any revenue row > 0; set with clients, null when logged out
      clientsLoading: false,
      fetchError: null,

      // The People list (docs/plans/people-and-second-chair.md): everyone who can
      // lead or second-chair a client, with their role and how many clients each
      // leads, seconds and originated. From GET /api/people; not persisted.
      people: [],
      peopleError: null,
      
      // Upload state
      isUploading: false,
      uploadError: null,
      
      // Analysis state
      isAnalyzing: false,
      analysisError: null,
      analytics: null,
      
      // AI Advisor answers (WP2): kept in the store rather than the component so
      // switching tabs (which unmounts the tab content) does not discard a paid
      // answer. Not persisted (see partialize); cleared on logout.
      aiResults: { ...EMPTY_AI_RESULTS },
      aiError: null,

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
      
      // Partners as the Scenarios workflow still reads them (fetchPartners).
      // The Partnership tab and the client list use the People list instead.
      partners: [],
      
      // Succession planning state
      transitionPlans: {}, // { clientId: transitionPlan }
      successionWorkflow: {
        currentStage: 'impact', // 'impact', 'triage', 'implementation'
        stage1Data: null,
        stage2Data: null,
        selectedDepartingPartners: []
      },
      
      // Execution state
      activeTransitions: [], // Array of active transition objects
      transitionTasks: [], // Array of task objects
      communicationLog: [], // Array of communication records
      executionMetrics: {
        totalTransitions: 0,
        completedTransitions: 0,
        inProgressTransitions: 0,
        atRiskTransitions: 0,
        delayedTransitions: 0,
        successRate: 0,
        retentionRate: 0,
        avgTransitionDays: 0
      },
      executionAlerts: [],
      
      // Actions
      setClients: (clients) => {
        const enhancedClients = clients.map(client => enhanceClientWithSuccessionMetrics(client));
        set({ clients: enhancedClients, reportingYear: computeReportingYear(enhancedClients) });
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
          set({
            clients: enhancedClients,
            reportingYear: computeReportingYear(enhancedClients),
            clientsLoading: false,
            fetchError: null
          });
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
            reportingYear: null,
            fetchError: 'Unable to connect to server. Please try again later or add clients manually.' 
          });
        }
      },
      
      // Fetch the People list; the client form's pickers and the People dialog read it
      fetchPeople: async () => {
        try {
          const response = await apiClient.get('/people');
          set({ people: response.people || [], peopleError: null });
        } catch (err) {
          console.error('Failed to fetch people', err);
          if (err.message.includes('401') || err.message.includes('403')) {
            get().logout();
            return;
          }
          set({ peopleError: 'Could not load the People list. Reload the page to try again.' });
        }
      },

      // Add someone to the People list; the server validates and may refuse
      addPerson: async ({ name, role }) => {
        const response = await apiClient.post('/people', { name, role });
        await get().fetchPeople();
        return response.person;
      },

      // Rename, change role, or (de)activate. A rename changes the names the
      // client views show, so the clients are re-fetched too.
      updatePerson: async (id, changes) => {
        const response = await apiClient.put(`/people/${id}`, changes);
        await get().fetchPeople();
        if (changes.name !== undefined) await get().fetchClients();
        return response.person;
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
        // The three legacy retention fields (relationship_strength,
        // relationship_intensity, renewal_probability) and the phantom
        // strategic_fit_score have been retired — succession now derives from
        // stickiness/effort, and the score from stickiness. No longer sent.
        // People go as ids (docs/plans/people-and-second-chair.md, P3, P4); the
        // server writes the legacy primary_lobbyist, lobbyist_team and
        // client_originator text from them.
        return {
          name: clientData.name || '',
          practice_area: clientData.practiceArea || [],
          conflict_risk: clientData.conflict_risk || 'Medium',
          notes: clientData.notes || '',
          lead_id: clientData.lead_id ?? null,
          second_chair_id: clientData.second_chair_id ?? null,
          originator_id: clientData.originator_id ?? null,
          originator_is_firm: clientData.originator_is_firm === true,
          interaction_frequency: clientData.interaction_frequency || '',
          stickiness: clientData.stickiness ?? null,
          high_maintenance: clientData.high_maintenance === true,
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

      // AI Advisor answers: one slot per action (portfolioAnalysis, strategicAdvice, clientRecommendations)
      setAiResult: (key, data) => set((state) => ({ aiResults: { ...state.aiResults, [key]: data } })),
      setAiError: (aiError) => set({ aiError }),

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
            reportingYear: null,
            clientsLoading: false,
            fetchError: null,
            people: [],
            peopleError: null,
            aiResults: { ...EMPTY_AI_RESULTS },
            aiError: null
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

      // Partners derived from the legacy text fields, for the Scenarios workflow
      // until Phase 5 rebuilds it on the People list
      // (docs/plans/people-and-second-chair.md, section 8). Nothing else reads it.
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
          practiceAreas: Array.from(partner.practiceAreas),
          teamMemberClients: partner.teamMemberClients
        }));
        
        set({ partners });
      },
      
      // Computed getters
      getClientById: (id) => {
        const state = get();
        return state.clients.find(client => client.id === id);
      },
      
      // Reporting year (D4): the latest year in which any client has a revenue
      // row with amount > 0; falls back to the current calendar year.
      getReportingYear: () => {
        const state = get();
        return state.reportingYear ?? computeReportingYear(state.clients);
      },

      // Revenue for one client in the reporting year, or in an explicit year.
      // Existing one-argument call sites keep working.
      getClientRevenue: (client, year = get().reportingYear) =>
        revenueForYear(client, year ?? get().getReportingYear()),

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
        reportingYear: null,
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
      },

      // Succession planning workflow actions
      setSuccessionStage: (stage, data) => {
        const current = get().successionWorkflow;
        set({
          successionWorkflow: {
            ...current,
            currentStage: stage,
            ...(stage === 'triage' && { stage1Data: data }),
            ...(stage === 'implementation' && { stage2Data: data })
          }
        });
      },

      setTransitionPlan: (clientId, plan) => {
        const currentPlans = get().transitionPlans;
        set({
          transitionPlans: {
            ...currentPlans,
            [clientId]: plan
          }
        });
      },

      setTransitionPlans: (plans) => {
        set({ transitionPlans: plans });
      },

      updateTransitionPlan: (clientId, updates) => {
        const currentPlans = get().transitionPlans;
        if (currentPlans[clientId]) {
          set({
            transitionPlans: {
              ...currentPlans,
              [clientId]: {
                ...currentPlans[clientId],
                ...updates,
                updatedAt: new Date().toISOString()
              }
            }
          });
        }
      },

      approveTransitionPlan: (clientId) => {
        get().updateTransitionPlan(clientId, { status: 'approved' });
      },

      rejectTransitionPlan: (clientId) => {
        get().updateTransitionPlan(clientId, { status: 'rejected' });
      },

      bulkUpdateTransitionPlans: (clientIds, updates) => {
        const currentPlans = get().transitionPlans;
        const updatedPlans = { ...currentPlans };
        
        clientIds.forEach(clientId => {
          if (updatedPlans[clientId]) {
            updatedPlans[clientId] = {
              ...updatedPlans[clientId],
              ...updates,
              updatedAt: new Date().toISOString()
            };
          } else {
            updatedPlans[clientId] = {
              clientId,
              ...updates,
              createdAt: new Date().toISOString()
            };
          }
        });

        set({ transitionPlans: updatedPlans });
      },

      getTransitionPlansByStatus: (status) => {
        const plans = get().transitionPlans;
        return Object.entries(plans)
          .filter(([_, plan]) => plan.status === status)
          .map(([clientId, plan]) => ({ clientId, ...plan }));
      },

      clearTransitionPlans: () => {
        set({ transitionPlans: {} });
      },

      resetSuccessionWorkflow: () => {
        set({
          successionWorkflow: {
            currentStage: 'impact',
            stage1Data: null,
            stage2Data: null,
            selectedDepartingPartners: []
          },
          transitionPlans: {}
        });
      },

      // Execution management actions
      setActiveTransitions: (transitions) => {
        set({ activeTransitions: transitions });
        get().updateExecutionMetrics();
      },

      addActiveTransition: (transition) => {
        const current = get().activeTransitions;
        set({ activeTransitions: [...current, transition] });
        get().updateExecutionMetrics();
      },

      updateTransition: (transitionId, updates) => {
        const current = get().activeTransitions;
        set({
          activeTransitions: current.map(t => 
            t.clientId === transitionId ? { ...t, ...updates } : t
          )
        });
        get().updateExecutionMetrics();
      },

      setTransitionTasks: (tasks) => {
        set({ transitionTasks: tasks });
      },

      addTransitionTask: (task) => {
        const current = get().transitionTasks;
        set({ transitionTasks: [...current, task] });
      },

      updateTransitionTask: (taskId, updates) => {
        const current = get().transitionTasks;
        set({
          transitionTasks: current.map(task => 
            task.id === taskId ? { ...task, ...updates } : task
          )
        });
      },

      deleteTransitionTask: (taskId) => {
        const current = get().transitionTasks;
        set({ transitionTasks: current.filter(task => task.id !== taskId) });
      },

      addCommunication: (communication) => {
        const current = get().communicationLog;
        set({ communicationLog: [...current, communication] });
      },

      getCommunicationsForClient: (clientId) => {
        const communications = get().communicationLog;
        return communications.filter(comm => comm.clientId === clientId);
      },

      addExecutionAlert: (alert) => {
        const current = get().executionAlerts;
        set({ executionAlerts: [...current, { ...alert, id: Date.now().toString() }] });
      },

      dismissExecutionAlert: (alertId) => {
        const current = get().executionAlerts;
        set({ executionAlerts: current.filter(alert => alert.id !== alertId) });
      },

      updateExecutionMetrics: () => {
        const { activeTransitions } = get();
        const totalTransitions = activeTransitions.length;
        const completedTransitions = activeTransitions.filter(t => t.status === 'completed').length;
        const inProgressTransitions = activeTransitions.filter(t => t.status === 'in-progress').length;
        const atRiskTransitions = activeTransitions.filter(t => t.status === 'at-risk').length;
        const delayedTransitions = activeTransitions.filter(t => t.status === 'delayed').length;

        const successRate = totalTransitions > 0 ? Math.round((completedTransitions / totalTransitions) * 100) : 0;
        
        // Calculate average transition days
        const completedWithDays = activeTransitions.filter(t => t.status === 'completed' && t.actualDays);
        const avgTransitionDays = completedWithDays.length > 0 
          ? Math.round(completedWithDays.reduce((sum, t) => sum + t.actualDays, 0) / completedWithDays.length)
          : 0;

        set({
          executionMetrics: {
            totalTransitions,
            completedTransitions,
            inProgressTransitions,
            atRiskTransitions,
            delayedTransitions,
            successRate,
            retentionRate: 95, // This could be calculated based on actual client retention
            avgTransitionDays
          }
        });
      },

      getTasksByStatus: (status) => {
        const tasks = get().transitionTasks;
        return tasks.filter(task => task.status === status);
      },

      getTasksForClient: (clientId) => {
        const tasks = get().transitionTasks;
        return tasks.filter(task => task.clientId === clientId);
      },

      getOverdueTasks: () => {
        const tasks = get().transitionTasks;
        const now = new Date();
        return tasks.filter(task => 
          task.status !== 'completed' && new Date(task.dueDate) < now
        );
      },

      initializeTransitionsFromPlans: (stage2Data) => {
        if (!stage2Data?.transitionPlans) return;

        const approvedPlans = Object.entries(stage2Data.transitionPlans)
          .filter(([_, plan]) => plan.status === 'approved');

        const transitions = approvedPlans.map(([clientId, plan]) => {
          const client = stage2Data.affectedClients?.find(c => c.id === clientId);
          return {
            clientId,
            clientName: client?.name || 'Unknown Client',
            successionRisk: client?.successionRisk || 5,
            successorPartner: plan.successorPartner || 'TBD',
            timelineDays: plan.timelineDays || 30,
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date(Date.now() + (plan.timelineDays || 30) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'in-progress',
            progress: 0,
            tasks: plan.tasks || []
          };
        });

        const tasks = transitions.flatMap(transition => 
          transition.tasks.map((taskTitle, index) => ({
            id: `${transition.clientId}-${index}`,
            title: taskTitle,
            description: `Task for ${transition.clientName}`,
            assignee: transition.successorPartner,
            dueDate: new Date(Date.now() + (index + 1) * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            priority: index === 0 ? 'high' : 'medium',
            status: 'pending',
            clientId: transition.clientId,
            category: 'communication'
          }))
        );

        set({ 
          activeTransitions: transitions,
          transitionTasks: tasks
        });
        
        get().updateExecutionMetrics();
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

