// AI agent: Hebrew labels for tool activity shown in the assistant drawer

export const AGENT_TOOL_LABEL = Object.freeze({
  search_entities:        'חיפוש לקוחות ולידים',
  get_client_snapshot:    'קריאת תיק מטופל',
  get_client_timeline:    'היסטוריית מטופל',
  get_stale_leads:        'לידים ממתינים',
  get_schedule:           'בדיקת יומן',
  get_inbox:              'קריאת תיבת הפעולות',
  search_food_bank:       'חיפוש במאגר המזון',
  get_protocol:           'קריאת פרוטוקול',
  recall_memory:          'זיכרון קליני',
  convert_lead_to_client: 'הצעה: המרת ליד',
  update_lead_status:     'הצעה: עדכון סטטוס ליד',
  schedule_meeting:       'הצעה: קביעת פגישה',
  draft_whatsapp_message: 'הצעה: הודעת WhatsApp',
  schedule_followup:      'הצעה: משימת מעקב',
  log_session_notes:      'הצעה: תיעוד פגישה',
  assign_protocol:        'הצעה: שיוך פרוטוקול',
  create_menu_draft:      'הצעה: טיוטת תפריט',
  record_payment:         'הצעה: רישום תשלום',
  update_weight:          'רישום משקל',
});

export const AGENT_QUICK_PROMPTS = Object.freeze([
  'מה יש לי היום?',
  'אילו לידים מחכים לטיפול?',
  'הכנה לפגישה הבאה',
  'אילו מטופלים לא קבעו פגישה?',
]);

export const AGENT_CONVERSATION_KEY = 'agent_conversation_id';
