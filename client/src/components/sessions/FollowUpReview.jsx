import { CHANGE_LABEL, HABIT_STATUS_LABEL } from '../../constants/session-analysis';
import {
  input, btn, muted, Section, LinesField, cleanLines, QuoteBadge, BarriersEditor, HabitsEditor,
} from './analysis-ui';

// Follow-up session review: progress, previous habits, barriers, menu changes
// (current vs proposed, approve each), new clinical info, next habits.

/** Drop empty rows before saving. */
export function cleanFollowUpDraft(d) {
  const keepText = (list) => list.filter((x) => (x.text || '').trim());
  return {
    ...d,
    what_worked: keepText(d.what_worked),
    difficulties: keepText(d.difficulties),
    client_requests: keepText(d.client_requests),
    new_clinical_info: keepText(d.new_clinical_info),
    barriers: d.barriers.filter((b) => b.description.trim()),
    habits: d.habits.filter((h) => h.habit.trim()),
    open_questions: cleanLines(d.open_questions),
  };
}

function QuotedList({ value, onChange, addLabel }) {
  return (
    <>
      {value.map((x, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input dir="rtl" style={input} value={x.text}
              onChange={(e) => onChange(value.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
            <QuoteBadge status={x.quote_status} quote={x.quote} />
          </div>
          <button type="button" style={btn('ghost')} aria-label="הסרה" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" style={{ ...btn('ghost'), alignSelf: 'flex-start', color: 'var(--blue)' }}
        onClick={() => onChange([...value, { text: '', quote: '' }])}>{addLabel}</button>
    </>
  );
}

function PreviousHabits({ value, onChange }) {
  if (!value.length) return <p style={muted}>אין הרגלים מהפגישה הקודמת.</p>;
  return value.map((h, i) => (
    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1)' }}>{h.habit}</p>
        <QuoteBadge status={h.quote_status} quote={h.quote} />
      </div>
      <select style={{ ...input, width: 130, flexShrink: 0 }} value={h.status}
        onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}>
        {Object.entries(HABIT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  ));
}

const TEXT_CHANGES = new Set(['swap_option', 'add_option', 'remove_option', 'add_item', 'basket_variety', 'weekend', 'other']);

function MenuChanges({ value, onChange, menuTitle }) {
  if (!value.length) return <p style={muted}>לא הוצעו שינויים בתפריט.</p>;
  const set = (i, patch) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <>
      {menuTitle && <p style={muted}>על בסיס התפריט: {menuTitle}. השינויים המסומנים ייכנסו לגרסה חדשה של התפריט; המקורי לא משתנה.</p>}
      {value.map((c, i) => (
        <div key={i} style={{
          border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 10,
          background: c.valid ? 'var(--surface-2)' : 'var(--surface-1)', opacity: c.valid ? 1 : 0.85,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.valid ? 'pointer' : 'not-allowed' }}>
            <input type="checkbox" checked={!!c.approved} disabled={!c.valid} onChange={(e) => set(i, { approved: e.target.checked })} />
            <strong style={{ fontSize: 13, color: 'var(--ink-1)' }}>{CHANGE_LABEL[c.change_type] || c.change_type}</strong>
            {c.problem && <span style={{ fontSize: 12, color: 'var(--amber-ink)' }}>{c.problem}</span>}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, marginTop: 8, alignItems: 'start' }}>
            {c.current && (
              <>
                <span style={{ ...muted, paddingTop: 2 }}>קיים</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)', textDecoration: 'line-through' }}>{c.current}</span>
              </>
            )}
            <span style={{ ...muted, paddingTop: 6, color: 'var(--green-ink)' }}>מוצע</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEXT_CHANGES.has(c.change_type) && (
                <textarea dir="rtl" rows={2} style={{ ...input, lineHeight: 1.6 }} value={c.proposed}
                  onChange={(e) => set(i, { proposed: e.target.value })} />
              )}
              {c.change_type === 'timing' && (
                <input dir="rtl" style={{ ...input, maxWidth: 260 }} value={c.proposed_time} onChange={(e) => set(i, { proposed_time: e.target.value })} />
              )}
              {['portion', 'add_item', 'basket_variety', 'swap_option', 'add_option', 'remove_option'].includes(c.change_type) && (
                <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.change_type === 'basket_variety' ? 'אופציות ביום' : 'מנות'}
                  <input type="number" step={c.change_type === 'basket_variety' ? 1 : 0.5} dir="ltr" style={{ ...input, width: 80 }}
                    value={c.proposed_portions || ''} placeholder="ללא שינוי"
                    onChange={(e) => set(i, { proposed_portions: Number(e.target.value) || 0 })} />
                </label>
              )}
            </div>
          </div>
          <p style={{ ...muted, marginTop: 6 }}>{c.reason}</p>
          {c.quote && <QuoteBadge quote={c.quote} />}
        </div>
      ))}
    </>
  );
}

export default function FollowUpReview({ draft, setDraft, menuTitle }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <>
      <Section title="סיכום הפגישה">
        <textarea dir="rtl" rows={3} style={{ ...input, lineHeight: 1.6 }} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        {draft.reported_weight_kg > 0 && <p style={muted}>משקל שדווח בפגישה: {draft.reported_weight_kg} ק"ג (יירשם לפגישה אם לא הוזן משקל).</p>}
      </Section>
      <Section title="מה עבד" count={draft.what_worked.length}>
        <QuotedList value={draft.what_worked} onChange={(v) => set({ what_worked: v })} addLabel="+ הוספה" />
      </Section>
      <Section title="נקודות קושי" count={draft.difficulties.length}>
        <QuotedList value={draft.difficulties} onChange={(v) => set({ difficulties: v })} addLabel="+ הוספה" />
      </Section>
      <Section title="בקשות המטופל" count={draft.client_requests.length}>
        <QuotedList value={draft.client_requests} onChange={(v) => set({ client_requests: v })} addLabel="+ הוספה" />
      </Section>
      <Section title="הרגלים מהפגישה הקודמת" count={draft.previous_habits.length}>
        <PreviousHabits value={draft.previous_habits} onChange={(v) => set({ previous_habits: v })} />
      </Section>
      <Section title="חסמים" count={draft.barriers.length}>
        <BarriersEditor value={draft.barriers} onChange={(v) => set({ barriers: v })} />
      </Section>
      <Section title="שינויים מוצעים בתפריט" count={draft.menu_changes.filter((c) => c.approved).length}>
        <MenuChanges value={draft.menu_changes} onChange={(v) => set({ menu_changes: v })} menuTitle={menuTitle} />
      </Section>
      {draft.new_clinical_info.length > 0 && (
        <Section title="מידע קליני חדש" count={draft.new_clinical_info.length}>
          <QuotedList value={draft.new_clinical_info} onChange={(v) => set({ new_clinical_info: v })} addLabel="+ הוספה" />
        </Section>
      )}
      <Section title="הרגלים לפגישה הבאה" count={draft.habits.length}>
        <HabitsEditor value={draft.habits} onChange={(v) => set({ habits: v })} />
      </Section>
      <Section title="לבירור בפגישה הבאה" defaultOpen={false} count={draft.open_questions.length}>
        <LinesField rows={3} value={draft.open_questions} onChange={(v) => set({ open_questions: v })} />
      </Section>
    </>
  );
}
