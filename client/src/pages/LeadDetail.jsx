import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLead, updateLead, convertLead, deleteLead, fetchClientByLeadId, fetchLeadMeeting } from '../lib/api';
import { LEAD_STATUS, LEAD_STATUS_LABEL, LEAD_SOURCE_LABEL } from '../constants/statuses';
import { formatDateHebrew } from '../lib/dates';
import WhatsAppDropdown from '../components/whatsapp/WhatsAppDropdown';
import MeetingScheduleModal from '../components/leads/MeetingScheduleModal';
import LeadIntakeForm from '../components/leads/LeadIntakeForm';

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_ORDER = ['new', 'contacted', 'meeting_scheduled', 'became_client'];

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-16" />
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}

// ── Inline editable field ─────────────────────────────────────────────────────

function InlineField({ label, value, onSave, type = 'text', dir }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  function handleOpen() {
    setDraft(value ?? '');
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft !== (value ?? '')) onSave(draft);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && type !== 'textarea') commit();
    if (e.key === 'Escape') setEditing(false);
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500 w-28 flex-shrink-0 mt-1 text-right">
        {label}
      </span>
      <div className="flex-1">
        {editing ? (
          type === 'textarea' ? (
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKeyDown}
              dir={dir}
              className="w-full rounded-lg border border-indigo-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          ) : (
            <input
              autoFocus
              type={type}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKeyDown}
              dir={dir}
              className="w-full rounded-lg border border-indigo-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          )
        ) : (
          <span
            onClick={handleOpen}
            className="cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 text-sm text-gray-800 block"
          >
            {value || <span className="text-gray-400">—</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function InlineSelect({ label, value, options, onSave }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500 w-28 flex-shrink-0 text-right">
        {label}
      </span>
      <div className="flex-1">
        <select
          value={value ?? ''}
          onChange={(e) => onSave(e.target.value)}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {options.map(({ value: v, label: l }) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ currentStatus, onStepClick, disabled }) {
  const currentIndex = STEP_ORDER.indexOf(currentStatus);

  return (
    <div className="flex items-center gap-0">
      {STEP_ORDER.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isActive = i === currentIndex;
        const isFuture = i > currentIndex;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Circle + label */}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onStepClick(step)}
                title={LEAD_STATUS_LABEL[step]}
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
                  isCompleted
                    ? 'bg-indigo-600 text-white'
                    : isActive
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 ring-offset-1'
                    : 'bg-white border-2 border-gray-300 text-gray-400',
                  !disabled ? 'cursor-pointer hover:border-indigo-400' : 'cursor-default',
                ].join(' ')}
              >
                {isCompleted ? '✓' : i + 1}
              </button>
              <span className="text-xs text-gray-500 text-center leading-tight w-16">
                {LEAD_STATUS_LABEL[step]}
              </span>
            </div>

            {/* Connector line (not after last item) */}
            {i < STEP_ORDER.length - 1 && (
              <div
                className={[
                  'h-0.5 flex-1 mx-1 mb-5',
                  i < currentIndex ? 'bg-indigo-500' : 'bg-gray-200',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [converting, setConverting] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [convertError, setConvertError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [confirmMeetingHeld, setConfirmMeetingHeld] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const {
    data: lead,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
  });

  const convertedClientQuery = useQuery({
    queryKey: ['client-by-lead', id],
    queryFn: () => fetchClientByLeadId(id),
    enabled: lead?.status === 'became_client',
  });

  const meetingQuery = useQuery({
    queryKey: ['lead-meeting', id],
    queryFn: () => fetchLeadMeeting(id),
    enabled: lead?.status === LEAD_STATUS.MEETING_SCHEDULED || lead?.status === LEAD_STATUS.MEETING_HELD,
  });

  // ── Save mutation ────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data) => updateLead(id, data),
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => setSaveError(err.message || 'אירעה שגיאה בשמירה. נסה שוב.'),
  });

  function save(data) {
    saveMutation.mutate(data);
  }

  // ── Step click ───────────────────────────────────────────────────────────────

  function handleStepClick(status) {
    if (status === LEAD_STATUS.MEETING_SCHEDULED) {
      save({ status });
      setMeetingModalOpen(true);
      return;
    }
    save({ status });
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      navigate('/leads');
    },
  });

  // ── Conversion ───────────────────────────────────────────────────────────────

  async function handleConvert() {
    if (converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      // Server creates the client row automatically and returns the new client_id
      const result = await convertLead(id);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/clients/${result.client_id}`);
    } catch (err) {
      setConvertError(err.message || 'אירעה שגיאה בהמרת הליד. נסה שוב.');
    } finally {
      setConverting(false);
    }
  }

  // ── Render: loading / error / 404 ────────────────────────────────────────────

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    if (error?.status === 404) {
      return (
        <div className="p-6 text-center text-gray-500 mt-10">הליד לא נמצא.</div>
      );
    }
    return (
      <div className="p-6 text-center text-red-500 mt-10">שגיאה בטעינת הליד.</div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const isTerminal = lead.status === 'became_client';
  const isNotRelevant = lead.status === 'not_relevant';
  const isMeetingHeld = lead.status === LEAD_STATUS.MEETING_HELD;
  const showMeetingSection = lead.status === LEAD_STATUS.MEETING_SCHEDULED || isMeetingHeld;

  const createdAt = formatDateHebrew(lead.created_at);

  const followUpDate = lead.follow_up_date ? new Date(lead.follow_up_date) : null;
  const isOverdue =
    followUpDate && followUpDate < new Date() && lead.status !== 'became_client';

  const sourceOptions = Object.entries(LEAD_SOURCE_LABEL).map(([v, l]) => ({
    value: v,
    label: l,
  }));

  const convertedClient =
    convertedClientQuery.data && convertedClientQuery.data.length > 0
      ? convertedClientQuery.data[0]
      : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6" dir="rtl">
      {/* ── Section 1: Page header ── */}
      <div>
        <Link
          to="/leads"
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 mb-4"
        >
          <span>←</span>
          <span>חזרה ללידים</span>
        </Link>

        <h1 className="text-2xl font-bold text-gray-900">{lead.full_name}</h1>

        <p className="text-sm text-gray-400 mt-1">
          {LEAD_SOURCE_LABEL[lead.source] || lead.source}
          {createdAt ? ` · נוסף ${createdAt}` : ''}
        </p>
      </div>

      {/* ── Section 2: Step indicator ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">סטטוס ליד</h2>

        {isNotRelevant ? (
          <div className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3 text-center">
            סומן כלא רלוונטי
          </div>
        ) : isMeetingHeld ? (
          <>
            <StepIndicator
              currentStatus={LEAD_STATUS.MEETING_SCHEDULED}
              onStepClick={() => {}}
              disabled
            />
            <div className="mt-3 text-sm text-gray-500 bg-gray-50 rounded-xl p-3 text-center">
              פגישה התקיימה — הליד לא המשיך לטיפול
            </div>
          </>
        ) : (
          <StepIndicator
            currentStatus={lead.status}
            onStepClick={handleStepClick}
            disabled={isTerminal}
          />
        )}
      </div>

      {/* ── Section 2b: כרטיס פגישת היכרות ── */}
      {showMeetingSection && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-gray-600">כרטיס פגישת היכרות</h2>

          {/* A) Meeting info */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">פרטי הפגישה</span>
              {!isMeetingHeld && (
                <button
                  type="button"
                  onClick={() => setMeetingModalOpen(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {meetingQuery.data ? 'עדכן פגישה' : 'הוסף פרטים'}
                </button>
              )}
            </div>
            {meetingQuery.isLoading ? (
              <div className="h-10 animate-pulse bg-gray-100 rounded-lg" />
            ) : meetingQuery.data ? (
              <div className="text-sm text-gray-700 space-y-1">
                <p>
                  <span className="text-gray-500 ml-1">תאריך:</span>
                  {new Date(meetingQuery.data.start_time).toLocaleDateString('he-IL', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    timeZone: 'Asia/Jerusalem',
                  })}
                </p>
                <p>
                  <span className="text-gray-500 ml-1">שעה:</span>
                  {new Date(meetingQuery.data.start_time).toLocaleTimeString('he-IL', {
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
                  })}
                </p>
                {meetingQuery.data.event_type && (
                  <p>
                    <span className="text-gray-500 ml-1">סוג:</span>
                    {{ first_meeting: 'פגישה ראשונה', follow_up: 'מעקב', consultation: 'ייעוץ' }[meetingQuery.data.event_type] || meetingQuery.data.event_type}
                  </p>
                )}
                {meetingQuery.data.notes && (
                  <p className="text-gray-500">{meetingQuery.data.notes}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">לא הוזנו פרטי פגישה עדיין.</p>
            )}
          </div>

          {/* B) Intake form */}
          <LeadIntakeForm leadId={lead.id} />

          {/* C) Action buttons — only when meeting is still pending outcome */}
          {!isMeetingHeld && (
            <div className="pt-2 space-y-3 border-t border-gray-100">
              {/* Convert to client */}
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                {converting ? 'ממיר...' : 'התהליך התחיל — הפוך ללקוח'}
              </button>

              {/* Mark as meeting held (no conversion) */}
              {!confirmMeetingHeld ? (
                <button
                  type="button"
                  onClick={() => setConfirmMeetingHeld(true)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  פגישה התקיימה — לא המשיך
                </button>
              ) : (
                <div className="rounded-xl border border-gray-200 p-3 space-y-3 bg-gray-50">
                  <p className="text-sm text-gray-700 text-center">לסמן פגישה זו כלא הומרה?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await save({ status: LEAD_STATUS.MEETING_HELD });
                          setConfirmMeetingHeld(false);
                          queryClient.invalidateQueries({ queryKey: ['lead', id] });
                          queryClient.invalidateQueries({ queryKey: ['leads'] });
                        } catch {}
                      }}
                      className="flex-1 py-2 rounded-xl bg-gray-700 text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
                    >
                      אישור
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmMeetingHeld(false)}
                      className="flex-1 py-2 rounded-xl border border-gray-300 text-sm text-gray-600 hover:bg-white transition-colors"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {convertError && (
                <p className="text-sm text-red-600">{convertError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Inline editable fields ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">פרטי ליד</h2>

        <InlineField
          label="שם מלא"
          value={lead.full_name}
          onSave={(v) => save({ full_name: v })}
          type="text"
        />

        <InlineField
          label="טלפון"
          value={lead.phone}
          onSave={(v) => save({ phone: v })}
          type="tel"
          dir="ltr"
        />

        <InlineSelect
          label="מקור"
          value={lead.source}
          options={sourceOptions}
          onSave={(v) => save({ source: v })}
        />

        {/* Follow-up date with overdue indicator */}
        <div className="flex items-start gap-3 py-3 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-500 w-28 flex-shrink-0 mt-1 text-right">
            תאריך מעקב
          </span>
          <div className="flex-1">
            <FollowUpInlineField
              value={lead.follow_up_date}
              isOverdue={isOverdue}
              onSave={(v) => save({ follow_up_date: v || null })}
            />
          </div>
        </div>

        <InlineField
          label="הערות"
          value={lead.notes}
          onSave={(v) => save({ notes: v })}
          type="textarea"
        />

        {saveError && (
          <p className="text-sm text-red-600 mt-2">{saveError}</p>
        )}
      </div>

      {/* ── Section 4: WhatsApp ── */}
      {lead.phone && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-600 mb-3">שליחת הודעה</h2>
          <WhatsAppDropdown clientId={lead.id} phone={lead.phone} />
        </div>
      )}

      {/* ── Section 5: Conversion ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-600 mb-3">המרה ללקוח</h2>

        {isTerminal ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700 font-medium">הליד הפך ללקוח.</p>
            {convertedClient && (
              <Link
                to={`/clients/${convertedClient.id}`}
                className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <span>עבור לעמוד הלקוח</span>
                <span>←</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleConvert}
              disabled={converting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              <span>הפוך ללקוח</span>
              <span>←</span>
            </button>
            {convertError && (
              <p className="text-sm text-red-600">{convertError}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Delete lead ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-500 hover:text-red-700 transition-colors"
          >
            מחק ליד
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              האם למחוק את <strong>{lead.full_name}</strong>? פעולה זו אינה הפיכה.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'מוחק...' : 'מחק לצמיתות'}
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
      {/* ── Meeting schedule modal ── */}
      {meetingModalOpen && lead && (
        <MeetingScheduleModal
          lead={lead}
          existingEvent={meetingQuery.data || null}
          onSave={() => {
            setMeetingModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['lead-meeting', id] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
          onSkip={() => setMeetingModalOpen(false)}
          onClose={() => setMeetingModalOpen(false)}
        />
      )}
    </div>
  );
}

// ── Follow-up date field (separate to handle overdue styling) ─────────────────

function FollowUpInlineField({ value, isOverdue, onSave }) {
  const [editing, setEditing] = useState(false);
  // Convert ISO date string (with time) to YYYY-MM-DD for date input
  const dateValue = value ? value.slice(0, 10) : '';
  const [draft, setDraft] = useState(dateValue);

  function handleOpen() {
    setDraft(dateValue);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft !== dateValue) onSave(draft);
  }

  const displayLabel = value ? formatDateHebrew(value) : null;

  return editing ? (
    <input
      autoFocus
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      dir="ltr"
      className="rounded-lg border border-indigo-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
    />
  ) : (
    <span
      onClick={handleOpen}
      className={[
        'cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 text-sm block',
        isOverdue ? 'text-red-600 font-medium' : 'text-gray-800',
      ].join(' ')}
    >
      {displayLabel ? (
        <>
          {displayLabel}
          {isOverdue && <span className="mr-1 text-xs">(באיחור)</span>}
        </>
      ) : (
        <span className="text-gray-400">—</span>
      )}
    </span>
  );
}
