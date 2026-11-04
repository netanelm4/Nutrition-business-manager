// All API calls live here — no fetch() in components.
// Session token is stored in localStorage under key 'auth_token'.

const BASE = '/api';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();

  // If 401, clear token and reload to trigger login screen
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return; // unreachable but makes intent clear
  }

  if (!json.success) {
    const err = new Error(json.error || 'Request failed');
    err.status = res.status;
    throw err;
  }

  return json.data;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export const fetchDashboard = () => request('GET', '/dashboard');

// ── Clients ──────────────────────────────────────────────────────────────────
export const fetchClients = () => request('GET', '/clients');
export const fetchClient      = (id)       => request('GET',    `/clients/${id}`);
export const createClient     = (data)     => request('POST',   '/clients', data);
export const updateClient     = (id, data) => request('PUT',    `/clients/${id}`, data);
export const deleteClient     = (id)       => request('DELETE', `/clients/${id}`);
export const stopClient       = (id, body) => request('POST',   `/clients/${id}/stop`, body);
export const freezeClient     = (id, body) => request('POST',   `/clients/${id}/freeze`, body);
export const reactivateClient = (id)       => request('POST',   `/clients/${id}/reactivate`);

// ── Session Windows ───────────────────────────────────────────────────────────
export const fetchWindows = (clientId) => request('GET', `/clients/${clientId}/windows`);
export const updateWindow = (windowId, data) => request('PUT', `/session-windows/${windowId}`, data);

// ── Sessions ──────────────────────────────────────────────────────────────────
export const fetchSessions = (clientId) => request('GET', `/clients/${clientId}/sessions`);
export const fetchSession = (id) => request('GET', `/sessions/${id}`);
export const createSession = (clientId, data) => request('POST', `/clients/${clientId}/sessions`, data);
export const updateSession = (id, data) => request('PUT', `/sessions/${id}`, data);
export const deleteSession = (sessionId) => request('DELETE', `/sessions/${sessionId}`);
export const generateInsights  = (sessionId) => request('POST', `/sessions/${sessionId}/insights`);
export const completeSession   = (sessionId) => request('PUT',  `/sessions/${sessionId}/complete`);
export const updateSessionStatus = (sessionId, status) => request('PUT', `/sessions/${sessionId}/status`, { status });

// ── Leads ─────────────────────────────────────────────────────────────────────
export const fetchLeads = () => request('GET', '/leads');
export const fetchLead = (id) => request('GET', `/leads/${id}`);
export const createLead = (data) => request('POST', '/leads', data);
export const updateLead = (id, data) => request('PUT', `/leads/${id}`, data);
export const deleteLead = (id) => request('DELETE', `/leads/${id}`);
export const convertLead = (id) => request('POST', `/leads/${id}/convert`);

export const fetchClientByLeadId = (leadId) =>
  request('GET', `/clients?converted_from_lead_id=${leadId}`);

// ── Templates ─────────────────────────────────────────────────────────────────
export const fetchTemplates = () => request('GET', '/templates');
export const updateTemplate = (id, data) => request('PUT', `/templates/${id}`, data);
export const renderTemplate = (templateId, clientId, extra = {}) =>
  request('POST', '/templates/render', { templateId, clientId, ...extra });

// ── Templates (additional) ────────────────────────────────────────────────────
export const createTemplate = (data) => request('POST', '/templates', data);
export const deleteTemplate = (id) => request('DELETE', `/templates/${id}`);

// ── WhatsApp log ─────────────────────────────────────────────────────────────
export const logWhatsApp = (data) => request('POST', '/whatsapp/log', data);
export const fetchWhatsAppLog = (clientId) => request('GET', `/clients/${clientId}/whatsapp-log`);

// ── Protocols ─────────────────────────────────────────────────────────────────
export const fetchProtocols = () => request('GET', '/protocols');
export const fetchProtocol = (id) => request('GET', `/protocols/${id}`);
export const createProtocol = (data) => request('POST', '/protocols', data);
export const updateProtocol = (id, data) => request('PUT', `/protocols/${id}`, data);
export const deleteProtocol = (id) => request('DELETE', `/protocols/${id}`);
export const personalizeProtocol = (id, clientId) =>
  request('POST', `/protocols/${id}/personalize`, { clientId });
export const addProtocolTasks = (clientId, tasks, sessionNumber) =>
  request('POST', `/clients/${clientId}/protocol-tasks`, {
    tasks,
    ...(sessionNumber != null ? { session_number: sessionNumber } : {}),
  });

// ── Payments ──────────────────────────────────────────────────────────────────
export const fetchPayments = (clientId) => request('GET', `/clients/${clientId}/payments`);
export const createPayment = (clientId, data) => request('POST', `/clients/${clientId}/payments`, data);
export const deletePayment = (paymentId) => request('DELETE', `/payments/${paymentId}`);

// ── Google Calendar ───────────────────────────────────────────────────────────
export const fetchGoogleAuthUrl    = () => request('GET',    '/google/auth-url').then((d) => d.url);
export const fetchGoogleStatus     = () => request('GET',    '/google/status');
export const disconnectGoogle      = () => request('DELETE', '/google/disconnect');
export const syncGoogleCalendar    = () => request('POST',   '/google/sync');
export const pollGoogleCalendar    = () => request('POST',   '/google/poll-now');

// ── Meetings (Google Calendar) ────────────────────────────────────────────────
export const fetchBookingLinks      = () => request('GET',  '/meetings/config');
export const fetchUpcomingMeetings  = () => request('GET',  '/meetings/upcoming');
export const checkMeetingReminders  = () => request('POST', '/meetings/check-reminders');

// ── Lead meetings ─────────────────────────────────────────────────────────────
export const scheduleMeeting  = (leadId, data) => request('POST', `/leads/${leadId}/meeting`, data);
export const fetchLeadMeeting = (leadId)       => request('GET',  `/leads/${leadId}/meeting`);

// ── Meeting actions ───────────────────────────────────────────────────────────
export const updateMeeting       = (meetingId, data) => request('PUT', `/meetings/events/${meetingId}`, data);
export const cancelMeeting       = (meetingId)       => request('PUT', `/meetings/events/${meetingId}/cancel`);
export const fetchClientMeetings = (clientId)        => request('GET', `/meetings/clients/${clientId}/events`);
export const completeMeeting     = (meetingId)       => request('PUT', `/meetings/events/${meetingId}/complete`);

// ── Session intakes ───────────────────────────────────────────────────────────
export const fetchIntake   = (sessionId)       => request('GET',  `/sessions/${sessionId}/intake`);
export const createIntake  = (sessionId, data) => request('POST', `/sessions/${sessionId}/intake`, data);
export const updateIntake  = (sessionId, data) => request('PUT',  `/sessions/${sessionId}/intake`, data);

// ── Lead intakes ──────────────────────────────────────────────────────────────
export const fetchLeadIntake  = (leadId)       => request('GET',  `/leads/${leadId}/intake`);
export const createLeadIntake = (leadId, data) => request('POST', `/leads/${leadId}/intake`, data);
export const updateLeadIntake = (leadId, data) => request('PUT',  `/leads/${leadId}/intake`, data);

export function uploadLeadLabPdf(leadId, file) {
  const formData = new FormData();
  formData.append('pdf', file);
  return fetch(`/api/leads/${leadId}/intake/lab-pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  }).then((r) => r.json()).then((json) => {
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return json.data;
  });
}

export function uploadLabPdf(sessionId, file) {
  const formData = new FormData();
  formData.append('pdf', file);
  return fetch(`/api/sessions/${sessionId}/intake/lab-pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  }).then((r) => r.json()).then((json) => {
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return json.data;
  });
}

// ── AI Summary ────────────────────────────────────────────────────────────────
export const generateClientAISummary = (clientId) => request('POST', `/clients/${clientId}/ai-summary`);
export const fetchClientAISummary    = (clientId) => request('GET',  `/clients/${clientId}/ai-summary`);

// ── Check-in message ──────────────────────────────────────────────────────────
export const generateCheckinMessage = (sessionId) => request('POST', `/sessions/${sessionId}/checkin-message`);
export const fetchCheckinMessage    = (sessionId) => request('GET',  `/sessions/${sessionId}/checkin-message`);

// ── Process summary ───────────────────────────────────────────────────────────
export const generateProcessSummary = (clientId) => request('POST', `/clients/${clientId}/process-summary`);
export const fetchProcessSummary    = (clientId) => request('GET',  `/clients/${clientId}/process-summary`);

// ── Daily Tasks ───────────────────────────────────────────────────────────────

// ── Engagements ───────────────────────────────────────────────────────────────
export const fetchEngagements  = (clientId)        => request('GET',  `/engagements/client/${clientId}`);
export const createEngagement  = (clientId, data)  => request('POST', `/engagements/client/${clientId}`, data);
export const closeEngagement   = (id)              => request('POST', `/engagements/${id}/close`);

// ── Admin ─────────────────────────────────────────────────────────────────────
export const repairAIAssessments = () => request('POST', '/admin/repair-ai-assessments');

// ── AI agent ──────────────────────────────────────────────────────────────────
export const fetchAgentConversations = ()   => request('GET',    '/agent/conversations');
export const fetchAgentConversation  = (id) => request('GET',    `/agent/conversations/${id}`);
export const deleteAgentConversation = (id) => request('DELETE', `/agent/conversations/${id}`);

/**
 * One agent turn, streamed. onEvent(type, data) receives: conversation, text,
 * tool_start, tool_result, error, done. Resolves when the stream ends.
 */
export async function streamAgentChat({ message, conversationId, onEvent, signal }) {
  const res = await fetch(`${BASE}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ message, ...(conversationId ? { conversation_id: conversationId } : {}) }),
    signal,
  });
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  await readEventStream(res, onEvent);
}

// ── Food Bank ─────────────────────────────────────────────────────────────────
export const fetchFoodCategories = ()             => request('GET',    '/food-bank/categories');
export const fetchFoodItems      = (categoryId)   => request('GET',    `/food-bank/items/${categoryId}`);
export const fetchFoodMacro      = (nutrientType) => request('GET',    `/food-bank/macro/${nutrientType}`);
export const createFoodItem      = (data)         => request('POST',   '/food-bank/items', data);
export const updateFoodItem      = (id, data)     => request('PUT',    `/food-bank/items/${id}`, data);
export const deleteFoodItem      = (id)           => request('DELETE', `/food-bank/items/${id}`);
export const fetchPendingFoodItems = ()           => request('GET',    '/food-bank/pending');
export const approveFoodItem       = (id)         => request('PUT',    `/food-bank/items/${id}/approve`);

// ── Menus ─────────────────────────────────────────────────────────────────────

// Menus routes return { ok: true, ...data } (not { success, data }) — needs its own helper.
async function reqMenus(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
    return;
  }
  if (!json.ok) {
    const err = new Error(json.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return json;
}

export const fetchClientMenus  = (clientId)                        => reqMenus('GET',    `/menus?client_id=${clientId}`);
export const fetchMenu         = (menuId)                          => reqMenus('GET',    `/menus/${menuId}`);
export const createMenu        = (clientId, data)                  => reqMenus('POST',   `/menus`, { client_id: clientId, ...data });
export const updateMenu        = (menuId, data)                    => reqMenus('PUT',    `/menus/${menuId}`, data);
export const generateMenu      = (menuId)                          => reqMenus('POST',   `/menus/${menuId}/generate`);
export const finalizeMenu      = (menuId)                          => reqMenus('POST',   `/menus/${menuId}/finalize`);
export const addMeal           = (menuId, data)                    => reqMenus('POST',   `/menus/${menuId}/meals`, data);
export const updateMeal        = (menuId, mealId, data)            => reqMenus('PUT',    `/menus/${menuId}/meals/${mealId}`, data);
export const deleteMeal        = (menuId, mealId)                  => reqMenus('DELETE', `/menus/${menuId}/meals/${mealId}`);
export const addMenuItem       = (menuId, mealId, data)            => reqMenus('POST',   `/menus/${menuId}/meals/${mealId}/items`, data);
export const updateMenuItem    = (menuId, mealId, itemId, data)    => reqMenus('PUT',    `/menus/${menuId}/meals/${mealId}/items/${itemId}`, data);
export const deleteMenuItem    = (menuId, mealId, itemId)          => reqMenus('DELETE', `/menus/${menuId}/meals/${mealId}/items/${itemId}`);

// ── Weight Logs ───────────────────────────────────────────────────────────────
export const fetchWeightLog  = (clientId)      => request('GET',    `/weight/${clientId}`);
export const addWeight       = (clientId, data) => request('POST',   `/weight/${clientId}`, data);
export const deleteWeight    = (clientId, id)   => request('DELETE', `/weight/${clientId}/${id}`);
export const fetchWeightLink = (clientId)      => request('GET',    `/clients/${clientId}/weight-link`);

// ── Statistics ────────────────────────────────────────────────────────────────
export const fetchStopReasons = () => request('GET', '/stats/stop-reasons');

// ── AI Recommendations ────────────────────────────────────────────────────────
export const fetchAIRecommendations  = ()   => request('GET',  '/ai-recommendations');
export const dismissRecommendation   = (id) => request('POST', `/ai-recommendations/${id}/dismiss`);
export const markRecommendationSent  = (id) => request('POST', `/ai-recommendations/${id}/sent`);
export const runAIAnalysis           = ()   => request('POST', '/ai-recommendations/run');

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (name, password) =>
  fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  }).then((r) => r.json());

export const logout = () => request('POST', '/auth/logout');

// ── Settings: Users & Activity ────────────────────────────────────────────────
export const fetchUsers        = ()               => request('GET',  '/settings/users');
export const createUser        = (name, password) => request('POST', '/settings/users', { name, password });
export const toggleUserActive   = (id)             => request('PUT',  `/settings/users/${id}/toggle`);
export const resetUserPassword  = (id, password)   => request('PUT',  `/settings/users/${id}/password`, { password });
export const fetchActivityLog   = ()               => request('GET',  '/settings/activity');

// ── Inbox (action queue) ──────────────────────────────────────────────────────
export const fetchInbox        = ()             => request('GET',  '/inbox');
export const approveInboxItem  = (id)           => request('POST', `/inbox/${id}/approve`);
export const dismissInboxItem  = (id)           => request('POST', `/inbox/${id}/dismiss`);
export const snoozeInboxItem   = (id, hours)    => request('POST', `/inbox/${id}/snooze`, { hours });
export const batchInbox        = (ids, action)  => request('POST', '/inbox/batch', { ids, action });
export const refreshInbox      = ()             => request('POST', '/inbox/refresh');

// ── Server-Sent Events reader (fetch body stream → onEvent(type, json)) ───────
async function readEventStream(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let type = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue; // comment / heartbeat
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; } // malformed frame
      onEvent(type, parsed);
    }
  }
}

// ── Live updates (SSE) ────────────────────────────────────────────────────────
// fetch() + stream reader so the session token travels in the Authorization
// header (EventSource cannot send headers). Returns an AbortController.
export function openEventStream(onEvent, onClose) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/stream`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      await readEventStream(res, onEvent);
      onClose?.(null);
    } catch (err) {
      if (err.name !== 'AbortError') onClose?.(err);
    }
  })();
  return ctrl;
}
