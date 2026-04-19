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
export const generateInsights = (sessionId) => request('POST', `/sessions/${sessionId}/insights`);

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

// ── Calendly ──────────────────────────────────────────────────────────────────
export const fetchCalendlyConfig    = () => request('GET',  '/calendly/config');
export const fetchCalendlyUpcoming  = () => request('GET',  '/calendly/upcoming');
export const checkCalendlyReminders = () => request('POST', '/calendly/check-reminders');

// ── Lead meetings ─────────────────────────────────────────────────────────────
export const scheduleMeeting  = (leadId, data) => request('POST', `/leads/${leadId}/meeting`, data);
export const fetchLeadMeeting = (leadId)       => request('GET',  `/leads/${leadId}/meeting`);

// ── Calendly event actions ────────────────────────────────────────────────────
export const updateCalendlyEvent = (eventId, data) => request('PUT', `/calendly/events/${eventId}`, data);
export const cancelCalendlyEvent = (eventId) => request('PUT', `/calendly/events/${eventId}/cancel`);

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

// ── Admin ─────────────────────────────────────────────────────────────────────
export const repairAIAssessments = () => request('POST', '/admin/repair-ai-assessments');

// ── Google Calendar ───────────────────────────────────────────────────────────
export const fetchGoogleAuthUrl = () => request('GET', '/google/auth-url').then((d) => d.url);
export const fetchGoogleStatus  = () => request('GET', '/google/status');
export const disconnectGoogle   = () => request('DELETE', '/google/disconnect');
export const syncGoogleCalendar = () => request('POST', '/google/sync');

// ── Auth ──────────────────────────────────────────────────────────────────────
export const checkHealth = (password) =>
  fetch('/api/health', {
    headers: { Authorization: `Bearer ${password}` },
  }).then((r) => r.json());
