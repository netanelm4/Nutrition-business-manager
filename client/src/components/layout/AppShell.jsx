import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { DesktopSidebar, MobileNav } from './Sidebar';
import GlobalSearch from '../search/GlobalSearch';

// Mobile search overlay
function MobileSearchOverlay({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-white p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <GlobalSearch onClose={onClose} />
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 flex-shrink-0"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <div className="flex flex-row-reverse min-h-screen bg-gray-50">
      <DesktopSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
          {/* Desktop search — centered */}
          <div className="hidden md:flex flex-1 justify-center">
            <GlobalSearch />
          </div>

          {/* Mobile: search icon button */}
          <div className="flex md:hidden flex-1" />
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="חיפוש"
          >
            🔍
          </button>
        </header>

        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      <MobileNav />

      {mobileSearchOpen && (
        <MobileSearchOverlay onClose={() => setMobileSearchOpen(false)} />
      )}
    </div>
  );
}
