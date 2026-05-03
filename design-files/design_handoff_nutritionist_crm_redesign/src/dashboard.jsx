/* Dashboard sections */

function Sparkline({ points, color = '#567DBF' }) {
  const w = 68, h = 24, p = 2;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = (w - p * 2) / (points.length - 1);
  const d = points.map((v, i) => {
    const x = p + i * step;
    const y = h - p - ((v - min) / range) * (h - p * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${d} L${p + (points.length - 1) * step},${h - p} L${p},${h - p} Z`;
  return (
    <svg className="stat__spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={color} fillOpacity="0.08"/>
      <path d={d} stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function StatCard({ label, value, delta, dir, sub, spark }) {
  const color = dir === 'up' ? '#31B996' : dir === 'down' ? 'oklch(0.5 0.14 20)' : '#567DBF';
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      <div className="stat__delta">
        <span className={dir === 'up' ? 'up' : dir === 'down' ? 'down' : ''}>{delta}</span>
        {sub && <span className="t-faint">· {sub}</span>}
      </div>
      <Sparkline points={spark} color={color}/>
    </div>
  );
}

function Stats() {
  return (
    <div className="grid-stats">
      {DATA.STATS.map((s, i) => <StatCard key={i} {...s}/>)}
    </div>
  );
}

/* ----- Eisenhower tasks ----- */
function Tasks() {
  const [tab, setTab] = React.useState('all');
  const [tasks, setTasks] = React.useState(DATA.TASKS);

  const tabs = [
    { id: 'all', label: 'הכל', count: tasks.length },
    { id: 'q1', label: 'דחוף וחשוב', count: tasks.filter(t => t.quad === 'q1').length },
    { id: 'q2', label: 'חשוב', count: tasks.filter(t => t.quad === 'q2').length },
    { id: 'q3', label: 'דחוף', count: tasks.filter(t => t.quad === 'q3').length },
    { id: 'q4', label: 'שגרה', count: tasks.filter(t => t.quad === 'q4').length },
  ];

  const visible = tab === 'all' ? tasks : tasks.filter(t => t.quad === tab);
  const done = tasks.filter(t => t.done).length;

  const toggle = (id) => setTasks(ts => ts.map(t => t.id === id ? {...t, done: !t.done} : t));

  const quadLabels = { q1: 'דחוף', q2: 'חשוב', q3: 'דחוף', q4: 'שגרה' };

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2">המשימות שלי היום</div>
          <div className="t-sm t-muted" style={{marginTop: 2}}>
            מטריצת אייזנהאואר · {done} מתוך {tasks.length} הושלמו
          </div>
        </div>
        <div className="tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={tab === t.id ? 'is-active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="count">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card__body">
        {visible.map(t => {
          const client = t.client != null ? DATA.CLIENTS_INITIALS[t.client] : null;
          return (
            <div key={t.id} className={`task ${t.done ? 'is-done' : ''}`}>
              <button
                className={`check ${t.done ? 'is-on' : ''}`}
                onClick={() => toggle(t.id)}
                aria-label="השלם משימה"
              >
                {t.done && <I.check size={12} sw={2.4}/>}
              </button>

              <div className="task__title">
                <span>{t.title}</span>
                {t.sub && <span className="sub">· {t.sub}</span>}
              </div>

              <div className="task__meta">
                {client && (
                  <span className="task__client">
                    <span className={`avatar avatar--${client.c}`} style={{width: 20, height: 20, fontSize: 10}}>{client.i}</span>
                    {client.name}
                  </span>
                )}
              </div>

              <div className="task__meta">
                <span className={`quad quad--${t.quad}`}>{quadLabels[t.quad]}</span>
                <span className="t-num" style={{minWidth: 38, textAlign: 'end'}}>{t.due}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card__foot">
        <span>4 משימות יומיות · 2 שבועיות · 1 חודשית</span>
        <a className="btn btn--ghost btn--sm" onClick={() => Toaster.show('פתיחת מטריצת אייזנהאוור', 'info')}>
          צפייה במטריצה המלאה
          <I.chev size={12}/>
        </a>
      </div>
    </section>
  );
}

/* ----- Sessions ----- */
function Sessions() {
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2">פגישות היום</div>
          <div className="t-sm t-muted" style={{marginTop: 2}}>חמישי, 23 באפריל</div>
        </div>
        <div style={{display: 'flex', gap: 6}}>
          <button className="btn btn--sm" onClick={() => Toaster.show('מעבר לתצוגת שבועי')}><I.cal size={12}/> השבוע</button>
          <button className="btn btn--ghost btn--sm btn--icon"><I.more size={14}/></button>
        </div>
      </div>

      <div className="card__body">
        {DATA.SESSIONS.map((s, i) => {
          const c = DATA.CLIENTS_INITIALS[s.client];
          return (
            <div key={i} className="sess">
              <div className="sess__time">
                <span className="hh">{s.time[0]}</span>
                <span className="mm">{s.time[1]}</span>
              </div>
              <div className="sess__body">
                <div className="sess__who">
                  <span className={`avatar avatar--${c.c}`} style={{width: 22, height: 22, fontSize: 10}}>{c.i}</span>
                  {s.name}
                  {s.status === 'pending' && <span className="chip chip--amber">ממתין לאישור</span>}
                </div>
                <div className="sess__det">
                  <span>{s.type}</span>
                  <span className="sep"/>
                  <span style={{display: 'inline-flex', alignItems: 'center', gap: 4}}>
                    {s.loc.includes('Meet') ? <I.video size={12}/> : s.loc.includes('טלפון') ? <I.phone size={12}/> : <I.pin size={12}/>}
                    {s.loc}
                  </span>
                </div>
              </div>
              <button className="btn btn--sm" onClick={() => Toaster.show('קישור Google Meet הועתק')}>הצטרף</button>
            </div>
          );
        })}
      </div>

      <div className="card__foot">
        <span>5 פגישות · סה״כ 3:30 שעות</span>
        <a className="btn btn--ghost btn--sm" onClick={() => Toaster.show('מעבר ללוח השבועי')}>לוח השבוע <I.chev size={12}/></a>
      </div>
    </section>
  );
}

/* ----- Alerts ----- */
function Alerts() {
  const iconMap = { warn: I.warn, msg: I.msg, clock: I.clock, heart: I.heart };
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2">התראות</div>
          <div className="t-sm t-muted" style={{marginTop: 2}}>4 פריטים דורשים טיפול</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => Toaster.show('כל ההתראות סומנו כנקראו')}>סמן הכל כנקרא</button>
      </div>
      <div className="card__body">
        {DATA.ALERTS.map((a, i) => {
          const Ic = iconMap[a.icon];
          return (
            <div key={i} className="alert">
              <div className={`alert__icon is-${a.kind}`}><Ic size={14}/></div>
              <div>
                <div className="alert__title">{a.title}</div>
                <div className="alert__body">{a.body}</div>
              </div>
              <div className="alert__time">{a.time}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ----- Progress rail (compact client snapshot) ----- */
function Progress() {
  const rows = [
    { name: 'רחל כהן',     plan: 'סוכרת T2',      pct: 72, c: 'pink',  trend: '+5%', streak: 14 },
    { name: 'יואב לוי',    plan: 'ירידה במשקל',   pct: 58, c: 'blue',  trend: '+2%', streak: 21 },
    { name: 'מיכל אברהם',   plan: 'טבעוני מאוזן',   pct: 91, c: 'green', trend: '+8%', streak: 30 },
    { name: 'דנה בן-דוד',  plan: 'תסמונת מטבולית', pct: 44, c: 'pink',  trend: '−1%', streak: 7 },
    { name: 'אבי שמיר',    plan: 'ספורטאי',        pct: 83, c: 'blue',  trend: '+4%', streak: 45 },
  ];
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="h-2">התקדמות מטופלים</div>
          <div className="t-sm t-muted" style={{marginTop: 2}}>5 פעילים ביותר השבוע</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => location.href='Clients.html'}>כל המטופלים <I.chev size={12}/></button>
      </div>

      <div className="card__body">
        {rows.map((r, i) => (
          <div key={i} className="task" style={{gridTemplateColumns: '36px 1fr 52px 64px'}}>
            <span className={`avatar avatar--${r.c} avatar--lg`}>{r.name.slice(0,2)}</span>

            <div style={{minWidth: 0}}>
              <div style={{fontWeight: 600, fontSize: 13.5}}>{r.name}</div>
              <div className="t-sm t-muted" style={{display:'flex', gap: 8, marginTop: 2}}>
                <span>{r.plan}</span>
                <span className="t-faint">·</span>
                <span>{r.streak} ימי רצף</span>
              </div>
            </div>

            <div style={{
              fontSize: 11.5, fontWeight: 600,
              color: r.trend.startsWith('+') ? 'var(--green-ink)' : 'var(--red-ink)',
              fontVariantNumeric: 'tabular-nums', textAlign: 'end'
            }}>{r.trend}</div>

            <div style={{display:'flex', alignItems:'center', gap: 8, justifyContent:'flex-end'}}>
              <div className="ring" style={{'--p': r.pct, '--c': r.pct >= 75 ? 'var(--green)' : r.pct >= 50 ? 'var(--blue)' : 'oklch(0.72 0.13 70)'}}>
                <span>{r.pct}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

Object.assign(window, { Stats, Tasks, Sessions, Alerts, Progress });
