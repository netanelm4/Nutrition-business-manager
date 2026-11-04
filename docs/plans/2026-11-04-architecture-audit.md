# ביקורת ארכיטקטורה ותוכנית טרנספורמציה — נתא CRM
תאריך: 2026-11-04 · סטטוס: ביקורת בלבד, לא נכתב קוד מימוש

> כל הממצאים מבוססים על קריאת קוד ישירה (file:line). בדיקה ויזואלית ב-Playwright לא בוצעה כי שרת ה-MCP נכשל בהתחברות. ממצאי ה-RTL נגזרו מניתוח CSS ו-DOM.

---

## 0. ממצאים קריטיים (לטפל לפני כל דבר אחר)

| # | חומרה | ממצא | מיקום |
|---|---|---|---|
| S1 | 🔴 אבטחה / פרטיות | `temp-admin.routes.js` מותקן **ללא auth** (`/api/admin/diagnose-leads` ו-`/api/admin/repair-now`). כל אחד ברשת יכול לקרוא שמות לידים ומטופלים ולהפעיל repair | `server.js:63-64` |
| S2 | 🔴 אבטחה / פרטיות | `GET /api/public/debug/weight-schema` ציבורי ומחזיר שמות מטופלים וסכמת DB | `routes/public.routes.js:202` |
| S3 | 🟠 אבטחה | Webhook של WhatsApp ושל Calendly ללא אימות חתימה (`X-Hub-Signature-256` / `Calendly-Webhook-Signature`). אפשר לזייף הודעה נכנסת ולגרום לבוט לשלוח `send_auto_reply` או ליצור אירועים ופגישות מזויפים | `routes/whatsapp-bot.routes.js:23`, `routes/calendly.routes.js` (`webhookRouter.post`) |
| S4 | 🟠 אבטחה | `POST /api/public/recipes` ו-`/public/foods/submit` כותבים ל-DB ללא אימות וללא rate-limit | `routes/public.routes.js:358,452` |
| B1 | 🔴 זרימה שבורה | גרירת ליד בקנבן לעמודה "הפך למטופל" קוראת ל-`PUT /leads/:id {status}` ולא ל-`/convert`. **לא נוצר לקוח** עד ה-restart הבא, שבו `repairOrphanedConvertedLeads` "מתקן" | `client/src/pages/Leads.jsx:69`, `KanbanBoard.jsx:45` |
| B2 | 🔴 נתונים | המרת ליד לא מגדירה `process_end_date`, ולכן התראות "התהליך מסתיים" ו"התהליך הסתיים" **לעולם לא נורות** עבור לקוחות שהגיעו מליד | `routes/leads.routes.js:239-256` מול `services/alerts.service.js:84-93` |

---

## 1. System Reality Check — מה קורה בפועל

### 1.1 שכבת הנתונים

**Stack:** SQLite (better-sqlite3, סינכרוני) בלי ORM. הסכמה מפוזרת בין `database/schema.sql` (8 טבלאות מקוריות) ל-`database/db.js` (1,893 שורות: כ-80 מיגרציות `ALTER`, 4 שחזורי טבלה מלאים, 6 פונקציות repair ו-seed של מאגר מזון). אין טבלת גרסאות מיגרציה: כל מיגרציה רצה בכל עלייה ונשענת על `try/catch`.

**טבלאות (≈30):** `leads, lead_intakes, clients, engagements, session_windows, sessions, session_intakes, calendly_events, payments, menus, menu_meals, menu_items, menu_examples, protocols, whatsapp_templates, whatsapp_log, ai_recommendations, ai_memory, daily_tasks, weight_logs, food_categories, food_items, recipes, recipe_ingredients, client_food_favorites, settings, users, auth_sessions, activity_log`

**מצב בצד הלקוח:** TanStack Query (`staleTime 30s`), כל ה-fetch עובר דרך `client/src/lib/api.js`. אין store גלובלי. הריאקטיביות היא polling בלבד: dashboard כל 60 שניות, המלצות כל 5 דקות. אין SSE או WebSocket.

**שרשרת הישויות בפועל:**
```
Lead ──(convert, ידני)──▶ Client ──▶ engagements (רק מיגרציה ב-startup!)
  │                         ├─▶ session_windows (6 תאריכים צפויים)
  │                         ├─▶ sessions (1..6)  ◀── נוצרות גם מ-Calendly/Google בזמן *הזמנה*
  │                         ├─▶ payments ─▶ clients.payment_status (sync ✓)
  │                         ├─▶ menus (status draft/final)   ✗ לא מעדכן clients.menu_sent
  │                         ├─▶ whatsapp_log (רק כשלוחצים "שלח")
  │                         └─▶ ai_recommendations (נמחקות ונוצרות מחדש פעמיים ביום)
  └─▶ calendly_events (lead_id / client_id, התאמה לפי טלפון)
```

### 1.2 Broken Links: איפה עדכון ב-A לא מגיע ל-B

| # | פעולה | מה קורה | מה חסר |
|---|---|---|---|
| L1 | גרירה ל"הפך למטופל" | רק `leads.status` מתעדכן | לקוח, session 1, windows, intake copy (B1) |
| L2 | `/leads/:id/convert` | client, session 1, 6 windows, intake ← transaction ✓ | `process_end_date`, `engagement` (נוצר רק בעלייה הבאה, `db.js:1393`), `weight_token` (נוצר עצלני), `engagement_id` על session 1, הודעת Welcome, שיוך פרוטוקול |
| L3 | `menus/:id/finalize` | `menus.status='final'` + `menu_examples` + `ai_memory` | `clients.menu_sent` / `menu_sent_date`. ההתראה "תפריט לא נשלח" ממשיכה לדלוק ונדרש "סמן כנשלח" ידני (`ClientDetail.jsx:497`) |
| L4 | `sessions/:id/complete` | `status='completed'` + `ai_memory` | עדכון windows, טיימר SLA לתפריט, צ'ק-אין, סגירת `calendly_events` |
| L5 | `calendly/events/:id/complete` | `calendly_events.status='completed'` | לא נוגע ב-sessions בכלל |
| L6 | הזמנת פגישת מעקב (Calendly/Google) | יוצרת שורת `sessions` עם תאריך **עתידי** | אין הפרדה בין "נקבעה" ל"התקיימה". ה-window מחושב כירוק, `sessions_done` (Dashboard) סופר פגישות עתידיות כאילו בוצעו |
| L7 | ביטול ב-Google Calendar | `calendly_events → canceled` | ה-session שנוצר בהזמנה **לא נמחק** (רק Calendly webhook מוחק, `calendly.routes.js` `handleCanceled`) |
| L8 | `/clients/:id/stop` | `status='ended'` | לא מפעיל `triggerProcessSummary` (רק `PUT` עם status עושה זאת), לא סוגר engagement |
| L9 | `freeze` | המלצת תזכורת | אין cron שמחזיר ל-active כשמגיע `frozen_until`. רק המלצה |
| L10 | `meeting_held` | מוגדר ב-constants ו-UI labels | ה-CHECK של `leads.status` **לא כולל אותו**. כל כתיבה תיכשל |
| L11 | התאמת Google לפי email | `SELECT ... FROM clients WHERE email` | אין עמודת `email` ב-clients. השאילתה זורקת שגיאה ונבלעת בשקט |
| L12 | Calendly first_meeting ללא התאמה | נשמר event בלי ליד | Google כן יוצר ליד אוטומטית. התנהגות לא עקבית |

### 1.3 אוטומציות ותזמון

| מנגנון | איך עובד | בעיה |
|---|---|---|
| `checkUpcomingReminders` (כל 30 דק') | מייצר **לינק** `wa.me` ושומר ב-DB | לא שולח כלום. וגם: `start_time` נשמר בשלושה פורמטים (Calendly UTC `Z`, Google עם offset `+02:00`, ידני naive `T10:00:00`) ומושווה בטקסט מול `datetime('now')` (UTC עם רווח). חלון ה-23 עד 25 שעות לא אמין |
| `pollNewBookings` (כל 5 דק') | `updatedMin = lastPollTime` | `lastPollTime` בזיכרון. אחרי deploy יש lookback של 10 דק' בלבד, והזמנות בזמן downtime הולכות לאיבוד. מכאן הצורך ב"בדוק עכשיו" |
| `syncCanceledEvents` (כל 30 דק') | `events.get` לכל אירוע | N קריאות API. במקום זה אפשר `syncToken` או push notifications |
| התראות Dashboard | **מחושבות בכל GET** (`alerts.service.js`), לא נשמרות | אין מצב "טופל" או "נשלח". אין snooze. כוללות גם לקוחות `frozen`/`paused` (`dashboard.routes.js` מסנן רק `!= ended`) |
| `runAnalysis` (08:00, 17:00 **ובכל startup**) | 7 בדיקות לכל לקוח פעיל, עד 4 קריאות Claude ללקוח | `saveRecommendation` **מוחק ויוצר מחדש** (כולל כאלה שסומנו `is_sent`). `GET /ai-recommendations` לא מסנן `is_sent`. התוצאה היא 37+ התראות שלא נגמרות. כל deploy ב-Railway מריץ מחדש את כל הקריאות (עלות) |
| repairs ב-`db.js` | 3 repairs שקוראים ל-Claude ב-`setTimeout` בכל עלייה | לוגיקת AI משוכפלת בתוך שכבת ה-DB |

### 1.4 שכבת ה-AI

- **SDK:** `@anthropic-ai/sdk ^0.39.0` (ישן מאוד). מודל: `claude-sonnet-4-6` דרך `config/ai.js` (ה-CLAUDE.md עדיין מציין `claude-sonnet-4-20250514`, מיושן).
- **≈15 נקודות קריאה נפרדות** ל-`messages.create`, כל אחת עם `new Anthropic()` משלה: `assistant, ai-summary ×2, intakes, protocols, daily-tasks, clients, menus, sessions, admin ×2, db.js ×3, ai-intelligence, whatsapp-bot, ai.service`. זה מפר את כלל ה-CLAUDE.md "ALL Claude API calls in ai.service.js".
- **עוזר AI** (`routes/assistant.routes.js`): text wrapper בלבד. משיכה מלאה של כל הלקוחות והלידים ל-system prompt בכל הודעה (ללא caching), `max_tokens: 1000`, ללא tools, ללא יכולת כתיבה, `response.content[0].text` (נשבר אם הבלוק הראשון אינו טקסט). ההיסטוריה נשלחת מהלקוח ולא נשמרת.
- **המלצות AI** (`services/ai-intelligence.service.js`): ניתוח batch שמפיק JSON דרך parsing ידני (strip של ```` ``` ````) ולא דרך structured outputs.
- **סיכום AI / סיכום תהליך / צ'ק-אין / הערכה ראשונית:** single-shot calls, prompts משוכפלים ב-2 עד 3 מקומות (route + repair ב-db.js).
- **הבוט של WhatsApp** (`services/whatsapp-bot.service.js`) הוא **המקום היחיד עם tool use אמיתי**: 5 tools (`send_auto_reply, send_draft_for_approval, forward_to_natanel, update_weight, flag_for_attention`). `send_auto_reply` שולח **ישירות למטופל ללא אישור**.
- **סתירות מדיניות:** `STYLE_SYSTEM` וה-SYSTEM_PROMPT של הבוט מורים להשתמש באימוג'ים ו"גוף שני זכר". ה-CLAUDE.md אוסר אימוג'ים בתבניות WhatsApp ודורש ניסוח נייטרלי מגדרית.
- **`ai_memory`:** טבלה קיימת ומתמלאת (session complete, menu finalize) אבל **אף אחד לא קורא ממנה**.

### 1.5 Frontend, UX ו-CSS

**דפים:** Dashboard, Clients + ClientDetail (2,038 שורות, הקובץ הגדול בפרויקט), Leads (Kanban/List) + LeadDetail, "פגישות" (`/calendly`, CalendlySettings.jsx: אין דף Meetings אמיתי), Protocols, Templates, FoodBank, MenuEditor, Statistics, Settings (חדש, לא committed), PublicWeight, PublicFoodBank, Login.

**ארכיטקטורת CSS: שלוש מערכות במקביל**
1. Design tokens ב-`client/src/index.css` (`:root`, ‏462 שימושי `var(--…)`) ✓ בסיס טוב ל-theming
2. **705 מחלקות palette של Tailwind** (`bg-white`, `text-gray-500`, `bg-yellow-100`…), בעיקר ב-ClientDetail (175), Session/LeadIntakeForm (96 כל אחד), SessionModal (50)
3. **853 inline `style={{}}`** עם **229 hex קשיחים** (PublicFoodBank 107, FoodBank 56, PublicWeight 36)

**טוקנים לא מוגדרים** (נשברים בשקט, ונופלים ל-transparent או ל-initial): `--surface-1` (9 שימושים, כולל **הרקע של פאנל העוזר AI**), `--border` (11), `--red`, `--accent`, `--shadow` ועוד. `client/src/App.css` הוא שארית של Vite template ואינו מיובא (dead file).

**שורש בעיית ה-RTL: הסיידבר משמאל**
```css
/* index.css */
.crm-app  { grid-template-columns: 1fr var(--sidebar-w); }  /* @768+ */
.crm-main { grid-column: 1; }
.crm-side { grid-column: 2; border-inline-start: 1px solid var(--line); }
```
ב-`dir="rtl"` עמודת grid מס' 1 נמצאת **בימין**. התוצאה: main בימין, sidebar בשמאל. הקוד נכתב במודל מנטלי של LTR.

**מאגר מזון:** `FoodBank.jsx:574` הוא `flex-direction: row`. ה-main content ראשון ב-DOM ולכן בימין, ופאנל הקטגוריות שני ולכן **בשמאל**, בזמן שהטקסט (שורה 631) אומר "בחר קטגוריה מהרשימה בצד ימין".

**נוספים:** `AIAssistant` עם `right: 0` פיזי, `App.css` עם `text-align:left` / `border-right` (מת), `MobileNav` עם `right:0; left:0` (תקין). `index.html` עם `theme-color: #fcf4f9`. שני חוזי תגובה ב-API: `{success,data}` מול `{ok,...}` ב-menus (לכן קיים `reqMenus` נפרד ב-api.js).

---

## 2. End-to-End Event-Driven Flow Architecture

### 2.1 עיקרון: Domain Events + Outbox + Workflow Engine קטן

ב-SQLite ובתהליך Node יחיד אין צורך ב-Kafka או Redis. מספיק:

```
routes ──▶ domain/commands/*.js (פעולה עסקית אחת = transaction אחת)
                 │  כותבת שינוי + INSERT INTO domain_events (באותה transaction)
                 ▼
        services/event-bus.js  (EventEmitter in-process, מקבל אחרי commit)
                 │
     ┌───────────┼──────────────┬────────────────┬──────────────┐
     ▼           ▼              ▼                ▼              ▼
 timeline    scheduled_jobs   action_queue    ai-agent      SSE /api/stream
 projection  (SLA timers)     (Inbox לאישור)  (proactive)   (invalidate ב-UI)
```

**טבלאות חדשות:**
- `domain_events(id, type, entity_type, entity_id, payload JSON, created_at, processed_at)`: outbox ו-audit trail
- `scheduled_jobs(id, type, run_at, payload, status, attempts, last_error)`: מחליף `setInterval` ו-`setTimeout`. worker אחד שבודק כל דקה (`node-cron` קיים) ועמיד ל-restart
- `action_queue(id, kind, client_id, lead_id, title, draft JSON, status[pending|approved|sent|dismissed|snoozed], due_at, source[rule|agent], dedupe_key UNIQUE)`: **Inbox מאוחד** שמחליף את `ai_recommendations` ואת התראות ה-Dashboard המחושבות. ה-`dedupe_key` (למשל `menu_sla:client:42:session:1`) מונע את הלולאה של מחיקה ויצירה מחדש
- `sessions.status`: `scheduled | held | no_show | canceled` (קיים עמודה, לא בשימוש עקבי) + `calendly_event_id` FK. **session נוצר כ-`scheduled` בהזמנה ועובר ל-`held` רק כשהפגישה מסומנת כהתקיימה**

**SSE:** `GET /api/stream` משדר `{type, entity}` אחרי כל event. בצד הלקוח hook אחד `useLiveInvalidation()` ממפה event לרשימת `queryKey` ל-invalidate. זה מבטל את ה-polling ואת כפתורי "רענן".

### 2.2 Lead → Client

```
LeadStatusChanged(became_client)   ← מכל מקור: קנבן, LeadDetail, סוכן AI
  └▶ command convertLead(leadId)  [transaction אחת]
       ├ INSERT client (start_date, process_end_date = start+90, weight_token, phone, email)
       ├ INSERT engagement #1 (active, price מ-package)
       ├ INSERT session 1 (status=scheduled|held לפי מועד הפגישה, engagement_id)
       ├ INSERT 6 session_windows
       ├ COPY lead_intake → session_intake
       ├ LINK calendly_events.client_id
       └ emit ClientCreated
ClientCreated ──▶
  ├ action_queue: "Welcome" (טיוטה מתבנית welcome, ללא אימוג'ים) → אישור → שליחה
  ├ action_queue: "שייך פרוטוקול" (הצעת AI לפי intake + 3 פרוטוקולים מתאימים)
  ├ action_queue: "תשלום ראשון" אם package_price>0 ואין payment
  ├ AI job: initial_assessment (קיים, לייצב כ-job ולא setTimeout)
  └ SSE invalidate: leads, clients, dashboard
```
**כלל:** `PUT /leads/:id` **חוסם** status=`became_client` ומפנה ל-`convert` (או שהקנבן קורא ל-`convertLead`).

### 2.3 Session Lifecycle

```
BookingReceived (Calendly webhook / Google poll / ידני)
  └▶ upsert calendly_event (start_time מנורמל ל-UTC ISO 'Z' תמיד)
     ├ client מזוהה + follow_up  → session(next#, status=scheduled)
     ├ ליד מזוהה                 → lead.status = meeting_scheduled
     └ לא מזוהה + first_meeting  → ליד חדש (גם מ-Calendly, כמו ב-Google)
     scheduled_jobs: reminder_24h @ start-24h, mark_held_check @ end+30m

reminder_24h      → action_queue "אישור הגעה" (או שליחה אוטומטית ב-Cloud API לפי הגדרה)
mark_held_check   → אם האירוע לא בוטל: action_queue "האם הפגישה התקיימה?" [התקיימה | לא הגיע | נדחתה]
                    (אופציונלי: auto-held אחרי 12 שעות ללא ביטול)

SessionHeld(n)
  ├ sessions.status=held, session_date=actual
  ├ windows: חישוב מחדש של expected_date ל-n+1..6 (אם לא manually_overridden)
  ├ n==1 → scheduled_jobs: menu_sla_due @ held+48h
  ├ AI job: checkin_message → action_queue "צ'ק-אין" (due +3 ימים)
  ├ n<6  → action_queue "שלח לינק לקביעת פגישה n+1" (due לפי window)
  ├ n==6 → emit ProcessCompleting → סיכום תהליך + הצעת חידוש engagement
  └ ai_memory progress

MenuFinalized → clients.menu_sent=1 (נגזר!), menu_sent_date, cancel menu_sla_due,
                action_queue "שלח תפריט" (לינק PDF/food bank)
menu_sla_due  → אם אין menu final: action_queue urgent "תפריט באיחור"
PaymentAdded  → payment_status sync (קיים) + סגירת action "תשלום"
ClientStopped → engagement completed, process_summary job, ביטול כל scheduled_jobs ו-pending actions
ClientFrozen  → scheduled_jobs: freeze_end @ frozen_until → action "לחזור לתהליך?"
```

### 2.4 Dashboard חדש = Inbox

במקום 37 כרטיסים עם "שלח" ידני: Inbox ממוין לפי `due_at` ו-priority, עם פעולות batch ("אשר ושלח 5 צ'ק-אינים"), snooze ו-dismiss. מצב כל פריט **נשמר**, כך שמה שטופל לא חוזר.

---

## 3. AI-Native Agent Architecture

### 3.1 החלטות טכנולוגיות
- **SDK:** שדרוג `@anthropic-ai/sdk` מ-0.39 לגרסה הנוכחית. נדרש ל-Tool Runner (`client.beta.messages.toolRunner` + `betaZodTool`), structured outputs (`output_config.format`) ו-prompt caching מודרני.
- **מודל:** ברירת המחדל המומלצת לסוכן היא `claude-opus-5-5` (adaptive thinking תמיד פעיל, שליטה דרך `output_config.effort`, ברירת מחדל `medium`). למשימות batch זולות (ניתוח לילי, סיווג הודעות) אפשר `claude-haiku-5-5` או `claude-sonnet-5-5`, **בהחלטתך** לגבי עלות.
  - שים לב: ב-Opus 5.5 `tool_choice` מסוג `any`/`tool` מחזיר 400. יש להשתמש ב-`auto` + `strict: true`.
  - להוסיף refusal fallback (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`) ולבדוק `stop_reason` לפני קריאת content.
- **ריכוז:** `services/ai/` עם client יחיד, `config/ai.js` עם מודל לכל route, ו-prompts כקבצים. כל ה-`new Anthropic()` המפוזרים יוסרו.

### 3.2 Tool Registry

**כלל זהב:** כלי קריאה רצים חופשי. כלי כתיבה **לא מבצעים**: הם יוצרים `action_queue` מסוג `agent_proposal` עם diff מוצג, ואתה מאשר (Human-in-the-loop). חריגים שמוגדרים ב-Settings (למשל "מותר לסוכן לרשום משקל") רצים ישר ונרשמים ב-audit.

**Read (auto):**
| Tool | תיאור |
|---|---|
| `search_entities(query, types[])` | חיפוש לקוח/ליד לפי שם או טלפון (fuzzy) ← ids |
| `get_client_snapshot(client_id)` | פרופיל + engagement + sessions + windows/alerts + payments + menu אחרון + פרוטוקול + 6 משקלים |
| `get_client_timeline(client_id, since?)` | domain_events + whatsapp_log + sessions, כרונולוגי |
| `get_lead(lead_id)` / `list_leads(status?, stale_days?)` | כולל `get_stale_leads` |
| `get_schedule(from, to)` | פגישות (calendly_events) + windows צפויים |
| `get_inbox(filter)` | action_queue פתוחים |
| `get_financials(range)` | הכנסות, חובות פתוחים |
| `search_food_bank(query)` / `get_protocol(id)` / `list_templates()` | ידע קליני |
| `recall_memory(client_id, query)` | קריאה מ-`ai_memory` (סוף-סוף בשימוש) |

**Write (proposal ← approval):**
| Tool | תוצאה לאחר אישור |
|---|---|
| `convert_lead_to_client(lead_id, package?)` | command `convertLead` |
| `update_lead_status(lead_id, status, note)` | |
| `schedule_meeting(entity, datetime, type)` | calendly_events + Google Calendar |
| `draft_whatsapp_message(entity, template_id?, text, send_at?)` | action_queue (send now/scheduled) |
| `schedule_followup(entity, due_at, title)` | action_queue |
| `log_session_notes(session_id, highlights, weight, tasks[])` | |
| `assign_protocol(client_id, protocol_id, personalize?)` | |
| `create_menu_draft(client_id, calorie_target, notes)` | menus draft (+generate קיים) |
| `record_payment(client_id, amount, date)` | |
| `freeze_client / stop_client / reactivate_client` | commands קיימים |
| `add_daily_task(text, quadrant, client_id?)` | |

**Generators (מחליפים endpoints נפרדים):** `generate_session_prep_brief(client_id)`, `generate_checkin(session_id)`, `generate_process_summary(client_id)`. כולם עם structured outputs (JSON schema) ולא regex-strip.

### 3.3 Runtime

```
POST /api/agent/chat  (SSE stream)
  conversation_id ← agent_conversations / agent_messages (היסטוריה בשרת)
  system  = [STABLE persona + כללים + tool docs]   ← cache_control
  tools   = registry (סדר דטרמיניסטי, אחרת cache נשבר)
  messages= history + {role:"system", content: "היום: …, Inbox: 7 פתוחים"}  ← נתון נדיף אחרי ה-breakpoint
  loop: Tool Runner; כל tool כתיבה מחזיר "proposal #123 נוצר, ממתין לאישור"
```
- **אין יותר dump של כל ה-DB ל-prompt**: הסוכן שולף לפי צורך עם tools. זה זול יותר ומדויק יותר.
- **Proactive mode:** ה-event bus מפעיל את הסוכן ב-`claude-opus-5-5` עם effort `low` על אירועים נבחרים (ליד חדש, SessionHeld, menu_sla_due, הודעה נכנסת) עם prompt ממוקד ו-tools מוגבלים. הפלט הוא proposals ב-Inbox. **Morning brief** ב-08:00 במקום `runAnalysis`: סיכום יום + proposals, עם dedupe לפי `dedupe_key`.
- **בוט WhatsApp:** יעבור לאותו registry. `send_auto_reply` יהפוך ל-proposal כברירת מחדל (מידע קליני למטופלים), וניתן לאפשר אוטומטית רק לקטגוריות בטוחות שתגדיר.
- **סגנון:** קובץ `prompts/voice.md` אחד, מתואם עם CLAUDE.md (ללא אימוג'ים ומקפים בתבניות, ניסוח נייטרלי). צריך להכריע אם להודעות חופשיות של הבוט מותרים אימוג'ים. כרגע יש סתירה.

---

## 4. Dark UI Design System ו-RTL Fix

### 4.1 טוקנים (Semantic, לא palette)

```css
:root[data-theme="dark"] {
  /* Surfaces */
  --canvas:      #09090B;   /* רקע אפליקציה */
  --surface:     #0F0F12;   /* כרטיסים, sidebar */
  --surface-2:   #141418;   /* hover, inputs */
  --surface-3:   #1A1A1F;   /* active, selected */
  --overlay:     rgba(0,0,0,.6);
  /* Borders */
  --line:        #1F1F24;
  --line-2:      #27272A;
  --line-strong: #3F3F46;
  --hairline:    #18181B;
  /* Ink */
  --ink-1: #FAFAFA;  --ink-2: #D4D4D8;  --ink-3: #A1A1AA;  --ink-4: #71717A;
  /* Brand → accents (הבהרה ל-contrast על שחור, AA ≥ 4.5:1) */
  --blue:  #7B9DDB;  --blue-soft:  rgba(86,125,191,.14);  --blue-ink:  #A9C1EC;
  --green: #3FD1A9;  --green-soft: rgba(49,185,150,.14);  --green-ink: #6EE0BF;
  --pink:  #E8A9CB;  --pink-soft:  rgba(245,219,234,.10); --pink-ink:  #F2C6DD;
  --amber-soft: rgba(245,158,11,.12); --amber-ink: #FBBF24;
  --red-soft:   rgba(239,68,68,.12);  --red-ink:   #F87171;
  /* Elevation בכהה = border + inner highlight, לא shadow */
  --shadow-1: 0 0 0 1px var(--line);
  --shadow-2: 0 0 0 1px var(--line), 0 8px 24px rgba(0,0,0,.4);
  --shadow-pop: 0 0 0 1px var(--line-2), 0 16px 48px rgba(0,0,0,.6);
  --focus-ring: 0 0 0 2px var(--canvas), 0 0 0 4px var(--blue);
  color-scheme: dark;
}
```
להוסיף aliases לטוקנים השבורים: `--surface-1 → --surface`, `--border → --line`, `--red → --red-ink`, `--accent → --blue`.

### 4.2 אסטרטגיית מיגרציה (בלי לשבור הכול בבת אחת)
1. **שלב A, טוקנים:** ערכת `dark` ב-`index.css`, `data-theme` על `<html>`, `theme-color` ו-`apple-mobile-web-app-status-bar-style` מעודכנים. כ-60% מהמסכים (אלה שמבוססים על `var(--…)`) הופכים כהים מיד.
2. **שלב B, מיפוי Tailwind ל-טוקנים:** ב-`tailwind.config.js` להגדיר `colors` סמנטיים (`canvas, surface, ink-1..4, line, accent-*`) כ-`rgb(var(--…) / <alpha-value>)`. אחר כך codemod (סקריפט jscodeshift או regex) שממפה את 705 המחלקות: `bg-white→bg-surface`, `text-gray-500→text-ink-3`, `border-gray-200→border-line`, `bg-yellow-100 text-yellow-700→bg-amber-soft text-amber-ink` וכו'. לפי סדר הקבצים: ClientDetail, IntakeForms, SessionModal…
3. **שלב C, inline hex:** 229 ערכים, מרוכזים ב-FoodBank ו-PublicFoodBank/PublicWeight. החלפה ל-`var(--…)`.
4. **שלב D, lint guard:** כלל ESLint או grep ב-CI שאוסר hex ו-palette classes חדשים.
5. **דפים ציבוריים** (PublicWeight/PublicFoodBank, שהמטופלים רואים) ו-**דף הנחיתה:** ההמלצה היא להשאיר אותם על המותג הבהיר. הם חלון ראווה ללקוח, לא כלי עבודה. **החלטה שלך.** ה-CLAUDE.md (Brand section) יעודכן בהתאם.

### 4.3 תיקוני RTL
```css
/* נכון ל-RTL: עמודה ראשונה = ימין */
.crm-app  { grid-template-columns: var(--sidebar-w) 1fr; }
.crm-side { grid-column: 1; border-inline-end: 1px solid var(--line); }
.crm-main { grid-column: 2; }
```
- `FoodBank.jsx:574`: להעביר את פאנל הקטגוריות לפני ה-main ב-DOM (או `order: -1`) ולהחליף `borderLeft/Right` ב-`borderInlineEnd`.
- `AIAssistant.jsx:178`: `right:0` ל-`insetInlineEnd: 0`. לוודא שלא מתנגש עם הסיידבר שזז ימינה. העוזר יפתח משמאל (`insetInlineStart` של ה-main), מה שהגיוני כפאנל "משני".
- למחוק את `client/src/App.css` (dead).
- כלל: אסור `left/right/margin-left/padding-right/text-align:left` חדשים. רק logical properties (`inset-inline-*`, `margin-inline-*`, `text-align:start`). ב-Tailwind: `ms-/me-/ps-/pe-/start-/end-`.

---

## 5. Execution Roadmap

כל שלב הוא PR נפרד. כל שלב שמשנה נתונים מגיע עם **repair idempotent ב-`db.js`** לפי CRITICAL RULE #1 ב-CLAUDE.md.

| שלב | תוכן | Repair לנתונים קיימים | סיכון |
|---|---|---|---|
| **0. Hotfix אבטחה** (שעות) | הסרת `temp-admin` ו-`public/debug`, אימות חתימות webhooks, rate-limit ל-public POST | אין (אין שינוי נתונים) | נמוך |
| **1. תיקוני זרימה** (יום-יומיים) | קנבן קורא ל-`convertLead`, חסימת `became_client` ב-PUT; convert מגדיר `process_end_date` + engagement + `weight_token`; `finalize` מעדכן `menu_sent`; `/stop` מפעיל סיכום וסוגר engagement; GET המלצות מסנן `is_sent`; dashboard מסנן `frozen/paused`; `meeting_held` ב-CHECK (או הסרה מה-UI) | backfill `process_end_date=start_date+90` לכל הלקוחות בלי ערך; engagement לכל לקוח חסר; `menu_sent=1` לכל לקוח עם menu final; engagement_id לכל session/payment יתום | נמוך |
| **2. נרמול זמן** | כל `start_time`/`end_time` ל-UTC ISO `Z` דרך `utils/dates.js` בלבד; תיקון השוואות ב-reminders; `lastPollTime` נשמר ב-`settings` | המרת כל `calendly_events` הקיימים לפורמט אחיד (naive ← Asia/Jerusalem ← UTC) | בינוני: לבדוק על עותק DB |
| **3. Session status model** | `scheduled/held/no_show/canceled`, `calendly_event_id` FK; ביטול ב-Google מוחק או מבטל session; ספירת "בוצעו" רק `held` | לכל session עם `session_date > now` → `scheduled`; עבר + יש highlights/weight → `held`; עבר ריק → `held` (ברירת מחדל שמרנית); קישור sessions ל-events לפי client+תאריך | בינוני |
| **4. Event bus + jobs + Inbox** | `domain_events`, `scheduled_jobs`, `action_queue`, commands; העברת reminders/poll/runAnalysis ל-jobs; SSE; Dashboard Inbox | המרת `ai_recommendations` פתוחות ל-`action_queue` עם dedupe; יצירת jobs עתידיים (reminder_24h, menu_sla, freeze_end) לכל ישות פעילה | גבוה: feature flag, הישן רץ במקביל עד אימות |
| **5. Dark theme + RTL** | שלבים A עד D ב-§4 | אין נתונים (UI) | בינוני: Playwright 1440/390 לכל דף |
| **6. AI consolidation** | שדרוג SDK, `services/ai/` מרכזי, structured outputs, ניקוי AI מ-`db.js` (repairs יעברו ל-jobs), יישור voice ל-CLAUDE.md | regenerate רק לרשומות עם JSON שבור (`process_summary` לא parse-able) | נמוך-בינוני |
| **7. Agent** | registry §3.2, `/api/agent/chat` עם streaming ו-history בשרת, proposals ב-Inbox, proactive triggers, morning brief, הבוט על אותו registry | אינדוקס `ai_memory` מנתונים קיימים (highlights, menus) | בינוני: להתחיל read-only, ואחר כך להוסיף כתיבה כלי אחר כלי |

**מדידה בכל שלב:** `scripts/test-routes.js` (קיים) מורחב לכיסוי flows: convert מקנבן, finalize ל-menu_sent, booking ל-session scheduled ל-held. snapshot של ה-DB מ-Railway לפני כל מיגרציה.

---

## נספח: החלטות פתוחות עבורך
1. דפים ציבוריים ודף נחיתה: לשמור מותג בהיר או להעביר לכהה?
2. "הפגישה התקיימה": אישור ידני ב-Inbox, או auto-held אחרי X שעות ללא ביטול?
3. אילו פעולות מותר לסוכן לבצע **בלי** אישור (משקל? תזכורות?)
4. הבוט: האם מותרת שליחה אוטומטית למטופלים בכלל, ובאילו קטגוריות?
5. אימוג'ים בהודעות חופשיות של AI: מותר (כמו היום בבוט) או אסור (כמו ב-CLAUDE.md)?
6. מודל ועלות: Opus 5.5 לסוכן הצ'אט ו-Haiku/Sonnet 5.5 לניתוחי רקע, או מודל אחד?
