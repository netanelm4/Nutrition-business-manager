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

// ── Payments ──────────────────────────────────────────────────────────────────
export const fetchPayments = (clientId) => request('GET', `/clients/${clientId}/payments`);
export const createPayment = (clientId, data) => request('POST', `/clients/${clientId}/payments`, data);
export const deletePayment = (paymentId) => request('DELETE', `/payments/${paymentId}`);

// ── Calendly ──────────────────────────────────────────────────────────────────
export const fetchCalendlyConfig    = () => request('GET',  '/calendly/config');
export const fetchCalendlyUpcoming  = () => request('GET',  '/calendly/upcoming');
export const checkCalendlyReminders = () => request('POST', '/calendly/check-reminders');

// ── Auth ──────────────────────────────────────────────────────────────────────
export const checkHealth = (password) =>
  fetch('/api/health', {
    headers: { Authorization: `Bearer ${password}` },
  }).then((r) => r.json());
