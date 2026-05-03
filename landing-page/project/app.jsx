/* eslint-disable */
// Main app for נתא landing page

const NAV_LINKS = [
{ href: "#beliefs", label: "האני מאמין" },
{ href: "#benefits", label: "מה תקבל" },
{ href: "#how", label: "איך זה עובד" },
{ href: "#testimonials", label: "ביקורות" }];


// ============ NAV ============
const Nav = () =>
<nav className="nav">
    <div className="container nav-inner">
      <Logo size="sm" />
      <div className="nav-links">
        {NAV_LINKS.map((l) =>
      <a key={l.href} className="nav-link" href={l.href}>{l.label}</a>
      )}
        <a className="nav-cta" href="#contact">לשיחת היכרות</a>
      </div>
    </div>
  </nav>;


// ============ HERO ============
const Hero = () =>
<section className="hero">
    <div className="container hero-grid">
      <div className="hero-text">
        <Reveal>
          <div className="eyebrow hero-eyebrow">נתנאל מלכה · קליניקת תזונה</div>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="hero-title">
            תזונה שמתאימה לחיים שלך -<em>לא לחיים שאחרים ממציאים לך</em>
          </h1>
        </Reveal>
        <Reveal delay={200}>
          <p className="hero-lede">בלי הבטחות שווא, בלי קיצוניות. רק תהליך שפוי, מבוסס מחקר, שנבנה סביב מי 
שאת/ה - לא סביב טרנד.

</p>
        </Reveal>
        <Reveal delay={300}>
          <div className="hero-actions">
            <a href="#contact" className="btn-primary">לשיחת היכרות חינם <IconArrow /></a>
            <a href="#how" className="btn-secondary">איך זה עובד</a>
          </div>
        </Reveal>
        <Reveal delay={400}>
          <div className="hero-stats">
            <StatCounter value={200} suffix="+" label="לקוחות שליוויתי" />
            <StatCounter value={2} suffix="+" label="שנות ניסיון בקליניקה" />
            <StatCounter value={90} suffix="%" label="שומרים על התוצאה לאורך זמן" />
          </div>
        </Reveal>
      </div>
      <Reveal delay={150} className="hero-photo-wrap">
        <PhotoCircle size={420} />
        <CredentialBadge />
      </Reveal>
    </div>
  </section>;

// ============ BELIEFS ============
const BELIEFS = [
{ icon: <IconResearch />, title: "מבוסס מחקר", body: "ההמלצות שלי מסתמכות על ספרות מקצועית עדכנית. בלי טרנדים, בלי מודות אינסטגרם, בלי הבטחות שיווק." },
{ icon: <IconBalance />, title: "אין שחור ולבן", body: "אין מאכלים אסורים ואין מאכלי-על. יש איזון שעובד עבורך — ויש מקום לפיצה ביום שישי בלי אשמה." },
{ icon: <IconProcess />, title: "תהליך, לא קסם", body: "אני לא מבטיח 'מינוס 8 קילו בחודש'. אני מבטיח שינוי הדרגתי שיישאר איתך גם בעוד שנתיים." },
{ icon: <IconFit />, title: "מותאם לחיים שלך", body: "התפריט נבנה סביב הזמן שלך, הטעם שלך, המשפחה שלך והתקציב שלך — לא להפך." }];


const Beliefs = () =>
<section className="beliefs" id="beliefs">
    <div className="container">
      <div className="beliefs-head">
        <Reveal>
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>הגישה שלי</div>
            <h2 className="section-title">האני מאמין שלי</h2>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <p className="section-lede">
            ארבעה עקרונות שמלווים כל מטופל ומטופלת שעוברים אצלי תהליך. בלי דוגמטיות, בלי הבטחות שווא — רק אמת מקצועית.
          </p>
        </Reveal>
      </div>
      <div className="beliefs-grid">
        {BELIEFS.map((b, i) =>
      <Reveal key={i} delay={i * 100} className="belief-card">
            <span className="belief-num">0{i + 1}</span>
            <div className="belief-icon">{b.icon}</div>
            <h3 className="belief-title">{b.title}</h3>
            <p className="belief-body">{b.body}</p>
          </Reveal>
      )}
      </div>
    </div>
  </section>;


// ============ BENEFITS ============
const BENEFITS = [
{ num: "01", title: "ליווי אמיתי ביומיום", body: "ליווי בוואטסאפ כל ימי השבוע. תשובה תוך כמה שעות. בלי שיפוט, בלי בושות, בלי 'תחזרי אליי בפגישה הבאה'." },
{ num: "02", title: "תפריט שחי ונושם", body: "תפריט שמתעדכן יחד איתך — לפי הקצב, החיים, החגים, הלחץ בעבודה והחופשה בקיץ. לא נוסחה קשיחה." },
{ num: "03", title: "כלים לכל החיים", body: "בסוף שלושת החודשים את/ה יוצא/ת לדרך עם הבנה אמיתית של הגוף שלך — לא תלויים בי, לא תלויים באף תפריט." }];


const Benefits = () =>
<section className="benefits" id="benefits">
    <div className="container">
      <div className="benefits-head">
        <Reveal>
          <div className="eyebrow benefits-eyebrow">מה תקבל בתהליך</div>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="section-title">לא רק תפריט. <em style={{ color: 'var(--primary)', fontStyle: 'italic', fontWeight: 400 }}>שינוי אמיתי.</em></h2>
        </Reveal>
      </div>
      <div className="benefits-grid">
        {BENEFITS.map((b, i) =>
      <Reveal key={i} delay={i * 120} className="benefit-card">
            <div className="benefit-num">{b.num}</div>
            <h3 className="benefit-title">{b.title}</h3>
            <p className="benefit-body">{b.body}</p>
          </Reveal>
      )}
      </div>
    </div>
  </section>;


// ============ VERTICAL TIMELINE (scroll-pinned, progressive reveal) ============
const SnakeTimeline = ({ steps }) => {
  const containerRef = React.useRef(null);
  const [progress, setProgress] = React.useState(0); // 0..steps.length-1

  React.useEffect(() => {
    const onScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = el.offsetHeight - vh;
      if (total <= 0) return;
      const scrolled = -rect.top;
      const p = Math.max(0, Math.min(1, scrolled / total));
      setProgress(p * (steps.length - 1));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [steps.length]);

  const pinHeight = `${100 + steps.length * 90}vh`;
  const railFillPct = (progress / Math.max(1, steps.length - 1)) * 100;

  return (
    <div className="vt-pin" ref={containerRef} style={{ height: pinHeight }}>
      <div className="vt-stage">
        <div className="vt-progress">
          <div className="vt-progress-track">
            <div className="vt-progress-fill" style={{ width: `${railFillPct}%` }}></div>
          </div>
          <div className="vt-progress-label">
            <span>{Math.min(steps.length, Math.floor(progress) + 1)}</span>
            <span className="dim"> / {steps.length}</span>
          </div>
        </div>

        <div className="vt-list">
          <div className="vt-rail">
            <div className="vt-rail-fill" style={{ height: `${railFillPct}%` }}></div>
          </div>

          {steps.map((s, i) => {
            const reveal = Math.max(0, Math.min(1, progress - (i - 0.5)));
            return (
              <div
                key={i}
                className={`vt-step ${reveal > 0.3 ? 'shown' : ''}`}
                style={{
                  opacity: 0.15 + reveal * 0.85,
                  transform: `translateY(${(1 - reveal) * 20}px)`
                }}>
                <div className="vt-marker">
                  <span className="vt-marker-num">{i + 1}</span>
                  <span className="vt-marker-pulse"></span>
                </div>
                <div className="vt-card">
                  <div className="vt-card-label">{s.label}</div>
                  <h3 className="vt-card-title">{s.title}</h3>
                  <p className="vt-card-body">{s.body}</p>
                  <div className="vt-card-meta">{s.meta}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


// ============ HOW IT WORKS — Timeline ============
const STEPS = [
{ label: "שלב 1", title: "פגישת היכרות עמוקה", body: "פגישה ראשונה של 90 דקות. אנחנו מדברים על ההיסטוריה הרפואית שלך, ההרגלים, הניסיונות הקודמים, ומה באמת מעניין אותך להשיג.", meta: "90 דקות · וירטואלי או בקליניקה" },
{ label: "שלב 2", title: "תפריט מותאם אישית", body: "תוך שבוע אני בונה לך תפריט שמתחשב בכל מה שלמדתי — כולל הזמן שיש לך לבשל, מה את/ה אוהב/ת, ומה לא.", meta: "מסמך אישי + הסברים" },
{ label: "שלב 3", title: "6 מפגשים + מעקב צמוד", body: "פגישה אחת לשבועיים לאורך 3 חודשים, בנוסף לליווי בוואטסאפ כל ימי השבוע. מתאימים, משנים, מסתכלים על הנתונים.", meta: "6 פגישות · 3 חודשים · ליווי 7/7" },
{ label: "שלב 4", title: "המשך הדרך", body: "פגישת סיכום, מסמך כלים אישי לחיים, והאפשרות להמשך מעקב אחת לחודשיים אם תרצי. את/ה לא לבד גם אחרי.", meta: "90 דקות · וירטואלי או בקליניקה" }];


const HowItWorks = () =>
<section className="timeline-section" id="how">
    <div className="container">
      <Reveal>
        <div className="timeline-head">
          <div className="eyebrow">איך זה עובד</div>
          <h2 className="section-title">תהליך של 3 חודשים. <br />התחלה, אמצע וסוף ברורים.</h2>
          <p className="section-lede">
            לא חוזה אינסופי, לא מנוי. תהליך מובנה שיש לו זמן התחלה ויש לו סיום — כי שינוי אמיתי לא צריך להחזיק אותך בן ערובה.
          </p>
        </div>
      </Reveal>

      <div className="timeline-snake">
        <SnakeTimeline steps={STEPS} />
      </div>

      <Reveal delay={200}>
        <div className="price-box">
          <div className="price-box-content">
            <div className="price-box-eyebrow">תוכנית מלאה</div>
            <h3 className="price-box-title">3 חודשי ליווי תזונתי מלא</h3>
            <div className="price-box-sub">6 פגישות · ליווי בוואטסאפ 7/7 · תפריט מותאם · מסמך כלים אישי · אפשרות תשלומים</div>
          </div>
          <div className="price-box-amount">
            <div>
              <span className="price-box-currency">₪</span>
              <span className="price-box-num">2,400</span>
            </div>
            <div className="price-box-period">לתוכנית המלאה · ניתן לפרוס</div>
          </div>
        </div>
      </Reveal>
    </div>
  </section>;


// ============ TESTIMONIALS ============
const TESTIMONIALS = [
{ initial: "מ", name: "מיכל, 34", goal: "ירידה במשקל", result: "ירידה של 11 ק״ג ב-3 חודשים", quote: "הגעתי אחרי שש שנים של דיאטות. נתנאל לא נתן לי תפריט — הוא לימד אותי לאכול. ירדתי 11 ק״ג ולא חזרתי." },
{ initial: "י", name: "יואב, 28", goal: "חיטוב ובניית מסה", result: "+5 ק״ג מסת שריר נטו", quote: "חיפשתי מישהו שיבין גם בכושר וגם בתזונה. נתנאל בנה לי תוכנית שמתחשבת בלוז העבודה והאימונים. הגוף שלי שונה היום." },
{ initial: "ש", name: "שירה, 41", goal: "סדר תזונתי ובריאות", result: "סוכר וכולסטרול חזרו לטווח", quote: "באתי בגלל בדיקות דם שלא נראו טוב. תוך 4 חודשים החזרתי את הסוכר והכולסטרול לטווח, בלי תרופות. בלי לסבול." }];


const Testimonials = () =>
<section className="testimonials-section" id="testimonials">
    <div className="container">
      <Reveal>
        <div className="testimonials-head">
          <div className="eyebrow testimonials-eyebrow">סיפורים אמיתיים</div>
          <h2 className="section-title">מה אומרים עליי</h2>
          <p className="section-lede">שלוש מתוך מאות סיפורים — אנשים אמיתיים שעברו תהליך אמיתי.</p>
        </div>
      </Reveal>

      <div className="testimonials-grid">
        {TESTIMONIALS.map((t, i) =>
      <Reveal key={i} delay={i * 120}>
            <figure className="testimonial">
              <div className="testimonial-quote-icon"><IconQuote size={18} /></div>
              <blockquote className="testimonial-quote">{t.quote}</blockquote>
              <div className="testimonial-result">
                <IconCheck size={14} color="currentColor" stroke={2.5} />
                {t.result}
              </div>
              <figcaption className="testimonial-meta">
                <div className="testimonial-avatar">{t.initial}</div>
                <div>
                  <div className="testimonial-name">{t.name}</div>
                  <div className="testimonial-sub">{t.goal}</div>
                </div>
              </figcaption>
            </figure>
          </Reveal>
      )}
      </div>
    </div>
  </section>;


// ============ CONTACT / FORM ============
const Contact = () =>
<section className="contact" id="contact">
    <div className="container contact-grid">
      <div>
        <Reveal>
          <div className="eyebrow contact-eyebrow">מתעניינים?</div>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="contact-title">
            בוא/י נדבר — <em>15 דקות, חינם, בלי התחייבות.</em>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <p className="contact-lede">
            שיחת היכרות קצרה — ללא עלות וללא התחייבות. נדבר על מה שמעניין אותך, אענה על שאלות, ונראה אם הדרך שלי מתאימה לך.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <ul className="contact-list">
            <li><span className="contact-list-tick"><IconCheck size={12} color="#fff" stroke={3} /></span> שיחה אישית — לא טופס אוטומטי</li>
            <li><span className="contact-list-tick"><IconCheck size={12} color="#fff" stroke={3} /></span> ללא עלות וללא התחייבות בהמשך</li>
            <li><span className="contact-list-tick"><IconCheck size={12} color="#fff" stroke={3} /></span> תשובה בתוך 24 שעות</li>
          </ul>
        </Reveal>
        <Reveal delay={340}>
          <a className="contact-phone" href="tel:0524013226">
            <IconWhatsApp size={18} color="#25d366" />
            <span>או בוואטסאפ ישיר: <span className="contact-phone-num">052-4013226</span></span>
          </a>
        </Reveal>
      </div>
      <Reveal delay={150}>
        <LeadForm />
      </Reveal>
    </div>
  </section>;


// ============ FOOTER ============
const Footer = () =>
<footer className="footer">
    <div className="container">
      <div className="footer-grid">
        <div>
          <Logo size="sm" />
          <p className="footer-tag">קליניקת תזונה לבני 21–45 — ליווי תזונתי קליני מבוסס מחקר, ללא דיאטות קיצוניות.</p>
        </div>
        <div>
          <div className="footer-col-title">קליניקה</div>
          <ul className="footer-list">
            <li><a href="#beliefs">האני מאמין</a></li>
            <li><a href="#benefits">מה תקבל</a></li>
            <li><a href="#how">איך זה עובד</a></li>
            <li><a href="#testimonials">ביקורות</a></li>
          </ul>
        </div>
        <div>
          <div className="footer-col-title">יצירת קשר</div>
          <ul className="footer-list">
            <li><a href="tel:0524013226" style={{ direction: 'ltr', display: 'inline-block' }}>052-4013226</a></li>
            <li><a href="mailto:hello@neta.co.il">hello@neta.co.il</a></li>
            <li><a href="#contact">וואטסאפ</a></li>
            <li><a href="#contact">אינסטגרם</a></li>
          </ul>
        </div>
        <div>
          <div className="footer-col-title">קליניקה</div>
          <ul className="footer-list">
            <li>רחוב הרצל 12, תל אביב</li>
            <li>בימים א׳–ה׳, 09:00–19:00</li>
            <li>וירטואלי בכל הארץ</li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 נתנאל מלכה · קליניקת תזונה</span>
        <span>תקנון · פרטיות</span>
      </div>
    </div>
  </footer>;


// ============ STICKY BOTTOM BAR ============
const StickyBar = () =>
<div className="sticky-bar">
    <span className="sticky-bar-text"><strong>מוכנים להתחיל?</strong> שיחת היכרות חינם, ללא התחייבות.</span>
    <a className="sticky-bar-cta" href="#contact">השאר/י פרטים <IconArrow /></a>
  </div>;


// ============ FAB ============
const FabWA = () =>
<a className="fab-wa" href="https://wa.me/972524013226" target="_blank" rel="noopener" aria-label="ליצירת קשר בוואטסאפ">
    <span className="fab-wa-pulse"></span>
    <IconWhatsApp size={26} color="#fff" />
  </a>;


// ============ MAIN APP ============
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentEmphasis": "balanced",
  "fontScale": 1,
  "showFab": true,
  "stickyBar": true
} /*EDITMODE-END*/;

const App = () => {
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(tweaks.fontScale));
    document.body.classList.remove("emph-pink", "emph-blue", "emph-green", "emph-balanced");
    document.body.classList.add(`emph-${tweaks.accentEmphasis}`);
  }, [tweaks.accentEmphasis, tweaks.fontScale]);

  return (
    <div className="page">
      <Nav />
      <Hero />
      <Beliefs />
      <Benefits />
      <HowItWorks />
      <Testimonials />
      <Contact />
      <Footer />
      {tweaks.stickyBar && <StickyBar />}
      {tweaks.showFab && <FabWA />}

      <window.TweaksPanel>
        <window.TweakSection label="דגש צבע">
          <window.TweakRadio
            label="Emphasis"
            value={tweaks.accentEmphasis}
            onChange={(v) => setTweak("accentEmphasis", v)}
            options={[
            { value: "balanced", label: "מאוזן" },
            { value: "pink", label: "ורוד" },
            { value: "blue", label: "כחול" },
            { value: "green", label: "ירוק" }]
            } />
          
        </window.TweakSection>
        <window.TweakSection label="טיפוגרפיה">
          <window.TweakSlider
            label="Font scale"
            value={tweaks.fontScale}
            min={0.85} max={1.2} step={0.05}
            onChange={(v) => setTweak("fontScale", v)} />
          
        </window.TweakSection>
        <window.TweakSection label="UI">
          <window.TweakToggle
            label="Sticky bottom bar"
            value={tweaks.stickyBar}
            onChange={(v) => setTweak("stickyBar", v)} />
          
          <window.TweakToggle
            label="WhatsApp FAB"
            value={tweaks.showFab}
            onChange={(v) => setTweak("showFab", v)} />
          
        </window.TweakSection>
      </window.TweaksPanel>
    </div>);

};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);