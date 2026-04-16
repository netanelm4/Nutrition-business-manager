import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeadIntake, createLeadIntake, updateLeadIntake, uploadLeadLabPdf } from '../../lib/api';
import {
  MEDICAL_CONDITIONS,
  EATING_PATTERNS,
  FREQUENCY_OPTIONS,
  ACTIVITY_FACTORS,
  GOAL_OPTIONS,
} from '../../constants/statuses';
import {
  calculateBMR,
  calculateAdjustedWeight,
  calculateBMI,
  calculateTDEE,
} from '../../lib/calculations';

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

// ── Toggle pill ───────────────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {['כן', 'לא'].map((opt) => {
        const isOn = opt === 'כן' ? !!value : !value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt === 'כן')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              isOn
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Radio group (horizontal) ──────────────────────────────────────────────────

function RadioGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            value === opt.value
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Section accordion ─────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-right"
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

// ── Section 1: פרטים אישיים ───────────────────────────────────────────────────

const GENDER_OPTIONS = [
  { value: 'male',   label: 'זכר' },
  { value: 'female', label: 'נקבה' },
];

function PersonalSection({ form, set }) {
  return (
    <Section title="פרטים אישיים" defaultOpen>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>גיל</label>
          <input
            type="number"
            className={inputCls}
            value={form.age ?? ''}
            onChange={(e) => set('age', e.target.value !== '' ? Number(e.target.value) : null)}
            min={1} max={120} dir="ltr"
          />
        </div>
        <div>
          <label className={labelCls}>משקל (ק"ג)</label>
          <input
            type="number"
            className={inputCls}
            value={form.weight ?? ''}
            onChange={(e) => set('weight', e.target.value !== '' ? Number(e.target.value) : null)}
            min={20} max={300} step={0.1} dir="ltr"
            placeholder="משקל נוכחי בעת הפגישה"
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>מגדר</label>
        <RadioGroup options={GENDER_OPTIONS} value={form.gender} onChange={(v) => set('gender', v)} />
      </div>

      <div>
        <label className={labelCls}>גובה (ס"מ)</label>
        <input
          type="number"
          className={inputCls}
          value={form.height ?? ''}
          onChange={(e) => set('height', e.target.value ? Number(e.target.value) : null)}
          min={100} max={250} dir="ltr"
        />
      </div>

      <div>
        <label className={labelCls}>מטרה</label>
        <RadioGroup options={GOAL_OPTIONS} value={form.goal} onChange={(v) => set('goal', v)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>מצב משפחתי</label>
          <select className={inputCls} value={form.marital_status ?? ''} onChange={(e) => set('marital_status', e.target.value || null)}>
            <option value="">בחירה...</option>
            {['רווק', 'נשוי', 'גרוש', 'אלמן'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>מספר ילדים</label>
          <input type="number" className={inputCls} value={form.num_children ?? ''} onChange={(e) => set('num_children', e.target.value !== '' ? Number(e.target.value) : null)} min={0} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>עיסוק</label>
          <input type="text" className={inputCls} value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || null)} />
        </div>
        <div>
          <label className={labelCls}>שעות עבודה</label>
          <input type="text" placeholder="למשל: 9-18" className={inputCls} value={form.work_hours ?? ''} onChange={(e) => set('work_hours', e.target.value || null)} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>סוג עבודה</label>
          <select className={inputCls} value={form.work_type ?? ''} onChange={(e) => set('work_type', e.target.value || null)}>
            <option value="">בחירה...</option>
            <option value="sitting">ישיבה</option>
            <option value="standing">עמידה</option>
            <option value="mixed">משולב</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>אכילה בעבודה</label>
        <select className={inputCls} value={form.eating_at_work ?? ''} onChange={(e) => set('eating_at_work', e.target.value || null)}>
          <option value="">בחירה...</option>
          <option value="yes">כן</option>
          <option value="no">לא</option>
          <option value="sometimes">לפעמים</option>
        </select>
      </div>
    </Section>
  );
}

// ── Calculated section ────────────────────────────────────────────────────────

function bmiBadge(bmi) {
  if (bmi < 18.5) return { label: 'תת משקל',       cls: 'bg-blue-100 text-blue-700' };
  if (bmi < 25)   return { label: 'תקין',           cls: 'bg-green-100 text-green-700' };
  if (bmi < 30)   return { label: 'עודף משקל',      cls: 'bg-yellow-100 text-yellow-700' };
  if (bmi < 35)   return { label: 'השמנה דרגה 1',   cls: 'bg-orange-100 text-orange-700' };
  if (bmi < 40)   return { label: 'השמנה דרגה 2',   cls: 'bg-orange-200 text-orange-800' };
  return           { label: 'השמנה דרגה 3',         cls: 'bg-red-100 text-red-700' };
}

function CalculatedSection({ form, set, calc }) {
  const dash = '—';

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">נתונים קליניים מחושבים</span>
        <span className="mr-2 text-xs text-gray-400">(מתעדכן אוטומטית)</span>
      </div>
      <div className="p-4 space-y-4 bg-gray-50/50">

        {/* Row 1 — BMI */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-600 w-36 flex-shrink-0">BMI</span>
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm font-semibold text-gray-800">
              {calc?.bmi != null ? calc.bmi.toFixed(1) : dash}
            </span>
            {calc?.bmi != null && (() => {
              const { label, cls } = bmiBadge(calc.bmi);
              return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
            })()}
          </div>
        </div>

        {/* Row 2 — Adjusted weight (only when needed) */}
        {calc?.needsAdjustment && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-800">משקל מתוקנן לחישוב</span>
              <span className="text-sm font-semibold text-amber-900">{calc.adjustedWeight.toFixed(1)} ק"ג</span>
            </div>
            <p className="text-xs text-amber-700">BMI מעל 31.25 — משקל מתוקנן לפי פרוטוקול קליני</p>
            <p className="text-xs text-amber-600">משקל אידיאלי (BMI 25): {calc.idealWeight.toFixed(1)} ק"ג</p>
          </div>
        )}

        {/* Row 3 — Activity factor (editable) */}
        <div className="flex items-start gap-3">
          <label className="text-sm font-medium text-gray-600 w-36 flex-shrink-0 mt-2">רמת פעילות גופנית</label>
          <select
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            value={form.activity_factor ?? ''}
            onChange={(e) => set('activity_factor', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">בחירה...</option>
            {ACTIVITY_FACTORS.map((af) => (
              <option key={af.value} value={af.value}>{af.label}</option>
            ))}
          </select>
        </div>

        {/* Row 4 — TDEE */}
        <div className="rounded-lg bg-white border border-gray-200 p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">הוצאה קלורית יומית מחושבת</p>
          <p className="text-2xl font-bold" style={{ color: '#567DBF' }}>
            {calc?.tdee != null ? `${Math.round(calc.tdee).toLocaleString()} קק"ל` : dash}
          </p>
          <p className="text-xs text-gray-400">
            {`BMR ממוצע: ${calc?.bmrAverage != null ? Math.round(calc.bmrAverage) : dash} קק"ל`}
            {' | '}
            {`מיפלין: ${calc?.bmrMifflin != null ? Math.round(calc.bmrMifflin) : dash}`}
            {' | '}
            {`האריס: ${calc?.bmrHarris != null ? Math.round(calc.bmrHarris) : dash}`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Section 2: היסטוריה רפואית ────────────────────────────────────────────────

function MedicalSection({ form, set }) {
  const conditions = form.medical_conditions ?? {};
  function setCondition(name, value) { set('medical_conditions', { ...conditions, [name]: value }); }
  const meds = form.medications ?? [];
  function setMed(i, value) { const next = [...meds]; next[i] = value; set('medications', next); }
  function addMed() { if (meds.length < 8) set('medications', [...meds, '']); }
  function removeMed(i) { set('medications', meds.filter((_, idx) => idx !== i)); }

  return (
    <Section title="היסטוריה רפואית">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מצבים רפואיים</p>
        {MEDICAL_CONDITIONS.map((cond) => {
          const row = conditions[cond] ?? { active: false, since: '' };
          return (
            <div key={cond} className="flex flex-wrap items-center gap-3 py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700 flex-1 min-w-[120px]">{cond}</span>
              <Toggle value={row.active} onChange={(v) => setCondition(cond, { ...row, active: v })} />
              {row.active && (
                <input type="text" placeholder="מתי אובחן?" className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 w-32" value={row.since ?? ''} onChange={(e) => setCondition(cond, { ...row, since: e.target.value })} />
              )}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תרופות</p>
        {meds.map((med, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" className={inputCls} value={med} onChange={(e) => setMed(i, e.target.value)} placeholder={`תרופה ${i + 1}`} />
            <button type="button" onClick={() => removeMed(i)} className="px-2 py-1 text-red-400 hover:text-red-600 text-sm" aria-label="הסר תרופה">✕</button>
          </div>
        ))}
        {meds.length < 8 && (
          <button type="button" onClick={addMed} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ הוסף תרופה</button>
        )}
      </div>
    </Section>
  );
}

// ── Section 3: בדיקות דם ─────────────────────────────────────────────────────

function LabSection({ leadId, form, set }) {
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const result = await uploadLeadLabPdf(leadId, file);
      set('lab_results_pdf_path', result.path);
      setUploadMsg('הקובץ הועלה בהצלחה');
    } catch (err) {
      setUploadMsg(err.message || 'שגיאה בהעלאה');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Section title="בדיקות דם">
      {form.lab_results_pdf_path && (
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm text-green-700 flex-1">קובץ קיים: {form.lab_results_pdf_path}</span>
        </div>
      )}
      <div>
        <label className={labelCls}>{form.lab_results_pdf_path ? 'החלף קובץ PDF' : 'העלאת PDF בדיקות דם'}</label>
        <input ref={fileRef} type="file" accept=".pdf" onChange={handleFileChange} disabled={uploading}
          className="block text-sm text-gray-600 file:mr-0 file:ml-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer disabled:opacity-50" dir="ltr" />
        {uploading && <p className="text-xs text-gray-400 mt-1">מעלה...</p>}
        {uploadMsg && <p className={`text-xs mt-1 ${uploadMsg.includes('שגיאה') ? 'text-red-500' : 'text-green-600'}`}>{uploadMsg}</p>}
        <p className="text-xs text-gray-400 mt-1">PDF בלבד, עד 10MB</p>
      </div>
    </Section>
  );
}

// ── Section 4: היסטוריה תזונתית ──────────────────────────────────────────────

function NutritionHistorySection({ form, set }) {
  return (
    <Section title="היסטוריה תזונתית">
      <div>
        <label className={labelCls}>טיפול תזונתי קודם</label>
        <Toggle value={form.prev_treatment} onChange={(v) => set('prev_treatment', v)} />
      </div>
      {form.prev_treatment && (
        <>
          <div>
            <label className={labelCls}>מטרת הטיפול הקודם</label>
            <textarea className={inputCls} rows={2} value={form.prev_treatment_goal ?? ''} onChange={(e) => set('prev_treatment_goal', e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>מה הצליח?</label>
            <textarea className={inputCls} rows={2} value={form.prev_success ?? ''} onChange={(e) => set('prev_success', e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>מה לא הצליח?</label>
            <textarea className={inputCls} rows={2} value={form.prev_challenges ?? ''} onChange={(e) => set('prev_challenges', e.target.value || null)} />
          </div>
        </>
      )}
      <div>
        <label className={labelCls}>מה הסיבה להגיע לטיפול?</label>
        <textarea className={inputCls} rows={3} value={form.reason_for_treatment ?? ''} onChange={(e) => set('reason_for_treatment', e.target.value || null)} />
      </div>
    </Section>
  );
}

// ── Nutrition Anamnesis Table ─────────────────────────────────────────────────

const ANAMNESIS_MEALS = [
  { key: 'morning',     label: 'בוקר' },
  { key: 'mid_morning', label: 'ביניים' },
  { key: 'lunch',       label: 'צהריים' },
  { key: 'afternoon',   label: 'ביניים' },
  { key: 'evening',     label: 'ערב' },
  { key: 'night',       label: 'לילה' },
];

const ANAMNESIS_DAYS = [
  { key: 'weekday',  label: 'יום רגיל' },
  { key: 'friday',   label: 'שישי' },
  { key: 'saturday', label: 'שבת' },
];

function NutritionAnamnesisTable({ form, set }) {
  const anamnesis = form.nutrition_anamnesis ?? {};

  function setCell(day, meal, value) {
    set('nutrition_anamnesis', {
      ...anamnesis,
      [day]: { ...(anamnesis[day] ?? {}), [meal]: value || null },
    });
  }

  return (
    <div>
      <p className={labelCls}>אנמנזה תזונתית</p>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 bg-gray-50 w-20">זמן ביום</th>
              {ANAMNESIS_DAYS.map(({ key, label }) => (
                <th key={key} className="text-center px-2 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 bg-gray-50">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ANAMNESIS_MEALS.map(({ key: mealKey, label: mealLabel }) => (
              <tr key={mealKey}>
                <td className="px-2 py-1 text-xs text-gray-600 font-medium border border-gray-200 bg-gray-50 align-middle">{mealLabel}</td>
                {ANAMNESIS_DAYS.map(({ key: dayKey }) => (
                  <td key={dayKey} className="border border-gray-200 p-1 align-top">
                    <textarea
                      rows={2}
                      className="w-full text-xs border-0 focus:outline-none resize-none p-1 bg-transparent"
                      value={anamnesis[dayKey]?.[mealKey] ?? ''}
                      onChange={(e) => setCell(dayKey, mealKey, e.target.value)}
                      placeholder="..."
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile: stacked cards per day */}
      <div className="sm:hidden space-y-4">
        {ANAMNESIS_DAYS.map(({ key: dayKey, label: dayLabel }) => (
          <div key={dayKey} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 border-b border-gray-200">{dayLabel}</div>
            <div className="divide-y divide-gray-100">
              {ANAMNESIS_MEALS.map(({ key: mealKey, label: mealLabel }) => (
                <div key={mealKey} className="px-3 py-2">
                  <label className="block text-xs text-gray-500 mb-1">{mealLabel}</label>
                  <textarea
                    rows={2}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                    value={anamnesis[dayKey]?.[mealKey] ?? ''}
                    onChange={(e) => setCell(dayKey, mealKey, e.target.value)}
                    placeholder="..."
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section 5: הרגלי אכילה ───────────────────────────────────────────────────

const DIET_TYPES = [
  { value: 'omnivore',    label: 'אוכל הכל' },
  { value: 'vegetarian',  label: 'צמחוני' },
  { value: 'vegan',       label: 'טבעוני' },
  { value: 'gluten_free', label: 'ללא גלוטן' },
  { value: 'keto',        label: 'קטוגני' },
  { value: 'other',       label: 'אחר' },
];

function EatingSection({ form, set }) {
  const patterns = form.eating_patterns ?? {};
  function setPattern(name, freq) { set('eating_patterns', { ...patterns, [name]: freq }); }

  return (
    <Section title="הרגלי אכילה">
      <div>
        <label className={labelCls}>סוג תזונה</label>
        <div className="flex flex-wrap gap-2">
          {DIET_TYPES.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => set('diet_type', value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.diet_type === value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={labelCls}>דפוסי אכילה</p>
        <div className="space-y-2">
          {EATING_PATTERNS.map((pattern) => (
            <div key={pattern} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-700 w-48 flex-shrink-0">{pattern}</span>
              <div className="flex gap-1 flex-wrap">
                {FREQUENCY_OPTIONS.map((freq) => (
                  <button key={freq} type="button" onClick={() => setPattern(pattern, freq)}
                    className={`px-2 py-1 rounded-full text-xs border transition-colors ${patterns[pattern] === freq ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    {freq}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <NutritionAnamnesisTable form={form} set={set} />
    </Section>
  );
}

// ── Section 6: אורח חיים ─────────────────────────────────────────────────────

function LifestyleSection({ form, set }) {
  return (
    <Section title="אורח חיים">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>כמה מים ביום?</label>
          <input type="text" className={inputCls} value={form.water_intake ?? ''} onChange={(e) => set('water_intake', e.target.value || null)} placeholder="למשל: 2 ליטר" />
        </div>
        <div>
          <label className={labelCls}>כוסות קפה ביום</label>
          <input type="text" className={inputCls} value={form.coffee_per_day ?? ''} onChange={(e) => set('coffee_per_day', e.target.value || null)} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>אלכוהול בשבוע</label>
          <input type="text" className={inputCls} value={form.alcohol_per_week ?? ''} onChange={(e) => set('alcohol_per_week', e.target.value || null)} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>שעות שינה</label>
          <input type="text" className={inputCls} value={form.sleep_hours ?? ''} onChange={(e) => set('sleep_hours', e.target.value || null)} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>איכות שינה</label>
          <select className={inputCls} value={form.sleep_quality ?? ''} onChange={(e) => set('sleep_quality', e.target.value || null)}>
            <option value="">בחירה...</option>
            <option value="good">טובה</option>
            <option value="average">בינונית</option>
            <option value="poor">לא טובה</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>פעילות גופנית</label>
        <Toggle value={form.physical_activity} onChange={(v) => set('physical_activity', v)} />
      </div>
      {form.physical_activity && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>סוג פעילות</label>
            <input type="text" className={inputCls} value={form.activity_type ?? ''} onChange={(e) => set('activity_type', e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>כמה פעמים בשבוע?</label>
            <input type="text" className={inputCls} value={form.activity_frequency ?? ''} onChange={(e) => set('activity_frequency', e.target.value || null)} dir="ltr" />
          </div>
        </div>
      )}
      <div>
        <label className={labelCls}>חטיפים אהובים</label>
        <textarea className={inputCls} rows={2} value={form.favorite_snacks ?? ''} onChange={(e) => set('favorite_snacks', e.target.value || null)} />
      </div>
      <div>
        <label className={labelCls}>מאכלים אהובים</label>
        <textarea className={inputCls} rows={2} value={form.favorite_foods ?? ''} onChange={(e) => set('favorite_foods', e.target.value || null)} />
      </div>
    </Section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  age: null, gender: null, weight: null, goal: null, activity_factor: null,
  height: null, marital_status: null, num_children: null, occupation: null,
  work_hours: null, work_type: null, eating_at_work: null,
  medical_conditions: {}, medications: [],
  lab_results_pdf_path: null,
  prev_treatment: false, prev_treatment_goal: null, prev_success: null,
  prev_challenges: null, reason_for_treatment: null,
  diet_type: null, eating_patterns: {},
  water_intake: null, coffee_per_day: null, alcohol_per_week: null,
  sleep_hours: null, sleep_quality: null,
  physical_activity: false, activity_type: null, activity_frequency: null,
  favorite_snacks: null, favorite_foods: null,
  nutrition_anamnesis: null,
};

export default function LeadIntakeForm({ leadId }) {
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [calc, setCalc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const debounceRef = useRef(null);
  const calcRef = useRef(null);
  const intakeExistsRef = useRef(false);

  const { data: intake, isLoading } = useQuery({
    queryKey: ['lead-intake', leadId],
    queryFn: () => fetchLeadIntake(leadId),
  });

  // Populate form when intake data arrives (never touch open state)
  useEffect(() => {
    if (intake === undefined) return;
    if (intake) {
      setForm({ ...EMPTY_FORM, ...intake });
      intakeExistsRef.current = true;
    }
  }, [intake]);

  // Real-time clinical calculations
  useEffect(() => {
    const { age, gender, height, weight, activity_factor } = form;

    if (!weight || !height) {
      setCalc(null);
      calcRef.current = null;
      return;
    }

    const bmi = calculateBMI(weight, height);
    const { needsAdjustment, adjustedWeight, idealWeight } = calculateAdjustedWeight(weight, height);
    const weightForCalc = needsAdjustment ? adjustedWeight : weight;

    let bmrMifflin = null;
    let bmrHarris  = null;
    let bmrAverage = null;

    if (age && gender) {
      const bmr = calculateBMR(gender, weightForCalc, height, age);
      bmrMifflin = bmr.mifflin;
      bmrHarris  = bmr.harris;
      bmrAverage = bmr.average;
    }

    const tdee = bmrAverage != null && activity_factor
      ? calculateTDEE(bmrAverage, activity_factor)
      : null;

    const result = {
      bmi,
      needsAdjustment,
      adjustedWeight: needsAdjustment ? adjustedWeight : null,
      idealWeight,
      bmrMifflin,
      bmrHarris,
      bmrAverage,
      tdee,
    };

    setCalc(result);
    calcRef.current = result;
  }, [form.age, form.gender, form.height, form.weight, form.activity_factor]);

  // For display badge only — does not drive save logic
  const intakeIsSaved = !!intake;

  const set = useCallback((field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      clearTimeout(debounceRef.current);
      // Use ref so closure is never stale
      debounceRef.current = setTimeout(() => doSave(next, intakeExistsRef.current), 1000);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSave(data, exists) {
    setSaveError('');
    setSaving(true);
    const c = calcRef.current;
    const payload = {
      ...data,
      bmr_mifflin:     c?.bmrMifflin     ?? null,
      bmr_harris:      c?.bmrHarris      ?? null,
      bmr_average:     c?.bmrAverage     ?? null,
      adjusted_weight: c?.adjustedWeight ?? null,
      tdee:            c?.tdee           ?? null,
    };
    try {
      if (exists) {
        await updateLeadIntake(leadId, payload);
      } else {
        await createLeadIntake(leadId, payload);
        // Signal LeadDetail to start polling for AI assessment
        window.dispatchEvent(new Event(`intake-saved-lead-${leadId}`));
      }
      // Mark as existing so next auto-save uses PUT — do NOT invalidate parent queries
      intakeExistsRef.current = true;
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1000);
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function handleManualSave() {
    clearTimeout(debounceRef.current);
    await doSave(form, intakeExistsRef.current);
  }

  if (isLoading) return null;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2 text-right"
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          טופס פגישת היכרות — אנמנזה
        </span>
        <div className="flex items-center gap-2">
          {intakeIsSaved && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">מולא</span>
          )}
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-3 mt-3" dir="rtl">
          <PersonalSection          form={form} set={set} />
          <CalculatedSection        form={form} set={set} calc={calc} />
          <MedicalSection           form={form} set={set} />
          <LabSection               leadId={leadId} form={form} set={set} />
          <NutritionHistorySection  form={form} set={set} />
          <EatingSection            form={form} set={set} />
          <LifestyleSection         form={form} set={set} />

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleManualSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'שומר...' : 'שמור'}
              </button>
              {showSaved && !saving && (
                <span className="text-xs text-green-600">נשמר</span>
              )}
              {saveError && <span className="text-xs text-red-500">{saveError}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
