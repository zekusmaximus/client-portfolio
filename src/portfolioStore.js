import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from './api';
import { enhanceClientWithSuccessionMetrics, getSuccessionAnalytics } from './utils/successionUtils';
import { computeReportingYear, revenueForYear } from './utils/revenue';
import { toggleId, withChoice } from './utils/departure';
import { approvalBlocker, pinnedChoice, syncTransitions } from './utils/transitionPlans';

// The AI tab's answers (docs/plans/tier-1.md, WP3): the last Ask and the last
// brief. They start empty and go back to empty on logout.
const EMPTY_AI_RESULTS = { ask: null, brief: null };

// The Scenarios workflow (docs/plans/people-and-second-chair.md, Phase 5,
// P11): the open stage, the ids of the people leaving, and the partner's
// picks for each affected client's seats, { [clientId]: { leadId,
// secondChairId } }, which src/utils/departure.js applies over its defaults.
const emptySuccessionWorkflow = () => ({ currentStage: 'impact', departingIds: [], choices: {} });
// Stage 3: the approved plans' transitions, their tasks and the
// communications the partner logs. Counts are computed from these
// (executionSummary in src/utils/transitionPlans.js); nothing is estimated.
const emptyExecution = () => ({ activeTransitions: [], transitionTasks: [], communicationLog: [] });
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
      
      // Succession planning state (P11): in the store so a tab switch, which
      // unmounts the tab, keeps the scenario. Not persisted (partialize);
      // cleared on logout. currentStage is 'impact', 'mitigation' or
      // 'implementation'.
      successionWorkflow: emptySuccessionWorkflow(),
      transitionPlans: {}, // { clientId: transitionPlan }, Stage 2

      // Execution state, Stage 3
      ...emptyExecution(),
      
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

      // The associate split (docs/plans/people-and-second-chair.md, Phase 6,
      // P9): write one client's second chair. `expectedSecondChairId` is the
      // seat as the page showed it (null for none); the server answers 409 if
      // it has changed since. Then the book and the People counts reload.
      assignSecondChair: async (clientId, secondChairId, expectedSecondChairId = null) => {
        const response = await apiClient.put(`/data/clients/${clientId}/second-chair`, {
          second_chair_id: secondChairId,
          expected_second_chair_id: expectedSecondChairId
        });
        await get().fetchClients();
        await get().fetchPeople();
        return response.client;
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

      // The AI tab's answers: one slot per kind (ask, brief), each the route's whole answer
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
            aiError: null,
            successionWorkflow: emptySuccessionWorkflow(),
            transitionPlans: {},
            ...emptyExecution()
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

      // Succession planning workflow actions (docs/plans/people-and-second-chair.md, Phase 5)
      setSuccessionStage: (stage) => {
        set((state) => ({ successionWorkflow: { ...state.successionWorkflow, currentStage: stage } }));
      },

      // Mark someone as leaving, or not; the departure engine does the rest
      toggleDeparting: (personId) => {
        set((state) => ({
          successionWorkflow: {
            ...state.successionWorkflow,
            departingIds: toggleId(state.successionWorkflow.departingIds, personId)
          }
        }));
      },

      clearDeparting: () => {
        set((state) => ({ successionWorkflow: { ...state.successionWorkflow, departingIds: [] } }));
      },

      // The partner's pick for one client's seats: { leadId?, secondChairId? }
      // (a secondChairId of null leaves the seat empty); null forgets the pick
      setDepartureChoice: (clientId, choice) => {
        set((state) => ({
          successionWorkflow: {
            ...state.successionWorkflow,
            choices: withChoice(state.successionWorkflow.choices, clientId, choice)
          }
        }));
      },

      // Stage 2: one client's plan (the AI's answer, the timeline, the
      // status). `update` is the fields to merge, or a function of the plan.
      // The plan's seats are the scenario's choices, not fields here.
      updateTransitionPlan: (clientId, update) => {
        set((state) => {
          const id = String(clientId);
          const current = state.transitionPlans[id] || { clientId: id, status: 'pending' };
          const next = typeof update === 'function' ? update(current) : { ...current, ...update };
          return {
            transitionPlans: { ...state.transitionPlans, [id]: { ...next, updatedAt: new Date().toISOString() } }
          };
        });
      },

      // Approve plans: each client's seats are pinned as they stand, so a
      // later pick on another client cannot move them, and the plan is marked
      // approved. A client that cannot be approved (no lead, or a refused
      // pick) is left as it is.
      approveTransitionPlans: (decisions) => {
        set((state) => {
          let choices = state.successionWorkflow.choices;
          const plans = { ...state.transitionPlans };
          const now = new Date().toISOString();
          for (const decision of decisions) {
            if (approvalBlocker(decision)) continue;
            const id = String(decision.client.id);
            choices = withChoice(choices, id, pinnedChoice(decision));
            plans[id] = { ...(plans[id] || { clientId: id }), status: 'approved', updatedAt: now };
          }
          return { transitionPlans: plans, successionWorkflow: { ...state.successionWorkflow, choices } };
        });
      },

      // 'pending' or 'rejected' (needs revision) for each client
      setTransitionPlanStatus: (clientIds, status) => {
        set((state) => {
          const plans = { ...state.transitionPlans };
          const now = new Date().toISOString();
          for (const clientId of clientIds) {
            const id = String(clientId);
            plans[id] = { ...(plans[id] || { clientId: id }), status, updatedAt: now };
          }
          return { transitionPlans: plans };
        });
      },

      // Start the scenario over: nobody leaving, no picks, no plans
      resetSuccessionWorkflow: () => {
        set({
          successionWorkflow: emptySuccessionWorkflow(),
          transitionPlans: {},
          ...emptyExecution()
        });
      },

      // Stage 3: the transitions of the approved plans, keeping what was
      // already recorded for them (syncTransitions), and the stage opened
      startExecution: (decisions) => {
        set((state) => {
          const { transitions, tasks } = syncTransitions({
            decisions,
            plans: state.transitionPlans,
            transitions: state.activeTransitions,
            tasks: state.transitionTasks,
            today: new Date().toISOString().split('T')[0]
          });
          return {
            activeTransitions: transitions,
            transitionTasks: tasks,
            successionWorkflow: { ...state.successionWorkflow, currentStage: 'implementation' }
          };
        });
      },

      updateTransition: (clientId, updates) => {
        set((state) => ({
          activeTransitions: state.activeTransitions.map((t) =>
            String(t.clientId) === String(clientId) ? { ...t, ...updates } : t
          )
        }));
      },

      addTransitionTask: (task) => {
        set((state) => ({ transitionTasks: [...state.transitionTasks, task] }));
      },

      updateTransitionTask: (taskId, updates) => {
        set((state) => ({
          transitionTasks: state.transitionTasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task))
        }));
      },

      deleteTransitionTask: (taskId) => {
        set((state) => ({ transitionTasks: state.transitionTasks.filter((task) => task.id !== taskId) }));
      },

      addCommunication: (communication) => {
        set((state) => ({ communicationLog: [...state.communicationLog, communication] }));
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

