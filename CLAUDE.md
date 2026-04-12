# Nutrition CRM — Claude Code Instructions

## Project Overview
A full-stack CRM web app for a clinical nutritionist (נתנאל מלכה).
Stack: React + Tailwind (frontend), Node.js + Express (backend), 
SQLite with better-sqlite3, Anthropic Claude API for AI insights.
Deployed on Railway at: https://web-production-790f4.up.railway.app

## Language Rules
- All UI text must be in Hebrew
- RTL layout throughout (dir="rtl")
- NEVER use gender slash-forms (אשר/י, בחר/י etc.)
- Use gender-neutral Hebrew phrasing only
- No emojis in WhatsApp templates
- No dash characters (—) in WhatsApp templates

## Visual Research with Playwright MCP
When asked to look at websites, landing pages, or UI examples:
1. Use playwright-mcp to open the URL in a real browser
2. Take a screenshot and analyze the visual layout
3. Note: colors, typography, section structure, CTA placement,
   mobile responsiveness, Hebrew/RTL handling if relevant
4. Extract specific design patterns worth applying

Common use cases:
- "תסתכל על דף הנחיתה הזה" → open + screenshot + analyze
- "מה דומה/שונה מהדף שלנו" → compare visually
- "איך הם עשו את ה-X" → inspect specific UI pattern

Always summarize findings in Hebrew before suggesting 
any code changes based on visual research.

## Code Rules
- Never hardcode strings — use constants files
- All date logic goes through utils/dates.js only
- All WhatsApp logic goes through services/whatsapp.service.js only
- All fetch calls go through client/src/lib/api.js only
- Every API route must have try/catch and return consistent JSON
- Every DB migration must be wrapped in try/catch (ignore duplicate)
- Mobile first — every screen must work at 390px width

## Architecture
- Public routes (no auth): mounted BEFORE requireAuth in server.js
- Auth: single password via Authorization: Bearer header
- DB: SQLite at DB_PATH env variable (default: data/nutrition.db)
- AI insights: claude-sonnet-4-20250514, Hebrew responses only

## Key Files
- server.js — entry point, route mounting order matters
- database/db.js — DB singleton + all migrations on startup
- database/seed.js — idempotent seeds (check before insert)
- services/whatsapp.service.js — ALL WhatsApp logic here
- services/ai.service.js — ALL Claude API calls here
- services/reminders.service.js — Calendly reminder checks

## Environment Variables
PORT, NODE_ENV, AUTH_PASSWORD, ANTHROPIC_API_KEY,
WHATSAPP_MODE, DB_PATH, CALENDLY_TOKEN,
CALENDLY_FOLLOWUP_LINK, CALENDLY_FIRST_LINK

## Before Every Change
1. Read relevant skill files from /mnt/skills
2. Plan before coding
3. Build one file at a time
4. Self-review after each file
5. Never batch multiple files without confirmation
