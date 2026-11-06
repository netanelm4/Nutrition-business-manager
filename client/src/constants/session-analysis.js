// Session clinical analysis (Phase 10): labels for the review card

export const ANALYSIS_TITLE = 'תובנות AI וטיוטת תפריט';

export const MEAL_LABEL = Object.freeze({
  breakfast: 'ארוחת בוקר', ten_oclock: 'ארוחת עשר', lunch: 'ארוחת צהריים',
  snack: 'ארוחת ביניים', dinner: 'ארוחת ערב', night: 'ארוחת לילה',
});

export const SLOT_LABEL = Object.freeze({ protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', vegetable: 'ירק', fruit: 'פרי' });

export const BARRIER_LABEL = Object.freeze({
  emotional_eating: 'אכילה רגשית', schedule: 'סדר יום', late_night_eating: 'אכילה בלילה',
  weekend_social: 'סופי שבוע ואירועים', other: 'אחר',
});

export const ANAMNESIS_LABEL = Object.freeze({
  medical_history: 'רקע רפואי', medications: 'תרופות', work_routine: 'שגרת עבודה', activity: 'פעילות גופנית',
  digestive: 'עיכול', sleep: 'שינה', food_likes: 'מזונות אהובים', food_dislikes: 'מזונות לא אהובים',
  allergies_intolerances: 'אלרגיות ורגישויות',
});

export const QUOTE_STATUS = Object.freeze({
  exact:      { label: 'ציטוט מאומת', tone: 'var(--green-ink)' },
  close:      { label: 'ציטוט קרוב',  tone: 'var(--blue-ink)' },
  unverified: { label: 'לבדיקה: הציטוט לא נמצא בדברי המטופל', tone: 'var(--amber-ink)' },
  missing:    { label: 'לבדיקה: ללא ציטוט', tone: 'var(--amber-ink)' },
});

export const IMPORT_TARGETS = Object.freeze([
  { key: 'notes',  label: 'ייבוא לסיכום הפגישה',        done: 'יובא לסיכום הפגישה' },
  { key: 'intake', label: 'מילוי שדות ריקים באנמנזה',   done: 'שדות ריקים באנמנזה מולאו' },
  { key: 'menu',   label: 'יצירת טיוטת תפריט',          done: 'נוצרה טיוטת תפריט' },
]);

export const INTAKE_FIELD_LABEL = Object.freeze({
  work_hours: 'שעות עבודה', activity_type: 'סוג פעילות', favorite_foods: 'מזונות אהובים',
  medications: 'תרופות', physical_activity: 'פעילות גופנית',
});

// ── Follow-up sessions ──
export const MODE_LABEL = Object.freeze({ intake: 'אינטייק', follow_up: 'פגישת מעקב' });

export const CHANGE_LABEL = Object.freeze({
  portion: 'מספר מנות', timing: 'שעת ארוחה', swap_option: 'החלפת חלופה', add_option: 'הוספת חלופה',
  remove_option: 'הסרת חלופה', add_item: 'פריט חדש', basket_variety: 'גיוון בסל היומי', weekend: 'סוף שבוע', other: 'אחר',
});

export const HABIT_STATUS_LABEL = Object.freeze({
  kept: 'נשמר', partial: 'נשמר חלקית', not_kept: 'לא נשמר', not_discussed: 'לא נדון',
});

export const FOLLOWUP_IMPORT_TARGETS = Object.freeze([
  { key: 'notes', label: 'ייבוא לסיכום הפגישה',  done: 'יובא לסיכום הפגישה' },
  { key: 'menu',  label: 'יצירת עדכון תפריט',    done: 'נוצר עדכון תפריט' },
]);
