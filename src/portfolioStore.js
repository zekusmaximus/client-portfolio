import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, apiErrorMessage, apiErrorStatus } from './api';
import { withSuccessionMetrics, getSuccessionAnalytics } from './utils/successionUtils';
import { computeReportingYear, revenueForYear } from './utils/revenue';
import { toggleId, withChoice } from './utils/departure';
import { approvalBlocker, pinnedChoice, syncTransitions } from './utils/transitionPlans';
import { appendAnswers } from './utils/recentAnswers';
import { clientRequestBody } from './utils/clientForm';
import {
  emptyPlan,
  emptyStateOf,
  openState,
  planViews,
  scenarioSavable,
  stateFromStore,
  stateJson,
} from './utils/scenarioState';
import { newAssociate, withoutAssociatePicks, withPick } from './utils/hireScenario';

// The AI tab's answers (docs/plans/tier-1.md, WP3): the last Ask and the last
// brief. They start empty and go back to empty on logout. From Tier 2 WP10
// each is the last answer of its card's thread, with `turns`, the earlier
// turns the card shows above it (threadTurn, src/utils/recentAnswers.js):
// [] for a new question or brief, the thread so far for a follow-up.
const EMPTY_AI_RESULTS = { ask: null, brief: null };
// The AI tab's requests in flight (WP5), one per card like aiResults: each
// { kind, question, text, startedAt, firstTextAt, streamed, turns } while its
// answer is being written, then null. `text` is what has streamed so far,
// updated at most every AI_TEXT_RENDER_MS so the tab re-renders about ten
// times a second however fast the pieces come; `streamed` is false on the
// JSON path; `turns` are the thread's earlier turns, for a follow-up.
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
// opened from it, whole, by id. From Tier 2 WP10 an opened answer is fetched
// each time it opens (whether it can be followed up depends on today's book,
// and another partner may have hidden it), showing the copy already fetched
// meanwhile; and `hidden` says which list is shown: the answers (false) or,
// after "Show hidden", the hidden ones (true). Nothing deletes an answer.
const emptyAiAnswers = () => ({
  items: [],
  hasMore: false,
  loaded: false,
  loadingOlder: false,
  error: null,
  summary: null,
  details: {},
  openId: null,
  hidden: false,
});
const answersPath = (hidden, query = '') => {
  const params = [query, hidden ? 'hidden=1' : ''].filter(Boolean).join('&');
  return params ? `/ai/answers?${params}` : '/ai/answers';
};

// The Scenarios workflow (docs/plans/people-and-second-chair.md, Phase 5,
// P11): the open stage, the ids of the people leaving, and the partner's
// picks for each affected client's seats, { [clientId]: { leadId,
// secondChairId } }, which src/utils/departure.js applies over its defaults.
const emptySuccessionWorkflow = () => ({ currentStage: 'impact', departingIds: [], choices: {} });
// Stage 3: the approved plans' transitions, their tasks and the
// communications the partner logs. Counts are computed from these
// (executionSummary in src/utils/transitionPlans.js); nothing is estimated.
// heldTransitions are the Stage 3 records of a saved scenario that opening it
// could not show (their approved seats no longer apply on the book), kept so
// that saving it again loses nothing (Tier 2 WP8).
const emptyExecution = () => ({ activeTransitions: [], heldTransitions: [], transitionTasks: [], communicationLog: [] });
// An associate in Scenarios (docs/plans/tier-2.md, section 14, WP9): the
// hypothetical associates, the partner's picks and S19's toggle, which
// src/utils/hireScenario.js turns into proposals and loads. Only the
// Scenarios tab reads it: a hypothetical person never reaches the People
// list, the book or another tab.
const emptyHireScenario = () => ({ associates: [], picks: {}, relief: false });
// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): the saved scenario open
// in Scenarios (null for one not saved yet), its state as last opened or
// saved (as text, for "Unsaved changes"), and the notices opening it gave.
// The scenario itself is the store's successionWorkflow, transitionPlans and
// Stage 3 state, as before, or, when scenarioKind is 'hire' (WP9),
// hireScenario.
const closedScenario = (kind = 'departure') => ({
  savedScenario: null,
  savedStateJson: stateJson(emptyStateOf(kind)),
  scenarioNotices: []
});
const emptyScenarioList = () => ({ items: [], loaded: false, loading: false, error: null });
// A saved scenario's fields the page keeps while it is open
const scenarioMeta = (scenario) => ({
  id: scenario.id,
  name: scenario.name,
  version: scenario.version,
  updated_by_username: scenario.updated_by_username ?? null,
  updated_at: scenario.updated_at,
});
const usePortfolioStore = create(
  persist(
    (set, get) => ({
      // Client data - fetched from server, not persisted locally
      clients: [],
      reportingYear: null, // D4: latest year with any revenue row > 0; set with clients, null when logged out
      clientsLoading: false,
      fetchError: null,

      // The People list (docs/plans/people-and-second-chair.md): everyone who can
      // lead or second-chair a client, with their role and how many clients each
      // leads, seconds and originated. From GET /api/people; not persisted.
      people: [],
      peopleError: null,

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
      // { clientId: { answerId, ai, edits, status, updatedAt } }, Stage 2: the
      // AI's fields and the partner's edits kept apart (Tier 2 WP8,
      // src/utils/scenarioState.js); planViews gives what the stages read
      transitionPlans: {},

      // Execution state, Stage 3
      ...emptyExecution(),

      // Which kind of scenario is open (WP9): 'departure' (someone leaves,
      // the three stages above) or 'hire' (an associate is added, below)
      scenarioKind: 'departure',
      hireScenario: emptyHireScenario(),

      // Saved Scenarios (WP8): whether the API has them (null until asked,
      // then /api/health's saved-scenarios), whether it saves a hire scenario
      // (hire-scenarios, WP9), the saved list, and the open one. Not
      // persisted; cleared on logout.
      scenarioFeature: null,
      hireFeature: null,
      scenarioList: emptyScenarioList(),
      ...closedScenario(),
      
      // Actions
      // Each client's succession metrics are the API's since Tier 2 WP7
      // (docs/plans/tier-2.md, S11), kept as they came; only a client from an
      // older API, which sends none, gets them from the page's copy of the
      // same rules (withSuccessionMetrics), so the page works on either API
      setClients: (clients) => {
        const enhancedClients = clients.map(withSuccessionMetrics);
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
          const enhancedClients = clients.map(withSuccessionMetrics);
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
      // `kind` is the card the answer shows in ('ask' or 'brief'). With
      // `parentId` (Tier 2 WP10, only when /api/health lists ai-threads) it
      // is a follow-up to that saved answer, posted to /ai/ask whichever
      // card it is in, and `turns` are the thread's earlier turns, which the
      // card shows above it.
      askStream: async (kind, question = null, { stream = true, parentId = null, turns = [] } = {}) => {
        if (get().aiStreaming[kind]) return;
        const followUp = Number.isInteger(parentId);
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
            [kind]: { kind, question, text: '', startedAt: Date.now(), firstTextAt: null, streamed: stream, turns: followUp ? turns : [] },
          },
        }));

        const path = kind === 'ask' || followUp ? '/ai/ask' : '/ai/brief';
        const body = followUp ? { question, parentId } : kind === 'ask' ? { question } : {};
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
                  result = { success: true, id: answerId ?? null, kind: followUp ? 'ask' : kind, question, ...answered };
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
          finish((state) => ({ aiResults: { ...state.aiResults, [kind]: { ...result, turns: followUp ? turns : [] } } }));
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
        const { hidden } = get().aiAnswers;
        try {
          const [list, summary] = await Promise.all([
            apiClient.get(answersPath(hidden)),
            apiClient.get('/ai/answers/summary'),
          ]);
          if (!get().isAuthenticated) return; // signed out while it loaded
          if (get().aiAnswers.hidden !== hidden) return; // the other list was asked for since
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
          const { hidden } = get().aiAnswers;
          const older = await apiClient.get(answersPath(hidden, `before=${items[items.length - 1].id}`));
          if (!get().isAuthenticated || get().aiAnswers.hidden !== hidden) return;
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
      // fetching it whole each time it opens (WP10: whether it can be
      // followed up, and whether it is hidden, may have changed)
      toggleAiAnswer: async (id) => {
        const { openId } = get().aiAnswers;
        if (openId === id) {
          set((state) => ({ aiAnswers: { ...state.aiAnswers, openId: null } }));
          return;
        }
        set((state) => ({ aiAnswers: { ...state.aiAnswers, openId: id, error: null } }));
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

      // Hides a saved answer from every partner's list, or shows it again
      // (Tier 2 WP10, S15; only when /api/health lists ai-threads). Nothing
      // is deleted. The opened answer takes who hid it and when, and the
      // list and the month's line reload.
      setAiAnswerHidden: async (id, hidden) => {
        try {
          const { answer } = await apiClient.post(`/ai/answers/${id}/${hidden ? 'hide' : 'show'}`, {});
          if (!get().isAuthenticated) return;
          set((state) => ({
            aiAnswers: {
              ...state.aiAnswers,
              error: null,
              details: state.aiAnswers.details[id]
                ? { ...state.aiAnswers.details, [id]: { ...state.aiAnswers.details[id], ...answer } }
                : state.aiAnswers.details,
            },
          }));
          await get().fetchAiAnswers();
        } catch (err) {
          console.error('Failed to hide or show an answer', err);
          set((state) => ({ aiAnswers: { ...state.aiAnswers, error: apiErrorMessage(err, 'Could not change that answer.') } }));
        }
      },

      // "Show hidden" (true) and back to the answers (false): the list and
      // its pages reload for the one asked for (WP10)
      showHiddenAiAnswers: async (hidden) => {
        set((state) => ({ aiAnswers: { ...state.aiAnswers, hidden, items: [], hasMore: false, loaded: false, openId: null, error: null } }));
        await get().fetchAiAnswers();
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
            ...emptyExecution(),
            scenarioKind: 'departure',
            hireScenario: emptyHireScenario(),
            scenarioFeature: null,
            hireFeature: null,
            scenarioList: emptyScenarioList(),
            ...closedScenario()
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

      // Stage 2: one client's plan, { answerId, ai, edits, status, updatedAt }.
      // `update` is the fields to merge, or a function of the plan (withAiPlan,
      // withEdits and withoutEdit in src/utils/scenarioState.js). The plan's
      // seats are the scenario's choices, not fields here.
      updateTransitionPlan: (clientId, update) => {
        set((state) => {
          const id = String(clientId);
          const current = state.transitionPlans[id] || emptyPlan();
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
            plans[id] = { ...(plans[id] || emptyPlan()), status: 'approved', updatedAt: now };
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
            plans[id] = { ...(plans[id] || emptyPlan()), status, updatedAt: now };
          }
          return { transitionPlans: plans };
        });
      },

      // Start the scenario over: nobody leaving, no picks, no plans. A saved
      // scenario stays open (its next save stores the empty scenario)
      resetSuccessionWorkflow: () => {
        set({
          successionWorkflow: emptySuccessionWorkflow(),
          transitionPlans: {},
          ...emptyExecution(),
          scenarioNotices: []
        });
      },

      // Stage 3: the transitions of the approved plans, keeping what was
      // already recorded for them (syncTransitions), and the stage opened
      startExecution: (decisions) => {
        set((state) => {
          const { transitions, tasks } = syncTransitions({
            decisions,
            plans: planViews(state.transitionPlans),
            transitions: state.activeTransitions,
            tasks: state.transitionTasks,
            today: new Date().toISOString().split('T')[0]
          });
          // Stage 3 is set afresh from the plans approved now, so the records
          // an opened scenario could not show go, as syncTransitions drops a
          // client no longer approved
          return {
            activeTransitions: transitions,
            heldTransitions: [],
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
      },

      // An associate in Scenarios (WP9). Nothing here is written anywhere
      // but the scenario: accepting a pick after the hire goes through
      // assignSecondChair, one client at a time (P9).
      // A hypothetical associate: "New associate", no focus, the default target
      addHireAssociate: () => {
        set((state) => ({
          hireScenario: {
            ...state.hireScenario,
            associates: [
              ...state.hireScenario.associates,
              newAssociate(state.hireScenario.associates, { people: state.people, clients: state.clients })
            ]
          }
        }));
      },

      // { label?, focus?, target?, personId? } for one hypothetical associate
      updateHireAssociate: (id, changes) => {
        set((state) => ({
          hireScenario: {
            ...state.hireScenario,
            associates: state.hireScenario.associates.map((a) => (a.id === id ? { ...a, ...changes } : a))
          }
        }));
      },

      // Remove a hypothetical associate and every pick naming it
      removeHireAssociate: (id) => {
        set((state) => ({
          hireScenario: {
            ...state.hireScenario,
            associates: state.hireScenario.associates.filter((a) => a.id !== id),
            picks: withoutAssociatePicks(state.hireScenario.picks, id)
          }
        }));
      },

      // One client's pick: an associate's id (its seat, as the book shows it
      // now, goes to that associate), null (never propose the client), or
      // undefined (forget the pick; the proposals decide again)
      setHirePick: (client, associateId) => {
        set((state) => ({
          hireScenario: { ...state.hireScenario, picks: withPick(state.hireScenario.picks, client, associateId) }
        }));
      },

      // S19's toggle: the figures beside P10's, in this scenario only
      setHireRelief: (on) => {
        set((state) => ({ hireScenario: { ...state.hireScenario, relief: on === true } }));
      },

      // Saved Scenarios (docs/plans/tier-2.md, S12, WP8). Whether the API
      // saves scenarios: without saved-scenarios in /api/health (an API older
      // than WP8), Scenarios works in the browser only, as before
      checkScenarioFeature: async () => {
        const health = await apiClient.get('/api/health').catch(() => null);
        const features = Array.isArray(health?.features) ? health.features : [];
        const available = features.includes('saved-scenarios');
        set({ scenarioFeature: available, hireFeature: features.includes('hire-scenarios') });
        return available;
      },

      // The saved scenarios, newest save first, for the list
      fetchScenarios: async () => {
        set((state) => ({ scenarioList: { ...state.scenarioList, loading: true, error: null } }));
        try {
          const response = await apiClient.get('/scenarios');
          set({ scenarioList: { items: response.scenarios || [], loaded: true, loading: false, error: null } });
        } catch (err) {
          set((state) => ({ scenarioList: { ...state.scenarioList, loading: false, error: apiErrorMessage(err, 'Could not load the saved scenarios.') } }));
        }
      },

      // Open a saved scenario on the current book: the book and the People
      // list are loaded again first, so the scenario is re-derived from them
      // as they are now (openState); nothing opens if either fails to load.
      // Throws with a message the page shows.
      openScenario: async (id) => {
        const { scenario } = await apiClient.get(`/scenarios/${id}`);
        if (!['departure', 'hire'].includes(scenario?.state?.kind)) {
          throw new Error('This scenario is of a kind this page cannot show. Reload the page and try again.');
        }
        await get().fetchClients({ force: true });
        await get().fetchPeople();
        const { fetchError, peopleError, isAuthenticated } = get();
        // An expired session logs out while the book reloads: open nothing
        if (!isAuthenticated) throw new Error('Your session has ended. Sign in again to open the scenario.');
        if (fetchError || peopleError) {
          throw new Error('The book or the People list could not be loaded, so the scenario was not opened. Try again.');
        }
        const opened = openState(scenario.state, {
          people: get().people,
          clients: get().clients,
          reportingYear: get().getReportingYear(),
          today: new Date().toISOString().split('T')[0]
        });
        // The other kind's state is cleared: one scenario is open at a time
        const pieces = opened.scenarioKind === 'hire'
          ? {
            successionWorkflow: emptySuccessionWorkflow(),
            transitionPlans: {},
            ...emptyExecution(),
            hireScenario: opened.hireScenario
          }
          : {
            successionWorkflow: opened.successionWorkflow,
            transitionPlans: opened.transitionPlans,
            activeTransitions: opened.activeTransitions,
            heldTransitions: opened.heldTransitions,
            transitionTasks: opened.transitionTasks,
            communicationLog: opened.communicationLog,
            hireScenario: emptyHireScenario()
          };
        set({
          ...pieces,
          scenarioKind: opened.scenarioKind,
          savedScenario: scenarioMeta(scenario),
          savedStateJson: stateJson(scenario.state),
          scenarioNotices: opened.notices
        });
        return scenario;
      },

      // Save the open scenario: a new one (POST) when none is open or
      // `asNew`, under `name`; otherwise the open one (PUT, with the version it
      // was opened or last saved at), keeping its name unless `name` is given.
      // A stale save answers 409, a deleted scenario 404: both throw, and
      // nothing on the page changes.
      saveScenario: async ({ name, asNew = false } = {}) => {
        if (!scenarioSavable(get())) {
          throw new Error('This API cannot save this scenario yet; it works in this browser only. Try again after the API is updated.');
        }
        const state = stateFromStore(get());
        const open = get().savedScenario;
        const response = open && !asNew
          ? await apiClient.put(`/scenarios/${open.id}`, { name: name ?? open.name, state, version: open.version })
          : await apiClient.post('/scenarios', { name, state });
        set({ savedScenario: scenarioMeta(response.scenario), savedStateJson: stateJson(state) });
        if (get().scenarioList.loaded) get().fetchScenarios();
        return response.scenario;
      },

      // Delete a saved scenario (any partner, P2). Deleting the open one
      // leaves what is on screen as a scenario not saved yet
      deleteScenario: async (id) => {
        await apiClient.del(`/scenarios/${id}`);
        if (get().savedScenario?.id === id) set({ savedScenario: null, savedStateJson: stateJson(emptyStateOf(get().scenarioKind)) });
        await get().fetchScenarios();
      },

      // A new scenario of either kind ('departure' or 'hire', WP9): nothing
      // leaving, no picks, plans or associates, nothing saved yet
      newScenario: (kind = 'departure') => {
        const scenarioKind = kind === 'hire' ? 'hire' : 'departure';
        set({
          successionWorkflow: emptySuccessionWorkflow(),
          transitionPlans: {},
          ...emptyExecution(),
          scenarioKind,
          hireScenario: emptyHireScenario(),
          ...closedScenario(scenarioKind)
        });
      },

      dismissScenarioNotices: () => set({ scenarioNotices: [] })
    }),
    {
      name: 'portfolio-storage',
      partialize: (state) => ({
        // Persist only non-authoritative, UI-specific state; clients come
        // from the server. optimizationParams, which nothing read, went in
        // Tier 3 WP4: a copy left in a partner's localStorage is merged into
        // the state on load as a key nothing reads, and dropped at the next
        // write.
        currentView: state.currentView,
        isModalOpen: state.isModalOpen,
        selectedClient: state.selectedClient
      })
    }
  )
);

export default usePortfolioStore;

