// Free, deterministic Hebrew keyword analysis. Not ML — good enough for a demo.
const NEGATIVE = [
  'לא טוב', 'לא נוח', 'לא עובד', 'לא הגיע', 'לא מצאתי', 'לא ברור',
  'גרוע', 'תקוע', 'נתקע', 'איטי', 'מתסכל', 'באג', 'שגיאה', 'נורא', 'בעיה',
  'מאכזב', 'קורס', 'מעצבן', 'יקר', 'יקרים', 'מסובך',
  'אין קליטה', 'מתנתק', 'לא חזר', 'התעכבה', 'עיכוב', 'באיחור', 'נכשל', 'התרוקן', 'עלה בלי הודעה',
];
const POSITIVE = [
  'מעולה', 'מצוין', 'אהבתי', 'תודה', 'נוח', 'מהיר', 'מהר', 'קל', 'מושלם', 'כיף',
  'ממליץ', 'טוב', 'נהדר', 'אדיב', 'שמח',
];
// Order matters: the first category with a matching word wins.
const CATEGORIES = [
  ['checkout', ['תשלום', 'לשלם', 'קופה', 'אשראי', 'עגלה', 'סל הקניות']],
  ['travel', ['טיסה', 'טיסות', 'מטוס', 'מזוודה', 'כבודה', 'צ׳ק אין', "צ'ק אין", 'צק אין', 'המראה', 'נחיתה', 'דייל']],
  ['delivery', ['משלוח', 'שליח', 'הגיע', 'איסוף', 'הזמנה']],
  ['prices', ['מחיר', 'יקר', 'מבצע', 'הנחה', 'זול']],
  ['billing', ['חשבונית', 'חיוב', 'חייב', 'חשבון']],
  ['connectivity', ['קליטה', 'אינטרנט', 'גלישה', 'סיבים', 'ראוטר', 'נתב']],
  ['pharmacy', ['מרשם', 'מרקחת', 'תרופ', 'רוקח']],
  ['content', ['כתבה', 'כתבות', 'פרסומ', 'מודעה', 'כותרת']],
  ['site', ['אתר', 'באג', 'נתקע', 'תקוע', 'טעינה', 'כפתור', 'אפליקציה', 'חיפוש', 'שגיאה']],
  ['service', ['שירות', 'נציג', 'מוקד', 'תמיכה']],
];

// Whole word, allowing up to two attached Hebrew prefix letters (ו, ה, ב, ל, מ, ש, כ).
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = phrase => new RegExp(`(?<!\\p{L})[והבלמשכ]{0,2}${escape(phrase)}(?!\\p{L})`, 'gu');

export function analyze(text, rating = null) {
  const original = String(text ?? '');
  let rest = original;
  let score = 0;
  // Negative phrases first, then blank them out so "לא טוב" doesn't also count "טוב".
  for (const p of NEGATIVE) {
    const re = wordRe(p);
    const n = (rest.match(re) || []).length;
    if (n) { score -= n; rest = rest.replace(re, ' '); }
  }
  for (const p of POSITIVE) score += (rest.match(wordRe(p)) || []).length;
  if (Number.isInteger(rating)) {
    if (rating <= 2) score -= 2;
    else if (rating >= 4) score += 2;
  }
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  const hit = CATEGORIES.find(([, words]) => words.some(w => original.includes(w)));
  return { sentiment, category: hit ? hit[0] : 'other' };
}
