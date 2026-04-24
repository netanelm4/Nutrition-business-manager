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

function PageSkeleton() {
  return (
    <div className="crm-page" style={{ maxWidth: 720 }}>
      <div className="animate-pulse" style={{ height: 14, width: 80, background: 'var(--surface-3)', borderRadius: 6, marginBottom: 24 }} />
      <div className="animate-pulse" style={{ height: 28, width: 200, background: 'var(--surface-3)', borderRadius: 8, marginBottom: 8 }} />
      <div className="animate-pulse" style={{ height: 14, width: 140, background: 'var(--surface-3)', borderRadius: 6, marginBottom: 24 }} />
      {[1, 2, 3].map((i) => (
        <div key={i} className="card animate-pulse" style={{ height: 80, marginBottom: 12, background: 'var(--surface-2)' }} />
      ))}
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
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 96, flexShrink: 0, paddingTop: 2, textAlign: 'right' }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>
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
              className="field-input"
              style={{ width: '100%', resize: 'none' }}
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
              className="field-input"
              style={{ width: '100%' }}
            />
          )
        ) : (
          <span
            onClick={handleOpen}
            style={{ cursor: 'pointer', fontSize: 13.5, color: 'var(--ink-1)', display: 'block', padding: '2px 4px', borderRadius: 4 }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
          >
            {value || <span style={{ color: 'var(--ink-4)' }}>—</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function InlineSelect({ label, value, options, onSave }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 96, flexShrink: 0, textAlign: 'right' }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>
        <select
          value={value ?? ''}
          onChange={(e) => onSave(e.target.value)}
          className="field-input"
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
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {STEP_ORDER.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isActive = i === currentIndex;

        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < STEP_ORDER.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onStepClick(step)}
                title={LEAD_STATUS_LABEL[step]}
                style={{
                  width: 30, height: 30, borderRadius: '50%', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                  background: (isCompleted || isActive) ? 'var(--blue)' : 'var(--surface-3)',
                  color: (isCompleted || isActive) ? '#fff' : 'var(--ink-3)',
                  boxShadow: isActive ? '0 0 0 3px var(--blue-soft)' : 'none',
                }}
              >
                {isCompleted ? '✓' : i + 1}
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'center', width: 60, lineHeight: 1.3 }}>
                {LEAD_STATUS_LABEL[step]}
              </span>
            </div>

            {i < STEP_ORDER.length - 1 && (
              <div style={{
                height: 2, flex: 1, margin: '0 4px', marginBottom: 20,
                background: i < currentIndex ? 'var(--blue)' : 'var(--line)',
              }} />
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
      const result = await convertLead(id);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (result.clientId) {
        navigate(`/clients/${result.clientId}`);
      }
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
        <div className="crm-page" style={{ textAlign: 'center', color: 'var(--ink-3)', paddingTop: 60 }}>הליד לא נמצא.</div>
      );
    }
    return (
      <div className="crm-page" style={{ textAlign: 'center', color: 'var(--red-ink)', paddingTop: 60 }}>שגיאה בטעינת הליד.</div>
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
    <div className="crm-page" style={{ maxWidth: 720 }} dir="rtl">
      {/* ── Back link ── */}
      <Link to="/leads" className="back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        חזרה ללידים
      </Link>

      {/* ── Page head ── */}
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">{lead.full_name}</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
            {LEAD_SOURCE_LABEL[lead.source] || lead.source}
            {createdAt ? ` · נוסף ${createdAt}` : ''}
          </p>
        </div>
        {lead.phone && (
          <WhatsAppDropdown clientId={lead.id} phone={lead.phone} />
        )}
      </div>

      {/* ── Section: Status steps ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
          סטטוס ליד
        </div>

        {isNotRelevant ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
            סומן כלא רלוונטי
          </div>
        ) : isMeetingHeld ? (
          <>
            <StepIndicator
              currentStatus={LEAD_STATUS.MEETING_SCHEDULED}
              onStepClick={() => {}}
              disabled
            />
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
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

      {/* ── Section: Meeting card ── */}
      {showMeetingSection && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
            כרטיס פגישת היכרות
          </div>

          {/* Meeting info */}
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>פרטי הפגישה</span>
              {!isMeetingHeld && (
                <button
                  type="button"
                  onClick={() => setMeetingModalOpen(true)}
                  style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {meetingQuery.data ? 'עדכן פגישה' : 'הוסף פרטים'}
                </button>
              )}
            </div>
            {meetingQuery.isLoading ? (
              <div className="animate-pulse" style={{ height: 40, background: 'var(--surface-3)', borderRadius: 6 }} />
            ) : meetingQuery.data ? (
              <div style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <span style={{ color: 'var(--ink-3)' }}>תאריך: </span>
                  {new Date(meetingQuery.data.start_time).toLocaleDateString('he-IL', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    timeZone: 'Asia/Jerusalem',
                  })}
                </div>
                <div>
                  <span style={{ color: 'var(--ink-3)' }}>שעה: </span>
                  {new Date(meetingQuery.data.start_time).toLocaleTimeString('he-IL', {
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
                  })}
                </div>
                {meetingQuery.data.event_type && (
                  <div>
                    <span style={{ color: 'var(--ink-3)' }}>סוג: </span>
                    {{ first_meeting: 'פגישה ראשונה', follow_up: 'מעקב', consultation: 'ייעוץ' }[meetingQuery.data.event_type] || meetingQuery.data.event_type}
                  </div>
                )}
                {meetingQuery.data.notes && (
                  <div style={{ color: 'var(--ink-3)' }}>{meetingQuery.data.notes}</div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-4)' }}>לא הוזנו פרטי פגישה עדיין.</p>
            )}
          </div>

          {/* Intake form */}
          <LeadIntakeForm leadId={lead.id} />

          {/* Action buttons */}
          {!isMeetingHeld && (
            <div style={{ paddingTop: 14, borderTop: '1px solid var(--hairline)', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className="crm-btn crm-btn--primary"
                style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}
              >
                {converting ? 'ממיר...' : 'התהליך התחיל — הפוך ללקוח'}
              </button>

              {!confirmMeetingHeld ? (
                <button
                  type="button"
                  onClick={() => setConfirmMeetingHeld(true)}
                  className="crm-btn"
                  style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}
                >
                  פגישה התקיימה — לא המשיך
                </button>
              ) : (
                <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 14px' }}>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', textAlign: 'center', marginBottom: 10 }}>לסמן פגישה זו כלא הומרה?</p>
                  <div style={{ display: 'flex', gap: 8 }}>
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
                      className="crm-btn"
                      style={{ flex: 1, justifyContent: 'center', background: 'var(--ink-1)', color: '#fff', border: 'none' }}
                    >
                      אישור
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmMeetingHeld(false)}
                      className="crm-btn"
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {convertError && (
                <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>{convertError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Lead details ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          פרטי ליד
        </div>

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

        {/* Follow-up date */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 96, flexShrink: 0, paddingTop: 2, textAlign: 'right' }}>
            תאריך מעקב
          </span>
          <div style={{ flex: 1 }}>
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
          <p style={{ fontSize: 13, color: 'var(--red-ink)', marginTop: 8 }}>{saveError}</p>
        )}
      </div>

      {/* ── Section: Conversion ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          המרה ללקוח
        </div>

        {isTerminal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--green-ink)', fontWeight: 500 }}>הליד הפך ללקוח.</p>
            {convertedClient && (
              <Link
                to={`/clients/${convertedClient.id}`}
                style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                עבור לעמוד הלקוח ←
              </Link>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={handleConvert}
              disabled={converting}
              className="crm-btn crm-btn--primary"
              style={{ alignSelf: 'flex-start' }}
            >
              {converting ? 'ממיר...' : 'הפוך ללקוח ←'}
            </button>
            {convertError && (
              <p style={{ fontSize: 13, color: 'var(--red-ink)' }}>{convertError}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Delete lead ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            style={{ fontSize: 13, color: 'var(--red-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            מחק ליד
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              האם למחוק את <strong>{lead.full_name}</strong>? פעולה זו אינה הפיכה.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="crm-btn"
                style={{ flex: 1, justifyContent: 'center', background: 'var(--red-soft)', color: 'var(--red-ink)', border: '1px solid var(--red-soft)' }}
              >
                {deleteMutation.isPending ? 'מוחק...' : 'מחק לצמיתות'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="crm-btn"
                style={{ flex: 1, justifyContent: 'center' }}
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
      className="field-input"
    />
  ) : (
    <span
      onClick={handleOpen}
      style={{
        cursor: 'pointer', fontSize: 13.5, display: 'block', padding: '2px 4px', borderRadius: 4,
        color: isOverdue ? 'var(--red-ink)' : 'var(--ink-1)',
        fontWeight: isOverdue ? 500 : 400,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={(e) => e.currentTarget.style.background = ''}
    >
      {displayLabel ? (
        <>
          {displayLabel}
          {isOverdue && <span style={{ marginRight: 4, fontSize: 11 }}>(באיחור)</span>}
        </>
      ) : (
        <span style={{ color: 'var(--ink-4)' }}>—</span>
      )}
    </span>
  );
}
