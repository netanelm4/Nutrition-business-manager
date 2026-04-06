const { TEMPLATE_VARIABLE_PATTERN } = require('../constants/events');

// ─────────────────────────────────────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace all {{variable}} placeholders in a template string with values
 * from the variables object.
 * Unknown placeholders are left as-is so missing data is visible to the user.
 *
 * @param {string} bodyTemplate - Hebrew template text with {{variable}} markers
 * @param {object} variables    - Key/value pairs to substitute
 * @returns {string} Rendered message text
 */
function renderTemplate(bodyTemplate, variables) {
  if (!bodyTemplate) return '';
  return bodyTemplate.replace(TEMPLATE_VARIABLE_PATTERN, (match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone number normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise an Israeli phone number for use in a wa.me URL.
 * Strips all non-digit characters, replaces a leading 0 with the +972 country code.
 * Returns the cleaned number string (digits only, no +).
 *
 * @param {string} phone - Raw phone number (e.g. "050-123-4567" or "+972501234567")
 * @returns {string} E.164 digits without leading + (e.g. "972501234567")
 */
function normalisePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deeplink mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a wa.me deep-link URL that pre-fills the given message.
 * The user opens this URL and manually taps Send in WhatsApp.
 *
 * @param {string} phone   - Client phone number (any format)
 * @param {string} message - Pre-filled message text
 * @returns {string} wa.me URL
 */
function generateLink(phone, message) {
  const cleanPhone = normalisePhone(phone);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// API mode stub (future — Twilio or 360dialog)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message programmatically via the configured API provider.
 * NOT IMPLEMENTED — stub for future Phase 2 integration.
 *
 * @param {string} phone   - Client phone number
 * @param {string} message - Message text to send
 * @returns {Promise<{ success: boolean, messageId: string }>}
 */
async function sendMessage(phone, message) { // eslint-disable-line no-unused-vars
  throw new Error(
    'WhatsApp API mode is not implemented yet. Set WHATSAPP_MODE=deeplink or implement this method with Twilio / 360dialog.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified public interface
// ─────────────────────────────────────────────────────────────────────────────

const mode = process.env.WHATSAPP_MODE || 'deeplink';

/**
 * The active WhatsApp mode ('deeplink' or 'api').
 * Read by the UI to display the correct send instructions.
 */
const activeMode = mode;

module.exports = {
  renderTemplate,
  normalisePhone,
  generateLink,
  sendMessage,
  activeMode,
};
