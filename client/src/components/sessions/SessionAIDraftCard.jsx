import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSessionAnalysis, runSessionAnalysis, saveSessionAnalysis, importSessionAnalysis,
  discardSessionAnalysis, fetchSessionRecordings, setRecordingSpeakers,
} from '../../lib/api';
import {
  ANALYSIS_TITLE, MEAL_LABEL, SLOT_LABEL, BARRIER_LABEL, ANAMNESIS_LABEL, QUOTE_STATUS, IMPORT_TARGETS, INTAKE_FIELD_LABEL,
} from '../../constants/session-analysis';

// ─── Small building blocks (dark theme tokens, RTL) ───────────────────────────

const box = { border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface-1)', padding: 12 };
const input = {
  width: '100%', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)',
  color: 'var(--ink-1)', padding: '6px 8px', fontSize: 13, fontFamily: 'inherit',
};
const btn = (variant) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 13,
  cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-1)',
  ...(variant === 'primary' ? { background: 'var(--blue)', color: 'var(--on-accent)', borderColor: 'var(--blue)' } : {}),
  ...(variant === 'ghost' ? { background: 'none', borderColor: 'transparent', color: 'var(--ink-3)', padding: '4px 6px' } : {}),
});
const muted = { fontSize: 12, color: 'var(--ink-3)', margin: 0 };

function Section({ title, children, defaultOpen = true, count }) {
  return (
    <details open={defaultOpen} style={box}>
      <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
        {title}{count !== undefined && <span style={{ ...muted, display: 'inline', marginInlineStart: 6 }}>({count})</span>}
      </summary>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </details>
  );
}

/** One item per line ↔ string[] */
function LinesField({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea dir="rtl" rows={rows} style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} placeholder={placeholder}
      value={(value || []).join('\n')} onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trimStart()).filter((l, i, a) => l || i < a.length - 1))} />
  );
}
const cleanLines = (arr) => (arr || []).map((l) => l.trim()).filter(Boolean);

/** Drop empty lines left while typing before the draft goes to the server. */
function cleanDraft(d) {
  const p = d.meal_plan;
  return {
    ...d,
    meal_plan: {
      ...p,
      meals: p.meals.map((m) => ({ ...m, slots: m.slots.map((s) => ({ ...s, options: s.options.filter((o) => `${o.amount} ${o.food}`.trim()) })) })),
      daily_basket: { ...p.daily_basket, suggested_items: cleanLines(p.daily_basket.suggested_items) },
      friday: { guidelines: cleanLines(p.friday.guidelines) },
      saturday: { guidelines: cleanLines(p.saturday.guidelines) },
      general_notes: cleanLines(p.general_notes),
    },
    habits: d.habits.filter((h) => h.habit.trim()),
    barriers: d.barriers.filter((b) => b.description.trim()),
    open_questions: cleanLines(d.open_questions),
  };
}

function QuoteBadge({ status, quote }) {
  const meta = QUOTE_STATUS[status];
  if (!quote && !meta) return null;
  return (
    <p style={{ ...muted, fontSize: 11.5 }}>
      {quote && <span>"{quote}"</span>}
      {meta && <span style={{ color: meta.tone, marginInlineStart: 6 }}>· {meta.label}</span>}
    </p>
  );
}

// ─── Editors ──────────────────────────────────────────────────────────────────

function AnamnesisEditor({ value, onChange }) {
  const setList = (key, list) => onChange({ ...value, [key]: list });
  return (
    <>
      <textarea dir="rtl" rows={4} style={{ ...input, lineHeight: 1.6 }} value={value.summary}
        onChange={(e) => onChange({ ...value, summary: e.target.value })} />
      {Object.entries(ANAMNESIS_LABEL).map(([key, label]) => (value[key]?.length ? (
        <div key={key}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', margin: '4px 0' }}>{label}</p>
          {value[key].map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <input dir="rtl" style={input} value={f.fact}
                  onChange={(e) => setList(key, value[key].map((x, j) => (j === i ? { ...x, fact: e.target.value } : x)))} />
                <QuoteBadge status={f.quote_status} quote={f.quote} />
              </div>
              <button type="button" style={btn('ghost')} aria-label="הסרה" onClick={() => setList(key, value[key].filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      ) : null))}
    </>
  );
}

function BarriersEditor({ value, onChange }) {
  return (
    <>
      {value.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <select style={{ ...input, width: 150, flexShrink: 0 }} value={b.type}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
            {Object.entries(BARRIER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div style={{ flex: 1 }}>
            <input dir="rtl" style={input} value={b.description}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <QuoteBadge status={b.quote_status} quote={b.quote} />
          </div>
          <button type="button" style={btn('ghost')} aria-label="הסרה" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" style={{ ...btn('ghost'), alignSelf: 'flex-start', color: 'var(--blue)' }}
        onClick={() => onChange([...value, { type: 'other', description: '', quote: '' }])}>+ הוספת חסם</button>
    </>
  );
}

const optionLine = (o) => [o.amount, o.food].filter(Boolean).join(' ').trim();

function MealPlanEditor({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setMeal = (i, patch) => set({ meals: value.meals.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const setSlot = (mi, si, patch) => setMeal(mi, { slots: value.meals[mi].slots.map((s, j) => (j === si ? { ...s, ...patch } : s)) });
  const b = value.daily_basket;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={muted}>יעד קלורי משוער</label>
        <input type="number" dir="ltr" style={{ ...input, width: 90 }} value={value.calorie_target_estimate}
          onChange={(e) => set({ calorie_target_estimate: Number(e.target.value) })} />
        <span style={{ ...muted, flex: 1 }}>{value.calorie_rationale}</span>
      </div>

      {value.meals.map((meal, mi) => (
        <div key={mi} style={{ ...box, background: 'var(--surface-2)', padding: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 13, color: 'var(--ink-1)' }}>{MEAL_LABEL[meal.meal] || meal.meal}</strong>
            <input dir="rtl" placeholder="שעה" style={{ ...input, width: 110 }} value={meal.time_hint}
              onChange={(e) => setMeal(mi, { time_hint: e.target.value })} />
          </div>
          {meal.slots.map((slot, si) => {
            const outside = slot.options.filter((o) => o.in_kb === false).map((o) => o.food);
            return (
              <div key={si} style={{ display: 'grid', gridTemplateColumns: '80px 64px 1fr', gap: 6, alignItems: 'start', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)', paddingTop: 6 }}>{SLOT_LABEL[slot.slot] || slot.slot}</span>
                <input type="number" step="0.5" dir="ltr" aria-label="מנות" style={input} value={slot.portions}
                  onChange={(e) => setSlot(mi, si, { portions: Number(e.target.value) })} />
                <div>
                  <LinesField rows={Math.max(2, slot.options.length)} value={slot.options.map(optionLine)}
                    onChange={(lines) => setSlot(mi, si, { options: lines.map((l) => ({ amount: '', food: l })) })} />
                  {outside.length > 0 && <p style={{ ...muted, color: 'var(--amber-ink)', fontSize: 11.5 }}>מחוץ למאגר: {outside.join(', ')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ ...box, background: 'var(--surface-2)', padding: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, color: 'var(--ink-1)' }}>סל יומי</strong>
          <select style={{ ...input, width: 90 }} value={b.options_per_day}
            onChange={(e) => set({ daily_basket: { ...b, options_per_day: Number(e.target.value) } })}>
            <option value={2}>2 אופציות</option>
            <option value={3}>3 אופציות</option>
          </select>
          <input type="number" dir="ltr" style={{ ...input, width: 70 }} value={b.kcal_per_option}
            onChange={(e) => set({ daily_basket: { ...b, kcal_per_option: Number(e.target.value) } })} />
          <span style={muted}>קק"ל לאופציה (100-120)</span>
        </div>
        <LinesField rows={3} value={b.suggested_items} onChange={(items) => set({ daily_basket: { ...b, suggested_items: items } })} />
      </div>

      {[['friday', 'יום שישי'], ['saturday', 'יום שבת']].map(([key, label]) => (
        <div key={key}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', margin: '2px 0 4px' }}>{label}</p>
          <LinesField rows={3} value={value[key].guidelines} onChange={(g) => set({ [key]: { guidelines: g } })} />
        </div>
      ))}
      <div>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', margin: '2px 0 4px' }}>דגשים כלליים</p>
        <LinesField rows={2} value={value.general_notes} onChange={(n) => set({ general_notes: n })} />
      </div>
    </>
  );
}

function HabitsEditor({ value, onChange }) {
  return (
    <>
      {value.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input dir="rtl" placeholder="הרגל" style={input} value={h.habit}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, habit: e.target.value } : x)))} />
            <input dir="rtl" placeholder="יעד מדיד" style={input} value={h.target}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
          </div>
          <button type="button" style={btn('ghost')} aria-label="הסרה" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {value.length < 4 && (
        <button type="button" style={{ ...btn('ghost'), alignSelf: 'flex-start', color: 'var(--blue)' }}
          onClick={() => onChange([...value, { habit: '', target: '', quote: '' }])}>+ הוספת הרגל</button>
      )}
    </>
  );
}

// ─── Speaker roles per transcribed recording ──────────────────────────────────

function SpeakerRoles({ sessionId }) {
  const queryClient = useQueryClient();
  const { data: recordings = [] } = useQuery({ queryKey: ['recordings', String(sessionId)], queryFn: () => fetchSessionRecordings(sessionId) });
  const swap = useMutation({
    mutationFn: ({ id, dietitian }) => setRecordingSpeakers(sessionId, id, dietitian),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings', String(sessionId)] }),
  });
  const done = recordings.filter((r) => r.transcript_status === 'done');
  if (!done.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {done.map((r) => (
        <p key={r.id} style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{r.file_name}: הדיאטן הוא <strong style={{ color: 'var(--ink-1)' }}>{r.dietitian_speaker}</strong></span>
          <button type="button" style={btn('ghost')} disabled={swap.isPending}
            onClick={() => swap.mutate({ id: r.id, dietitian: r.dietitian_speaker === 'דובר 1' ? 'דובר 2' : 'דובר 1' })}>
            ⇄ החלפת תפקידים
          </button>
        </p>
      ))}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function SessionAIDraftCard({ sessionId, clientId }) {
  const queryClient = useQueryClient();
  const key = ['session-analysis', String(sessionId)];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchSessionAnalysis(sessionId),
    refetchInterval: (q) => (q.state.data?.analysis?.status === 'running' ? 3000 : false),
  });
  const row = data?.analysis;
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [importInfo, setImportInfo] = useState(null);
  const [confirmRerun, setConfirmRerun] = useState(false);

  // take the server copy whenever it changes (new run / saved)
  const serverJson = row?.analysis ? JSON.stringify(row.analysis) : null;
  useEffect(() => { setDraft(row?.analysis ? JSON.parse(serverJson) : null); }, [serverJson]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && JSON.stringify(draft) !== serverJson;

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onErr = (err) => setError(err.message || 'שגיאה');

  const run = useMutation({
    mutationFn: (force) => runSessionAnalysis(sessionId, { force }),
    onSuccess: () => { setError(''); setConfirmRerun(false); setImportInfo(null); refresh(); },
    onError: onErr,
  });
  const save = useMutation({ mutationFn: () => saveSessionAnalysis(sessionId, cleanDraft(draft)), onSuccess: () => { setError(''); refresh(); }, onError: onErr });
  const discard = useMutation({ mutationFn: () => discardSessionAnalysis(sessionId), onSuccess: refresh, onError: onErr });
  const doImport = useMutation({
    mutationFn: async (targets) => {
      if (dirty) await saveSessionAnalysis(sessionId, cleanDraft(draft)); // import exactly what is on screen
      return importSessionAnalysis(sessionId, targets);
    },
    onSuccess: (res) => {
      setError('');
      setImportInfo(res.results);
      refresh();
      for (const k of ['sessions', 'menus', 'client']) queryClient.invalidateQueries({ queryKey: [k] });
    },
    onError: onErr,
  });

  const status = row?.status;
  const imported = row?.imported || {};
  const anyImported = !!(imported.notes || imported.intake || imported.menu);

  return (
    <section dir="rtl" style={{ ...box, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{ANALYSIS_TITLE}</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {status !== 'running' && data?.can_analyze && !confirmRerun && (
            <button type="button" style={btn(row ? undefined : 'primary')} disabled={run.isPending}
              onClick={() => (anyImported ? setConfirmRerun(true) : run.mutate(false))}>
              {row ? 'ניתוח מחדש' : 'נתח פגישה'}
            </button>
          )}
          {confirmRerun && (
            <span style={{ ...muted, color: 'var(--amber-ink)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              הטיוטה כבר יובאה. ניתוח חדש יחליף אותה (מה שיובא נשאר).
              <button type="button" style={btn()} onClick={() => run.mutate(true)}>להמשיך</button>
              <button type="button" style={btn('ghost')} onClick={() => setConfirmRerun(false)}>ביטול</button>
            </span>
          )}
          {row && status !== 'running' && (
            <button type="button" style={btn('ghost')} disabled={discard.isPending} onClick={() => discard.mutate()}>מחיקת הטיוטה</button>
          )}
        </div>
      </div>

      {isLoading && <p style={muted}>טוען...</p>}
      {!isLoading && !data?.can_analyze && !row && (
        <p style={muted}>אין עדיין תמלול לפגישה. אחרי הקלטה או העלאה והתמלול, אפשר לנתח את הפגישה.</p>
      )}
      {data?.can_analyze && <SpeakerRoles sessionId={sessionId} />}

      {status === 'running' && (
        <p style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="animate-pulse motion-reduce:animate-none" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />
          מנתח את הפגישה. זה יכול לקחת עד כשתי דקות.
        </p>
      )}
      {status === 'failed' && <p style={{ ...muted, color: 'var(--red-ink)' }}>הניתוח נכשל: {row.error}</p>}

      {status === 'draft' && draft && (
        <>
          {row.warnings?.length > 0 && (
            <ul style={{ margin: 0, padding: '8px 12px', listStyle: 'none', borderRadius: 'var(--r-md)', background: 'var(--amber-soft)', color: 'var(--amber-ink)', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {row.warnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          )}

          <Section title="אנמנזה וסיכום">
            <AnamnesisEditor value={draft.anamnesis} onChange={(anamnesis) => setDraft({ ...draft, anamnesis })} />
          </Section>
          <Section title="חסמים" count={draft.barriers.length}>
            <BarriersEditor value={draft.barriers} onChange={(barriers) => setDraft({ ...draft, barriers })} />
          </Section>
          <Section title="טיוטת תפריט">
            <MealPlanEditor value={draft.meal_plan} onChange={(meal_plan) => setDraft({ ...draft, meal_plan })} />
          </Section>
          <Section title="הרגלים שסוכמו" count={draft.habits.length}>
            <HabitsEditor value={draft.habits} onChange={(habits) => setDraft({ ...draft, habits })} />
          </Section>
          <Section title="לבירור בפגישה הבאה" defaultOpen={false} count={draft.open_questions.length}>
            <LinesField rows={3} value={draft.open_questions} onChange={(open_questions) => setDraft({ ...draft, open_questions })} />
          </Section>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
            {dirty && (
              <button type="button" style={btn('primary')} disabled={save.isPending}
                onClick={() => save.mutate()}>
                {save.isPending ? 'שומר...' : 'שמירת שינויים'}
              </button>
            )}
            {IMPORT_TARGETS.map((t) => (imported[t.key] ? (
              <span key={t.key} style={{ fontSize: 12.5, color: 'var(--green-ink)' }}>
                ✓ {t.done}
                {t.key === 'menu' && row.menu_id && (
                  <> · <Link to={`/clients/${clientId}/menus/${row.menu_id}`} style={{ color: 'var(--blue)' }}>פתיחת התפריט</Link></>
                )}
              </span>
            ) : (
              <button key={t.key} type="button" style={btn()} disabled={doImport.isPending} onClick={() => doImport.mutate([t.key])}>{t.label}</button>
            )))}
            {!anyImported && (
              <button type="button" style={btn('primary')} disabled={doImport.isPending} onClick={() => doImport.mutate(['notes', 'intake', 'menu'])}>
                ייבוא הכל
              </button>
            )}
          </div>

          {importInfo?.intake && (
            <div style={{ ...muted }}>
              {importInfo.intake.filled.length > 0
                ? `מולאו באנמנזה: ${importInfo.intake.filled.map((f) => INTAKE_FIELD_LABEL[f] || f).join(', ')}.`
                : 'לא היו שדות ריקים למילוי באנמנזה.'}
              {importInfo.intake.conflicts.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                  {importInfo.intake.conflicts.map((c) => (
                    <li key={c.field}>{INTAKE_FIELD_LABEL[c.field] || c.field}: נשאר הערך הקיים. הצעה מהפגישה: {c.suggested}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {error && <p style={{ ...muted, color: 'var(--red-ink)' }}>{error}</p>}
      <p style={{ ...muted, fontSize: 11.5, color: 'var(--ink-4)' }}>טיוטה לבדיקה בלבד. שום דבר לא נשלח למטופל.</p>
    </section>
  );
}
