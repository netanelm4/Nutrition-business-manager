// Mirror of server/constants/statuses.js — keep values in sync

export const CLIENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  ENDING_SOON: 'ending_soon',
  ENDED: 'ended',
  PAUSED: 'paused',
});

export const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  MEETING_SCHEDULED: 'meeting_scheduled',
  BECAME_CLIENT: 'became_client',
  NOT_RELEVANT: 'not_relevant',
});

export const ALERT_STATE = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  NONE: 'none',
});

export const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  DONE: 'done',
  IN_PROGRESS: 'in_progress',
});

export const LEAD_SOURCE = Object.freeze({
  LANDING_PAGE: 'landing_page',
  REFERRAL: 'referral',
  OTHER: 'other',
});

// Hebrew display labels
export const CLIENT_STATUS_LABEL = Object.freeze({
  active: 'פעיל',
  ending_soon: 'מסיים בקרוב',
  ended: 'סיים',
  paused: 'מושהה',
});

export const LEAD_STATUS_LABEL = Object.freeze({
  new: 'חדש',
  contacted: 'נוצר קשר',
  meeting_scheduled: 'פגישה נקבעה',
  became_client: 'הפך ללקוח',
  not_relevant: 'לא רלוונטי',
});

export const LEAD_SOURCE_LABEL = Object.freeze({
  landing_page: 'דף נחיתה',
  referral: 'הפניה',
  other: 'אחר',
});

export const GENDER_LABEL = Object.freeze({
  male: 'זכר',
  female: 'נקבה',
  other: 'אחר',
});

// ── Intake form constants ─────────────────────────────────────────────────────

export const MEDICAL_CONDITIONS = [
  'שומנים בדם',
  'סוכרת',
  'מחלות לב',
  'יתר לחץ דם',
  'אנמיה',
  'בעיות בלוטת התריס',
  'צליאק',
  'GERD',
  'IBS/IBD',
  'אלרגיות למזון',
  'רגישויות למזון',
];

export const EATING_PATTERNS = [
  'אכילה מסודרת',
  'אכילה נשנשנית',
  'אכילה מהירה',
  'תאווה למתוק',
  'אוכל מהיר',
  'אכילה מסיבות שאינן רעב',
  'אכילה תוך כדי הסחות דעת',
  'אכילה עד מלאות יתר',
  'אכילה רגשית',
  'בולמוסי אכילה',
  'אכילה ללא צלחת',
];

export const FREQUENCY_OPTIONS = [
  'אף פעם',
  'לעיתים רחוקות',
  'לפעמים',
  'לעיתים קרובות',
  'תמיד',
];
