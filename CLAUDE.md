# Nutrition CRM — Claude Code Instructions

## ⚠️ CRITICAL RULE #1 — RETROACTIVE DATA POLICY

This rule applies to EVERY change, fix, or new feature.
No exceptions. Ever.

### The Rule:
When you change how data is created, stored, or displayed —
you MUST also update ALL existing records in the database
to match the new expected state.

### This applies to:
- Bug fixes that affect data structure
- New fields added to existing tables
- New features that generate data (AI summaries, assessments, etc.)
- Changes to how leads convert to clients
- Changes to how sessions are created
- Changes to how tasks, protocols, or payments work
- ANY change where existing records would be in a different
  state than records created after the change

### How to implement:
Every fix must have TWO parts:

PART 1 — Code fix (future data):
  Fix the bug or add the feature normally.

PART 2 — Repair function (existing data):
  Add a repair function in db.js that:
  - Finds all existing records that need updating
  - Updates them to match the new expected state
  - Runs on every server startup (idempotent — safe to run multiple times)
  - Logs every action: console.log('[repair] Fixed X for client Y')
  - Is wrapped in try/catch so it never crashes the server

### The repair function must cover ALL entities:
- All clients (every status: active, ended, paused)
- All leads (every status: new, contacted, meeting_scheduled,
  became_client, not_relevant, meeting_held)
- All sessions (all 6 session numbers)
- All calendly_events
- All intakes (lead_intakes and session_intakes)

### Examples of what this means:
✅ Added AI summary → run repair to generate summaries
   for all existing clients
✅ Fixed session creation on lead conversion → run repair
   to create sessions for all leads that already converted
✅ Added new field to clients table → run repair to
   populate the field for all existing clients
✅ Changed payment status logic → run repair to recalculate
   status for all existing clients

### When you are done with ANY task:
Before saying "done" or "pushed" — ask yourself:
"Are there any existing records that should look different
after this change?"
If YES → write the repair function first, then push.
If NO → explicitly state why no repair is needed.

### Never acceptable:
❌ "Fixed for future data only"
❌ "Existing records will need to be updated manually"
❌ "This only affects new records"
❌ Pushing without checking if existing data needs repair

---

## Project Overview
A full-stack CRM web app for a clinical nutritionist (נתנאל מלכה).
Stack: React + Tailwind (frontend), Node.js + Express (backend),
SQLite with better-sqlite3, Anthropic Claude API for AI insights.
Deployed on Railway at: https://web-production-790f4.up.railway.app
Landing page: https://web-production-790f4.up.railway.app/landing/
Local dev server runs on: http://localhost:3001

## Language Rules
- All UI text must be in Hebrew
- RTL layout throughout (dir="rtl")
- NEVER use gender slash-forms (אשר/י, בחר/י, לחץ/י etc.)
- Always use gender-neutral Hebrew phrasing only
- No emojis in WhatsApp templates
- No dash characters (—) in WhatsApp templates

## Code Rules
- Never hardcode strings — use constants files
- All date logic goes through utils/dates.js only
- All WhatsApp logic goes through services/whatsapp.service.js only
- All fetch calls go through client/src/lib/api.js only
- Every API route must have try/catch and return consistent JSON
- Every DB migration must be wrapped in try/catch (ignore duplicate column errors)
- Mobile first — every screen must work at 390px width
- Before every task: read relevant skill files from available skills

## Architecture
- Public routes (no auth): mounted BEFORE requireAuth in server.js
- Auth: single password via Authorization: Bearer header
- DB: SQLite at DB_PATH env variable (default: data/nutrition.db)
- AI insights: claude-sonnet-4-20250514, Hebrew responses only
- WhatsApp: WHATSAPP_MODE=deeplink (wa.me links, manual send)
- Calendly: webhook at /api/calendly/webhook (mounted before auth)

## Key Files
- server.js — entry point, route mounting order matters
- database/db.js — DB singleton + all migrations on startup
- database/seed.js — idempotent seeds (check before insert)
- services/whatsapp.service.js — ALL WhatsApp logic here
- services/ai.service.js — ALL Claude API calls here
- services/reminders.service.js — Calendly reminder checks (runs every 30min)
- routes/public.routes.js — public endpoints (no auth)
- routes/calendly.routes.js — Calendly webhook + upcoming sessions

## Environment Variables
PORT, NODE_ENV, AUTH_PASSWORD, ANTHROPIC_API_KEY,
WHATSAPP_MODE, DB_PATH, CALENDLY_TOKEN,
CALENDLY_FOLLOWUP_LINK, CALENDLY_FIRST_LINK

## Brand (for landing page and UI)
Colors: #fcf4f9 (bg), #F5DBEA (pink), #567DBF (blue), #31B996 (green)
Font: Heebo (Hebrew-first)
Logo files: landing/assets/logo-color.png, logo-dark.png, logo-light.png

## Visual Development with Playwright

IMMEDIATELY after implementing any front-end change:
1. Use mcp__playwright__browser_navigate to visit each changed view
2. Take a full page screenshot at desktop (1440px)
3. Take a screenshot at mobile (390px)
4. Run mcp__playwright__browser_console_messages to check for errors
5. Verify RTL is correct and Hebrew text is readable

For comprehensive design review use: /design-review
Full design principles checklist: /.claude/context/design-principles.md

Trigger phrases for visual review:
- "תסתכל על..."
- "השווה את..."
- "בדוק את הדיזיין..."
- "review the..."
- "look at this page..."

Skip visual testing for: backend changes, DB migrations, config files.

## Before Every Task
1. Read ALL available skill files relevant to the task
2. Plan the full approach before writing any code
3. Build one file at a time
4. Self-review after each file
5. Never batch multiple files without confirmation
6. After any frontend change: run the Quick Visual Check above
