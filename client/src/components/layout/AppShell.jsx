import { useState } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import { DesktopSidebar, MobileNav, MobileDrawer } from './Sidebar';
import GlobalSearch from '../search/GlobalSearch';
import AIAssistant from '../assistant/AIAssistant';

// ── Page title map ─────────────────────────────────────────────────────────────

const PATH_LABELS = {
  '/':           ['עבודה', 'לוח בקרה'],
  '/clients':    ['עבודה', 'מטופלים'],
  '/leads':      ['עבודה', 'לידים'],
  '/calendly':   ['עבודה', 'פגישות'],
  '/protocols':  ['כלים', 'פרוטוקולים'],
  '/templates':  ['כלים', 'תבניות WhatsApp'],
};

function useCrumbs() {
  const { pathname } = useLocation();
  const base = '/' + pathname.split('/').filter(Boolean)[0] || '/';
  const key  = Object.keys(PATH_LABELS).find((k) => pathname === k || (k !== '/' && pathname.startsWith(k)));
  return PATH_LABELS[key || base] || ['עבודה', pathname.split('/').filter(Boolean)[0] || 'לוח בקרה'];
}

// ── Inline icon ────────────────────────────────────────────────────────────────

function IcSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  );
}
function IcBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
  );
}
function IcSparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>
    </svg>
  );
}
function IcPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}
function IcMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18"/>
    </svg>
  );
}

// ── Mobile search overlay ──────────────────────────────────────────────────────

function MobileSearchOverlay({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 p-4 flex flex-col gap-4" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-3">
        <GlobalSearch onClose={onClose} />
        <button
          type="button"
          onClick={onClose}
          className="text-sm flex-shrink-0"
          style={{ color: 'var(--ink-3)' }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

// ── Main shell ─────────────────────────────────────────────────────────────────

export default function AppShell() {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [assistantOpen,    setAssistantOpen]    = useState(false);
  const [drawerOpen,       setDrawerOpen]       = useState(false);
  const crumbs = useCrumbs();

  function toggleAssistant() { setAssistantOpen((v) => !v); }

  return (
    <div className="crm-app">

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="crm-main">

        {/* Topbar */}
        <header className="crm-top">
          {/* Breadcrumbs */}
          <nav className="crm-crumbs" aria-label="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: 'var(--ink-4)' }}>/</span>}
                <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
              </span>
            ))}
          </nav>

          {/* Desktop search */}
          <div className="crm-search-wrap hidden md:block">
            <GlobalSearch />
          </div>

          <div className="top-spacer" />

          <div className="top-actions">
            {/* Mobile search trigger */}
            <button
              type="button"
              className="crm-btn crm-btn--ghost crm-btn--icon md:hidden"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="חיפוש"
            >
              <IcSearch />
            </button>

            {/* Mobile menu trigger */}
            <button
              type="button"
              className="crm-btn crm-btn--ghost crm-btn--icon md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="תפריט"
            >
              <IcMenu />
            </button>

            {/* Bell */}
            <button
              type="button"
              className="crm-btn crm-btn--ghost crm-btn--icon"
              aria-label="התראות"
              style={{ position: 'relative' }}
            >
              <IcBell />
            </button>

            {/* AI Assistant */}
            <button
              type="button"
              className="crm-btn"
              onClick={toggleAssistant}
            >
              <IcSparkle />
              <span className="hidden sm:inline">עוזר AI</span>
            </button>

            {/* + New */}
            <NavLink
              to="/clients"
              className="crm-btn crm-btn--primary"
            >
              <IcPlus />
              <span>חדש</span>
            </NavLink>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <DesktopSidebar onToggleAssistant={toggleAssistant} />

      {/* ── Mobile nav ──────────────────────────────────────────────── */}
      <MobileNav onToggleAssistant={toggleAssistant} />

      {/* ── Mobile drawer ───────────────────────────────────────────── */}
      <MobileDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onToggleAssistant={toggleAssistant}
      />

      {/* ── AI Assistant panel ──────────────────────────────────────── */}
      <AIAssistant
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
      />

      {mobileSearchOpen && (
        <MobileSearchOverlay onClose={() => setMobileSearchOpen(false)} />
      )}
    </div>
  );
}
