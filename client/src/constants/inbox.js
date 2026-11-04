// Inbox (action queue) display metadata — mirrors the kinds produced on the
// server (services/inbox-rules, jobs, ai-intelligence, whatsapp-bot).

export const INBOX_KIND_META = Object.freeze({
  session_due:      { label: 'פגישה לקבוע',        tone: 'blue'  },
  process_ending:   { label: 'סיום תהליך מתקרב',   tone: 'amber' },
  process_ended:    { label: 'תאריך סיום עבר',     tone: 'red'   },
  menu_overdue:     { label: 'תפריט באיחור',       tone: 'red'   },
  checkin:          { label: "צ'ק-אין",            tone: 'green' },
  lead_followup:    { label: 'ליד ממתין',          tone: 'muted' },
  freeze_end:       { label: 'סיום הקפאה',         tone: 'amber' },
  meeting_reminder: { label: 'אישור הגעה',         tone: 'blue'  },
  bot_reply:        { label: 'תשובת בוט לאישור',   tone: 'blue'  },
  bot_draft:        { label: 'טיוטת בוט לאישור',   tone: 'blue'  },
  whatsapp_flag:    { label: 'דגל אדום',           tone: 'red'   },
  food_submitted:   { label: 'מזון שהוגש',         tone: 'muted' },
});

export const AI_KIND_META = Object.freeze({ label: 'המלצת AI', tone: 'violet' });

export function inboxKindMeta(kind) {
  if (INBOX_KIND_META[kind]) return INBOX_KIND_META[kind];
  if (kind?.startsWith('ai_')) return AI_KIND_META;
  return { label: 'פעולה', tone: 'muted' };
}

export const INBOX_PRIORITY_LABEL = Object.freeze({ urgent: 'דחוף', medium: 'רגיל', low: 'נמוך' });

export const INBOX_FILTERS = Object.freeze([
  { key: 'all',     label: 'הכל' },
  { key: 'message', label: 'הודעות' },
  { key: 'task',    label: 'משימות' },
]);

export const SNOOZE_OPTIONS = Object.freeze([
  { hours: 24, label: 'מחר' },
  { hours: 72, label: 'בעוד 3 ימים' },
  { hours: 168, label: 'בעוד שבוע' },
]);
