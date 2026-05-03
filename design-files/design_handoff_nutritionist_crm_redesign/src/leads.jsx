/* Leads kanban */

function LeadsBoard() {
  const [leads, setLeads] = React.useState(LEADS);
  const [dragId, setDragId] = React.useState(null);
  const [overStage, setOverStage] = React.useState(null);

  const onDragStart = (id) => (e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (stage) => (e) => {
    e.preventDefault();
    setOverStage(stage);
  };
  const onDrop = (stage) => (e) => {
    e.preventDefault();
    setLeads(ls => ls.map(l => l.id === dragId ? {...l, stage} : l));
    setDragId(null);
    setOverStage(null);
  };

  const totalValue = leads
    .filter(l => l.stage !== 'won')
    .reduce((s, l) => s + parseInt(l.value.replace(/[^\d]/g, ''), 10), 0);

  return (
    <>
      <div className="subhead">
        <div>
          <div style={{fontSize: 13, color: 'var(--ink-3)'}}>
            <b style={{color: 'var(--ink-1)', fontSize: 14}}>{leads.length} לידים פעילים</b>
            {' · '}פייפליין שווי ₪{totalValue.toLocaleString('he-IL')}
            {' · '}{leads.filter(l => l.stage === 'won').length} הומרו החודש
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <div className="seg">
            <button className="is-active"><I.grid size={12}/> קנבן</button>
            <button><I.leads size={12}/> רשימה</button>
          </div>
          <button className="btn" onClick={() => Toaster.show('סינון לפי מקור', 'info')}><I.filter size={13}/> מקור</button>
          <button className="btn btn--primary" onClick={() => window.act('new-lead')}><I.plus size={13}/> ליד חדש</button>
        </div>
      </div>

      <div className="kanban">
        {LEAD_STAGES.map(s => {
          const col = leads.filter(l => l.stage === s.id);
          const value = col.reduce((sum, l) => sum + parseInt(l.value.replace(/[^\d]/g, ''), 10), 0);
          return (
            <div key={s.id} className="col"
              onDragOver={onDragOver(s.id)}
              onDrop={onDrop(s.id)}
              style={{
                outline: overStage === s.id ? '2px dashed var(--blue)' : 'none',
                outlineOffset: -2
              }}
            >
              <div className="col__head">
                <span className={`dot ${s.cls}`}/>
                <span className="nm">{s.label}</span>
                <span className="ct">{col.length}</span>
                <button className="add btn--ghost"><I.plus size={13}/></button>
              </div>
              <div style={{padding: '0 4px 4px', fontSize: 11, color: 'var(--ink-4)', marginBottom: 4}}>
                שווי: ₪{value.toLocaleString('he-IL')}
              </div>

              {col.map(l => (
                <div key={l.id} className="lead"
                  draggable
                  onDragStart={onDragStart(l.id)}
                  onDragEnd={() => { setDragId(null); setOverStage(null); }}
                  style={{opacity: dragId === l.id ? 0.4 : 1}}
                >
                  <div className="lead__top">
                    <div className="avatar" style={{width: 22, height: 22, fontSize: 10, background: 'var(--surface-3)', color: 'var(--ink-2)'}}>
                      {l.name.slice(0,2)}
                    </div>
                    <div className="lead__name">{l.name}</div>
                    {l.hot && <span style={{marginInlineStart: 'auto', fontSize: 11}} title="ליד חם">🔥</span>}
                  </div>
                  <div className="lead__goal">{l.goal}</div>
                  <div className="lead__foot">
                    <div className="lead__tags">
                      <span className={`src-chip is-${l.src}`}>
                        {l.src === 'ref' ? 'הפניה' : l.src === 'ads' ? 'מודעה' : 'אינסטגרם'}
                      </span>
                    </div>
                    <span className="t-num" style={{fontWeight: 600, color: 'var(--ink-2)'}}>{l.value}</span>
                  </div>
                  <div style={{fontSize: 10.5, color: 'var(--ink-4)', marginTop: 6, display: 'flex', justifyContent: 'space-between'}}>
                    <span>נוצר לפני {l.age}</span>
                    <span>ID #{l.id}</span>
                  </div>
                </div>
              ))}

              {col.length === 0 && (
                <div style={{
                  padding: '20px 12px', textAlign: 'center',
                  fontSize: 12, color: 'var(--ink-4)',
                  border: '1px dashed var(--line)', borderRadius: 8,
                  background: 'var(--surface)'
                }}>
                  גרור ליד לכאן
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

Object.assign(window, { LeadsBoard });
