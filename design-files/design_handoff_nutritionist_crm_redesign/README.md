# Handoff: Nutritionist CRM — Visual Redesign

## Overview

This is a **visual-only redesign** of an existing nutritionist CRM for נתא (Natanel Malka, clinical dietitian). The CRM is already in production with real data, real users, and working business logic. **Your job is to swap the UI layer only** — apply the new visual design to the existing application without touching the data layer, API calls, routing, auth, or business logic.

> ⚠️ **Do not copy the mock data from the design files.** Names like "רחל כהן", "יואב לוי", counts like "47 מטופלים", and all numbers/content in the HTML files are placeholders. The real app already has its own data. Your task is to **restyle the shell, components, and layout** — the existing data should flow into the new visual containers unchanged.

---

## About the Design Files

The files in this bundle are **design references created in HTML + React (via inline Babel)** — prototypes showing the intended look and behavior. They are **not production code to copy directly**.

Recreate these designs in the target codebase's existing environment (React / Next.js / Vue / etc.) using its established patterns, state management, routing, and component libraries. Keep all existing business logic, API integrations, and data sources. Only the visual presentation layer changes.

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, radii, and shadows are locked. Match the design pixel-closely using the production codebase's styling approach (CSS-in-JS, Tailwind, CSS Modules, etc.).

---

## What to Keep vs. Replace

| Keep (existing app) | Replace (from this design) |
|---|---|
| All data — clients, leads, meetings, protocols, templates, notifications | Visual layout, colors, typography, spacing |
| API endpoints, GraphQL/REST calls, data fetching | Sidebar, topbar, cards, tables, forms, modals |
| Auth, permissions, user session | Button styles, chips, avatars, inputs |
| Routing (page URLs may change if you want, but paths/structure stay) | Page headers, subheaders, empty states |
| Business logic — meeting scheduling, WhatsApp sending, protocol calculations | Icons (use the SVG set in `src/icons.jsx` or equivalent Lucide icons) |
| Database schema, backend | Dashboard stat cards, task list, session list, alert patterns |
| Integrations — Google Calendar, Calendly, WhatsApp Business | Kanban for leads, week-view calendar, template editor layout |

---

## Design System / Tokens

All tokens live in `styles/app.css` under `:root`. Copy these into the target codebase's token system (Tailwind config, CSS vars, theme object, etc.).

### Colors

```
/* Brand */
--blue:   #567DBF   /* primary actions, active state */
--green:  #31B996   /* success, positive metrics, WhatsApp-ish */
--pink:   #F5DBEA   /* accent, avatars, brand warmth */
--bg:     #fcf4f9   /* app canvas — warm off-white with pink lift */

/* Ink (text) */
--ink-1:  #1a1a1a   /* primary text */
--ink-2:  oklch(0.35 0.01 320)   /* secondary */
--ink-3:  oklch(0.52 0.012 320)  /* muted */
--ink-4:  oklch(0.68 0.01 320)   /* faint */

/* Surface */
--surface:   #ffffff
--surface-2: #fbf6f9   /* subtle hover */
--surface-3: #f4ecf2   /* deeper hover / selected */

/* Lines */
--line:     oklch(0.92 0.008 340)
--hairline: oklch(0.95 0.006 340)

/* Semantic soft chips (soft bg + ink fg) */
blue-soft/ink, green-soft/ink, pink-soft/ink, amber-soft/ink, red-soft/ink
```

### Typography

- **Font family:** Heebo (Google Fonts), weights 400/500/600/700
- **Mono:** JetBrains Mono (for numbers in tables)
- **Base size:** 14px, line-height 1.5
- **Scale:** `.h-display` 24/700, `.h-1` 20/700, `.h-2` 16/600, `.h-3` 13/600, body 14/400, small 12/400, xs 11/400
- **Letter-spacing:** negative on headings (-0.015em to -0.006em)
- **Direction:** RTL throughout (`dir="rtl"`)

### Radii

`--r-sm: 6px` · `--r-md: 10px` (buttons) · `--r-lg: 14px` (cards) · `--r-xl: 20px` (modals)

### Shadows

```
--shadow-1:   /* resting cards */ very subtle 1-2px
--shadow-2:   /* raised cards  */ 4-14px soft
--shadow-pop: /* modals/popovers */ 10-30px diffused
```

All shadows are warm-toned (oklch base 0.3 at hue 320), not neutral gray.

### Layout

- Sidebar: **232px**, fixed RTL on the right
- Topbar: **56px**, sticky
- Content padding: **24px** (tweakable to compact 18px / spacious 32px)
- App max-width: 1500–1600px per page

---

## Screens

### 1. Dashboard (`Dashboard.html`)

**Purpose:** Landing after login — morning overview.

**Layout:**
- Sidebar + topbar (persistent shell)
- Page header: greeting ("בוקר טוב, נתנאל"), subline with counts, right-aligned action buttons (Filter, קבע פגישה)
- **Stats row:** 4 KPI cards — active clients / today's meetings / open tasks / monthly revenue. Each: eyebrow label, large number, delta chip (+/- with colored arrow), micro-sparkline
- **Main grid (2 cols):**
  - Left col: Tasks card (tabbed: היום / השבוע / החודש, with checkboxes) + Progress card (mini bar charts per active protocol)
  - Right col: Sessions card (today's meetings with time blocks, client avatars, "הצטרף" button) + Alerts card (4 items: payment overdue, unread WhatsApp, hot lead, etc.)
- Floating AI button bottom-right

**Key patterns:**
- Check toggles with smooth 150ms animation
- Task rows: 36px tall, checkbox + title + due chip + assignee avatar
- Session rows: colored left-border per session type (first/followup/checkin)

### 2. Clients (`Clients.html`)

**Purpose:** Client list + detail drill-down.

**List view:**
- Segmented status filter (All / Active / Paused / Overdue) — pill-shaped, active state has white bg + shadow
- Search input (right-aligned in RTL)
- Table: Avatar | Name + email | Goal chip | Protocol | Last visit | Next session | Status chip | Row hover → row-click opens detail
- Table rows: 52px tall, hover bg `var(--surface-2)`

**Detail view** (hash-route `#client/<id>`):
- Back button → breadcrumb
- Header: avatar (48px) + name + status chips + action buttons (WhatsApp / Call / Schedule meeting)
- **Grid: 2 cols**
  - Left: Vitals + goals card, Current protocol card (macro mini-bar), Meetings history (timeline)
  - Right: WhatsApp conversation preview, Payments/invoices table
- AI "הצעות לפגישה" button in each section

### 3. Leads (`Leads.html`)

**Purpose:** Kanban pipeline — new → contacted → scheduled → converted.

- 4 columns, equal width, draggable cards
- Column header: name + count badge + subtle color strip
- Lead card: name, source chip, estimated value (mono font), days-in-stage, next-action chip
- Drag-and-drop between columns updates column counts live

### 4. Meetings (`Meetings.html`)

**Purpose:** Calendar + integrations management.

**Layout (split 1fr / 320px):**
- **Left:** Week-view calendar
  - Header: prev/next navigation + date range + Day/Week/Month segmented + "Today" + "+ Meeting"
  - Grid: 6 columns (day headers + 5 day columns), hours 8:00–18:00 stacked vertically at 56px per hour
  - Events: colored blocks positioned by fractional hours, colored by type (blue/green/pink/amber)
  - "Now" indicator: horizontal line on today's column
- **Right rail:**
  - Upcoming list (today's meetings, compact)
  - Integrations card: Google Calendar, Calendly, Google Meet, WhatsApp Business — each with logo square, name, description, status chip
  - Weekly availability editor

### 5. Protocols (`Protocols.html`)

**Purpose:** Protocol library with AI personalization.

- Filter chip bar (All / סוכרת / ירידה / טבעוני / הורמונלי / ספורט) + search + "צור ב-AI" + "פרוטוקול חדש"
- **AI banner** (full-width, subtle purple-to-white gradient): icon + title + description + "נסה עכשיו" button
- **Grid:** 3-col responsive cards
  - Top row: colored icon square + name + tag line
  - Description (2 lines, muted)
  - **Macro mini-bar:** 3 columns (protein/carbs/fat) with bold g count
  - Foot: active-client count + "התאם ב-AI" ghost button

### 6. Templates (`Templates.html`)

**Purpose:** WhatsApp template manager.

**Layout (split 380px / 1fr):**
- **Left:** Search + scrollable template list (category filter tabs on top)
  - Row: template name + uses chip + preview snippet + "updated X ago · N vars"
  - Active row: blue left accent, tinted bg
- **Right:** Editor + live preview
  - Header: template name, uses, actions (שפר ב-AI / שכפל / שלח)
  - **Split body:** 1fr / 280px
    - Left: textarea with body, "משתנים" section (var chips: `{{שם_פרטי}}`), quick-send chips
    - Right: **phone preview** — rounded message bubble with filled-in variables highlighted in yellow (`<mark>`)

---

## Shared Chrome Components

### Sidebar (`src/shell.jsx`)
- Brand: 36px "נ" logo tile + "נתא" / "קריינקת • תזונה"
- Sections: "עבודה" (Dashboard, Clients, Leads, Meetings) / "כלים" (Protocols, Templates)
- Nav item: icon 16px + label + optional count badge (right-aligned)
- Active state: tinted background (`var(--surface-3)`), blue left accent (in RTL: right accent)
- Footer: user avatar + name + role + settings dropdown (Profile / Availability / Integrations / Logout)

### Topbar (`src/shell.jsx`)
- Breadcrumbs (left) → Search (⌘K opens palette) → spacer → [Bell with unread dot] [AI button] [**+ חדש** primary with dropdown]
- **+ חדש dropdown:** מטופל/ת (⌘⇧P), ליד (⌘⇧L), פגישה (⌘⇧M), תבנית WhatsApp, פרוטוקול
- Bell → notifications side-panel (360px wide, slides in from right in RTL)

### Global patterns (`src/interactions.jsx`)
- **Modal:** centered, 560px (720px wide), backdrop blur, Esc to close
- **Toast:** top-right, auto-dismiss 2.6s, colored dot + message
- **Dropdown:** 220px min-width, 5px padding, 7px rounded items with hover bg
- **Command palette (⌘K):** 560px, 48px input, grouped results
- **Notifications panel:** 360px, unread blue dot, "סמן הכל כנקרא"

### Forms
- Input/textarea/select: 36px tall, 1px border `var(--line)`, 8px radius, 12px horizontal padding
- Focus: blue border + 3px soft-blue glow
- Label: 12px/500, ink-2, 6px below

### Buttons
- **Default:** 32px tall, 12px padding, 10px radius, white bg, line border
- **Primary:** blue bg, white text
- **Ghost:** transparent, hover surface-3
- **Small:** 26px tall, 9px padding, 12px font, 8px radius
- **Icon:** 30px square

### Chips
- 22px tall, 8px horizontal, 999px radius, 11.5px/500
- Variants: blue / green / pink / amber / red — each with soft bg + ink fg + optional leading dot

---

## Interactions & Motion

- **Hover:** 150ms background/border transitions on interactive elements
- **Active button:** 0.5px Y-translate
- **Modal open:** 180ms pop with subtle scale (0.98 → 1) + opacity
- **Toast in:** 220ms slide from top
- **Dropdown:** 120ms fade + 4px Y
- **AI panel slide:** 240ms from leading edge (right in RTL)
- **Check toggle:** 150ms background swap
- **Focus ring:** 2px solid blue, 2px offset

---

## RTL / Hebrew Notes

- `dir="rtl"` on `<html>` or app root
- Logical properties: use `inset-inline-start/end`, `margin-inline-start/end`, `padding-inline` — not physical left/right — so LTR fallback works
- Tabular numerals (`font-variant-numeric: tabular-nums`) for KPIs, prices, dates
- Font feature settings `'ss01', 'kern'` on Heebo
- Time format: 24h (e.g., "14:30"); dates: "ד׳ 23/4 09:00"

---

## Icons

See `src/icons.jsx` — a small inline-SVG set (dash, users, leads, cal, protocol, msg, sparkle, search, bell, plus, chev, filter, more, settings, arrow, phone, zap, clock). In production, use a matching Lucide/Heroicons set at 16px default stroke 1.75, or reuse this SVG inline if you want zero runtime dep.

---

## File Map (this bundle)

```
design_handoff_nutritionist_crm_redesign/
├── README.md                  ← this file
├── Dashboard.html             ← landing / overview
├── Clients.html               ← list + detail (hash-routed)
├── Leads.html                 ← kanban
├── Meetings.html              ← calendar + integrations
├── Protocols.html             ← library + AI personalization
├── Templates.html             ← WhatsApp manager
├── styles/
│   ├── app.css                ← tokens + buttons + chips + cards + avatar + base
│   ├── shell.css              ← sidebar + topbar + page scaffold + dashboard widgets
│   ├── clients.css            ← client list/detail + leads kanban
│   ├── features.css           ← meetings calendar + protocols grid + templates
│   └── interactions.css       ← modals, toasts, dropdowns, notif panel, cmdk
└── src/
    ├── icons.jsx              ← SVG icon set
    ├── shell.jsx              ← Sidebar + Topbar components
    ├── interactions.jsx       ← Modal/Toast/Dropdown/CmdK/ActionProvider
    ├── dashboard.jsx          ← Dashboard sections
    ├── clients.jsx            ← List + detail views
    ├── leads.jsx              ← Kanban board
    ├── meetings.jsx           ← WeekCalendar + Upcoming + Integrations + Avail
    ├── features.jsx           ← ProtocolsLibrary + TemplatesManager
    ├── data.jsx, clients-data.jsx, features-data.jsx  ← MOCK DATA — DISCARD
```

---

## Implementation Plan (suggested)

1. **Lift tokens** into the target codebase's theme/tailwind config.
2. **Shell first:** Sidebar + Topbar + base page scaffold. Wire to existing routing.
3. **Primitives:** Button, Chip, Card, Avatar, Input, Modal, Toast, Dropdown — match the shapes here.
4. **One page at a time**, wiring existing data:
   - Dashboard → existing dashboard endpoints, just re-skin the widgets
   - Clients list → existing clients query, restyle table/rows
   - Client detail → keep existing data fetch per client, replace layout
   - Leads kanban → existing lead stages; ensure drag/drop hooks into existing status-update mutation
   - Meetings → keep existing Google Calendar / Calendly integration; restyle the week grid
   - Protocols → existing protocol CRUD; restyle cards
   - Templates → existing template CRUD + WhatsApp send; restyle editor/preview
5. **Global chrome:** Notifications panel, ⌘K palette, "+ חדש" dropdown — wire each dropdown item to existing create flows/modals in the app.
6. **QA in RTL.** Logical properties, Hebrew copy alignment, tabular nums on numeric columns.

---

## Out of Scope

- Do NOT re-implement business logic (scheduling conflicts, macro math, payment handling, WhatsApp API, protocol personalization AI). Keep whatever exists.
- Do NOT swap the data model. If a field displayed here doesn't exist in the real data, ask the product owner before adding.
- Do NOT change URL structure without confirming with the team.

---

## Questions to resolve before starting

1. Which styling system does the production codebase use? (Tailwind / CSS Modules / styled-components / Emotion / vanilla)
2. Is Heebo already loaded, or should it be added via `next/font` or equivalent?
3. Any existing design-token source of truth that should be extended rather than replaced?
4. Confirm: data never comes from these HTML files — always from the existing API/store.
