/* Shared interactions toolkit — modals, toasts, dropdowns, notifications, cmdk */

/* ======== Toast system (imperative) ======== */
const Toaster = (() => {
  let listeners = [];
  let id = 0;
  const toasts = [];
  return {
    show(msg, kind = 'success') {
      const t = { id: ++id, msg, kind, leaving: false };
      toasts.push(t);
      listeners.forEach(l => l([...toasts]));
      setTimeout(() => {
        t.leaving = true;
        listeners.forEach(l => l([...toasts]));
        setTimeout(() => {
          const i = toasts.indexOf(t); if (i >= 0) toasts.splice(i, 1);
          listeners.forEach(l => l([...toasts]));
        }, 200);
      }, 2600);
    },
    subscribe(l) { listeners.push(l); return () => { listeners = listeners.filter(x => x !== l); }; }
  };
})();

function ToastHost() {
  const [list, setList] = React.useState([]);
  React.useEffect(() => Toaster.subscribe(setList), []);
  return (
    <div className="toast-wrap">
      {list.map(t => (
        <div key={t.id} className={`toast toast--${t.kind} ${t.leaving ? 'is-leaving' : ''}`}>
          <span className="toast__dot"/>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ======== Modal shell ======== */
function Modal({ title, sub, children, onClose, footer, wide }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="modal__title">{title}</div>
            {sub && <div className="modal__sub">{sub}</div>}
          </div>
          <button className="x-btn" onClick={onClose} aria-label="סגור">✕</button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ======== Dropdown ======== */
function Dropdown({ trigger, items, placement = 'bottom-end' }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef();
  React.useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const align = placement.includes('end') ? { insetInlineEnd: 0 } : { insetInlineStart: 0 };
  return (
    <div ref={ref} style={{position: 'relative', display: 'inline-flex'}}>
      <span onClick={() => setOpen(v => !v)}>{trigger}</span>
      {open && (
        <div className="dropdown" style={{ top: 'calc(100% + 6px)', ...align }}>
          {items.map((it, i) => {
            if (it.sep) return <div key={i} className="dd-sep"/>;
            if (it.head) return <div key={i} className="dd-head">{it.head}</div>;
            return (
              <button key={i} className="dd-item" onClick={() => { setOpen(false); it.onClick && it.onClick(); }}>
                {it.icon && <it.icon size={14}/>}
                <span>{it.label}</span>
                {it.kbd && <span className="kbd">{it.kbd}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ======== Notifications panel ======== */
const INITIAL_NOTIFS = [
  { id: 1, t: 'פיגור תשלום — שירה מזרחי', b: '₪450 לא שולמו 14 ימים. שליחת תזכורת אוטומטית נכשלה.', time: 'לפני 2ש', unread: true, kind: 'alert' },
  { id: 2, t: '3 הודעות WhatsApp ממתינות', b: 'רועי גולן, תמר פרידמן, ועוד אחת.', time: 'לפני 35ד', unread: true, kind: 'msg' },
  { id: 3, t: 'ליד חם חדש — אורי כץ', b: 'פנה דרך הפניה. שווי מוערך ₪3,200.', time: 'לפני 1ש', unread: true, kind: 'lead' },
  { id: 4, t: 'אבי שמיר השיג יעד', b: 'ירידה של 3.2 ק״ג בחודש.', time: 'היום', unread: false, kind: 'win' },
  { id: 5, t: 'סנכרון Google Calendar הושלם', b: '23 פגישות בשבוע הקרוב.', time: 'לפני 10ד', unread: false, kind: 'sys' },
  { id: 6, t: 'פגישה ממתינה לאישור', b: 'מיכל אברהם · ה׳ 14:00', time: 'אתמול', unread: false, kind: 'cal' },
];

function NotifPanel({ onClose }) {
  const [items, setItems] = React.useState(INITIAL_NOTIFS);
  const ref = React.useRef();
  React.useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);
  const unread = items.filter(i => i.unread).length;
  return (
    <div className="notif-panel" ref={ref}>
      <div className="notif-panel__head">
        <div>
          <div style={{fontWeight: 600, fontSize: 14}}>התראות</div>
          <div className="t-xs t-muted">{unread} לא נקראו</div>
        </div>
        <button className="btn btn--ghost btn--sm"
          onClick={() => { setItems(items.map(i => ({...i, unread: false}))); Toaster.show('כל ההתראות סומנו כנקראו', 'info'); }}>
          סמן הכל כנקרא
        </button>
      </div>
      <div className="notif-panel__body">
        {items.map(n => (
          <div key={n.id} className={`notif-item ${!n.unread ? 'is-read' : ''}`}
            onClick={() => { setItems(xs => xs.map(x => x.id === n.id ? {...x, unread: false} : x)); Toaster.show('ההתראה סומנה כנקראה'); }}>
            <span className="notif-item__unread"/>
            <div>
              <div className="notif-item__title">{n.t}</div>
              <div className="notif-item__body">{n.b}</div>
            </div>
            <div className="notif-item__time">{n.time}</div>
          </div>
        ))}
      </div>
      <div style={{padding: 10, borderTop: '1px solid var(--hairline)', textAlign: 'center'}}>
        <a className="t-sm" style={{color: 'var(--blue-ink)', fontWeight: 500}}>צפה בכל ההתראות</a>
      </div>
    </div>
  );
}

/* ======== Command palette ======== */
const CMDK_ITEMS = [
  { group: 'פעולות', items: [
    { label: 'מטופל חדש', icon: (p) => <I.users {...p}/>, kbd: '⌘⇧P', act: 'new-client' },
    { label: 'ליד חדש',   icon: (p) => <I.leads {...p}/>, kbd: '⌘⇧L', act: 'new-lead' },
    { label: 'קבע פגישה', icon: (p) => <I.cal {...p}/>,   kbd: '⌘⇧M', act: 'new-meeting' },
    { label: 'תבנית WhatsApp חדשה', icon: (p) => <I.msg {...p}/>, act: 'new-template' },
  ]},
  { group: 'מעבר', items: [
    { label: 'לוח בקרה',           icon: (p) => <I.dash {...p}/>,     href: 'Dashboard.html' },
    { label: 'מטופלים',             icon: (p) => <I.users {...p}/>,    href: 'Clients.html' },
    { label: 'לידים',               icon: (p) => <I.leads {...p}/>,    href: 'Leads.html' },
    { label: 'פגישות',              icon: (p) => <I.cal {...p}/>,      href: 'Meetings.html' },
    { label: 'פרוטוקולים',          icon: (p) => <I.protocol {...p}/>, href: 'Protocols.html' },
    { label: 'תבניות WhatsApp',     icon: (p) => <I.msg {...p}/>,      href: 'Templates.html' },
  ]},
];

function CmdK({ onClose, onAction }) {
  const [q, setQ] = React.useState('');
  const flat = React.useMemo(() => {
    const r = [];
    CMDK_ITEMS.forEach(g => { r.push({head: g.group}); g.items.forEach(i => r.push(i)); });
    return r;
  }, []);
  const filtered = !q ? flat : flat.filter(i => i.head || i.label.includes(q));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input autoFocus className="cmdk__input" placeholder="הקלד פקודה או חפש…"
          value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}/>
        <div className="cmdk__list">
          {filtered.map((it, i) => {
            if (it.head) return <div key={i} className="dd-head">{it.head}</div>;
            return (
              <button key={i} className="dd-item" onClick={() => {
                if (it.href) { location.href = it.href; }
                else if (it.act) { onAction(it.act); }
                onClose();
              }}>
                <it.icon size={14}/>
                <span>{it.label}</span>
                {it.kbd && <span className="kbd">{it.kbd}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ======== Create forms (mocked but realistic) ======== */
function NewClientForm({ onClose }) {
  const [f, setF] = React.useState({name:'', phone:'', email:'', goal:'', protocol:'med'});
  return (
    <Modal title="מטופל/ת חדש/ה" sub="הזנה מהירה — שאר הפרטים בטופס אינטייק" onClose={onClose}
      footer={<>
        <span className="t-xs t-muted">לאחר שמירה תישלח הודעת אינטייק אוטומטית</span>
        <div style={{display:'flex', gap: 8}}>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn--primary" onClick={() => { onClose(); Toaster.show(`${f.name || 'מטופל'} נוצר/ה בהצלחה`); }}>
            צור מטופל/ת
          </button>
        </div>
      </>}>
      <div className="field-row">
        <div className="field"><label>שם מלא</label><input value={f.name} onChange={e => setF({...f, name: e.target.value})} placeholder="לדוגמה: רחל כהן"/></div>
        <div className="field"><label>טלפון</label><input value={f.phone} onChange={e => setF({...f, phone: e.target.value})} placeholder="054-…"/></div>
      </div>
      <div className="field"><label>מייל</label><input value={f.email} onChange={e => setF({...f, email: e.target.value})} placeholder="example@gmail.com"/></div>
      <div className="field-row">
        <div className="field"><label>יעד טיפולי</label><input value={f.goal} onChange={e => setF({...f, goal: e.target.value})} placeholder="ירידה במשקל / סוכרת / ..."/></div>
        <div className="field">
          <label>פרוטוקול התחלתי</label>
          <select value={f.protocol} onChange={e => setF({...f, protocol: e.target.value})}>
            <option value="med">ים-תיכוני מותאם</option>
            <option value="wl">דלדול משקל מדורג</option>
            <option value="veg">טבעוני מאוזן</option>
            <option value="none">לא עכשיו</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

function NewLeadForm({ onClose }) {
  const [f, setF] = React.useState({name:'', phone:'', src:'ref', goal:'', value:''});
  return (
    <Modal title="ליד חדש" onClose={onClose}
      footer={<>
        <label className="t-xs t-muted" style={{display:'flex', alignItems:'center', gap: 6}}>
          <input type="checkbox" defaultChecked/> שלח הודעת פתיחה אוטומטית
        </label>
        <div style={{display:'flex', gap: 8}}>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn--primary" onClick={() => { onClose(); Toaster.show('הליד נוסף לעמודת ״חדש״'); }}>
            הוסף ליד
          </button>
        </div>
      </>}>
      <div className="field-row">
        <div className="field"><label>שם</label><input value={f.name} onChange={e => setF({...f, name: e.target.value})}/></div>
        <div className="field"><label>טלפון / מייל</label><input value={f.phone} onChange={e => setF({...f, phone: e.target.value})}/></div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>מקור</label>
          <select value={f.src} onChange={e => setF({...f, src: e.target.value})}>
            <option value="ref">הפניה</option>
            <option value="ads">מודעה</option>
            <option value="inst">אינסטגרם</option>
            <option value="other">אחר</option>
          </select>
        </div>
        <div className="field"><label>שווי מוערך (₪)</label><input value={f.value} onChange={e => setF({...f, value: e.target.value})} placeholder="2400"/></div>
      </div>
      <div className="field"><label>יעד / הערה</label><textarea value={f.goal} onChange={e => setF({...f, goal: e.target.value})} placeholder="מה הליד מחפש?"/></div>
    </Modal>
  );
}

function NewMeetingForm({ onClose }) {
  const [f, setF] = React.useState({client:'', type:'followup', date:'', time:'', loc:'meet'});
  return (
    <Modal title="קביעת פגישה" onClose={onClose}
      footer={<>
        <span className="t-xs t-muted">קישור Google Meet ייווצר אוטומטית</span>
        <div style={{display:'flex', gap: 8}}>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn--primary" onClick={() => { onClose(); Toaster.show('הפגישה נקבעה · תזכורת WhatsApp נשלחה 24ש לפני'); }}>
            שמור פגישה
          </button>
        </div>
      </>}>
      <div className="field">
        <label>מטופל/ת</label>
        <select value={f.client} onChange={e => setF({...f, client: e.target.value})}>
          <option value="">בחר מטופל…</option>
          <option>רחל כהן</option><option>יואב לוי</option><option>מיכל אברהם</option>
          <option>דנה בן-דוד</option><option>אבי שמיר</option><option>תמר פרידמן</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label>סוג פגישה</label>
          <select value={f.type} onChange={e => setF({...f, type: e.target.value})}>
            <option value="first">פגישה ראשונה (60ד)</option>
            <option value="followup">מעקב (45ד)</option>
            <option value="checkin">צ׳ק-אין (30ד)</option>
          </select>
        </div>
        <div className="field">
          <label>מיקום</label>
          <select value={f.loc} onChange={e => setF({...f, loc: e.target.value})}>
            <option value="meet">Google Meet</option>
            <option value="office">משרד — ת״א</option>
            <option value="phone">טלפון</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field"><label>תאריך</label><input type="date" value={f.date} onChange={e => setF({...f, date: e.target.value})}/></div>
        <div className="field"><label>שעה</label><input type="time" value={f.time} onChange={e => setF({...f, time: e.target.value})}/></div>
      </div>
    </Modal>
  );
}

function NewTemplateForm({ onClose }) {
  const [f, setF] = React.useState({name:'', cat:'checkin', body:''});
  return (
    <Modal title="תבנית WhatsApp חדשה" sub="השתמש ב-{{משתנה}} כדי לסמן ערכים אוטומטיים" onClose={onClose} wide
      footer={<>
        <button className="btn"><I.sparkle size={12}/> נסח ב-AI</button>
        <div style={{display:'flex', gap: 8}}>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn--primary" onClick={() => { onClose(); Toaster.show('התבנית נשמרה'); }}>
            שמור תבנית
          </button>
        </div>
      </>}>
      <div className="field-row">
        <div className="field"><label>שם תבנית</label><input value={f.name} onChange={e => setF({...f, name: e.target.value})} placeholder="לדוגמה: תזכורת פגישה"/></div>
        <div className="field">
          <label>קטגוריה</label>
          <select value={f.cat} onChange={e => setF({...f, cat: e.target.value})}>
            <option value="onboard">קליטה</option>
            <option value="checkin">צ׳ק-אין</option>
            <option value="reminder">תזכורות</option>
            <option value="payment">תשלומים</option>
            <option value="results">בדיקות</option>
            <option value="celebrate">חגיגות</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>גוף ההודעה</label>
        <textarea rows="7" value={f.body} onChange={e => setF({...f, body: e.target.value})}
          placeholder={"שלום {{שם_פרטי}},\nההודעה שלך…"}/>
      </div>
    </Modal>
  );
}

/* ======== Global action dispatcher ======== */
function ActionProvider({ children }) {
  const [modal, setModal] = React.useState(null);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [cmdk, setCmdk] = React.useState(false);

  const run = React.useCallback((action, payload) => {
    switch (action) {
      case 'new-client':   setModal('client'); break;
      case 'new-lead':     setModal('lead'); break;
      case 'new-meeting':  setModal('meeting'); break;
      case 'new-template': setModal('template'); break;
      case 'open-notif':   setNotifOpen(v => !v); break;
      case 'open-cmdk':    setCmdk(true); break;
      case 'toast':        Toaster.show(payload?.msg || 'בוצע', payload?.kind || 'success'); break;
      case 'open-ai':
        window.dispatchEvent(new CustomEvent('open-ai'));
        break;
      default: break;
    }
  }, []);

  // Global keyboard
  React.useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk(true); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setModal('client'); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setModal('lead'); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); setModal('meeting'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Expose globally
  React.useEffect(() => {
    window.act = run;
  }, [run]);

  return (
    <>
      {children}
      {modal === 'client' && <NewClientForm onClose={() => setModal(null)}/>}
      {modal === 'lead' && <NewLeadForm onClose={() => setModal(null)}/>}
      {modal === 'meeting' && <NewMeetingForm onClose={() => setModal(null)}/>}
      {modal === 'template' && <NewTemplateForm onClose={() => setModal(null)}/>}
      {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)}/>}
      {cmdk && <CmdK onClose={() => setCmdk(false)} onAction={run}/>}
      <ToastHost/>
    </>
  );
}

Object.assign(window, {
  Toaster, Modal, Dropdown, NotifPanel, CmdK, ActionProvider,
  NewClientForm, NewLeadForm, NewMeetingForm, NewTemplateForm
});
