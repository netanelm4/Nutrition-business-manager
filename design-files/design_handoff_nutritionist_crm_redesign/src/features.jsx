/* Protocols library + Templates manager */

function ProtocolsLibrary() {
  const [filter, setFilter] = React.useState('all');
  const [q, setQ] = React.useState('');

  const filtered = PROTOCOLS.filter(p => {
    if (q && !p.name.includes(q) && !p.desc.includes(q)) return false;
    if (filter === 'all') return true;
    return p.tags.some(t => t.includes(filter));
  });

  const colorMap = {
    blue: {bg:'var(--blue-soft)', fg:'var(--blue-ink)'},
    green:{bg:'var(--green-soft)', fg:'var(--green-ink)'},
    pink: {bg:'var(--pink-soft)', fg:'var(--pink-ink)'},
    amber:{bg:'var(--amber-soft)', fg:'var(--amber-ink)'},
  };

  return (
    <>
      <div className="subhead">
        <div className="seg">
          {['all','סוכרת','ירידה','טבעוני','הורמונלי','ספורט'].map(c => (
            <button key={c} className={filter === c ? 'is-active' : ''} onClick={() => setFilter(c)}>
              {c === 'all' ? 'הכל' : c}
            </button>
          ))}
        </div>
        <div style={{display:'flex', gap: 8}}>
          <div className="search" style={{flex:'0 0 240px', margin:0}}>
            <I.search size={14}/>
            <input placeholder="חיפוש פרוטוקול…" value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          <button className="btn" onClick={() => Toaster.show('בונה פרוטוקול ב-AI…', 'info')}><I.sparkle size={13}/> צור ב-AI</button>
          <button className="btn btn--primary" onClick={() => Toaster.show('פרוטוקול חדש נוצר')}><I.plus size={13}/> פרוטוקול חדש</button>
        </div>
      </div>

      {/* AI Personalization banner */}
      <section className="card" style={{
        background:'linear-gradient(120deg, oklch(0.97 0.02 295) 0%, var(--surface) 70%)',
        borderColor:'oklch(0.9 0.04 295)',
        padding:'16px 18px', marginBottom: 16,
        display:'flex', alignItems:'center', gap:14
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'linear-gradient(135deg, #567DBF, #31B996)',
          display:'grid', placeItems:'center', color:'#fff'
        }}><I.sparkle size={18}/></div>
        <div style={{flex: 1}}>
          <div style={{fontWeight:600, fontSize: 14}}>התאמה אישית עם AI</div>
          <div className="t-sm t-muted" style={{marginTop:2}}>
            בחר/י פרוטוקול וסמן/י מטופל — נתא AI יתאים מחדש ארוחות, מאקרו וזמנים לפי האינטייק
          </div>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => Toaster.show('מפעיל התאמה אישית', 'info')}>נסה עכשיו</button>
      </section>

      <div className="pro-grid">
        {filtered.map(p => (
          <div key={p.id} className="pro-card">
            <div className="pro-card__top">
              <div className="pro-card__icon" style={{background: colorMap[p.color].bg, color: colorMap[p.color].fg}}>
                <I.protocol size={16}/>
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div className="pro-card__name">{p.name}</div>
                <div className="pro-card__sub">{p.cal} קל׳ · {p.tags.join(' · ')}</div>
              </div>
            </div>
            <div className="pro-card__desc">{p.desc}</div>

            <div className="macro-mini">
              <div><b>{p.p}g</b>חלבון</div>
              <div><b>{p.c}g</b>פחמימות</div>
              <div><b>{p.f}g</b>שומן</div>
            </div>

            <div className="pro-card__foot">
              <span>{p.uses} מטופלים פעילים</span>
              <button className="btn btn--ghost btn--sm" onClick={() => Toaster.show(`מתאים פרוטוקול ${p.name}...`, 'info')}>
                התאם <I.sparkle size={11}/>
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ==================== TEMPLATES ==================== */
function TemplatesManager() {
  const [activeId, setActiveId] = React.useState(TEMPLATES[1].id);
  const [cat, setCat] = React.useState('all');
  const [q, setQ] = React.useState('');

  const visible = TEMPLATES.filter(t => {
    if (cat !== 'all' && t.cat !== cat) return false;
    if (q && !t.name.includes(q) && !t.body.includes(q)) return false;
    return true;
  });
  const current = TEMPLATES.find(t => t.id === activeId) || TEMPLATES[0];

  const [preview, setPreview] = React.useState({
    'שם_פרטי': 'רחל', 'קישור_אינטייק': 'נתא.co/אינטייק',
    'תאריך_פגישה': 'ד׳ 23/4 09:00', 'שעה': '09:00',
    'מיקום': 'Google Meet', 'חודש': 'אפריל',
    'קישור_תשלום': 'נתא.co/שלם', 'סמן_1': 'HbA1c', 'ערך_1': '6.2',
    'סמן_2': 'ויטמין D', 'ערך_2': '28', 'מיילסטון': 'ירידה של 3 ק״ג'
  });

  // Render body with filled vars, highlighting filled values
  const renderBody = (body) => {
    const parts = body.split(/(\{\{[^}]+\}\})/g);
    return parts.map((p, i) => {
      const m = p.match(/^\{\{([^}]+)\}\}$/);
      if (m) {
        const val = preview[m[1]] || `{{${m[1]}}}`;
        return <mark key={i}>{val}</mark>;
      }
      return <React.Fragment key={i}>{p}</React.Fragment>;
    });
  };

  return (
    <>
      <div className="subhead">
        <div className="seg" style={{flexWrap:'wrap'}}>
          {TPL_CATS.map(c => (
            <button key={c.id} className={cat === c.id ? 'is-active' : ''} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div style={{display:'flex', gap: 8}}>
          <button className="btn" onClick={() => Toaster.show('מנסח תבנית ב-AI…', 'info')}><I.sparkle size={13}/> צור ב-AI</button>
          <button className="btn btn--primary" onClick={() => window.act('new-template')}><I.plus size={13}/> תבנית חדשה</button>
        </div>
      </div>

      <div className="split" style={{gridTemplateColumns:'380px 1fr'}}>
        {/* List column */}
        <section className="card" style={{padding: 0, overflow:'hidden'}}>
          <div style={{padding: '10px 12px', borderBottom: '1px solid var(--hairline)'}}>
            <div className="search" style={{margin:0}}>
              <I.search size={14}/>
              <input placeholder="חיפוש תבנית…" value={q} onChange={e => setQ(e.target.value)}/>
            </div>
          </div>
          <div className="tpl-list">
            {visible.map(t => (
              <div key={t.id} className={`tpl-row ${activeId === t.id ? 'is-active' : ''}`} onClick={() => setActiveId(t.id)}>
                <div className="tpl-row__top">
                  <div className="tpl-row__name">{t.name}</div>
                  <span className="chip" style={{fontSize: 10.5}}>
                    {t.uses} שימושים
                  </span>
                </div>
                <div className="tpl-row__preview">{t.body.replace(/\{\{[^}]+\}\}/g, '___').slice(0, 80)}…</div>
                <div className="tpl-row__foot">
                  <span>🕑 עודכן {t.updated}</span>
                  <span>· {t.vars.length} משתנים</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Editor + preview column */}
        <section className="card">
          <div className="card__head">
            <div>
              <div className="h-2">{current.name}</div>
              <div className="t-sm t-muted" style={{marginTop: 2}}>
                {current.uses} שימושים · עודכן {current.updated}
              </div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <button className="btn btn--sm" onClick={() => Toaster.show('משפר נוסחה…', 'info')}><I.sparkle size={11}/> שפר ב-AI</button>
              <button className="btn btn--sm" onClick={() => Toaster.show('התבנית שוכפלה')}>שכפל</button>
              <button className="btn btn--primary btn--sm" onClick={() => Toaster.show('הודעה נשלחה ב-WhatsApp')}>שלח</button>
            </div>
          </div>

          <div style={{padding: 20, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20}}>
            {/* Editor */}
            <div>
              <div className="t-eyebrow" style={{marginBottom: 8}}>גוף ההודעה</div>
              <textarea
                readOnly
                value={current.body}
                style={{
                  width: '100%', minHeight: 220,
                  border: '1px solid var(--line)', borderRadius: 10,
                  padding: 12, fontSize: 13.5, lineHeight: 1.6,
                  fontFamily: 'inherit', background: 'var(--surface)',
                  resize: 'vertical'
                }}
              />

              <div className="t-eyebrow" style={{marginTop: 16, marginBottom: 8}}>משתנים</div>
              <div className="vars">
                {current.vars.map(v => <span key={v} className="var-chip">{'{{'}{v}{'}}'}</span>)}
              </div>

              <div className="t-eyebrow" style={{marginTop: 16, marginBottom: 8}}>שליחה מהירה אל</div>
              <div style={{display:'flex', gap: 6, flexWrap: 'wrap'}}>
                {['רחל כהן','יואב לוי','מיכל אברהם','דנה בן-דוד','אבי שמיר'].map(n => (
                  <button key={n} className="btn btn--sm" onClick={() => Toaster.show(`הודעה נשלחה ל-${n}`)}>{n}</button>
                ))}
                <button className="btn btn--sm btn--ghost" onClick={() => Toaster.show('בחירת נמענים', 'info')}>+ בחר/י</button>
              </div>
            </div>

            {/* WhatsApp preview */}
            <div>
              <div className="t-eyebrow" style={{marginBottom: 8}}>תצוגה מקדימה</div>
              <div className="phone-preview">
                <div style={{display:'flex', flexDirection:'column', gap: 8}}>
                  <div className="msg-bubble">
                    {renderBody(current.body)}
                    <div className="msg-bubble__time">14:32 ✓✓</div>
                  </div>
                </div>
              </div>
              <div className="t-xs t-muted" style={{marginTop: 8, textAlign: 'center'}}>
                מוצג עם ערכי דמו — ימולא מהמטופל
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

window.ProtocolsLibrary = ProtocolsLibrary;
window.TemplatesManager = TemplatesManager;
