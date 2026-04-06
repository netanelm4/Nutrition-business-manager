const CLIENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  ENDING_SOON: 'ending_soon',
  ENDED: 'ended',
  PAUSED: 'paused',
});

const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  MEETING_SCHEDULED: 'meeting_scheduled',
  BECAME_CLIENT: 'became_client',
  NOT_RELEVANT: 'not_relevant',
});

const ALERT_STATE = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  NONE: 'none',
});

const GENDER = Object.freeze({
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
});

const LEAD_SOURCE = Object.freeze({
  LANDING_PAGE: 'landing_page',
  REFERRAL: 'referral',
  OTHER: 'other',
});

const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  DONE: 'done',
  IN_PROGRESS: 'in_progress',
});

module.exports = {
  CLIENT_STATUS,
  LEAD_STATUS,
  ALERT_STATE,
  GENDER,
  LEAD_SOURCE,
  TASK_STATUS,
};
