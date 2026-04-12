const { TRIGGER_EVENT } = require('../constants/events');

const TEMPLATES = [
  {
    name: 'תזכורת פגישה',
    trigger_event: TRIGGER_EVENT.SESSION_REMINDER,
    body_template:
      'היי {{client_name}}, רציתי להזכיר לך שיש לנו פגישה ב-{{date}} בשעה {{time}}. מחכה לך! 😊',
  },
  {
    name: 'ברוך הבא לתהליך',
    trigger_event: TRIGGER_EVENT.WELCOME,
    body_template:
      'היי {{client_name}}! ברוך הבא לתהליך 🙌 שמח לצאת איתך לדרך. התפריט שלך יהיה אצלך תוך יומיים מהפגישה שלנו.',
  },
  {
    name: 'תפריט נשלח',
    trigger_event: TRIGGER_EVENT.MENU_SENT,
    body_template:
      'היי {{client_name}}, התפריט שלך מוכן ונשלח אליך 🥗 קרא אותו בנחת ואם יש שאלות — אני כאן.',
  },
  {
    name: 'צ׳ק-אין שבועי',
    trigger_event: TRIGGER_EVENT.WEEKLY_CHECKIN,
    body_template:
      'היי {{client_name}}, שבוע טוב! רציתי לבדוק איך עובר השבוע מבחינת התזונה? מה מרגיש טוב ומה קצת מאתגר? 💪',
  },
  {
    name: 'סיום תהליך',
    trigger_event: TRIGGER_EVENT.PROCESS_ENDING,
    body_template:
      'היי {{client_name}}, כבר 3 חודשים ביחד — כל הכבוד על ההתמדה! 🎉 בוא נדבר על המשך הדרך ומה הצעד הבא בשבילך.',
  },
];

// Templates that must always exist (seeded individually by trigger_event)
const REQUIRED_TEMPLATES = [
  {
    name: 'תזכורת תשלום',
    trigger_event: TRIGGER_EVENT.PAYMENT_REMINDER,
    body_template:
      'היי {{client_name}}, רציתי להזכיר שיש יתרה פתוחה לתשלום עבור התהליך שלנו. אשמח שנסדיר את זה 🙏',
  },
  {
    name: 'אישור הגעה לפגישה',
    trigger_event: TRIGGER_EVENT.SESSION_CONFIRMATION,
    body_template:
      'היי {{client_name}} 👋\nרציתי לאשר את הפגישה שלנו מחר {{date}} בשעה {{time}}.\nאשמח לאישור הגעה 🙏\nאם צריך לשנות — נדבר!',
  },
  {
    name: 'קישור לקביעת פגישה',
    trigger_event: TRIGGER_EVENT.CALENDLY_LINK,
    body_template:
      'היי {{client_name}} 😊\nהקישור לקביעת הפגישה הקרובה שלנו:\n{{calendly_link}}\nניתן לבחור שעה נוחה — אני אהיה שם!',
  },
];

/**
 * Insert the 5 default WhatsApp templates if the table is empty.
 * Also ensures REQUIRED_TEMPLATES always exist (by trigger_event).
 * Safe to call on every server startup.
 */
function runSeed(db) {
  const count = db.prepare('SELECT COUNT(*) as n FROM whatsapp_templates').get();
  if (count.n === 0) {
    const insert = db.prepare(`
      INSERT INTO whatsapp_templates (name, trigger_event, body_template, is_active, is_custom)
      VALUES (@name, @trigger_event, @body_template, 1, 0)
    `);
    const insertAll = db.transaction((templates) => {
      for (const t of templates) insert.run(t);
    });
    insertAll(TEMPLATES);
    console.log(`[seed] Inserted ${TEMPLATES.length} WhatsApp templates.`);
  }

  // Ensure required templates exist (idempotent upsert by trigger_event)
  for (const tmpl of REQUIRED_TEMPLATES) {
    const existing = db
      .prepare('SELECT id FROM whatsapp_templates WHERE trigger_event = ?')
      .get(tmpl.trigger_event);
    if (!existing) {
      db.prepare(`
        INSERT INTO whatsapp_templates (name, trigger_event, body_template, is_active, is_custom)
        VALUES (@name, @trigger_event, @body_template, 1, 0)
      `).run(tmpl);
      console.log(`[seed] Inserted required template: ${tmpl.name}`);
    }
  }
}

// ─── Protocol seed data ───────────────────────────────────────────────────────

const PROTOCOLS = [
  {
    name: 'ירידה במשקל כללי',
    description: 'פרוטוקול בסיס לירידה במשקל בגישה מאוזנת',
    highlights: JSON.stringify([
      'הגדרת יעד קלורי ריאלי — גירעון של 300-500 קק״ל ביום',
      'עדיפות לחלבון גבוה לשמירה על מסת שריר',
      'מעקב אחר שעות האכילה וארוחות לילה',
      'זיהוי טריגרים רגשיים לאכילה',
      'שתייה — מינימום 8 כוסות ביום',
    ]),
    default_tasks: JSON.stringify([
      { text: 'לנהל יומן אכילה ל-3 ימים (כולל שישי)', status: 'pending' },
      { text: 'לשקול עצמו בבוקר בצום — כל יום באותה שעה', status: 'pending' },
      { text: 'לצלם את תכולת המקרר והמזווה', status: 'pending' },
    ]),
  },
  {
    name: 'סוכרת סוג 2 / עמידות לאינסולין',
    description: 'פרוטוקול לניהול סוכרת סוג 2 ועמידות לאינסולין',
    highlights: JSON.stringify([
      'עומס גליקמי — להסביר את המושג בפגישה',
      'תזמון ארוחות קבוע — כל 3-4 שעות, לא לדלג',
      'הפחתה הדרגתית של פחמימות פשוטות',
      'שילוב סיבים תזונתיים בכל ארוחה',
      'תיאום עם רופא מטפל — מעקב תרופות ובדיקות',
    ]),
    default_tasks: JSON.stringify([
      { text: 'להביא תוצאות בדיקות דם אחרונות (המוגלובין מסוכרר, גלוקוז)', status: 'pending' },
      { text: 'לתעד מה אוכל לפני ואחרי פעילות גופנית', status: 'pending' },
      { text: 'להפסיק שתיית מיצים ומשקאות ממותקים', status: 'pending' },
    ]),
  },
  {
    name: 'חיטוב ועלייה במסת שריר',
    description: 'פרוטוקול לבניית מסת שריר תוך שמירה על אחוז שומן נמוך',
    highlights: JSON.stringify([
      'עודף קלורי מבוקר — 200-300 קק״ל מעל תחזוקה',
      'חלבון — 1.6-2.2 גרם לק״ג משקל גוף',
      'תזמון חלבון סביב אימון (לפני ואחרי)',
      'פחמימות מורכבות כמקור אנרגיה עיקרי',
      'מעקב אחר ביצועים באימון כאינדיקטור התקדמות',
    ]),
    default_tasks: JSON.stringify([
      { text: 'לשלוח תוכנית אימונים נוכחית', status: 'pending' },
      { text: 'לתעד צריכת חלבון יומית ל-3 ימים', status: 'pending' },
      { text: 'לבדוק כמות שינה — מינימום 7 שעות לבנייה', status: 'pending' },
    ]),
  },
  {
    name: 'תסמונת מעי רגיש (IBS)',
    description: 'פרוטוקול לניהול תסמיני IBS בגישה שלבית',
    highlights: JSON.stringify([
      'זיהוי טריגרים אישיים — לא כולם זהים',
      'שלב Low-FODMAP ראשוני — 4-6 שבועות',
      'אכילה איטית, לעיסה מרובה, הפחתת מתח',
      'מעקב אחר תסמינים ביומן מפורט',
      'תיאום עם גסטרואנטרולוג במידת הצורך',
    ]),
    default_tasks: JSON.stringify([
      { text: 'לנהל יומן תסמינים + אכילה ל-5 ימים', status: 'pending' },
      { text: 'לרשום מזונות שמחמירים תסמינים לפי חוויה אישית', status: 'pending' },
      { text: 'לבדוק רמות מתח ואיכות שינה', status: 'pending' },
    ]),
  },
  {
    name: 'PCOS — תסמונת שחלות פוליציסטיות',
    description: 'פרוטוקול תזונתי להתמודדות עם PCOS',
    highlights: JSON.stringify([
      'הפחתת עמידות לאינסולין — ציר מרכזי',
      'תזונה אנטי-דלקתית — הגברת אומגה 3 ונוגדי חמצון',
      'הימנעות מסוכר מוסף ומזון מעובד',
      'תזמון ארוחות — למנוע קפיצות סוכר',
      'מיקרו-נוטריאנטים: מגנזיום, ויטמין D, אינוזיטול',
    ]),
    default_tasks: JSON.stringify([
      { text: 'להביא בדיקות הורמונליות אחרונות', status: 'pending' },
      { text: 'לתעד מחזור חודשי ותסמינים נלווים', status: 'pending' },
      { text: 'לבדוק צריכת מוצרי חלב — האם מחמירים תסמינים?', status: 'pending' },
    ]),
  },
  {
    name: 'תזונה צמחונית / טבעונית',
    description: 'פרוטוקול להבטחת תזונה מלאה ומאוזנת ללא מוצרים מן החי',
    highlights: JSON.stringify([
      'השלמת חלבון מלא — שילובי מזונות נכונים',
      'ויטמין B12 — חובה, לבדוק רמות ולתסף',
      'ברזל מהצומח + ויטמין C לשיפור ספיגה',
      'אומגה 3 — מקורות צמחיים ותוספות DHA/EPA',
      'סידן — מקורות חלופיים למוצרי חלב',
    ]),
    default_tasks: JSON.stringify([
      { text: 'להביא בדיקות דם — B12, ברזל, פריטין, ויטמין D', status: 'pending' },
      { text: 'לרשום מקורות חלבון עיקריים בתפריט הנוכחי', status: 'pending' },
      { text: 'לבדוק אילו תוספים לוקח כרגע ובאיזו מינון', status: 'pending' },
    ]),
  },
  {
    name: 'יתר לחץ דם — תזונת DASH',
    description: 'פרוטוקול מבוסס DASH להפחתת לחץ דם באמצעות תזונה',
    highlights: JSON.stringify([
      'הפחתת נתרן — מתחת ל-2300 מ״ג ביום',
      'הגברת אשלגן, מגנזיום וסידן מהמזון',
      'הפחתת אלכוהול ומזון מעובד',
      'פירות וירקות — מינימום 5 מנות ביום',
      'תיאום עם קרדיולוג / רופא משפחה',
    ]),
    default_tasks: JSON.stringify([
      { text: 'לתעד כמות מלח מוסף ביומן אכילה לשבוע', status: 'pending' },
      { text: 'למדוד לחץ דם בבית פעמיים ביום ל-3 ימים', status: 'pending' },
      { text: 'להפסיק מזון מעובד ונקניקים לשבוע ניסיון', status: 'pending' },
    ]),
  },
];

function seedProtocols(db) {
  const count = db.prepare('SELECT COUNT(*) as n FROM protocols').get();
  if (count.n > 0) return;

  const insert = db.prepare(`
    INSERT INTO protocols (name, description, highlights, default_tasks, is_custom, is_active)
    VALUES (@name, @description, @highlights, @default_tasks, 0, 1)
  `);

  const insertAll = db.transaction((protocols) => {
    for (const p of protocols) insert.run(p);
  });

  insertAll(PROTOCOLS);
  console.log(`[seed] Inserted ${PROTOCOLS.length} protocols.`);
}

module.exports = { runSeed, seedProtocols };
