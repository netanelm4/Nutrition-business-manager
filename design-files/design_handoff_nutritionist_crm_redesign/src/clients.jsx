/* Clients list + detail components */

function ClientsList({ onOpen, filter, setFilter }) {
  const q = (filter.q || '').trim();
  const visible = CLIENTS.filter(c => {
    if (filter.status !== 'all' && c.status !== filter.status) return false;
    if (q && !c.name.includes(q) && !c.email.includes(q) && !c.goal.includes(q)) return false;
    return true;
  });

  const counts = {
    all: CLIENTS.length,
    active: CLIENTS.filter(c => c.status === 'active').length,
    paused: CLIENTS.filter(c => c.status === 'paused').length,
    overdue: CLIENTS.filter(c => c.status === 'overdue').length,
  };

  const statusLabel = { active: 'פעיל', paused: 'מושהה', overdue: 'פיגור תשלום' };
  const statusChip  = { active: 'chip--green', paused: 'chip', overdue: 'chip--red' };

  return (
    <>
      <div className="subhead">
        <div className="seg">
          {[
            { id: 'all', label: 'הכל' },
            { id: 'active', label: 'פעילים' },
            { id: 'paused', label: 'מושהים' },
            { id: 'overdue', label: 'פיגור תשלום' },
          ].map(t => (
            <button key={t.id}
              className={filter.status === t.id ? 'is-active' : ''}
              onClick={() => setFilter({...filter, status: t.id})}>
              {t.label}<span className="count">{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <div className="search" style={{flex: '0 0 260px', margin: 0}}>
            <I.search size={14}/>
            <input
              placeholder="חיפוש שם, מייל, או יעד…"
              value={filter.q || ''}
              onChange={e => setFilter({...filter, q: e.target.value})}
            />
          </div>
          <button className="btn" onClick={() => Toaster.show('סינון', 'info')}><I.filter size={13}/> סינון</button>
          <button className="btn btn--primary" onClick={() => window.act('new-client')}><I.plus size={13}/> מטופל חדש</button>
        </div>
      </div>

      <section className="card" style={{padding: 0, overflow: 'hidden'}}>
        <table className="table">
          <thead>
            <tr>
              <th style={{width: '28%'}}>מטופל</th>
              <th>יעד טיפולי</th>
              <th style={{width: 120}}>סטטוס</th>
              <th style={{width: 130}}>6 פגישות</th>
              <th style={{width: 80}}>התקדמות</th>
              <th style={{width: 130}}>פגישה הבאה</th>
              <th style={{width: 120}}>תשלום</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td>
                  <div className="client-name">
                    <div className={`avatar avatar--${c.c} avatar--lg`}>{c.name.slice(0,2)}</div>
                    <div>
                      <div className="nm">{c.name}</div>
                      <div className="em">{c.email}</div>
                    </div>
                  </div>
                </td>
                <td>{c.goal}</td>
                <td>
                  <span className={`chip ${statusChip[c.status]}`}>
                    <span className="dot"/>{statusLabel[c.status]}
                  </span>
                </td>
                <td>
                  <div className="dots">
                    {c.sessions.map((s, i) => (
                      <i key={i} className={s === 1 ? 'on' : s === 2 ? 'cur' : ''}/>
                    ))}
                  </div>
                </td>
                <td>
                  <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                    <div className="ring" style={{'--p': c.pct, '--c': c.pct >= 75 ? 'var(--green)' : c.pct >= 50 ? 'var(--blue)' : 'oklch(0.72 0.13 70)', width: 26, height: 26}}>
                      <span style={{fontSize: 9}}>{c.pct}</span>
                    </div>
                  </div>
                </td>
                <td className="t-num t-muted" style={{fontSize: 12.5}}>{c.next}</td>
                <td style={{fontSize: 12.5, color: c.status === 'overdue' ? 'var(--red-ink)' : 'var(--ink-2)', fontWeight: c.status === 'overdue' ? 600 : 400}}>{c.paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-3)'}}>
        <span>מציג {visible.length} מתוך {CLIENTS.length} מטופלים</span>
        <span>מיון: פעילות אחרונה ↓</span>
      </div>
    </>
  );
}

/* ---------- Client detail ---------- */
function ClientDetail({ id, onBack }) {
  const c = CLIENTS.find(x => x.id === id) || CLIENTS[0];
  const [tab, setTab] = React.useState('timeline');

  const tabs = [
    { id: 'timeline', label: 'טיימליין', count: 6 },
    { id: 'intake', label: 'טופס אינטייק' },
    { id: 'protocol', label: 'פרוטוקול' },
    { id: 'messages', label: 'הודעות', count: 23 },
    { id: 'payments', label: 'תשלומים' },
    { id: 'files', label: 'קבצים', count: 4 },
  ];

  return (
    <>
      <a className="back" onClick={onBack} style={{cursor: 'pointer'}}>
        <I.chev size={12} style={{transform: 'scaleX(-1)'}}/> חזרה לכל המטופלים
      </a>

      <div className="page__head">
        <div>
          <div className="page__title">{c.name}</div>
          <div className="page__sub">{c.goal} · מטופל/ת מאז {c.joined} · רצף {c.streak} ימים</div>
        </div>
        <div className="page__actions">
          <button className="btn" onClick={() => Toaster.show('פותח WhatsApp', 'info')}><I.msg size={13}/> WhatsApp</button>
          <button className="btn" onClick={() => Toaster.show('מחייג…', 'info')}><I.phone size={13}/> התקשר</button>
          <button className="btn btn--primary" onClick={() => window.act('new-meeting')}><I.cal size={13}/> קבע פגישה</button>
        </div>
      </div>

      <div className="detail">
        {/* Left rail */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <section className="card profile">
            <div className="profile__top">
              <div className={`profile__avatar`} style={{
                background: c.c === 'pink' ? 'var(--pink-soft)' : c.c === 'blue' ? 'var(--blue-soft)' : 'var(--green-soft)',
                color: c.c === 'pink' ? 'var(--pink-ink)' : c.c === 'blue' ? 'var(--blue-ink)' : 'var(--green-ink)'
              }}>{c.name.slice(0,2)}</div>
              <div style={{minWidth: 0}}>
                <div className="profile__name">{c.name}</div>
                <div className="profile__meta">גיל {c.age} · {c.status === 'active' ? 'מטופל/ת פעיל/ה' : c.status === 'overdue' ? 'פיגור תשלום' : 'מושהה'}</div>
              </div>
            </div>
            <dl className="kv">
              <dt>טלפון</dt><dd className="t-num">{c.phone}</dd>
              <dt>מייל</dt><dd style={{fontSize: 12.5, fontWeight: 400}}>{c.email}</dd>
              <dt>יעד</dt><dd>{c.goal}</dd>
              <dt>פרוטוקול</dt><dd>ים-תיכוני מותאם</dd>
              <dt>פגישה הבאה</dt><dd>{c.next}</dd>
              <dt>הצטרפות</dt><dd>{c.joined}</dd>
              <dt>תשלום</dt><dd style={{color: c.status === 'overdue' ? 'var(--red-ink)' : 'var(--ink-1)'}}>{c.paid}</dd>
            </dl>
          </section>

          <section className="card ai-sum">
            <div className="ai-sum__head">
              <I.sparkle size={12}/> סיכום AI · מעודכן לפני 2 שעות
            </div>
            <div className="ai-sum__body">
              {c.name.split(' ')[0]} מראה <b>התקדמות עקבית</b> ב-6 השבועות האחרונים. רצף של <b>{c.streak} ימי דיווח</b>, עלייה של 12% בצריכת חלבון יומית, וירידה של <b>{(c.pct/20).toFixed(1)} ק״ג</b> מתחילת הפרוטוקול. שים לב: צריכת נוזלים ירדה מתחת ליעד ב-3 ימים האחרונים — מומלץ לציין בצ׳ק-אין.
            </div>
            <div style={{display: 'flex', gap: 6, marginTop: 10}}>
              <button className="btn btn--sm" onClick={() => Toaster.show('AI מכין הצעות…', 'info')}><I.sparkle size={11}/> הצעות לפגישה</button>
              <button className="btn btn--sm" onClick={() => Toaster.show('סיכום יוצא ל-PDF')}>ייצא סיכום</button>
            </div>
          </section>
        </div>

        {/* Main content */}
        <section className="card" style={{padding: 0}}>
          <div className="detail-tabs">
            {tabs.map(t => (
              <button key={t.id}
                className={tab === t.id ? 'is-active' : ''}
                onClick={() => setTab(t.id)}>
                {t.label}
                {t.count && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>

          {tab === 'timeline' && <Timeline c={c}/>}
          {tab === 'intake' && <IntakePanel/>}
          {tab === 'protocol' && <ProtocolPanel c={c}/>}
          {tab === 'messages' && <MessagesPanel c={c}/>}
          {tab === 'payments' && <PaymentsPanel c={c}/>}
          {tab === 'files' && <div style={{padding: 40, textAlign: 'center', color: 'var(--ink-3)'}}>4 קבצים · בדיקות דם, טופס אינטייק, 2 תמונות</div>}
        </section>
      </div>
    </>
  );
}

function Timeline({ c }) {
  const items = [
    { st: 'done', t: 'פגישה ראשונה — אינטייק',      s: 'הוערך BMI 28.4 · היעד: ירידה של 8 ק״ג ב-6 חודשים', d: 'א׳, 12 ינו', h: '60 דק׳' },
    { st: 'done', t: 'מעקב #1 — תוכנית תזונה',        s: 'הוגדרו 3 ארוחות + 2 ביניים · מעקב יומי ביומן', d: 'א׳, 26 ינו', h: '45 דק׳' },
    { st: 'done', t: 'מעקב #2 — התאמת חלבון',          s: 'עלייה של 12% בצריכת חלבון · ירידה של 1.8 ק״ג', d: 'א׳, 9 פבר', h: '30 דק׳' },
    { st: 'done', t: 'מעקב #3 — תוצאות בדיקות דם',    s: 'HbA1c 6.2 · ויטמין D נמוך, הוחל סופלמנט', d: 'א׳, 23 מרץ', h: '45 דק׳' },
    { st: 'cur',  t: 'מעקב #4 — היום', s: 'מתוכנן · התאמת פרוטוקול אחרי תוצאות חדשות', d: 'היום', h: '45 דק׳' },
    { st: 'next', t: 'מעקב #5 — מתוכנן',                s: 'סקירת התקדמות חודשית', d: 'א׳, 7 מאי', h: '30 דק׳' },
  ];
  return (
    <div className="timeline">
      {items.map((it, i) => (
        <div key={i} className={`tl-item is-${it.st}`}>
          <div className="tl-item__dot"/>
          <div className="tl-item__body">
            <div className="t">{it.t}</div>
            <div className="s">{it.s}</div>
          </div>
          <div className="tl-item__date">
            <span className="d">{it.d}</span>
            <span>{it.h}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function IntakePanel() {
  const rows = [
    { k: 'גובה',              v: '164 ס״מ' },
    { k: 'משקל בתחילת טיפול', v: '76.8 ק״ג' },
    { k: 'משקל נוכחי',        v: '73.2 ק״ג (−3.6)' },
    { k: 'תרופות קבועות',      v: 'מטפורמין 500mg · ויטמין D' },
    { k: 'רגישויות',           v: 'לקטוז (קלה)' },
    { k: 'מחלות משפחתיות',     v: 'סוכרת T2 (אם), יל״ד (אב)' },
    { k: 'רמת פעילות',          v: 'בינונית — 3 אימונים בשבוע' },
    { k: 'הרגלי שינה',           v: '6–7 שעות · איכות טובה' },
    { k: 'רמת לחץ יומית',         v: 'בינונית' },
  ];
  return (
    <div style={{padding: '18px 22px'}}>
      <div className="t-eyebrow" style={{marginBottom: 12}}>נתונים רפואיים</div>
      <dl className="kv" style={{gridTemplateColumns: '180px 1fr', borderTop: 0, paddingTop: 0}}>
        {rows.map((r, i) => (<React.Fragment key={i}><dt>{r.k}</dt><dd>{r.v}</dd></React.Fragment>))}
      </dl>
    </div>
  );
}

function ProtocolPanel({ c }) {
  return (
    <div style={{padding: '18px 22px'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14}}>
        <div>
          <div className="h-2">פרוטוקול: ים-תיכוני מותאם</div>
          <div className="t-sm t-muted">מותאם אישית · 1,850 קלוריות · 35% חלבון</div>
        </div>
        <button className="btn btn--sm" onClick={() => Toaster.show('מתאים פרוטוקול מחדש עם AI…', 'info')}><I.sparkle size={11}/> התאם מחדש ב-AI</button>
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10}}>
        {[
          { n: 'חלבון',      v: '130g', p: 85, c: 'var(--blue)' },
          { n: 'פחמימות',    v: '180g', p: 62, c: 'var(--green)' },
          { n: 'שומנים',     v: '68g',  p: 74, c: 'oklch(0.7 0.12 40)' },
        ].map((m, i) => (
          <div key={i} style={{
            border: '1px solid var(--hairline)', borderRadius: 10, padding: 12
          }}>
            <div style={{fontSize: 11, color: 'var(--ink-3)', marginBottom: 6}}>{m.n}</div>
            <div style={{fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em'}}>{m.v}</div>
            <div style={{height: 4, background: 'var(--surface-3)', borderRadius: 99, marginTop: 10, overflow: 'hidden'}}>
              <div style={{width: m.p + '%', height: '100%', background: m.c}}/>
            </div>
            <div className="t-xs t-muted" style={{marginTop: 4}}>{m.p}% מהיעד השבועי</div>
          </div>
        ))}
      </div>

      <div className="t-eyebrow" style={{marginTop: 18, marginBottom: 10}}>ארוחות יומיות</div>
      {['בוקר — 07:00', 'ביניים — 10:30', 'צהריים — 13:00', 'ביניים — 16:30', 'ערב — 19:30'].map((m, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', padding: '8px 0',
          borderBottom: '1px solid var(--hairline)', fontSize: 13
        }}>
          <span style={{fontWeight: 500}}>{m}</span>
          <span className="t-muted t-sm">
            {['שיבולת שועל + פירות יער + אגוזים', 'יוגורט יווני + דבש', 'סלט ים-תיכוני + עוף אפוי', 'חומוס + ירקות', 'דג אפוי + קינואה + ירקות מאודים'][i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function MessagesPanel({ c }) {
  const msgs = [
    { who: 'client', t: 'שלום נתנאל, היה לי כאב בטן קל אחרי ארוחת הצהריים היום. חשבתי לציין.', at: '14:22' },
    { who: 'me', t: 'תודה שעדכנת! זה קרה גם בימים הקודמים או פעם ראשונה? האם אכלת משהו חדש?', at: '14:35' },
    { who: 'client', t: 'פעם ראשונה, והייתה לי מנה של עדשים שחורות שלא אכלתי הרבה זמן.', at: '14:41' },
    { who: 'me', t: 'נשמע כמו רגישות זמנית לקטניות אחרי הפסקה ארוכה. ננסה להתחיל בכמות קטנה יותר ונעדכן בפרוטוקול. נדבר מחר בפגישה 🙏', at: '14:48', template: true },
  ];
  return (
    <div style={{padding: '10px 18px 16px'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px 10px'}}>
        <div className="t-eyebrow">צ׳ק-אין שבועי · 23 הודעות</div>
        <button className="btn btn--sm" onClick={() => Toaster.show('היסטוריית שיחות נפתחה')}>כל השיחה <I.chev size={11}/></button>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start',
            maxWidth: '78%',
            background: m.who === 'me' ? 'var(--blue)' : 'var(--surface-3)',
            color: m.who === 'me' ? '#fff' : 'var(--ink-1)',
            padding: '8px 12px', borderRadius: 12,
            borderBottomLeftRadius: m.who === 'me' ? 12 : 4,
            borderBottomRightRadius: m.who === 'me' ? 4 : 12,
            fontSize: 13, lineHeight: 1.5
          }}>
            {m.t}
            <div style={{
              fontSize: 10.5, marginTop: 4,
              opacity: 0.7,
              display: 'flex', gap: 6, alignItems: 'center'
            }}>
              {m.template && <span>⚡ תבנית</span>}
              <span className="t-num">{m.at}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsPanel({ c }) {
  const rows = [
    { d: '15.04.26', item: 'חבילה חודשית — אפריל',   amt: '₪450', st: 'paid' },
    { d: '15.03.26', item: 'חבילה חודשית — מרץ',     amt: '₪450', st: 'paid' },
    { d: '15.02.26', item: 'חבילה חודשית — פברואר',  amt: '₪450', st: 'paid' },
    { d: '12.01.26', item: 'פגישת אינטייק',           amt: '₪280', st: 'paid' },
  ];
  return (
    <div className="pay">
      <div style={{padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--hairline)'}}>
        <div>
          <div className="t-sm t-muted">סה״כ שולם</div>
          <div style={{fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em'}}>₪1,630</div>
        </div>
        <button className="btn btn--sm" onClick={() => Toaster.show('חשבונית נשלחה ב-WhatsApp')}>שלח חשבונית</button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="pay__row">
          <span className="pay__date">{r.d}</span>
          <span>{r.item}</span>
          <span className="t-num" style={{fontWeight: 600}}>{r.amt}</span>
          <span className="chip chip--green"><span className="dot"/>שולם</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { ClientsList, ClientDetail });
