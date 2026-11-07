import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchInbox, approveInboxItem, dismissInboxItem, snoozeInboxItem, batchInbox, refreshInbox, runAIAnalysis,
} from '../../lib/api';
import { israelDateOf, relativeLabel } from '../../lib/dates';
import {
  inboxKindMeta, INBOX_PRIORITY_LABEL, INBOX_FILTERS, SNOOZE_OPTIONS,
} from '../../constants/inbox';

// ─── Inbox: every actionable item in one queue, sorted by priority + due date ─
// Message items: one-click approve (server sends via WhatsApp Cloud API when
// configured; otherwise wa.me opens). Task items: mark done. Batch approve for
// check-ins and any selection. Live: SSE invalidates ['inbox'] on any change.

const TONE_CHIP = {
  red: 'chip chip--red', amber: 'chip chip--amber', green: 'chip chip--green',
  blue: 'chip chip--blue', violet: 'chip chip--blue', muted: 'chip',
};

function ManualSendList({ results, onClose }) {
  const [opened, setOpened] = useState(new Set());
  const pending = results.filter((r) => r.whatsapp_link);
  if (pending.length === 0) return null;
  return (
    <div className="inbox-manual" role="dialog" aria-label="שליחה ידנית">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <b style={{ fontSize: 13 }}>שליחה ידנית בוואטסאפ ({opened.size}/{pending.length})</b>
        <button type="button" className="crm-btn crm-btn--sm crm-btn--ghost" onClick={onClose}>סגירה</button>
      </div>
      <p className="t-xs t-muted" style={{ margin: '4px 0 8px' }}>
        {pending.some((r) => r.error) ? 'השליחה האוטומטית לא הצליחה. ' : ''}
        יש לפתוח כל הודעה ולשלוח מהוואטסאפ.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pending.map((r) => (
          <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="t-sm" style={{ color: opened.has(r.id) ? 'var(--ink-4)' : 'var(--ink-1)' }}>
              {r.title || `פריט ${r.id}`}
            </span>
            <a
              href={r.whatsapp_link}
              target="_blank"
              rel="noreferrer"
              className={`crm-btn crm-btn--sm${opened.has(r.id) ? '' : ' crm-btn--primary'}`}
              onClick={() => setOpened((s) => new Set(s).add(r.id))}
            >
              {opened.has(r.id) ? 'נפתח' : 'פתיחה'}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboxRow({ item, selected, onToggle, onApprove, onDismiss, onSnooze, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const meta = inboxKindMeta(item.kind);
  const isMessage = item.category === 'message' && item.message;

  return (
    <li className={`inbox-row is-${item.priority}`}>
      <input
        type="checkbox"
        className="inbox-row__check"
        checked={selected}
        onChange={onToggle}
        aria-label={`בחירת ${item.title}`}
      />
      <div className="inbox-row__main">
        <div className="inbox-row__top">
          <span className={TONE_CHIP[meta.tone] || 'chip'}>{meta.label}</span>
          {item.priority === 'urgent' && <span className="chip chip--red">{INBOX_PRIORITY_LABEL.urgent}</span>}
          <span className="t-xs t-muted">{relativeLabel(israelDateOf(item.due_at))}</span>
        </div>
        {item.link
          ? <Link to={item.link} className="inbox-row__title">{item.title}</Link>
          : <span className="inbox-row__title">{item.title}</span>}
        {item.body && <p className="inbox-row__body">{item.body}</p>}
        {isMessage && (
          <button type="button" className="inbox-row__preview" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span className={expanded ? '' : 'is-clamped'}>{item.message}</span>
          </button>
        )}
        {item.send_error && <p className="inbox-row__error">שליחה קודמת נכשלה: {item.send_error}</p>}
      </div>
      <div className="inbox-row__actions">
        <button type="button" className="crm-btn crm-btn--sm crm-btn--primary" disabled={busy} onClick={onApprove}>
          {isMessage ? 'אישור ושליחה' : 'בוצע'}
        </button>
        <div style={{ position: 'relative' }}>
          <button type="button" className="crm-btn crm-btn--sm" disabled={busy} onClick={() => setSnoozeOpen((v) => !v)} aria-haspopup="menu" aria-expanded={snoozeOpen}>
            דחייה
          </button>
          {snoozeOpen && (
            <div className="inbox-menu" role="menu">
              {SNOOZE_OPTIONS.map((o) => (
                <button key={o.hours} type="button" role="menuitem" onClick={() => { setSnoozeOpen(false); onSnooze(o.hours); }}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="crm-btn crm-btn--sm crm-btn--ghost" disabled={busy} onClick={onDismiss} aria-label="ביטול הפריט">
          ✕
        </button>
      </div>
    </li>
  );
}

export default function InboxCard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [manual, setManual] = useState([]);
  const [notice, setNotice] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInbox,
    refetchInterval: 5 * 60_000, // fallback only — SSE keeps it live
  });
  const items = data?.items ?? [];

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.category === filter)),
    [items, filter]
  );
  const checkins = items.filter((i) => i.kind === 'checkin' && i.category === 'message');

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 4000); };

  const approveMut = useMutation({
    mutationFn: (item) => approveInboxItem(item.id),
    onSuccess: (res, item) => {
      done();
    },
    onError: (err) => flash(err.message || 'שגיאה באישור'),
  });

  const batchMut = useMutation({
    mutationFn: ({ ids, action }) => batchInbox(ids, action),
    onSuccess: (res, { action }) => {
      const results = res?.results ?? [];
      if (action === 'approve') {
        const titles = Object.fromEntries(items.map((i) => [i.id, i.title]));
        setManual(results.filter((r) => r.whatsapp_link).map((r) => ({ ...r, title: titles[r.id] })));
      }
      setSelected(new Set());
      done();
    },
    onError: (err) => flash(err.message || 'שגיאה בפעולה המרוכזת'),
  });

  const dismissMut = useMutation({ mutationFn: (id) => dismissInboxItem(id), onSuccess: done });
  const snoozeMut = useMutation({ mutationFn: ({ id, hours }) => snoozeInboxItem(id, hours), onSuccess: done });
  const refreshMut = useMutation({
    mutationFn: refreshInbox,
    onSuccess: (res) => { done(); flash(`התיבה עודכנה · ${res?.open ?? 0} פתוחים`); },
  });
  const aiMut = useMutation({
    mutationFn: runAIAnalysis,
    onSuccess: () => { flash('ניתוח AI רץ ברקע. ההמלצות יופיעו כאן'); },
  });

  function approve(item) {
    // Open wa.me synchronously inside the click (popup blockers)
    if (item.whatsapp_link) window.open(item.whatsapp_link, '_blank', 'noopener');
    approveMut.mutate(item);
  }

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const busy = approveMut.isPending || batchMut.isPending;
  const open = data?.open ?? 0;

  return (
    <section className="card inbox" aria-labelledby="inbox-title">
      <div className="card__head inbox__head">
        <div>
          <div id="inbox-title" className="t-h2" style={{ fontWeight: 600 }}>תיבת פעולות</div>
          <div className="t-sm t-muted" style={{ marginTop: 5 }}>
            {isLoading ? '...' : open > 0 ? `${open} פריטים ממתינים לטיפול` : 'אין פעולות פתוחות'}
          </div>
        </div>
        <div className="inbox__tools">
          <button type="button" className="crm-btn crm-btn--sm" onClick={() => aiMut.mutate()} disabled={aiMut.isPending}>
            {aiMut.isPending ? 'מריץ...' : 'הרצת ניתוח AI'}
          </button>
          <button type="button" className="crm-btn crm-btn--sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            {refreshMut.isPending ? 'מרענן...' : 'רענון'}
          </button>
        </div>
      </div>

      <div className="inbox__bar">
        <div className="inbox__filters" role="tablist" aria-label="סינון">
          {INBOX_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`inbox__filter${filter === f.key ? ' is-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="inbox__batch">
          {checkins.length > 1 && selected.size === 0 && (
            <button
              type="button"
              className="crm-btn crm-btn--sm crm-btn--primary"
              disabled={busy}
              onClick={() => batchMut.mutate({ ids: checkins.map((i) => i.id), action: 'approve' })}
            >
              אישור ושליחת צ'ק-אינים ({checkins.length})
            </button>
          )}
          {selected.size > 0 && (
            <>
              <button type="button" className="crm-btn crm-btn--sm crm-btn--primary" disabled={busy}
                onClick={() => batchMut.mutate({ ids: [...selected], action: 'approve' })}>
                אישור נבחרים ({selected.size})
              </button>
              <button type="button" className="crm-btn crm-btn--sm" disabled={busy}
                onClick={() => batchMut.mutate({ ids: [...selected], action: 'dismiss' })}>
                ביטול נבחרים
              </button>
            </>
          )}
        </div>
      </div>

      {notice && <div className="inbox__notice" role="status">{notice}</div>}
      {manual.length > 0 && <ManualSendList results={manual} onClose={() => setManual([])} />}

      <div className="card__body" style={{ padding: 0 }}>
        {isLoading ? (
          <p className="t-sm t-muted" style={{ padding: '16px 18px' }}>טוען...</p>
        ) : isError ? (
          <p style={{ padding: '16px 18px', color: 'var(--red-ink)', fontSize: 13 }}>שגיאה בטעינת התיבה</p>
        ) : visible.length === 0 ? (
          <p style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            {open === 0 ? 'הכל מטופל ✓' : 'אין פריטים בסינון הזה'}
          </p>
        ) : (
          <ul className="inbox__list">
            {visible.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggle={() => toggle(item.id)}
                onApprove={() => approve(item)}
                onDismiss={() => dismissMut.mutate(item.id)}
                onSnooze={(hours) => snoozeMut.mutate({ id: item.id, hours })}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
