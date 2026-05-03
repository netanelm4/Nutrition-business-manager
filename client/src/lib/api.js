// All API calls live here — no fetch() in components.
// Password is stored in localStorage under key 'auth_password'.

const BASE = '/api';

function getPassword() {
  return localStorage.getItem('auth_password') || '';
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getPassword()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();

  // If 401, clear password and reload to trigger login screen
  if (res.status === 401) {
    localStorage.removeItem('auth_password');
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
export const fetchClients = (includeEnded = false) =>
  request('GET', `/clients${includeEnded ? '?include_ended=true' : ''}`);
export const fetchClient = (id) => request('GET', `/clients/${id}`);
export const createClient = (data) => request('POST', '/clients', data);
export const updateClient = (id, data) => request('PUT', `/clients/${id}`, data);
export const deleteClient = (id) => request('DELETE', `/clients/${id}`);

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

// ── Calendly ──────────────────────────────────────────────────────────────────
export const fetchCalendlyConfig    = () => request('GET',  '/calendly/config');
export const fetchCalendlyUpcoming  = () => request('GET',  '/calendly/upcoming');
export const checkCalendlyReminders = () => request('POST', '/calendly/check-reminders');

// ── Lead meetings ─────────────────────────────────────────────────────────────
export const scheduleMeeting  = (leadId, data) => request('POST', `/leads/${leadId}/meeting`, data);
export const fetchLeadMeeting = (leadId)       => request('GET',  `/leads/${leadId}/meeting`);

// ── Calendly event actions ────────────────────────────────────────────────────
export const updateCalendlyEvent   = (eventId, data) => request('PUT', `/calendly/events/${eventId}`, data);
export const cancelCalendlyEvent   = (eventId)       => request('PUT', `/calendly/events/${eventId}/cancel`);
export const fetchClientMeetings   = (clientId)      => request('GET', `/calendly/clients/${clientId}/events`);
export const completeCalendlyEvent = (id)            => request('PUT', `/calendly/events/${id}/complete`);

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
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_password') || ''}` },
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
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_password') || ''}` },
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
export const fetchDailyTasks = ()          => request('GET',    '/daily-tasks');
export const createDailyTask = (data)      => request('POST',   '/daily-tasks', data);
export const updateDailyTask = (id, data)  => request('PUT',    `/daily-tasks/${id}`, data);
export const deleteDailyTask = (id)        => request('DELETE', `/daily-tasks/${id}`);
export const runAIScan       = ()          => request('POST',   '/daily-tasks/ai-scan');

// ── Engagements ───────────────────────────────────────────────────────────────
export const fetchEngagements  = (clientId)        => request('GET',  `/engagements/client/${clientId}`);
export const createEngagement  = (clientId, data)  => request('POST', `/engagements/client/${clientId}`, data);
export const closeEngagement   = (id)              => request('POST', `/engagements/${id}/close`);

// ── Admin ─────────────────────────────────────────────────────────────────────
export const repairAIAssessments = () => request('POST', '/admin/repair-ai-assessments');

// ── AI Assistant ──────────────────────────────────────────────────────────────
export const chatWithAssistant = (message, history) =>
  request('POST', '/assistant/chat', { message, history });

// ── Food Bank ─────────────────────────────────────────────────────────────────
export const fetchFoodCategories = ()             => request('GET',    '/food-bank/categories');
export const fetchFoodItems      = (categoryId)   => request('GET',    `/food-bank/items/${categoryId}`);
export const createFoodItem      = (data)         => request('POST',   '/food-bank/items', data);
export const updateFoodItem      = (id, data)     => request('PUT',    `/food-bank/items/${id}`, data);
export const deleteFoodItem      = (id)           => request('DELETE', `/food-bank/items/${id}`);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const checkHealth = (password) =>
  fetch('/api/health', {
    headers: { Authorization: `Bearer ${password}` },
  }).then((r) => r.json());
