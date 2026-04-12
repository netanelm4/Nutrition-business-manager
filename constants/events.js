const TRIGGER_EVENT = Object.freeze({
  SESSION_REMINDER:    'session_reminder',
  WELCOME:             'welcome',
  WEEKLY_CHECKIN:      'weekly_checkin',
  MENU_SENT:           'menu_sent',
  PROCESS_ENDING:      'process_ending',
  PAYMENT_REMINDER:    'payment_reminder',
  SESSION_CONFIRMATION:'session_confirmation',
  CALENDLY_LINK:       'calendly_link',
  CUSTOM:              'custom',
});

// Number of sessions in a client process
const TOTAL_SESSIONS = 6;

// Days between expected sessions
const SESSION_INTERVAL_DAYS = 14;

// Tolerance around expected_date for alert state calculation (±3 days = 7-day window)
const SESSION_TOLERANCE_DAYS = 3;

// Total duration of a standard client process in days (3 months)
const PROCESS_DURATION_DAYS = 90;

// Days after session 1 before "menu not sent" alert fires
const MENU_ALERT_THRESHOLD_DAYS = 2;

// Days before process_end_date when "ending soon" alert fires
const ENDING_SOON_THRESHOLD_DAYS = 14;

// Whatsapp template variable placeholder pattern
const TEMPLATE_VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

module.exports = {
  TRIGGER_EVENT,
  TOTAL_SESSIONS,
  SESSION_INTERVAL_DAYS,
  SESSION_TOLERANCE_DAYS,
  PROCESS_DURATION_DAYS,
  MENU_ALERT_THRESHOLD_DAYS,
  ENDING_SOON_THRESHOLD_DAYS,
  TEMPLATE_VARIABLE_PATTERN,
};
