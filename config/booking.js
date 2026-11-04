// Google Calendar appointment-scheduling links (https://calendar.app.google/...).
// Legacy CALENDLY_*_LINK names are read as a fallback so an un-renamed Railway
// variable keeps working until it is renamed.

let warnedLegacy = false;

function bookingLinks() {
  const env = process.env;
  const firstLink    = env.BOOKING_LINK_FIRST    || env.CALENDLY_FIRST_LINK    || '';
  const followupLink = env.BOOKING_LINK_FOLLOWUP || env.CALENDLY_FOLLOWUP_LINK || '';
  const usingLegacy = (!env.BOOKING_LINK_FIRST && env.CALENDLY_FIRST_LINK)
    || (!env.BOOKING_LINK_FOLLOWUP && env.CALENDLY_FOLLOWUP_LINK);
  if (usingLegacy && !warnedLegacy) {
    warnedLegacy = true;
    console.warn('[booking] Using legacy CALENDLY_*_LINK env vars — rename to BOOKING_LINK_FIRST / BOOKING_LINK_FOLLOWUP');
  }
  return { firstLink, followupLink };
}

module.exports = { bookingLinks };
