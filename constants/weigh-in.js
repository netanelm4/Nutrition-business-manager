// Weigh-in access freeze: copy shown on the public weigh-in page (/w/:token).
// Gender-neutral Hebrew, no emojis, no dashes (the WhatsApp text is client-facing).

// Public contact number (same one shown on the landing page).
const CONTACT_PHONE = process.env.CONTACT_WHATSAPP_PHONE || '0524013226';

const WEIGH_IN_FROZEN = Object.freeze({
  TITLE: 'הגישה לטבלת השקילות מושהית כרגע',
  MESSAGE: 'כל השקילות שלך שמורות ולא נמחק דבר. כדי לחדש את הגישה, אפשר לפנות לנתנאל בוואטסאפ.',
  WHATSAPP_TEXT: 'היי נתנאל, אשמח לחדש את הגישה לטבלת השקילות שלי',
  CTA_LABEL: 'פנייה לנתנאל בוואטסאפ',
});

const WEIGH_IN_REASON_MAX = 200;

module.exports = { CONTACT_PHONE, WEIGH_IN_FROZEN, WEIGH_IN_REASON_MAX };
