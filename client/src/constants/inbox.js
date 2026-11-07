// Inbox (action queue) display metadata — mirrors the kinds produced on the
// server (services/inbox-rules, jobs, ai-intelligence, agent).

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
  morning_brief:       { label: 'תדריך בוקר',      tone: 'violet' },
  meeting_prep:        { label: 'הכנה לפגישה',     tone: 'blue'   },
  brief_lead_followup: { label: 'מעקב ליד (טיוטה)', tone: 'muted'  },
  agent_convert_lead_to_client: { label: 'הצעת סוכן: המרת ליד',      tone: 'violet' },
  agent_update_lead_status:     { label: 'הצעת סוכן: סטטוס ליד',     tone: 'violet' },
  agent_schedule_meeting:       { label: 'הצעת סוכן: פגישה',         tone: 'violet' },
  agent_draft_whatsapp:         { label: 'הצעת סוכן: הודעה',         tone: 'violet' },
  agent_schedule_followup:      { label: 'הצעת סוכן: משימת מעקב',    tone: 'violet' },
  agent_log_session_notes:      { label: 'הצעת סוכן: תיעוד פגישה',   tone: 'violet' },
  agent_assign_protocol:        { label: 'הצעת סוכן: פרוטוקול',      tone: 'violet' },
  agent_create_menu_draft:      { label: 'הצעת סוכן: טיוטת תפריט',   tone: 'violet' },
  agent_record_payment:         { label: 'הצעת סוכן: תשלום',         tone: 'violet' },
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
