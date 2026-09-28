import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, apiErrorMessage, apiErrorStatus } from './api';
import { enhanceClientWithSuccessionMetrics, getSuccessionAnalytics } from './utils/successionUtils';
import { computeReportingYear, revenueForYear } from './utils/revenue';
import { toggleId, withChoice } from './utils/departure';
import { approvalBlocker, pinnedChoice, syncTransitions } from './utils/transitionPlans';
import { appendAnswers } from './utils/recentAnswers';
import { clientRequestBody } from './utils/clientForm';

// The AI tab's answers (docs/plans/tier-1.md, WP3): the last Ask and the last
// brief. They start empty and go back to empty on logout.
const EMPTY_AI_RESULTS = { ask: null, brief: null };
// The AI tab's requests in flight (WP5), one per kind like aiResults: each
// { kind, question, text, startedAt, firstTextAt, streamed } while its answer
// is being written, then null. `text` is what has streamed so far, updated at
// most every AI_TEXT_RENDER_MS so the tab re-renders about ten times a second
// however fast the pieces come; `streamed` is false on the JSON path.
const EMPTY_AI_STREAMING = { ask: null, brief: null };
const AI_TEXT_RENDER_MS = 100;
const AI_DROPPED = 'The connection dropped. The answer is still being written and will appear under Recent answers.';
// The requests themselves, outside the state: each kind's AbortController and
// the text not yet shown. Only logout aborts one (T15: the server finishes
// and saves the answer whatever the page does).
const aiRequests = {};
const abortAiRequests = () => {
  for (const kind of Object.keys(aiRequests)) {
    clearTimeout(aiRequests[kind].timer);
    aiRequests[kind].controller.abort();
    delete aiRequests[kind];
  }
};
// The AI tab's saved answers (WP4): the recent list as the API pages it
// (newest first, for everyone), whether older ones remain, and the answers
// opened from it, whole, by id. Saved answers never change (none can be
// edited or deleted in Tier 1), so an opened one is fetched once.
const emptyAiAnswers = () => ({
  items: [],
  hasMore: false,
  loaded: false,
  loadingOlder: false,
  error: null,
  summary: null,
  details: {},
  openId: null,
});

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
      // The requests in flight (WP5): in the store, so a tab switch keeps an
      // answer streaming and its spinner; not persisted, cleared on logout
      aiStreaming: { ...EMPTY_AI_STREAMING },
      // Saved answers (WP4), from GET /api/ai/answers; not persisted, cleared
      // on logout. After a refresh the list comes back from the API, with the
      // answer just given at its top.
      aiAnswers: emptyAiAnswers(),

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

      // Fetch clients from backend. A load already in flight is not started
      // again, unless `force`: after a stale save (updateClient's 409) the
      // form needs the book as it is now, not as a load begun earlier read it.
      fetchClients: async ({ force = false } = {}) => {
        const { clientsLoading } = get();
        if (clientsLoading && force !== true) return;
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

      // Update existing client. clientData.expected_updated_at, when the form
      // gives it, is the client's updated_at_exact as the form loaded it
      // (docs/plans/tier-2.md, S10, WP6): the API answers 409 when another
      // save came first. Then the book is reloaded before the error goes back
      // to the form, which shows the client as it is now (mergeAfterConflict)
      // and keeps the modal open, as on any failure.
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
          if (apiErrorStatus(err) === 409) await get().fetchClients({ force: true });
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
      
      setSelectedClient: (client) => set({ selectedClient: client }),

      // Helper function to format client data for API: clientRequestBody
      // (src/utils/clientForm.js, pure, so tests can check the body against
      // the server's rules)
      formatClientForAPI: (clientData) => clientRequestBody(clientData),
      
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

      // Ask (question) or the brief (question null), owned by the store so a
      // tab switch, which unmounts the tab, neither loses the answer nor
      // stops it (WP5). stream: true reads the answer as it is written
      // (POST with Accept: text/event-stream, when /api/health lists
      // ai-stream); false posts for JSON as WP3 did. Either way the answer
      // lands in aiResults with the JSON answer's shape, `done`'s answerId
      // as its id, and the saved list reloads when the tab has loaded it. A
      // refusal replaces the partial text with the notice (the saved answer
      // is empty). A stream that ends without `done` or `error` after it
      // opened says the connection dropped: the server still finishes and
      // saves the answer (T15). Logout aborts the request; nothing else does.
      askStream: async (kind, question = null, { stream = true } = {}) => {
        if (get().aiStreaming[kind]) return;
        const request = { controller: new AbortController(), text: '', timer: null };
        aiRequests[kind] = request;
        const current = () => aiRequests[kind] === request;
        const update = (changes) => set((state) => (state.aiStreaming[kind]
          ? { aiStreaming: { ...state.aiStreaming, [kind]: { ...state.aiStreaming[kind], ...changes } } }
          : {}));
        const flush = () => {
          request.timer = null;
          if (current()) update({ text: request.text });
        };
        const finish = (changes) => {
          clearTimeout(request.timer);
          delete aiRequests[kind];
          set((state) => ({ ...changes(state), aiStreaming: { ...state.aiStreaming, [kind]: null } }));
        };
        set((state) => ({
          aiError: null,
          aiStreaming: {
            ...state.aiStreaming,
            [kind]: { kind, question, text: '', startedAt: Date.now(), firstTextAt: null, streamed: stream },
          },
        }));

        const path = kind === 'ask' ? '/ai/ask' : '/ai/brief';
        const body = kind === 'ask' ? { question } : {};
        try {
          let result = null;
          let failure = null;
          if (stream) {
            const outcome = await apiClient.postStream(path, body, {
              signal: request.controller.signal,
              onEvent: (type, data) => {
                if (!current()) return;
                if (type === 'text' && typeof data?.text === 'string') {
                  const first = request.text === '';
                  request.text += data.text;
                  // The first words at once, so "Thinking…" gives way to them
                  if (first) update({ text: request.text, firstTextAt: Date.now() });
                  else if (!request.timer) request.timer = setTimeout(flush, AI_TEXT_RENDER_MS);
                } else if (type === 'done' && data) {
                  const { answerId, ...answered } = data;
                  result = { success: true, id: answerId ?? null, kind, question, ...answered };
                } else if (type === 'error') {
                  failure = data?.error || 'The AI request failed.';
                }
              },
            });
            if (!outcome.streamed) result = outcome.json;
            else if (!result && !failure) failure = AI_DROPPED;
          } else {
            result = await apiClient.post(path, body);
          }
          if (!current()) return;
          if (!failure && !result?.success) failure = result?.error || 'The AI request failed.';
          if (failure) {
            finish(() => ({ aiError: failure }));
            return;
          }
          finish((state) => ({ aiResults: { ...state.aiResults, [kind]: result } }));
          // The answer just given heads the saved list, with this month's new
          // total, when the tab has loaded the list (an API with ai-answers)
          if (get().aiAnswers.loaded) get().fetchAiAnswers();
        } catch (err) {
          if (!current()) return; // aborted by logout
          console.error(`AI ${kind} error:`, err);
          finish(() => ({ aiError: err?.streamOpened ? AI_DROPPED : apiErrorMessage(err) }));
        }
      },

      // Saved answers (WP4). The AI tab calls these only after /api/health
      // lists ai-answers. fetchAiAnswers reloads the first page and this
      // month's count and cost; the list stays on screen while it does.
      fetchAiAnswers: async () => {
        try {
          const [list, summary] = await Promise.all([
            apiClient.get('/ai/answers'),
            apiClient.get('/ai/answers/summary'),
          ]);
          if (!get().isAuthenticated) return; // signed out while it loaded
          set((state) => ({
            aiAnswers: {
              ...state.aiAnswers,
              items: list.answers || [],
              hasMore: list.hasMore === true,
              loaded: true,
              error: null,
              summary,
            },
          }));
        } catch (err) {
          console.error('Failed to load the saved answers', err);
          set((state) => ({ aiAnswers: { ...state.aiAnswers, loaded: true, error: apiErrorMessage(err, 'Could not load the saved answers.') } }));
        }
      },

      // The next page after the last answer shown
      fetchOlderAiAnswers: async () => {
        const { items, loadingOlder } = get().aiAnswers;
        if (loadingOlder || items.length === 0) return;
        set((state) => ({ aiAnswers: { ...state.aiAnswers, loadingOlder: true } }));
        try {
          const older = await apiClient.get(`/ai/answers?before=${items[items.length - 1].id}`);
          if (!get().isAuthenticated) return;
          set((state) => ({
            aiAnswers: {
              ...state.aiAnswers,
              items: appendAnswers(state.aiAnswers.items, older.answers),
              hasMore: older.hasMore === true,
              loadingOlder: false,
              error: null,
            },
          }));
        } catch (err) {
          console.error('Failed to load older answers', err);
          set((state) => ({ aiAnswers: { ...state.aiAnswers, loadingOlder: false, error: apiErrorMessage(err, 'Could not load older answers.') } }));
        }
      },

      // Opens a saved answer in place (or closes it when it is the one open),
      // fetching it whole the first time
      toggleAiAnswer: async (id) => {
        const { openId, details } = get().aiAnswers;
        if (openId === id) {
          set((state) => ({ aiAnswers: { ...state.aiAnswers, openId: null } }));
          return;
        }
        set((state) => ({ aiAnswers: { ...state.aiAnswers, openId: id, error: null } }));
        if (details[id]) return;
        try {
          const { answer } = await apiClient.get(`/ai/answers/${id}`);
          if (!get().isAuthenticated) return;
          set((state) => ({ aiAnswers: { ...state.aiAnswers, details: { ...state.aiAnswers.details, [id]: answer } } }));
        } catch (err) {
          console.error('Failed to open a saved answer', err);
          set((state) => ({
            aiAnswers: {
              ...state.aiAnswers,
              openId: state.aiAnswers.openId === id ? null : state.aiAnswers.openId,
              error: apiErrorMessage(err, 'Could not open that answer.'),
            },
          }));
        }
      },

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
        abortAiRequests();
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
            aiStreaming: { ...EMPTY_AI_STREAMING },
            aiAnswers: emptyAiAnswers(),
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

