import { BARRIER_LABEL, ANAMNESIS_LABEL, QUOTE_STATUS, MEAL_LABEL, SLOT_LABEL } from '../../constants/session-analysis';

// Shared UI for the session analysis review (intake and follow-up views)

// ─── Small building blocks (dark theme tokens, RTL) ───────────────────────────

export const box = { border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface-1)', padding: 12 };
export const input = {
  width: '100%', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)',
  color: 'var(--ink-1)', padding: '6px 8px', fontSize: 13, fontFamily: 'inherit',
};
export const btn = (variant) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 13,
  cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-1)',
  ...(variant === 'primary' ? { background: 'var(--blue)', color: 'var(--on-accent)', borderColor: 'var(--blue)' } : {}),
  ...(variant === 'ghost' ? { background: 'none', borderColor: 'transparent', color: 'var(--ink-3)', padding: '4px 6px' } : {}),
});
export const muted = { fontSize: 12, color: 'var(--ink-3)', margin: 0 };

export function Section({ title, children, defaultOpen = true, count }) {
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
export function LinesField({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea dir="rtl" rows={rows} style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} placeholder={placeholder}
      value={(value || []).join('\n')} onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trimStart()).filter((l, i, a) => l || i < a.length - 1))} />
  );
}
export const cleanLines = (arr) => (arr || []).map((l) => l.trim()).filter(Boolean);

/** Drop empty lines left while typing before the draft goes to the server. */
export function cleanDraft(d) {
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

export function QuoteBadge({ status, quote }) {
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

export function AnamnesisEditor({ value, onChange }) {
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

export function BarriersEditor({ value, onChange }) {
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

export const optionLine = (o) => [o.amount, o.food].filter(Boolean).join(' ').trim();

export function MealPlanEditor({ value, onChange }) {
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

export function HabitsEditor({ value, onChange }) {
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

