/* eslint-disable */
// Shared components for נתא landing page

// ============ ICONS (refined, no emoji) ============
const IconCheck = ({ size = 18, color = "currentColor", stroke = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const IconArrow = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform: 'scaleX(-1)'}}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </svg>
);

const IconWhatsApp = ({ size = 22, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.2-1.1a7.93 7.93 0 0 0 3.85.98h.01A7.94 7.94 0 0 0 20 11.94a7.88 7.88 0 0 0-2.4-5.62Zm-5.55 12.2a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.66.67-2.43-.16-.25a6.6 6.6 0 1 1 12.24-3.5 6.59 6.59 0 0 1-6.65 6.58Zm3.62-4.93c-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1s-.51.65-.63.78c-.11.13-.23.15-.43.05a5.43 5.43 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.38c-.12-.2 0-.3.09-.4.09-.1.2-.23.3-.35.1-.12.13-.2.2-.34.06-.13.03-.25-.02-.35-.05-.1-.45-1.08-.62-1.48-.16-.39-.32-.34-.45-.34h-.38a.74.74 0 0 0-.53.25 2.22 2.22 0 0 0-.7 1.65A3.85 3.85 0 0 0 9 12.16a8.83 8.83 0 0 0 3.4 3 11.4 11.4 0 0 0 1.13.42 2.72 2.72 0 0 0 1.25.08 2.04 2.04 0 0 0 1.34-.95c.16-.33.16-.6.11-.66-.05-.07-.18-.11-.38-.21Z"/>
  </svg>
);

// Belief icons — minimal line illustrations, single stroke
const IconResearch = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="20" cy="20" r="11"></circle>
    <line x1="28" y1="28" x2="38" y2="38"></line>
    <line x1="20" y1="14" x2="20" y2="26"></line>
    <line x1="14" y1="20" x2="26" y2="20"></line>
  </svg>
);

const IconBalance = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="24" y1="8" x2="24" y2="42"></line>
    <line x1="10" y1="16" x2="38" y2="16"></line>
    <path d="M10 16 L4 28 a6 6 0 0 0 12 0 Z"></path>
    <path d="M38 16 L32 28 a6 6 0 0 0 12 0 Z"></path>
  </svg>
);

const IconProcess = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 24 a16 16 0 0 1 32 0"></path>
    <polyline points="32 18 40 24 32 30"></polyline>
    <path d="M40 24 a16 16 0 0 1 -32 0"></path>
    <polyline points="16 30 8 24 16 18"></polyline>
  </svg>
);

const IconFit = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="24" cy="14" r="6"></circle>
    <path d="M12 42 c0-8 5-14 12-14 s12 6 12 14"></path>
    <line x1="24" y1="28" x2="24" y2="42"></line>
  </svg>
);

const IconQuote = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
    <path d="M10 22 H4 V14 c0-4 2-7 6-8 v3 c-2 1-3 2-3 4 h3 z M22 22 h-6 V14 c0-4 2-7 6-8 v3 c-2 1-3 2-3 4 h3 z"/>
  </svg>
);

// ============ LOGO ============
// Typographic placeholder (we keep this; user can swap with image later)
const Logo = ({ light = false, size = "md" }) => {
  const sizes = {
    sm: { word: 28, sub: 9 },
    md: { word: 38, sub: 10 },
    lg: { word: 56, sub: 12 },
  };
  const s = sizes[size] || sizes.md;
  const color = light ? "#fcf4f9" : "var(--primary)";
  return (
    <div className="logo" style={{ color }}>
      <div className="logo-word" style={{ fontSize: s.word }}>נתא</div>
      <div className="logo-underline"></div>
      <div className="logo-sub" style={{ fontSize: s.sub }}>קליניקת • תזונה</div>
    </div>
  );
};

// ============ PHOTO PLACEHOLDER (circular for hero) ============
const PhotoCircle = ({ size = 380, label = "נתנאל מלכה" }) => (
  <div className="photo-circle" style={{ width: size, height: size }}>
    <div className="photo-circle-inner">
      <div className="photo-circle-stripes"></div>
      <div className="photo-circle-mono">netanel.JPG</div>
    </div>
    <div className="photo-circle-ring"></div>
  </div>
);

// ============ CREDENTIAL BADGE ============
const CredentialBadge = () => (
  <div className="cred-badge">
    <div className="cred-badge-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 l3 6 7 1 -5 5 1 7 -6-3 -6 3 1-7 -5-5 7-1 z"></path>
      </svg>
    </div>
    <span>תזונאי קליני מורשה</span>
  </div>
);

// ============ STAT (counter that animates on scroll) ============
const StatCounter = ({ value, suffix = "", label, accent = false }) => {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(0);
  const [seen, setSeen] = React.useState(false);

  React.useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !seen) setSeen(true);
    }, { threshold: 0.4 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [seen]);

  React.useEffect(() => {
    if (!seen) return;
    const target = Number(value);
    if (Number.isNaN(target)) { setShown(value); return; }
    const dur = 1400;
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);

  return (
    <div className={`stat ${accent ? 'stat-accent' : ''}`} ref={ref}>
      <div className="stat-value">
        <span className="stat-num">{shown}</span>
        <span className="stat-suffix">{suffix}</span>
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
};

// ============ MULTI-STEP LEAD FORM ============
const goals = [
  { id: "weight",   label: "ירידה במשקל",        hint: "תהליך הדרגתי ובר־קיימא" },
  { id: "muscle",   label: "חיטוב ובניית מסה",   hint: "תזונה לבניית גוף" },
  { id: "order",    label: "סדר תזונתי",          hint: "ארגון ההרגלים מחדש" },
  { id: "health",   label: "מסיבות בריאותיות",   hint: "ליווי לפי מצב רפואי" },
];

const LeadForm = () => {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({ name: "", phone: "", goal: "", notes: "" });
  const [errors, setErrors] = React.useState({});
  const [submitted, setSubmitted] = React.useState(false);

  const totalSteps = 4;
  const update = (k, v) => { setData(d => ({ ...d, [k]: v })); setErrors(e => ({ ...e, [k]: null })); };

  const validate = () => {
    const e = {};
    if (step === 0 && !data.name.trim()) e.name = "השם הוא שדה חובה";
    if (step === 1) {
      const digits = data.phone.replace(/\D/g, "");
      if (digits.length < 9) e.phone = "מספר טלפון לא תקין";
    }
    if (step === 2 && !data.goal) e.goal = "בחר/י מטרה אחת";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate()) setStep(s => s + 1); };
  const back = () => setStep(s => Math.max(0, s - 1));
  const submit = () => { if (validate()) setSubmitted(true); };

  if (submitted) {
    return (
      <div className="form-card form-success">
        <div className="form-success-mark">
          <IconCheck size={28} color="#fff" />
        </div>
        <h3 className="form-success-title">תודה, {data.name.split(" ")[0]}.</h3>
        <p className="form-success-body">
          קיבלתי את הפרטים. אחזור אלייך עד 24 שעות לשיחת היכרות קצרה — בלי התחייבות, בלי לחץ.
        </p>
        <div className="form-success-meta">
          <span>{data.phone}</span><span className="dot">·</span><span>{goals.find(g => g.id === data.goal)?.label}</span>
        </div>
      </div>
    );
  }

  const stepLabels = ["שם", "טלפון", "מטרה", "הערות"];

  return (
    <div className="form-card">
      <div className="form-progress">
        <div className="form-progress-steps">
          {stepLabels.map((lbl, i) => (
            <div key={i} className={`form-step-dot ${i <= step ? 'active' : ''} ${i === step ? 'current' : ''}`}>
              <div className="form-step-num">{i < step ? <IconCheck size={11} color="#fff" stroke={3} /> : i + 1}</div>
              <div className="form-step-lbl">{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="form-steps">
        {step === 0 && (
          <div className="form-step">
            <label className="form-label">איך קוראים לך?</label>
            <input
              autoFocus
              className={`form-input ${errors.name ? "err" : ""}`}
              placeholder="שם מלא"
              value={data.name}
              onChange={e => update("name", e.target.value)}
              onKeyDown={e => e.key === "Enter" && next()}
            />
            {errors.name && <div className="form-err">{errors.name}</div>}
          </div>
        )}

        {step === 1 && (
          <div className="form-step">
            <label className="form-label">מספר טלפון</label>
            <input
              autoFocus
              className={`form-input ${errors.phone ? "err" : ""}`}
              type="tel"
              placeholder="050-0000000"
              value={data.phone}
              onChange={e => update("phone", e.target.value)}
              onKeyDown={e => e.key === "Enter" && next()}
            />
            {errors.phone && <div className="form-err">{errors.phone}</div>}
            <div className="form-hint">שיחת היכרות קצרה — ללא עלות וללא התחייבות.</div>
          </div>
        )}

        {step === 2 && (
          <div className="form-step">
            <label className="form-label">מה המטרה שלך?</label>
            <div className="goal-grid">
              {goals.map(g => (
                <button
                  key={g.id}
                  type="button"
                  className={`goal-chip ${data.goal === g.id ? "active" : ""}`}
                  onClick={() => update("goal", g.id)}
                >
                  <div className="goal-chip-tick">
                    {data.goal === g.id && <IconCheck size={12} color="#fff" stroke={3} />}
                  </div>
                  <div className="goal-chip-body">
                    <div className="goal-chip-label">{g.label}</div>
                    <div className="goal-chip-hint">{g.hint}</div>
                  </div>
                </button>
              ))}
            </div>
            {errors.goal && <div className="form-err">{errors.goal}</div>}
          </div>
        )}

        {step === 3 && (
          <div className="form-step">
            <label className="form-label">משהו שכדאי לי לדעת? <span className="optional">(לא חובה)</span></label>
            <textarea
              autoFocus
              className="form-input form-textarea"
              placeholder="אלרגיות, ניסיונות קודמים, שעות נוחות לשיחה…"
              rows={4}
              value={data.notes}
              onChange={e => update("notes", e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="form-actions">
        {step > 0 && (
          <button type="button" className="btn-ghost" onClick={back}>
            חזרה
          </button>
        )}
        {step < totalSteps - 1 ? (
          <button type="button" className="btn-primary" onClick={next}>
            המשך <IconArrow />
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={submit}>
            שליחת פרטים <IconArrow />
          </button>
        )}
      </div>
    </div>
  );
};

// ============ REVEAL on scroll ============
const Reveal = ({ children, delay = 0, className = "" }) => {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setShown(true);
    }, { threshold: 0.15 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? 'shown' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
};

Object.assign(window, {
  IconCheck, IconArrow, IconWhatsApp, IconQuote,
  IconResearch, IconBalance, IconProcess, IconFit,
  Logo, PhotoCircle, CredentialBadge, StatCounter, LeadForm, Reveal,
  goals,
});
