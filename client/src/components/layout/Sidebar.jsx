import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/',           icon: '📊', label: 'לוח בקרה'    },
  { to: '/clients',    icon: '👤', label: 'לקוחות'      },
  { to: '/leads',      icon: '📋', label: 'לידים'       },
  { to: '/protocols',  icon: '📂', label: 'פרוטוקולים'  },
  { to: '/templates',  icon: '💬', label: 'תבניות'      },
  { to: '/calendly',   icon: '📅', label: 'קביעת פגישות'},
];

function NavItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`
      }
    >
      <span className="text-lg leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

// Desktop sidebar (hidden on mobile)
export function DesktopSidebar() {
  return (
    <aside className="hidden md:flex flex-col w-56 bg-white border-l border-gray-200 min-h-screen p-4 gap-1 flex-shrink-0">
      <div className="mb-6 px-2">
        <h1 className="text-base font-bold text-gray-900">ניהול לקוחות</h1>
        <p className="text-xs text-gray-400">תזונה קלינית</p>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} {...item} />
      ))}
    </aside>
  );
}

// Mobile bottom nav (visible on mobile only)
export function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 right-0 left-0 bg-white border-t border-gray-200 flex z-50">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
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
    </nav>
  );
}
