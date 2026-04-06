import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSession, updateSession, generateInsights, fetchProtocols, personalizeProtocol } from '../../lib/api';
import { EditableTaskList } from './TaskList';
import { v4 as uuidv4 } from 'uuid';

const MIN_HIGHLIGHTS_FOR_AI = 20;

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

function InsightDisplay({ insights, flags }) {
  const hasInsights = insights?.length > 0;
  const hasFlags    = flags?.length > 0;
  if (!hasInsights && !hasFlags) return null;

  return (
    <div className="mt-4 space-y-3 rounded-xl bg-gray-50 border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תובנות AI</p>
      {hasInsights && (
        <div>
          <p className="text-xs font-medium text-indigo-600 mb-1">הצעות קליניות</p>
          <ul className="space-y-1">
            {insights.map((item, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-indigo-400 flex-shrink-0">•</span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasFlags && (
        <div>
          <p className="text-xs font-medium text-orange-600 mb-1">דגלים לתשומת לב</p>
          <ul className="space-y-1">
            {flags.map((item, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-orange-400 flex-shrink-0">⚑</span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Create or edit a session. Rendered inside Modal by the parent.
 *
 * @param {number}       clientId
 * @param {object|null}  session    - null = create new; object = edit existing
 * @param {number}       [sessionNumber] - Used only for create (auto-filled)
 * @param {function}     onSuccess
 */
const SOAP_LABELS = {
  subjective: 'S — סובייקטיבי (דיווח המטופל)',
  objective:  'O — אובייקטיבי (נתונים מדידים)',
  assessment: 'A — הערכה קלינית',
  plan:       'P — תוכנית המשך',
};

const SOAP_KEYS = ['subjective', 'objective', 'assessment', 'plan'];

export default function SessionModal({ clientId, session, sessionNumber, onSuccess }) {
  const queryClient = useQueryClient();
  const isEdit = !!session?.id;

  const [form, setForm] = useState({
    session_date: session?.session_date ?? '',
    weight: session?.weight ?? '',
    highlights: session?.highlights ?? '',
    tasks: session?.tasks ?? [],
  });

  const initSoap = session?.soap_notes && typeof session.soap_notes === 'object'
    ? session.soap_notes
    : { subjective: '', objective: '', assessment: '', plan: '' };
  const [soap, setSoap] = useState(initSoap);
  const [soapOpen, setSoapOpen] = useState(
    SOAP_KEYS.some((k) => initSoap[k]?.trim())
  );

  const [aiResult, setAiResult] = useState(
    isEdit && (session.ai_insights?.length || session.ai_flags?.length)
      ? { insights: session.ai_insights, flags: session.ai_flags }
      : null
  );
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState('');
  const [serverError, setServerError] = useState('');
  const [dateError, setDateError] = useState('');

  // Protocol picker state
  const currentSessionNumber = isEdit ? session.session_number : (sessionNumber ?? null);
  const isFirstSession = currentSessionNumber === 1;
  const [protocolPickerOpen, setProtocolPickerOpen] = useState(false);
  const [personalizingId, setPersonalizingId] = useState(null);   // protocol id being personalized
  const [personalizeError, setPersonalizeError] = useState('');
  const [personalizedResult, setPersonalizedResult] = useState(null); // { protocol, result }
  const [protocolToast, setProtocolToast] = useState('');

  const { data: protocols = [] } = useQuery({
    queryKey: ['protocols'],
    queryFn: fetchProtocols,
    enabled: isFirstSession,
    staleTime: 60_000,
  });

  function showProtocolToast(msg) {
    setProtocolToast(msg);
    setTimeout(() => setProtocolToast(''), 2500);
  }

  function applyProtocol(highlights, tasks) {
    // Append highlights
    const bullet = highlights.map((h) => `• ${h}`).join('\n');
    setForm((f) => ({
      ...f,
      highlights: f.highlights.trim()
        ? f.highlights.trim() + '\n---\n' + bullet
        : bullet,
      tasks: [
        ...f.tasks,
        ...tasks.map((t) => ({
          id: uuidv4(),
          text: typeof t === 'string' ? t : t.text,
          status: 'pending',
        })),
      ],
    }));
    setProtocolPickerOpen(false);
    setPersonalizedResult(null);
    showProtocolToast('פרוטוקול נטען בהצלחה ✓');
  }

  async function handlePersonalize(protocol) {
    setPersonalizingId(protocol.id);
    setPersonalizeError('');
    setPersonalizedResult(null);
    try {
      const result = await personalizeProtocol(protocol.id, clientId);
      setPersonalizedResult({ protocol, result });
    } catch (err) {
      setPersonalizeError(err.message || 'שגיאה בהתאמה אישית. נסה שוב.');
    } finally {
      setPersonalizingId(null);
    }
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    // Auto-populate soap.objective with weight when it's empty or was previously auto-filled
    if (field === 'weight' && value) {
      setSoap((s) => {
        const prev = s.objective ?? '';
        if (!prev.trim() || /^משקל: [\d.]+ ק"ג$/.test(prev.trim())) {
          return { ...s, objective: `משקל: ${value} ק"ג` };
        }
        return s;
      });
    }
  }

  function setSoapField(field, value) {
    setSoap((s) => ({ ...s, [field]: value }));
  }

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? updateSession(session.id, data)
        : createSession(clientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', String(clientId)] });
      queryClient.invalidateQueries({ queryKey: ['client', String(clientId)] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onSuccess();
    },
    onError: (err) => setServerError(err.message || 'שגיאה בשמירה. נסה שוב.'),
  });

  async function handleGenerateAI() {
    if (!isEdit) return; // AI only in edit mode — session must exist
    if (form.highlights.length < MIN_HIGHLIGHTS_FOR_AI) return;
    setGeneratingAI(true);
    setAiError('');
    try {
      // First save current highlights so the server has the latest text
      await updateSession(session.id, { highlights: form.highlights });
      const result = await generateInsights(session.id);
      setAiResult(result);
    } catch (err) {
      setAiError(err.message || 'שגיאה ביצירת תובנות. נסה שוב.');
    } finally {
      setGeneratingAI(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.session_date) {
      setDateError('תאריך הפגישה הוא שדה חובה');
      return;
    }
    setDateError('');
    setServerError('');
    const soapPayload = SOAP_KEYS.some((k) => soap[k]?.trim()) ? soap : null;
    saveMutation.mutate({
      session_date: form.session_date,
      weight: form.weight ? Number(form.weight) : null,
      highlights: form.highlights.trim() || null,
      tasks: form.tasks,
      soap_notes: soapPayload,
    });
  }

  const aiEnabled = isEdit && form.highlights.length >= MIN_HIGHLIGHTS_FOR_AI;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Session number (read-only) */}
      <p className="text-sm text-gray-500">
        פגישה מספר {isEdit ? session.session_number : sessionNumber ?? '?'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">תאריך הפגישה *</label>
          <input
            type="date"
            value={form.session_date}
            onChange={(e) => { set('session_date', e.target.value); setDateError(''); }}
            className={inputClass}
            dir="ltr"
          />
          {dateError && <p className="text-xs text-red-500">{dateError}</p>}
          {form.session_date && form.session_date < new Date().toISOString().slice(0, 10) && (
            <p className="text-xs text-orange-600">פגישה רטרואקטיבית — מתועדת בתאריך שנבחר</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">משקל (ק״ג)</label>
          <input
            type="number"
            step="0.1"
            value={form.weight}
            onChange={(e) => set('weight', e.target.value)}
            placeholder="70.5"
            className={inputClass}
          />
        </div>
      </div>

      {/* Highlights */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">דגשים מהפגישה</label>
        <textarea
          value={form.highlights}
          onChange={(e) => set('highlights', e.target.value)}
          placeholder="מה עלה בפגישה? הישגים, קשיים, נושאים מרכזיים..."
          rows={5}
          className={inputClass}
        />
        <p className="text-xs text-gray-400 text-left">{form.highlights.length} תווים</p>
      </div>

      {/* Protocol loader — first session only */}
      {isFirstSession && (
        <div>
          <button
            type="button"
            onClick={() => { setProtocolPickerOpen((v) => !v); setPersonalizedResult(null); setPersonalizeError(''); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
          >
            <span>📂</span>
            <span>{protocolPickerOpen ? 'סגור ספריית פרוטוקולים' : 'טען פרוטוקול'}</span>
          </button>

          {protocolPickerOpen && (
            <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden" dir="rtl">
              {/* Personalized result panel */}
              {personalizedResult ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800">פרוטוקול מותאם אישית</p>
                    <button
                      type="button"
                      onClick={() => setPersonalizedResult(null)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      ← חזרה לרשימה
                    </button>
                  </div>

                  {personalizedResult.result.clinical_notes?.trim() && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-yellow-700 mb-0.5">הערה קלינית</p>
                      <p className="text-xs text-yellow-800 leading-relaxed">
                        {personalizedResult.result.clinical_notes}
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">דגשים מותאמים</p>
                    <ul className="space-y-1">
                      {personalizedResult.result.personalized_highlights.map((h, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-teal-400 flex-shrink-0">•</span>{h}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">משימות מותאמות</p>
                    <ul className="space-y-1">
                      {personalizedResult.result.personalized_tasks.map((t, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-teal-400 flex-shrink-0">◦</span>{t}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        applyProtocol(
                          personalizedResult.result.personalized_highlights,
                          personalizedResult.result.personalized_tasks
                        )
                      }
                      className="flex-1 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
                    >
                      טען לפגישה
                    </button>
                    <button
                      type="button"
                      onClick={() => setPersonalizedResult(null)}
                      className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="px-4 py-2 text-xs font-medium text-gray-400 bg-gray-50 border-b border-gray-100">
                    בחר פרוטוקול לטעינה
                  </p>
                  {personalizeError && (
                    <p className="px-4 py-2 text-xs text-red-500 bg-red-50 border-b border-red-100">
                      {personalizeError}
                    </p>
                  )}
                  {protocols.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-400">אין פרוטוקולים פעילים.</p>
                  )}
                  {protocols.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        {p.description && (
                          <p className="text-xs text-gray-500 truncate">{p.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePersonalize(p)}
                          disabled={personalizingId !== null}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                        >
                          {personalizingId === p.id ? 'מתאים...' : '✨ התאם לפי הלקוח'}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyProtocol(p.highlights, p.default_tasks)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100 transition-colors"
                        >
                          בחר
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {protocolToast && (
            <p className="mt-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg">
              {protocolToast}
            </p>
          )}
        </div>
      )}

      {/* SOAP notes — collapsible */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setSoapOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
        >
          <span>{soapOpen ? '▾ תיעוד מקצועי (SOAP)' : '▸ תיעוד מקצועי (SOAP) — אופציונלי'}</span>
        </button>
        {soapOpen && (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SOAP_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">{SOAP_LABELS[key]}</label>
                <textarea
                  value={soap[key] ?? ''}
                  onChange={(e) => setSoapField(key, e.target.value)}
                  rows={3}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI insights button — edit mode only */}
      {isEdit ? (
        <div>
          <button
            type="button"
            onClick={handleGenerateAI}
            disabled={!aiEnabled || generatingAI}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!aiEnabled ? `הזן לפחות ${MIN_HIGHLIGHTS_FOR_AI} תווים בדגשים` : ''}
          >
            {generatingAI ? (
              <>
                <span className="animate-spin text-base">⟳</span>
                <span>מנתח דגשים...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>צור תובנות AI</span>
              </>
            )}
          </button>
          {aiError && <p className="text-xs text-red-500 mt-1">{aiError}</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          שמור את הפגישה תחילה כדי ליצור תובנות AI
        </p>
      )}

      {/* AI results displayed inline */}
      <InsightDisplay insights={aiResult?.insights} flags={aiResult?.flags} />

      {/* Tasks */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">משימות</label>
        <EditableTaskList tasks={form.tasks} onChange={(tasks) => set('tasks', tasks)} />
      </div>

      {serverError && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={saveMutation.isPending}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-60"
      >
        {saveMutation.isPending ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור פגישה'}
      </button>
    </form>
  );
}
