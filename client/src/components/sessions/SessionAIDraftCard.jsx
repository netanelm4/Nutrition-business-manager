import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSessionAnalysis, runSessionAnalysis, saveSessionAnalysis, importSessionAnalysis,
  discardSessionAnalysis, fetchSessionRecordings, setRecordingSpeakers,
} from '../../lib/api';
import {
  ANALYSIS_TITLE, IMPORT_TARGETS, FOLLOWUP_IMPORT_TARGETS, INTAKE_FIELD_LABEL, MODE_LABEL,
} from '../../constants/session-analysis';
import FollowUpReview, { cleanFollowUpDraft } from './FollowUpReview';
import {
  box, btn, muted, Section, LinesField, cleanDraft, AnamnesisEditor, BarriersEditor, MealPlanEditor, HabitsEditor,
} from './analysis-ui';

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
  const [modeChoice, setModeChoice] = useState(null); // null → the server's suggestion

  // take the server copy whenever it changes (new run / saved)
  const serverJson = row?.analysis ? JSON.stringify(row.analysis) : null;
  useEffect(() => { setDraft(row?.analysis ? JSON.parse(serverJson) : null); }, [serverJson]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && JSON.stringify(draft) !== serverJson;
  const clean = (d) => (row?.mode === 'follow_up' ? cleanFollowUpDraft(d) : cleanDraft(d));

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onErr = (err) => setError(err.message || 'שגיאה');

  const run = useMutation({
    mutationFn: (force) => runSessionAnalysis(sessionId, { force, mode: modeChoice || data?.suggested_mode }),
    onSuccess: () => { setError(''); setConfirmRerun(false); setImportInfo(null); refresh(); },
    onError: onErr,
  });
  const save = useMutation({ mutationFn: () => saveSessionAnalysis(sessionId, clean(draft)), onSuccess: () => { setError(''); refresh(); }, onError: onErr });
  const discard = useMutation({ mutationFn: () => discardSessionAnalysis(sessionId), onSuccess: refresh, onError: onErr });
  const doImport = useMutation({
    mutationFn: async (targets) => {
      if (dirty) await saveSessionAnalysis(sessionId, clean(draft)); // import exactly what is on screen
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
  const followUp = row?.mode === 'follow_up';
  const targets = followUp ? FOLLOWUP_IMPORT_TARGETS : IMPORT_TARGETS;

  return (
    <section dir="rtl" style={{ ...box, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
          {ANALYSIS_TITLE}
          {row?.mode && (
            <span style={{ marginInlineStart: 8, fontSize: 11.5, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--blue-soft)', color: 'var(--blue-ink)' }}>
              {MODE_LABEL[row.mode]}
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {status !== 'running' && data?.can_analyze && !confirmRerun && (
            <select aria-label="סוג הניתוח" style={{ ...btn(), padding: '5px 8px' }}
              value={modeChoice || row?.mode || data?.suggested_mode || 'intake'} onChange={(e) => setModeChoice(e.target.value)}>
              <option value="intake">{MODE_LABEL.intake}</option>
              <option value="follow_up">{MODE_LABEL.follow_up}</option>
            </select>
          )}
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

          {followUp ? (
            <FollowUpReview draft={draft} setDraft={setDraft} menuTitle={data?.base_menu?.title || data?.active_menu?.title} />
          ) : (<>
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
          </>)}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
            {dirty && (
              <button type="button" style={btn('primary')} disabled={save.isPending}
                onClick={() => save.mutate()}>
                {save.isPending ? 'שומר...' : 'שמירת שינויים'}
              </button>
            )}
            {targets.map((t) => (imported[t.key] ? (
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
              <button type="button" style={btn('primary')} disabled={doImport.isPending} onClick={() => doImport.mutate(targets.map((t) => t.key))}>
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
