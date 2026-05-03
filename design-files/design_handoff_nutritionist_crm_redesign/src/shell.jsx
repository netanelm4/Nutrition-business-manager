/* Shell: Sidebar + Topbar */

function Sidebar({ active = 'dash' }) {
  const items = [
    { id: 'dash', label: 'לוח בקרה', icon: I.dash, href: 'Dashboard.html' },
    { id: 'clients', label: 'מטופלים', icon: I.users, count: 47, href: 'Clients.html' },
    { id: 'leads', label: 'לידים', icon: I.leads, count: 12, href: 'Leads.html' },
    { id: 'cal', label: 'פגישות', icon: I.cal, count: 6, href: 'Meetings.html' },
  ];
  const tools = [
    { id: 'protocols', label: 'פרוטוקולים', icon: I.protocol, href: 'Protocols.html' },
    { id: 'templates', label: 'תבניות WhatsApp', icon: I.msg, href: 'Templates.html' },
  ];

  return (
    <aside className="side">
      <div className="side__brand">
        <div className="side__logo">נ</div>
        <div>
          <div className="side__brand-name">נתא</div>
          <div className="side__brand-sub">קריינקת • תזונה</div>
        </div>
      </div>

      <div className="side__sec">עבודה</div>
      {items.map(it => (
        <a key={it.id} href={it.href} className={`nav-item ${active === it.id ? 'is-active' : ''}`}>
          <it.icon size={16}/>
          <span>{it.label}</span>
          {it.count != null && <span className="count">{it.count}</span>}
        </a>
      ))}

      <div className="side__sec">כלים</div>
      {tools.map(it => (
        <a key={it.id} href={it.href} className={`nav-item ${active === it.id ? 'is-active' : ''}`}>
          <it.icon size={16}/>
          <span>{it.label}</span>
        </a>
      ))}

      <div className="side__foot">
        <div className="avatar avatar--blue avatar--lg">נמ</div>
        <div style={{minWidth: 0, flex: 1}}>
          <div className="side__user-name">נתנאל מלכה</div>
          <div className="side__user-role">דיאטן קליני</div>
        </div>
        {window.Dropdown ? (
          <Dropdown
            trigger={<button className="btn btn--ghost btn--icon" title="הגדרות"><I.settings size={15}/></button>}
            items={[
              { head: 'הגדרות' },
              { label: 'פרופיל', icon: I.users, onClick: () => window.act?.('toast', { msg: 'פרופיל יוצג בקרוב' }) },
              { label: 'שעות זמינות', icon: I.clock, onClick: () => location.href = 'Meetings.html' },
              { label: 'אינטגרציות', icon: I.zap, onClick: () => location.href = 'Meetings.html' },
              { sep: true },
              { label: 'התנתק', icon: I.arrow, onClick: () => window.act?.('toast', { msg: 'התנתקות (דמו)', kind: 'info' }) },
            ]}
          />
        ) : (
          <button className="btn btn--ghost btn--icon" title="הגדרות"><I.settings size={15}/></button>
        )}
      </div>
    </aside>
  );
}

function Topbar({ crumbs = [], onToggleAI }) {
  const act = (a, p) => window.act && window.act(a, p);
  return (
    <header className="top">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="search" onClick={() => act('open-cmdk')}>
        <I.search size={14}/>
        <input placeholder="חיפוש מטופלים, לידים, הודעות…" readOnly style={{cursor: 'pointer'}}/>
        <kbd>⌘K</kbd>
      </div>

      <div className="top__spacer"/>

      <div className="top__actions">
        <button className="btn btn--ghost btn--icon" title="התראות" style={{position: 'relative'}}
          onClick={() => act('open-notif')}>
          <I.bell size={16}/>
          <span style={{
            position: 'absolute', top: 5, insetInlineEnd: 5,
            width: 6, height: 6, borderRadius: '50%', background: '#31B996'
          }}/>
        </button>
        <button className="btn" onClick={onToggleAI || (() => act('open-ai'))}>
          <I.sparkle size={14}/> עוזר AI
        </button>
        {window.Dropdown ? (
          <Dropdown
            trigger={<button className="btn btn--primary"><I.plus size={14}/> חדש</button>}
            items={[
              { head: 'צור חדש' },
              { label: 'מטופל/ת', icon: I.users, kbd: '⌘⇧P', onClick: () => act('new-client') },
              { label: 'ליד',      icon: I.leads, kbd: '⌘⇧L', onClick: () => act('new-lead') },
              { label: 'פגישה',    icon: I.cal,   kbd: '⌘⇧M', onClick: () => act('new-meeting') },
              { sep: true },
              { label: 'תבנית WhatsApp', icon: I.msg, onClick: () => act('new-template') },
              { label: 'פרוטוקול', icon: I.protocol, onClick: () => act('toast', { msg: 'בונה פרוטוקול ב-AI…', kind: 'info' }) },
            ]}
          />
        ) : (
          <button className="btn btn--primary" onClick={() => act('new-client')}><I.plus size={14}/> חדש</button>
        )}
      </div>
    </header>
  );
}

Object.assign(window, { Sidebar, Topbar });
