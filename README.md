# presentation: הדגמה של Intent AI

כל מה שצריך כדי להציג את המוצר: אתר הדגמה שרץ מקומית, נתוני בדיקה, מחקר נתונים ומצגת.

| מה | איפה |
|---|---|
| **מצגת:** 3 שקופיות בעברית שמסבירות מה המוצר ומה יש | [`Intent-AI-overview.pptx`](Intent-AI-overview.pptx) |
| **אתר ההדגמה:** משוב בקול ובטקסט על 5 אתרים ישראליים (שופרסל, אל על, ynet, סופר־פארם, פרטנר) | [`simulation/`](simulation/) |
| **הקוד עם החיבור למידע:** שרת Node + מסד נתוני בדיקה (TEST DB, SQLite) | [`simulation/src/`](simulation/src/) · `simulation/data/test.db` |
| **הדשבורד:** משובים לפי לקוח, משתמשים ייחודיים, מגמות | `simulation/public/dashboard.html` |
| **מחקר נתונים:** רשומות גולמיות ותרשימי מגמות (Jupyter) | [`simulation/notebooks/raw_data.ipynb`](simulation/notebooks/raw_data.ipynb) |
| **מסמכי תכנון:** אפיון ותוכנית עבודה | [`docs/superpowers/`](docs/superpowers/) |

## איך מפעילים את ההדגמה

```bash
cd presentation/simulation
npm install
npm run capture   # צילום מסך של האתרים האמיתיים (פעם אחת)
npm start
```

| עמוד | כתובת |
|---|---|
| העמוד הראשי: בחירת אתר | http://localhost:4000 |
| דשבורד לכל האתרים | http://localhost:4000/dashboard.html |
| דשבורד לאתר אחד | http://localhost:4000/dashboard.html?org=elal |
| מדיניות פרטיות | http://localhost:4000/privacy.html |

- **דורש:** Node 22.5 ומעלה. בלי Docker ובלי מפתחות בתשלום.
- **בהדגמה:** הכפתור "👤 משתמש חדש" בסרגל העליון מדמה מבקר נוסף, כדי להראות משתמשים ייחודיים.
- **לפני הדגמה:** כדי לאפס את הנתונים, עוצרים את השרת ומריצים `npm run reset`.
- **מחברת המחקר:** פותחים ב־VS Code, בוחרים Python kernel ומריצים Run All. לפני commit מריצים Clear All Outputs.

פרטים מלאים, כולל ציות ופרטיות: [`simulation/README.md`](simulation/README.md).
