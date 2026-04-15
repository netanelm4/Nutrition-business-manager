import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLeadIntake, createLeadIntake, updateLeadIntake, uploadLeadLabPdf } from '../../lib/api';
import {
  MEDICAL_CONDITIONS,
  EATING_PATTERNS,
  FREQUENCY_OPTIONS,
} from '../../constants/statuses';

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

function PersonalSection({ form, set }) {
  return (
    <Section title="פרטים אישיים" defaultOpen>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>גובה (ס״מ)</label>
          <input
            type="number"
            className={inputCls}
            value={form.height ?? ''}
            onChange={(e) => set('height', e.target.value ? Number(e.target.value) : null)}
            min={100} max={250} dir="ltr"
          />
        </div>
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
};

export default function LeadIntakeForm({ leadId }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [saveError, setSaveError] = useState('');
  const debounceRef = useRef(null);

  const { data: intake, isLoading } = useQuery({
    queryKey: ['lead-intake', leadId],
    queryFn: () => fetchLeadIntake(leadId),
    onSuccess: (data) => {
      if (data) {
        setForm({ ...EMPTY_FORM, ...data });
        setOpen(false);
      } else {
        setOpen(true);
      }
    },
  });

  const intakeExists = !!intake;

  const set = useCallback((field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSave(next, intakeExists), 1000);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeExists]);

  async function doSave(data, exists) {
    setSaveError('');
    setSaving(true);
    try {
      if (exists) {
        await updateLeadIntake(leadId, data);
      } else {
        await createLeadIntake(leadId, data);
      }
      queryClient.invalidateQueries({ queryKey: ['lead-intake', leadId] });
      const now = new Date();
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function handleManualSave() {
    clearTimeout(debounceRef.current);
    await doSave(form, intakeExists);
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
          {intakeExists && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">מולא</span>
          )}
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-3 mt-3" dir="rtl">
          <PersonalSection          form={form} set={set} />
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
              {savedAt && !saving && !saveError && (
                <span className="text-xs text-gray-400">נשמר לאחרונה: {savedAt}</span>
              )}
              {saveError && <span className="text-xs text-red-500">{saveError}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
