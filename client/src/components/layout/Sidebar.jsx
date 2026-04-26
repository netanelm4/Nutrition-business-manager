import { NavLink, useLocation } from 'react-router-dom';

// ── Minimal inline SVG icon set ───────────────────────────────────────────────

function Ic({ children, size = 16, sw = 1.6 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      className="nav-ic" aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Icons = {
  dash:     () => <Ic><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></Ic>,
  clients:  () => <Ic><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Ic>,
  leads:    () => <Ic><path d="M21 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M7 7h10M7 11h7M7 15h5"/><path d="m18 18 2 2 4-4"/></Ic>,
  cal:      () => <Ic><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Ic>,
  protocol: () => <Ic><path d="M10 2v4a2 2 0 0 0 2 2h4"/><path d="M20 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2z"/><path d="M9 13h6M9 17h4"/></Ic>,
  templates:() => <Ic><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></Ic>,
  sparkle:  () => <Ic><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></Ic>,
  settings: () => <Ic><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></Ic>,
};

const WORK_NAV = [
  { to: '/',          end: true,  Icon: Icons.dash,      label: 'לוח בקרה'   },
  { to: '/clients',   end: false, Icon: Icons.clients,   label: 'מטופלים'    },
  { to: '/leads',     end: false, Icon: Icons.leads,     label: 'לידים'      },
  { to: '/calendly',  end: false, Icon: Icons.cal,       label: 'פגישות'     },
];

const TOOLS_NAV = [
  { to: '/protocols',  end: false, Icon: Icons.protocol,  label: 'פרוטוקולים'       },
  { to: '/templates',  end: false, Icon: Icons.templates, label: 'תבניות WhatsApp'   },
];

function NavItem({ to, end, Icon, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
    >
      <Icon />
      <span style={{ flex: 1 }}>{label}</span>
    </NavLink>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────

export function DesktopSidebar({ onToggleAssistant }) {
  return (
    <aside className="crm-side">
      {/* Brand */}
      <div className="side-brand">
        <div className="side-logo">נ</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
            ניהול לקוחות
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>תזונה קלינית</div>
        </div>
      </div>

      {/* Work section */}
      <div className="side-sec">עבודה</div>
      {WORK_NAV.map((item) => (
        <NavItem key={item.to} {...item} />
      ))}

      {/* Tools section */}
      <div className="side-sec">כלים</div>
      {TOOLS_NAV.map((item) => (
        <NavItem key={item.to} {...item} />
      ))}

      {/* AI Assistant */}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={onToggleAssistant}
          className="nav-item"
          style={{ width: '100%', color: 'var(--blue)', fontWeight: 600 }}
        >
          <Icons.sparkle />
          <span>עוזר AI</span>
        </button>
      </div>

      {/* Footer */}
      <div className="side-foot">
        <div
          className="av av--blue"
          style={{ width: 32, height: 32, fontSize: 12 }}
        >
          נמ
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>נתנאל מלכה</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>דיאטן קליני</div>
        </div>
        <button
          type="button"
          className="crm-btn crm-btn--ghost crm-btn--icon"
          title="הגדרות"
          style={{ width: 28, height: 28 }}
        >
          <Icons.settings />
        </button>
      </div>
    </aside>
  );
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────

const MOBILE_NAV = [
  { to: '/',          end: true,  icon: '📊', label: 'לוח בקרה'    },
  { to: '/clients',   end: false, icon: '👤', label: 'מטופלים'     },
  { to: '/leads',     end: false, icon: '📋', label: 'לידים'       },
  { to: '/protocols', end: false, icon: '📂', label: 'פרוטוקולים'  },
  { to: '/templates', end: false, icon: '💬', label: 'תבניות'      },
];

export function MobileNav({ onToggleAssistant }) {
  return (
    <nav className="md:hidden fixed bottom-0 right-0 left-0 z-50 flex border-t" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      {MOBILE_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-indigo-600' : 'text-gray-500'
            }`
          }
        >
          <span className="text-xl">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onToggleAssistant}
        className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors"
        style={{ color: 'var(--blue)' }}
      >
        <span className="text-xl">✨</span>
        <span>עוזר AI</span>
      </button>
    </nav>
  );
}
