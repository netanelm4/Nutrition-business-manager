/* Meetings week view + integrations */

function WeekCalendar() {
  const hours = [8,9,10,11,12,13,14,15,16,17,18];
  const HOUR_PX = 56;
  const START_H = 8;
  const nowH = 11.5; // simulated "now" line at 11:30

  return (
    <section className="card" style={{padding: 0, overflow: 'hidden'}}>
      <div className="card__head">
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <button className="btn btn--ghost btn--icon"><I.chev size={14}/></button>
          <div className="h-2">20–24 באפריל 2026</div>
          <button className="btn btn--ghost btn--icon" style={{transform:'scaleX(-1)'}}><I.chev size={14}/></button>
        </div>
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          <div className="seg">
            <button>יום</button>
            <button className="is-active">שבוע</button>
            <button>חודש</button>
          </div>
          <button className="btn btn--sm" onClick={() => Toaster.show('היום')}>היום</button>
          <button className="btn btn--primary btn--sm" onClick={() => window.act('new-meeting')}><I.plus size={12}/> פגישה</button>
        </div>
      </div>

      <div className="cal-grid">
        {/* Header row */}
        <div className="cal-head" style={{background:'var(--surface)'}}></div>
        {WEEK_DAYS.map(d => (
          <div key={d.id} className={`cal-head ${d.today ? 'is-today' : ''}`}>
            <div>{d.nm}</div>
            <div className="dd">{d.dd}</div>
          </div>
        ))}

        {/* Hour rows */}
        {hours.map((h, hi) => (
          <React.Fragment key={h}>
            <div className="cal-hour">{String(h).padStart(2,'0')}:00</div>
            {WEEK_DAYS.map(d => (
              <div key={d.id} className="cal-cell" style={{position:'relative'}}>
                {hi === 0 && WEEK_EVENTS.filter(e => e.d === d.id).map((e, i) => {
                  const top = (e.s - START_H) * HOUR_PX;
                  const height = (e.e - e.s) * HOUR_PX - 2;
                  return (
                    <div key={i} className={`cal-evt cal-evt--${e.c}`} style={{
                      top: top, height: height, zIndex: 1
                    }}>
                      <div className="nm">{e.nm}</div>
                      <div className="mt">{e.mt}</div>
                    </div>
                  );
                })}
                {hi === 0 && d.today && (
                  <div className="cal-now" style={{top: (nowH - START_H) * HOUR_PX}}/>
                )}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function UpcomingList() {
  const today = WEEK_EVENTS.filter(e => e.d === 3);
  return (
    <section className="card">
      <div className="card__head">
        <div className="h-2">הבאות בתור</div>
        <button className="btn btn--ghost btn--sm">הכל <I.chev size={11}/></button>
      </div>
      <div className="card__body">
        {today.map((e, i) => (
          <div key={i} className="sess">
            <div className="sess__time">
              <span className="hh">{String(Math.floor(e.s)).padStart(2,'0')}:{e.s % 1 >= 0.5 ? '30' : '00'}</span>
              <span className="mm">{Math.round((e.e - e.s) * 60)}ד</span>
            </div>
            <div className="sess__body">
              <div className="sess__who">{e.nm}</div>
              <div className="sess__det"><span>{e.mt}</span></div>
            </div>
            <button className="btn btn--sm" onClick={() => Toaster.show(`פתיחת מפגש ${e.name}`)}>פתח</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Integrations() {
  return (
    <section className="card">
      <div className="card__head">
        <div className="h-2">חיבורים</div>
      </div>
      <div className="card__body">
        <div className="integ" style={{borderBottom: '1px solid var(--hairline)'}}>
          <div className="integ__logo" style={{background:'#fff', color:'#4285F4'}}>G</div>
          <div>
            <div className="integ__name">Google Calendar</div>
            <div className="integ__desc">מחובר · nathanael@gmail.com · סנכרון דו-כיווני</div>
          </div>
          <span className="chip chip--green"><span className="dot"/>מחובר</span>
        </div>
        <div className="integ" style={{borderBottom: '1px solid var(--hairline)'}}>
          <div className="integ__logo" style={{background:'#006BFF', color:'#fff'}}>C</div>
          <div>
            <div className="integ__name">Calendly</div>
            <div className="integ__desc">דף קביעת פגישות ציבורי · natanel-malka</div>
          </div>
          <span className="chip chip--green"><span className="dot"/>מחובר</span>
        </div>
        <div className="integ" style={{borderBottom: '1px solid var(--hairline)'}}>
          <div className="integ__logo" style={{background:'#00897B', color:'#fff'}}>✓</div>
          <div>
            <div className="integ__name">Google Meet</div>
            <div className="integ__desc">קישורי Meet נוצרים אוטומטית בכל פגישה מקוונת</div>
          </div>
          <span className="chip chip--green"><span className="dot"/>פעיל</span>
        </div>
        <div className="integ">
          <div className="integ__logo" style={{background:'#25D366', color:'#fff'}}>W</div>
          <div>
            <div className="integ__name">WhatsApp Business</div>
            <div className="integ__desc">תזכורות 24ש לפני כל פגישה</div>
          </div>
          <span className="chip chip--green"><span className="dot"/>פעיל</span>
        </div>
      </div>
    </section>
  );
}

function AvailCard() {
  const slots = [
    { d: 'א׳', h: '09:00-12:00, 14:00-17:00' },
    { d: 'ב׳', h: '10:00-13:00' },
    { d: 'ג׳', h: '09:00-12:00, 15:00-18:00' },
    { d: 'ד׳', h: '09:00-17:00' },
    { d: 'ה׳', h: '10:00-14:00' },
    { d: 'ו׳', h: '09:00-12:00' },
  ];
  return (
    <section className="card">
      <div className="card__head">
        <div className="h-2">זמינות שבועית</div>
        <button className="btn btn--ghost btn--sm" onClick={() => Toaster.show('עריכת זמינות', 'info')}>עריכה</button>
      </div>
      <div style={{padding:'6px 0'}}>
        {slots.map((s, i) => (
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'50px 1fr',
            padding: '8px 18px', borderBottom:'1px solid var(--hairline)',
            fontSize: 12.5, alignItems:'center'
          }}>
            <span style={{fontWeight: 600}}>{s.d}</span>
            <span className="t-muted t-num">{s.h}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

window.WeekCalendar = WeekCalendar;
window.UpcomingList = UpcomingList;
window.Integrations = Integrations;
window.AvailCard = AvailCard;
