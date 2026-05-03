/* Dashboard data — realistic Hebrew clinical-nutrition context */

const CLIENTS_INITIALS = [
  { i: 'רכ', c: 'pink',  name: 'רחל כהן' },
  { i: 'יל', c: 'blue',  name: 'יואב לוי' },
  { i: 'מא', c: 'green', name: 'מיכל אברהם' },
  { i: 'דב', c: 'pink',  name: 'דנה בן-דוד' },
  { i: 'אש', c: 'blue',  name: 'אבי שמיר' },
  { i: 'תפ', c: 'green', name: 'תמר פרידמן' },
  { i: 'שמ', c: 'pink',  name: 'שירה מזרחי' },
  { i: 'רג', c: 'blue',  name: 'רועי גולן' },
];

const TASKS = [
  // quadrant: q1 urgent+important, q2 important, q3 urgent, q4 neither
  { id: 1, quad: 'q1', title: 'להחזיר ל-רחל כהן אחרי תוצאות בדיקות דם', sub: 'HbA1c עלה — להתאים פרוטוקול', due: '10:30', client: 0 },
  { id: 2, quad: 'q1', title: 'לאשר הסכם טיפול ליואב לוי', sub: 'חתימה דיגיטלית ממתינה 3 ימים', due: 'היום', client: 1 },
  { id: 3, quad: 'q2', title: 'לסכם פרוטוקול אישי למיכל אברהם', sub: 'לקראת פגישת ייעוץ מחר', due: '12:00', client: 2 },
  { id: 4, quad: 'q2', title: 'להכין תוכנית תזונה שבועית — דנה בן-דוד', sub: 'בקשה למעקב טבעוני', due: '14:00', client: 3, done: true },
  { id: 5, quad: 'q3', title: 'לעדכן צ׳ק-אין שבועי עם אבי שמיר', sub: null, due: '15:30', client: 4 },
  { id: 6, quad: 'q3', title: 'לענות על הודעת WhatsApp — תמר פרידמן', sub: 'שאלה לגבי ארוחת בוקר', due: '16:00', client: 5 },
  { id: 7, quad: 'q4', title: 'לעדכן כותרת תבנית WhatsApp — צ׳ק-אין', sub: null, due: 'השבוע' },
];

const SESSIONS = [
  { time: ['09:00', '45ד'], name: 'רחל כהן', type: 'פגישה ראשונה', loc: 'Google Meet', status: 'confirmed', client: 0 },
  { time: ['10:30', '30ד'], name: 'יואב לוי', type: 'מעקב חודשי', loc: 'משרד — ת״א', status: 'confirmed', client: 1 },
  { time: ['12:00', '60ד'], name: 'מיכל אברהם', type: 'ייעוץ תזונתי', loc: 'Google Meet', status: 'pending', client: 2 },
  { time: ['14:00', '30ד'], name: 'דנה בן-דוד', type: 'צ׳ק-אין שבועי', loc: 'טלפון', status: 'confirmed', client: 3 },
  { time: ['16:30', '45ד'], name: 'אבי שמיר', type: 'מעקב', loc: 'Google Meet', status: 'confirmed', client: 4 },
];

const ALERTS = [
  { kind: 'red',   icon: 'warn',  title: 'פיגור תשלום — שירה מזרחי', body: '₪450 לא שולמו 14 ימים. שליחת תזכורת אוטומטית נכשלה.', time: 'לפני 2ש' },
  { kind: 'blue',  icon: 'msg',   title: '3 הודעות WhatsApp לא-נקראות', body: 'רועי גולן, תמר פרידמן, + 1 נוספ/ת ממתינים לתגובה.', time: 'לפני 35ד' },
  { kind: 'amber', icon: 'clock', title: 'ליד לא נענה 5 ימים', body: 'מיכל דוידוב — יצר/ה קשר דרך האתר, ניתן לדלג לשיחת פתיחה.', time: 'לפני 1י' },
  { kind: 'green', icon: 'heart', title: 'אבי שמיר השיג יעד', body: 'ירידה של 3.2 ק״ג בחודש — פרוטוקול עובד.', time: 'היום' },
];

const STATS = [
  { label: 'מטופלים פעילים',  value: '47', delta: '+4', dir: 'up',   sub: 'החודש',        spark: [4,6,5,8,7,10,9,11,12,14,13,15] },
  { label: 'הכנסה חודשית',    value: '₪18,450', delta: '+12%', dir: 'up', sub: 'מול חודש קודם', spark: [8,9,7,10,12,11,13,12,14,15,16,17] },
  { label: 'פגישות השבוע',    value: '23', delta: '6 היום', dir: 'flat', sub: null,        spark: [2,3,4,3,5,4,6,5,7,6,8,6] },
  { label: 'הצלחת פרוטוקולים', value: '84%', delta: '+3%', dir: 'up',   sub: '12 חודשים',  spark: [7,8,8,9,9,10,10,11,12,12,13,14] },
];

window.DATA = { CLIENTS_INITIALS, TASKS, SESSIONS, ALERTS, STATS };
