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
  MEETING_HELD: 'meeting_held',
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

const ACTIVITY_FACTORS = Object.freeze([
  { value: 1.2,   label: 'ישיבה מלאה — אין פעילות גופנית' },
  { value: 1.28,  label: 'מעט יושבנית — פעילות קלה מאוד' },
  { value: 1.375, label: 'קלה — 1-3 פעמים בשבוע' },
  { value: 1.55,  label: 'בינונית — 3-5 פעמים בשבוע' },
  { value: 1.725, label: 'גבוהה — 6-7 פעמים בשבוע' },
  { value: 1.9,   label: 'מאוד גבוהה — עבודה פיזית + אימונים' },
]);

const GOAL_OPTIONS = Object.freeze([
  { value: 'loss',     label: 'ירידה במשקל' },
  { value: 'gain',     label: 'עלייה במסה' },
  { value: 'maintain', label: 'שימור' },
]);

module.exports = {
  CLIENT_STATUS,
  LEAD_STATUS,
  ALERT_STATE,
  GENDER,
  LEAD_SOURCE,
  TASK_STATUS,
  ACTIVITY_FACTORS,
  GOAL_OPTIONS,
};
