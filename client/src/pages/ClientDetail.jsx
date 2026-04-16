import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient, fetchSessions, fetchWindows, updateClient, deleteClient, fetchWhatsAppLog, fetchProtocols, personalizeProtocol, addProtocolTasks } from '../lib/api';
import PaymentsSection from '../components/payments/PaymentsSection';
import { formatDateHebrew, daysUntil } from '../lib/dates';
import { CLIENT_STATUS_LABEL, GENDER_LABEL } from '../constants/statuses';
import Modal from '../components/ui/Modal';
import ClientForm from '../components/clients/ClientForm';
import SessionTimeline from '../components/sessions/SessionTimeline';
import SessionHistory from '../components/sessions/SessionHistory';
import WhatsAppDropdown from '../components/whatsapp/WhatsAppDropdown';

// ─── Client profile section ───────────────────────────────────────────────────

function WeightDelta({ initial, last }) {
  if (!initial || !last) return null;
  const delta = (last - initial).toFixed(1);
  const isLoss = delta < 0;
  return (
    <span className={`text-sm font-semibold ${isLoss ? 'text-green-600' : 'text-red-500'}`}>
      {isLoss ? '' : '+'}{delta} ק״ג
    </span>
  );
}

function ProcessEndLabel({ processEndDate }) {
  if (!processEndDate) return null;
  const days = daysUntil(processEndDate);
  if (days === null) return null;

  if (days < 0) {
    return (
      <span className="text-xs text-red-500">
        התהליך הסתיים לפני {Math.abs(days)} ימים
      </span>
    );
  }
  if (days === 0) return <span className="text-xs text-orange-500">התהליך מסתיים היום</span>;
  return <span className="text-xs text-gray-500">{days} ימים נותרו</span>;
}

function MenuSentStatus({ client }) {
  const queryClient = useQueryClient();
  const [menuError, setMenuError] = useState(null);

  const mutation = useMutation({
    mutationFn: () =>
      updateClient(client.id, {
        menu_sent: 1,
        menu_sent_date: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      setMenuError(null);
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => setMenuError(err.message || 'אירעה שגיאה. נסה שוב.'),
  });

  if (client.menu_sent) {
    return (
      <span className="text-xs text-green-600 flex items-center gap-1">
        ✓ תפריט נשלח {client.menu_sent_date ? `ב-${formatDateHebrew(client.menu_sent_date)}` : ''}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded-full">
          תפריט לא נשלח
        </span>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'שומר...' : 'סמן כנשלח'}
        </button>
      </div>
      {menuError && (
        <p className="text-xs text-red-600">{menuError}</p>
      )}
    </div>
  );
}

function ProfileField({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

// ─── Protocol assignment ──────────────────────────────────────────────────────

function ProtocolAssignment({ client }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [toast, setToast] = useState(null);
  const [personalizationModal, setPersonalizationModal] = useState(null);
  // session picker state: null | 'loading' | { windows, recordedNums }
  const [sessionPicker, setSessionPicker] = useState(null);
  const [sessionPickerSuccess, setSessionPickerSuccess] = useState(null);

  const { data: protocols = [] } = useQuery({
    queryKey: ['protocols'],
    queryFn: fetchProtocols,
  });

  async function runPersonalization(protocolId, updatedClient) {
    const protocol = protocols.find((p) => p.id === protocolId) || updatedClient?.protocol;
    setToast('מתאים פרוטוקול ללקוח...');
    try {
      const data = await personalizeProtocol(protocolId, client.id);
      setPersonalizationModal({ protocol, data });
    } catch {
      // Non-fatal — personalization failed silently
    } finally {
      setToast(null);
    }
  }

  const assignMutation = useMutation({
    mutationFn: (protocolId) => updateClient(client.id, { protocol_id: protocolId }),
    onSuccess: async (updatedClient) => {
      setReplacing(false);
      setSelectedId('');
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      if (updatedClient?.protocol_id) {
        await runPersonalization(updatedClient.protocol_id, updatedClient);
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => updateClient(client.id, { protocol_id: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
    },
  });

  async function openSessionPicker() {
    setSessionPicker('loading');
    try {
      const [windows, sessions] = await Promise.all([
        fetchWindows(client.id),
        fetchSessions(client.id),
      ]);
      const recordedNums = new Set(sessions.map((s) => s.session_number));
      setSessionPicker({ windows, recordedNums });
    } catch {
      setSessionPicker(null);
    }
  }

  async function handleAssignToSession(sessionNumber, tasks) {
    try {
      await addProtocolTasks(client.id, tasks, sessionNumber);
      queryClient.invalidateQueries({ queryKey: ['sessions', String(client.id)] });
      setSessionPickerSuccess(sessionNumber);
      setTimeout(() => {
        setPersonalizationModal(null);
        setSessionPicker(null);
        setSessionPickerSuccess(null);
      }, 1800);
    } catch { /* best-effort */ }
  }

  const assignedProtocol = client.protocol;
  const showDropdown = !assignedProtocol || replacing;

  return (
    <div className="mb-3">
      <p className="text-xs text-gray-400 mb-1.5">פרוטוקול טיפול</p>

      {assignedProtocol && !replacing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
            {assignedProtocol.name}
          </span>
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            החלף
          </button>
          <button
            type="button"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            הסר
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="text-sm rounded-lg border border-gray-300 px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">בחר פרוטוקול...</option>
            {protocols.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => selectedId && assignMutation.mutate(Number(selectedId))}
            disabled={!selectedId || assignMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {assignMutation.isPending ? 'שומר...' : 'שייך פרוטוקול'}
          </button>
          {replacing && (
            <button
              type="button"
              onClick={() => setReplacing(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ביטול
            </button>
          )}
        </div>
      )}

      {toast && (
        <p className="text-xs text-indigo-500 mt-1.5 animate-pulse">{toast}</p>
      )}

      {personalizationModal && (
        <Modal
          title={`פרוטוקול מותאם — ${personalizationModal.protocol?.name ?? ''}`}
          onClose={() => setPersonalizationModal(null)}
          size="lg"
        >
          {personalizationModal.data.clinical_notes && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              {personalizationModal.data.clinical_notes}
            </div>
          )}
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">דגשים מותאמים</p>
            <ul className="space-y-1.5">
              {personalizationModal.data.personalized_highlights.map((h, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-blue-500 flex-shrink-0 mt-0.5">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">משימות מומלצות</p>
            <ul className="space-y-1.5">
              {personalizationModal.data.personalized_tasks.map((t, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-indigo-500 flex-shrink-0 mt-0.5">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="pt-4 border-t border-gray-100">
            {/* Success message */}
            {sessionPickerSuccess && (
              <p className="text-sm text-green-600 font-medium text-center py-2">
                המשימות והדגשים שויכו לפגישה {sessionPickerSuccess}
              </p>
            )}

            {/* Session picker */}
            {sessionPicker && sessionPicker !== 'loading' && !sessionPickerSuccess && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  בחר פגישה לשיוך הדגשים והמשימות
                </p>
                <div className="space-y-2">
                  {sessionPicker.windows.map((w) => {
                    const isDone = sessionPicker.recordedNums.has(w.session_number);
                    return (
                      <button
                        key={w.session_number}
                        type="button"
                        onClick={() => handleAssignToSession(
                          w.session_number,
                          personalizationModal.data.personalized_tasks
                        )}
                        className={[
                          'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-colors cursor-pointer',
                          isDone
                            ? 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                            : 'border-indigo-200 bg-white hover:bg-indigo-50 text-gray-800',
                        ].join(' ')}
                      >
                        <span className="font-medium">פגישה {w.session_number}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {new Date(w.expected_date).toLocaleDateString('he-IL', {
                              day: 'numeric', month: 'long', year: 'numeric',
                            })}
                          </span>
                          <span className={[
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            isDone
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-green-100 text-green-700',
                          ].join(' ')}>
                            {isDone ? 'בוצעה - ניתן להוסיף' : 'פתוחה'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Loading state */}
            {sessionPicker === 'loading' && (
              <p className="text-sm text-indigo-500 animate-pulse text-center py-2">טוען פגישות...</p>
            )}

            {/* Footer buttons */}
            {!sessionPickerSuccess && (
              <div className="flex gap-2">
                {!sessionPicker ? (
                  <button
                    type="button"
                    onClick={openSessionPicker}
                    className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    שייך לפגישה
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSessionPicker(null)}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    ביטול
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setPersonalizationModal(null); setSessionPicker(null); }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  סגור
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ClientProfile({ client, sessions, onDelete }) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lastSession = sessions.length > 0
    ? sessions.reduce((a, b) => (a.session_number > b.session_number ? a : b))
    : null;
  const lastWeight = lastSession?.weight ?? null;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{client.full_name}</h2>
            {client.phone && (
              <a
                href={`https://wa.me/${client.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-500 hover:text-green-600 transition-colors"
                dir="ltr"
              >
                {client.phone}
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
              {CLIENT_STATUS_LABEL[client.status] ?? client.status}
            </span>
            <WhatsAppDropdown clientId={client.id} phone={client.phone} />
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              עריכה
            </button>
          </div>
        </div>

        {/* Profile fields grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          <ProfileField label="גיל" value={client.age} />
          <ProfileField label="מין" value={client.gender ? GENDER_LABEL[client.gender] : null} />
          <ProfileField
            label="סיום תהליך"
            value={
              client.process_end_date ? (
                <span>
                  {formatDateHebrew(client.process_end_date)}
                  {' · '}
                  <ProcessEndLabel processEndDate={client.process_end_date} />
                </span>
              ) : null
            }
          />
        </div>

        {/* Weight tracking */}
        {(client.initial_weight || lastWeight) && (
          <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
            {client.initial_weight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">משקל התחלתי</p>
                <p className="text-base font-semibold text-gray-800">{client.initial_weight} ק״ג</p>
              </div>
            )}
            {lastWeight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">משקל אחרון</p>
                <p className="text-base font-semibold text-gray-800">{lastWeight} ק״ג</p>
              </div>
            )}
            {client.initial_weight && lastWeight && (
              <div className="text-center">
                <p className="text-xs text-gray-400">שינוי</p>
                <WeightDelta initial={client.initial_weight} last={lastWeight} />
              </div>
            )}
          </div>
        )}

        {/* Goal */}
        {client.goal && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">מטרה</p>
            <p className="text-sm text-gray-700 mt-0.5">{client.goal}</p>
          </div>
        )}

        {/* Medical notes */}
        {client.medical_notes && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">הערות רפואיות</p>
            <p className="text-sm text-gray-700 mt-0.5">{client.medical_notes}</p>
          </div>
        )}

        {/* Protocol assignment */}
        <ProtocolAssignment client={client} />

        {/* Menu status */}
        <MenuSentStatus client={client} />
      </div>

      {editOpen && (
        <Modal title="עריכת לקוח" onClose={() => { setEditOpen(false); setConfirmDelete(false); }}>
          <ClientForm client={client} onSuccess={() => setEditOpen(false)} />
          <div className="mt-6 pt-4 border-t border-gray-100">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-red-500 hover:text-red-700 transition-colors"
              >
                מחק לקוח
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  האם למחוק את <strong>{client.full_name}</strong>? פעולה זו תמחק את כל הפגישות
                  וההיסטוריה שלו ולא ניתן לשחזרה.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onDelete}
                    className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
                  >
                    מחק לצמיתות
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      navigate('/clients');
    },
  });

  const { data: client, isLoading: clientLoading, isError: clientError } = useQuery({
    queryKey: ['client', id],
    queryFn: () => fetchClient(id),
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => fetchSessions(id),
    enabled: !!client,
  });

  const { data: whatsappLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['whatsapp-log', id],
    queryFn: () => fetchWhatsAppLog(id),
    enabled: logOpen,
  });

  const isLoading = clientLoading || sessionsLoading;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-gray-200 rounded-xl h-40" />
        ))}
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-red-500 text-sm">שגיאה בטעינת פרטי הלקוח.</p>
        <Link to="/clients" className="text-indigo-600 text-sm mt-2 block hover:underline">
          חזרה לרשימת הלקוחות
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Back link */}
      <Link to="/clients" className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
        <span>→</span>
        <span>חזרה לרשימת הלקוחות</span>
      </Link>

      {/* Section 1 — Profile */}
      <ClientProfile client={client} sessions={sessions} onDelete={() => deleteMutation.mutate()} />

      {/* Section 2 — Session timeline */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">ציר זמן פגישות</h2>
        <SessionTimeline client={client} sessions={sessions} />
      </section>

      {/* Section 3 — Session history */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">היסטוריית פגישות</h2>
        {sessions.length === 0 && !sessionsLoading && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-gray-500 text-sm mb-1">עדיין לא נרשמו פגישות</p>
            <p className="text-xs text-gray-400">לחץ על אחד מחלונות הפגישה כדי לתעד את הפגישה הראשונה</p>
          </div>
        )}
        <SessionHistory client={client} sessions={sessions} />
      </section>

      {/* Section 4 — Payment tracking */}
      <PaymentsSection client={client} />

      {/* Section 5 — WhatsApp log */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <button onClick={() => setLogOpen(v => !v)} className="flex items-center justify-between w-full">
          <h2 className="text-base font-semibold text-gray-700">היסטוריית הודעות</h2>
          <span>{logOpen ? '▲' : '▼'}</span>
        </button>

        {logOpen && (
          <div className="mt-4">
            {logLoading ? (
              <div className="animate-pulse bg-gray-200 rounded h-10 w-full" />
            ) : whatsappLog.length === 0 ? (
              <p className="text-sm text-gray-400">אין הודעות שנשלחו עדיין.</p>
            ) : (
              <ul>
                {whatsappLog.map((entry) => (
                  <li key={entry.id} className="border-b border-gray-100 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        {entry.template_name ?? 'שליחה ישירה'}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatDateHebrew(entry.sent_at)}
                      </span>
                    </div>
                    {entry.rendered_message && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {entry.rendered_message.length > 80
                          ? entry.rendered_message.slice(0, 80) + '…'
                          : entry.rendered_message}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
