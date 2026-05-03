/* Clients + Leads data */

const CLIENTS = [
  { id: 1, name: 'רחל כהן', email: 'rachel.cohen@gmail.com', phone: '054-8273610', goal: 'סוכרת T2', status: 'active', pct: 72, sessions: [1,1,1,1,2,0], next: 'היום 09:00', age: 54, joined: 'ספט 2024', streak: 14, paid: 'עד סוף חודש', c: 'pink' },
  { id: 2, name: 'יואב לוי', email: 'yoav.levi@gmail.com', phone: '052-7401299', goal: 'ירידה במשקל', status: 'active', pct: 58, sessions: [1,1,1,2,0,0], next: 'היום 10:30', age: 38, joined: 'ינו 2025', streak: 21, paid: 'שולם', c: 'blue' },
  { id: 3, name: 'מיכל אברהם', email: 'michal.a@icloud.com', phone: '050-9927184', goal: 'טבעוני מאוזן', status: 'active', pct: 91, sessions: [1,1,1,1,1,2], next: 'מחר 14:00', age: 29, joined: 'מרץ 2025', streak: 30, paid: 'שולם', c: 'green' },
  { id: 4, name: 'דנה בן-דוד', email: 'dana.bendavid@gmail.com', phone: '058-3312856', goal: 'תסמונת מטבולית', status: 'active', pct: 44, sessions: [1,1,2,0,0,0], next: 'ד׳, 17:00', age: 46, joined: 'פבר 2025', streak: 7, paid: 'שולם חלקי', c: 'pink' },
  { id: 5, name: 'אבי שמיר', email: 'avishamir@gmail.com', phone: '053-6148722', goal: 'ספורטאי', status: 'active', pct: 83, sessions: [1,1,1,1,1,2], next: 'ה׳, 07:30', age: 32, joined: 'אוק 2024', streak: 45, paid: 'שולם', c: 'blue' },
  { id: 6, name: 'תמר פרידמן', email: 'tamar.f@gmail.com', phone: '054-2280195', goal: 'מעקב היריון', status: 'active', pct: 67, sessions: [1,1,1,2,0,0], next: 'ו׳, 10:00', age: 34, joined: 'דצמ 2024', streak: 12, paid: 'שולם', c: 'green' },
  { id: 7, name: 'שירה מזרחי', email: 'shira.m@gmail.com', phone: '052-8841067', goal: 'בעיות עיכול', status: 'overdue', pct: 38, sessions: [1,1,2,0,0,0], next: 'לא נקבע', age: 41, joined: 'ינו 2025', streak: 0, paid: 'פיגור 14י', c: 'pink' },
  { id: 8, name: 'רועי גולן', email: 'roei.g@outlook.com', phone: '050-4419802', goal: 'בניית מסה', status: 'paused', pct: 55, sessions: [1,1,1,0,0,0], next: 'מושהה', age: 27, joined: 'נוב 2024', streak: 0, paid: 'שולם', c: 'blue' },
  { id: 9, name: 'נועה שיין', email: 'noa.shein@gmail.com', phone: '054-7763412', goal: 'איזון הורמונלי', status: 'active', pct: 76, sessions: [1,1,1,1,2,0], next: 'ב׳, 11:30', age: 37, joined: 'פבר 2025', streak: 18, paid: 'שולם', c: 'pink' },
  { id:10, name: 'דניאל קורן', email: 'daniel.koren@gmail.com', phone: '058-9120487', goal: 'כולסטרול גבוה', status: 'active', pct: 63, sessions: [1,1,1,2,0,0], next: 'ג׳, 16:00', age: 51, joined: 'מרץ 2025', streak: 9, paid: 'שולם', c: 'green' },
];

// Lead stages (kanban)
const LEAD_STAGES = [
  { id: 'new',  label: 'חדש',              cls: 'st-new'  },
  { id: 'call', label: 'שיחת פתיחה',       cls: 'st-call' },
  { id: 'meet', label: 'פגישה נקבעה',      cls: 'st-meet' },
  { id: 'neg',  label: 'הצעה ומו״מ',       cls: 'st-neg'  },
  { id: 'won',  label: 'הומר למטופל',      cls: 'st-won'  },
];

const LEADS = [
  // new
  { id: 101, stage: 'new', name: 'מיכל דוידוב', goal: 'ירידה של 8 ק״ג', src: 'inst', age: '3 ימים', value: '₪2,400' },
  { id: 102, stage: 'new', name: 'אורי כץ', goal: 'סוכרת גבולית', src: 'ref', age: '1 יום', value: '₪3,200', hot: true },
  { id: 103, stage: 'new', name: 'יעל בר', goal: 'תזונה לילדים', src: 'ads', age: '5 ימים', value: '₪1,800' },
  // call
  { id: 104, stage: 'call', name: 'אסף הלוי', goal: 'צמחוני — חוסרי ברזל', src: 'ads', age: '2 ימים', value: '₪2,800' },
  { id: 105, stage: 'call', name: 'דפנה רוט', goal: 'מעקב אחרי ניתוח', src: 'ref', age: '4 ימים', value: '₪4,500', hot: true },
  // meet
  { id: 106, stage: 'meet', name: 'עדן מור', goal: 'כושר + הרזיה', src: 'inst', age: '1 שבוע', value: '₪3,600' },
  { id: 107, stage: 'meet', name: 'אילן שחר', goal: 'בעיות עיכול', src: 'ref', age: '5 ימים', value: '₪2,400' },
  { id: 108, stage: 'meet', name: 'רותם אלון', goal: 'ספורטאי — תחרות', src: 'inst', age: '3 ימים', value: '₪5,200', hot: true },
  // neg
  { id: 109, stage: 'neg', name: 'נועם טל', goal: 'כולסטרול + לחץ דם', src: 'ref', age: '2 שבועות', value: '₪3,800' },
  { id: 110, stage: 'neg', name: 'ליאור גוב', goal: 'בניית מסה', src: 'ads', age: '10 ימים', value: '₪2,700' },
  // won (moved last week)
  { id: 111, stage: 'won', name: 'שני עמר', goal: 'איזון הורמונלי', src: 'ref', age: 'השבוע', value: '₪3,200' },
  { id: 112, stage: 'won', name: 'גיא הרמן', goal: 'טבעוני', src: 'inst', age: 'השבוע', value: '₪2,400' },
];

window.CLIENTS = CLIENTS;
window.LEAD_STAGES = LEAD_STAGES;
window.LEADS = LEADS;
