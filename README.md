# מערכת ניהול לקוחות — תזונה קלינית

מערכת CRM פרטית לתזונאים קליניים. מאפשרת ניהול לקוחות ולידים, מעקב אחר 6 פגישות לכל לקוח, התראות חכמות, תובנות AI, ושליחת הודעות וואטסאפ דרך תבניות מותאמות אישית.

---

## דרישות מקדימות

- Node.js גרסה 18 ומעלה
- חיבור לאינטרנט (להורדת חבילות ולשימוש ב-Claude AI)

---

## התקנה

```bash
# שכפל את הפרויקט
git clone <repo-url>
cd <project-folder>

# התקן תלויות (שרת + לקוח בו-זמנית)
npm install
```

---

## הגדרת משתני סביבה

העתק את קובץ הדוגמה וערוך אותו:

```bash
cp .env.example .env
```

ערוך את הקובץ `.env`:

```env
PORT=3001
AUTH_PASSWORD=הסיסמה-שלך
ANTHROPIC_API_KEY=sk-ant-...
WHATSAPP_MODE=deeplink
```

### הסבר על משתני הסביבה

| משתנה | תיאור |
|---|---|
| `PORT` | הפורט שהשרת יאזין עליו (ברירת מחדל: 3001) |
| `AUTH_PASSWORD` | הסיסמה הפרטית להתחברות לאפליקציה |
| `ANTHROPIC_API_KEY` | מפתח API של Anthropic לתובנות AI על פגישות |
| `WHATSAPP_MODE` | `deeplink` לפתיחת WhatsApp ידנית, `api` לשליחה אוטומטית (דורש הגדרה נוספת) |

---

## הרצה מקומית

פתח **שני חלוני טרמינל**:

**טרמינל 1 — השרת:**
```bash
npm run dev
```

**טרמינל 2 — הממשק:**
```bash
cd client
npm run dev
```

הממשק יפתח בכתובת: `http://localhost:5173`

---

## בנייה לייצור (Production)

```bash
npm run build
NODE_ENV=production npm start
```

הממשק ישורת מהכתובת: `http://localhost:3001`

---

## ⚠️ חשוב: Railway + SQLite

הגדר Railway Volume כדי לשמור את הנתונים בין דיפלויים.
ללא Volume — הנתונים יימחקו בכל עדכון קוד.
הוראות: Railway dashboard → project → Add Volume → mount path: `/app/data`

---

## דיפלוי ל-Railway

1. צור חשבון ב-railway.app
2. לחץ "New Project" → "Deploy from GitHub repo"
3. בחר את הריפו של המערכת
4. לאחר הסינכרון, עבור ל-Variables והוסף:
   ```
   PORT=3001
   NODE_ENV=production
   AUTH_PASSWORD=[סיסמה חזקה]
   ANTHROPIC_API_KEY=[המפתח שלך]
   WHATSAPP_MODE=deeplink
   ```
5. עבור ל-Settings → Add Volume:
   - Mount path: `/app/data`
6. הוסף משתנה סביבה נוסף:
   ```
   DB_PATH=/app/data/nutrition.db
   ```
7. לחץ Deploy — הבנייה אורכת כ-2 דקות
8. לחץ על הדומיין שנוצר — האפליקציה עלתה
# Nutrition-business-manager
