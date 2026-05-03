# Mobile Layout Fix & PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the mobile sidebar overlap bug, add a hamburger-triggered drawer, improve the bottom nav, fix card header spacing, and add iPhone PWA meta tags.

**Architecture:** The sidebar (`DesktopSidebar`) has a CSS cascade conflict — `.crm-side { display: flex }` overrides Tailwind's `hidden` class. The fix adds an explicit `@media` guard to the custom CSS. A new mobile drawer is added to `AppShell` as a slide-in overlay. PWA support is added via `index.html` meta tags and `manifest.json`.

**Tech Stack:** React 19, React Router 7, Tailwind CSS 3, Vite 5, CSS custom properties (design system tokens)

---

### Task 1: Fix card header title/subtitle spacing

**Files:**
- Modify: `client/src/index.css` (line ~279 `.card__head`)
- Modify: `client/src/pages/Dashboard.jsx` (lines ~580, ~736 — `marginTop: 2` inline styles)

**Step 1: Fix `.h-2` line-height in index.css**

Find line ~479:
```css
.h-2 { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink-1); }
```
Change to:
```css
.h-2 { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink-1); line-height: 1.25; }
```

**Step 2: Fix subtitle margin in Dashboard.jsx**

Find the two places with `style={{ marginTop: 2 }}` on the `.t-sm.t-muted` subtitle divs (lines ~581 and ~737) and change both to `style={{ marginTop: 5 }}`.

**Step 3: Build and verify**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות/client && npm run build 2>&1 | tail -5
```
Expected: `✓ built in` with no errors.

**Step 4: Commit**

```bash
git add client/src/index.css client/src/pages/Dashboard.jsx
git commit -m "fix: increase card header subtitle spacing to prevent overlap"
```

---

### Task 2: Fix mobile sidebar CSS cascade bug

**Files:**
- Modify: `client/src/index.css` (`.crm-app` grid, `.crm-side` display)

**Step 1: Fix `.crm-app` to single-column on mobile**

Find the `.crm-app` rule (line ~71):
```css
.crm-app {
  display: grid;
  grid-template-columns: 1fr var(--sidebar-w);
  min-height: 100vh;
}
```
Change to:
```css
.crm-app {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
}
@media (min-width: 768px) {
  .crm-app { grid-template-columns: 1fr var(--sidebar-w); }
}
```

**Step 2: Fix `.crm-side` so it doesn't override Tailwind `hidden`**

The `.crm-side` rule has `display: flex` which overrides Tailwind's `.hidden { display: none }`.
Find the `.crm-side` rule (line ~84) and add the media guard:

```css
.crm-side {
  grid-column: 2;
  position: sticky; top: 0; align-self: start;
  height: 100vh;
  background: var(--surface);
  border-inline-start: 1px solid var(--line);
  display: none;          /* hidden by default; md:flex turns it on */
  flex-direction: column;
  padding: 14px 12px;
  gap: 2px;
  overflow-y: auto;
}
@media (min-width: 768px) {
  .crm-side { display: flex; }
}
```

Also remove the `hidden md:flex` Tailwind classes from `DesktopSidebar` in `Sidebar.jsx` (line ~58) since the CSS now handles visibility:
```jsx
<aside className="crm-side">
```

**Step 3: Build and verify**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות/client && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add client/src/index.css client/src/components/layout/Sidebar.jsx
git commit -m "fix: sidebar hidden on mobile via CSS media query (fixes cascade conflict with Tailwind)"
```

---

### Task 3: Add mobile drawer + hamburger button

**Files:**
- Modify: `client/src/components/layout/Sidebar.jsx` — add `MobileDrawer` export
- Modify: `client/src/components/layout/AppShell.jsx` — add state + hamburger + render drawer
- Modify: `client/src/index.css` — add drawer + overlay CSS

**Step 1: Add CSS for mobile drawer in index.css**

After the `.crm-side` rules, add:

```css
/* ── Mobile drawer ───────────────────────────────────────────────────────────── */
.crm-overlay {
  display: none;
  position: fixed; inset: 0; z-index: 40;
  background: oklch(0 0 0 / 0.35);
  backdrop-filter: blur(1px);
}
.crm-overlay.is-open { display: block; }

.crm-drawer {
  position: fixed;
  top: 0; bottom: 0;
  inset-inline-end: 0;         /* right side in RTL */
  width: min(280px, 85vw);
  z-index: 41;
  background: var(--surface);
  border-inline-start: 1px solid var(--line);
  display: flex; flex-direction: column;
  padding: 14px 12px;
  gap: 2px;
  overflow-y: auto;
  transform: translateX(-100%);  /* hidden off-screen (RTL: negative = off right) */
  transition: transform 0.22s ease;
}
/* RTL: slide in from right */
[dir="rtl"] .crm-drawer { transform: translateX(100%); }
.crm-drawer.is-open { transform: translateX(0); }

@media (min-width: 768px) {
  .crm-overlay, .crm-drawer { display: none !important; }
}
```

**Step 2: Add `MobileDrawer` component to Sidebar.jsx**

At the bottom of `Sidebar.jsx`, add:

```jsx
export function MobileDrawer({ isOpen, onClose, onToggleAssistant }) {
  return (
    <>
      <div
        className={`crm-overlay${isOpen ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`crm-drawer${isOpen ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="תפריט ניווט">
        {/* Brand */}
        <div className="side-brand">
          <div className="side-logo">נ</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
              ניהול לקוחות
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>תזונה קלינית</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4 }}
            aria-label="סגור תפריט"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
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
            onClick={() => { onToggleAssistant(); onClose(); }}
            className="nav-item"
            style={{ width: '100%', color: 'var(--blue)', fontWeight: 600 }}
          >
            <Icons.sparkle />
            <span>עוזר AI</span>
          </button>
        </div>

        {/* Footer */}
        <div className="side-foot">
          <div className="av av--blue" style={{ width: 32, height: 32, fontSize: 12 }}>נמ</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>נתנאל מלכה</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>דיאטן קליני</div>
          </div>
        </div>
      </aside>
    </>
  );
}
```

**Step 3: Add hamburger icon to AppShell.jsx**

Add hamburger SVG icon function after `IcPlus`:
```jsx
function IcMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18"/>
    </svg>
  );
}
```

**Step 4: Update AppShell state + imports**

In `AppShell.jsx`:
1. Add `drawerOpen` state: `const [drawerOpen, setDrawerOpen] = useState(false);`
2. Add import: `import { DesktopSidebar, MobileNav, MobileDrawer } from './Sidebar';`
3. Add hamburger button to topbar (BEFORE the bell button, only on mobile):
```jsx
{/* Mobile menu trigger */}
<button
  type="button"
  className="crm-btn crm-btn--ghost crm-btn--icon md:hidden"
  onClick={() => setDrawerOpen(true)}
  aria-label="תפריט"
>
  <IcMenu />
</button>
```
4. Render `MobileDrawer` below `MobileNav`:
```jsx
<MobileDrawer
  isOpen={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  onToggleAssistant={toggleAssistant}
/>
```

**Step 5: Close drawer on navigation**

In `MobileDrawer`, wrap each `NavItem` to close drawer on click. Add `onClick` to the `NavItem` component in the drawer section by passing `onClose` as a prop through `NavItem`:

Actually the simpler approach: use a `useEffect` in `MobileDrawer` that listens to location changes and closes the drawer:
```jsx
import { useLocation } from 'react-router-dom';
// Inside MobileDrawer:
const location = useLocation();
useEffect(() => { onClose(); }, [location.pathname]);
```

**Step 6: Build and verify**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות/client && npm run build 2>&1 | tail -5
```

**Step 7: Commit**

```bash
git add client/src/components/layout/Sidebar.jsx client/src/components/layout/AppShell.jsx client/src/index.css
git commit -m "feat: add mobile drawer sidebar with hamburger toggle"
```

---

### Task 4: Improve mobile bottom nav (replace emojis with icons)

**Files:**
- Modify: `client/src/components/layout/Sidebar.jsx` — `MobileNav` component
- Modify: `client/src/index.css` — add `.mobile-nav` CSS

**Step 1: Add mobile nav CSS to index.css**

```css
/* ── Mobile bottom nav ───────────────────────────────────────────────────────── */
.mobile-nav {
  position: fixed; bottom: 0; right: 0; left: 0; z-index: 50;
  display: flex;
  background: var(--surface);
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.mobile-nav-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 8px 4px;
  gap: 3px;
  font-size: 10px; font-weight: 500;
  color: var(--ink-3);
  text-decoration: none;
  border: none; background: none; cursor: pointer;
  transition: color .12s;
}
.mobile-nav-item.is-active { color: var(--blue); }
.mobile-nav-item svg { width: 20px; height: 20px; }
@media (min-width: 768px) {
  .mobile-nav { display: none; }
}
```

**Step 2: Rewrite `MobileNav` in Sidebar.jsx**

Replace the existing `MobileNav` function with:

```jsx
const MOBILE_NAV = [
  { to: '/',          end: true,  Icon: Icons.dash,      label: 'לוח בקרה'   },
  { to: '/clients',   end: false, Icon: Icons.clients,   label: 'מטופלים'    },
  { to: '/leads',     end: false, Icon: Icons.leads,     label: 'לידים'      },
  { to: '/protocols', end: false, Icon: Icons.protocol,  label: 'פרוטוקולים' },
  { to: '/templates', end: false, Icon: Icons.templates, label: 'תבניות'     },
];

export function MobileNav({ onToggleAssistant }) {
  return (
    <nav className="mobile-nav" aria-label="ניווט תחתון">
      {MOBILE_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `mobile-nav-item${isActive ? ' is-active' : ''}`}
        >
          <item.Icon />
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onToggleAssistant}
        className="mobile-nav-item"
        style={{ color: 'var(--blue)' }}
      >
        <Icons.sparkle />
        <span>עוזר AI</span>
      </button>
    </nav>
  );
}
```

**Step 3: Build and verify**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות/client && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add client/src/components/layout/Sidebar.jsx client/src/index.css
git commit -m "feat: replace emoji bottom nav with SVG icons from design system"
```

---

### Task 5: PWA & iPhone meta tags

**Files:**
- Modify: `client/index.html`
- Create: `client/public/manifest.json`
- Modify: `client/src/index.css` — safe area CSS

**Step 1: Add meta tags to `client/index.html`**

Inside `<head>`, after the existing viewport meta, add:
```html
<!-- PWA / iPhone -->
<meta name="theme-color" content="#fcf4f9" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="תזונה CRM" />
<link rel="apple-touch-icon" href="/favicon.svg" />
<link rel="manifest" href="/manifest.json" />
```

**Step 2: Create `client/public/manifest.json`**

```json
{
  "name": "ניהול לקוחות — תזונה",
  "short_name": "תזונה CRM",
  "description": "מערכת ניהול לקוחות לדיאטן קליני",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fcf4f9",
  "theme_color": "#fcf4f9",
  "lang": "he",
  "dir": "rtl",
  "orientation": "portrait",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

**Step 3: Fix safe areas in index.css**

Find the `.crm-top` rule (line ~154) and add safe area top padding:
```css
.crm-top {
  ...existing rules...
  padding-top: env(safe-area-inset-top, 0px);
}
```

Find `.crm-page` or the `<main>` padding-bottom rule. In AppShell the main has `pb-16 md:pb-0`. Add to index.css:

```css
@media (max-width: 767px) {
  .crm-main > main {
    padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  }
}
```

And for the `.mobile-nav` (Task 4), `padding-bottom: env(safe-area-inset-bottom, 0px)` is already included.

**Step 4: Build and verify**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות/client && npm run build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add client/index.html client/public/manifest.json client/src/index.css
git commit -m "feat: add PWA manifest and iPhone meta tags with safe area support"
```

---

### Task 6: Visual check with Playwright

**Step 1: Start dev server**

```bash
cd /Users/netanelmalka/Desktop/תזונה/מערכת\ ניהול\ לקוחות && npm run dev &
```

**Step 2: Screenshot at mobile (390px)**

Use Playwright to navigate to `http://localhost:3001` and take a screenshot at 390px width. Verify:
- No sidebar visible
- Hamburger button visible in topbar
- Bottom nav visible with SVG icons
- Card headers show title and subtitle without overlap

**Step 3: Screenshot at desktop (1440px)**

Verify:
- Sidebar visible on the right
- No bottom nav
- No hamburger button

**Step 4: Test drawer on mobile viewport**

Click the hamburger button → drawer slides in from right → backdrop visible → click backdrop → drawer closes.

**Step 5: Final commit if any CSS tweaks needed**

```bash
git add -p
git commit -m "fix: mobile layout visual tweaks after Playwright review"
```
