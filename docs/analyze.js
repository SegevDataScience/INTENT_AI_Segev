// Free, deterministic keyword analysis in Hebrew, English and Arabic. Not ML — good enough for a demo.
// Each phrase is matched as a whole word; Hebrew and Arabic phrases also match with attached prefix letters.
const NEGATIVE = [
  // Hebrew
  'לא טוב', 'לא נוח', 'לא עובד', 'לא הגיע', 'לא מצאתי', 'לא ברור',
  'גרוע', 'תקוע', 'נתקע', 'איטי', 'מתסכל', 'באג', 'שגיאה', 'נורא', 'בעיה',
  'מאכזב', 'קורס', 'מעצבן', 'יקר', 'יקרים', 'מסובך',
  'אין קליטה', 'מתנתק', 'לא חזר', 'התעכבה', 'עיכוב', 'באיחור', 'נכשל', 'התרוקן', 'עלה בלי הודעה',
  // English
  'not good', 'not working', "doesn't work", 'did not arrive', "didn't arrive", 'slow', 'broken', 'terrible',
  'bad', 'awful', 'crash', 'crashed', 'stuck', 'error', 'bug', 'problem', 'expensive', 'late', 'delayed',
  'failed', 'annoying', 'frustrating', 'confusing', 'disappointed', 'worst',
  // Arabic
  'لا يعمل', 'لم يصل', 'سيء', 'سيئ', 'بطيء', 'بطيئة', 'مشكلة', 'غالي', 'متأخر', 'تأخر', 'عالق', 'خطأ', 'مزعج', 'فشل',
];
const POSITIVE = [
  'מעולה', 'מצוין', 'אהבתי', 'תודה', 'נוח', 'מהיר', 'מהר', 'קל', 'מושלם', 'כיף',
  'ממליץ', 'טוב', 'נהדר', 'אדיב', 'שמח',
  'great', 'excellent', 'thanks', 'thank you', 'love', 'loved', 'easy', 'fast', 'quick', 'perfect', 'good',
  'amazing', 'helpful', 'friendly', 'recommend', 'nice',
  'ممتاز', 'ممتازة', 'رائع', 'رائعة', 'شكرا', 'شكراً', 'سهل', 'سريع', 'جيد', 'أحببت', 'مفيد', 'لطيف',
];
// Order matters: the first category with a matching word wins.
const CATEGORIES = [
  ['checkout', ['תשלום', 'לשלם', 'קופה', 'אשראי', 'עגלה', 'סל הקניות',
    'payment', 'checkout', 'credit card', 'cart', 'pay ', 'الدفع', 'دفع', 'بطاقة']],
  ['travel', ['טיסה', 'טיסות', 'מטוס', 'מזוודה', 'כבודה', 'צ׳ק אין', "צ'ק אין", 'צק אין', 'המראה', 'נחיתה', 'דייל',
    'flight', 'luggage', 'baggage', 'check-in', 'boarding', 'رحلة', 'طيران', 'حقيبة']],
  ['delivery', ['משלוח', 'שליח', 'הגיע', 'איסוף', 'הזמנה',
    'delivery', 'shipping', 'courier', 'arrived', 'order', 'توصيل', 'شحن', 'وصل', 'الطلب']],
  ['prices', ['מחיר', 'יקר', 'מבצע', 'הנחה', 'זול',
    'price', 'expensive', 'discount', 'cheap', 'sale', 'سعر', 'أسعار', 'الأسعار', 'غالي', 'خصم']],
  ['billing', ['חשבונית', 'חיוב', 'חייב', 'חשבון', 'invoice', 'bill', 'charged', 'فاتورة']],
  ['connectivity', ['קליטה', 'אינטרנט', 'גלישה', 'סיבים', 'ראוטר', 'נתב',
    'internet', 'signal', 'reception', 'router', 'wifi', 'wi-fi', 'إنترنت', 'انترنت', 'الانترنت', 'شبكة']],
  ['pharmacy', ['מרשם', 'מרקחת', 'תרופ', 'רוקח', 'prescription', 'pharmacy', 'medicine', 'وصفة', 'صيدلية', 'دواء']],
  ['content', ['כתבה', 'כתבות', 'פרסומ', 'מודעה', 'כותרת', 'article', 'ads', 'advert', 'headline', 'مقال', 'إعلان']],
  ['site', ['אתר', 'באג', 'נתקע', 'תקוע', 'טעינה', 'כפתור', 'אפליקציה', 'חיפוש', 'שגיאה',
    'website', 'site', 'bug', 'stuck', 'loading', 'button', 'app', 'search', 'error',
    'الموقع', 'موقع', 'التطبيق', 'تطبيق', 'عالق', 'تحميل', 'خطأ']],
  ['service', ['שירות', 'נציג', 'מוקד', 'תמיכה', 'service', 'agent', 'support', 'staff', 'خدمة', 'موظف', 'دعم']],
];

const HEBREW = /[֐-׿]/;
const ARABIC = /[؀-ۿ]/;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Hebrew: up to two attached prefix letters (ו ה ב ל מ ש כ). Arabic: optional و/ف/ب/ل/ك and the article ال.
function wordRe(phrase) {
  const prefix = HEBREW.test(phrase) ? '[והבלמשכ]{0,2}' : ARABIC.test(phrase) ? '(?:[وفبلك]?(?:ال)?)' : '';
  return new RegExp(`(?<!\\p{L})${prefix}${escape(phrase)}(?!\\p{L})`, 'gu');
}
const NEG_RE = NEGATIVE.map(p => [p, wordRe(p)]);
const POS_RE = POSITIVE.map(p => wordRe(p));

export function analyze(text, rating = null) {
  const original = String(text ?? '');
  let rest = original.toLowerCase(); // affects Latin only
  let score = 0;
  // Negative phrases first, then blank them out so "לא טוב" / "not good" don't also count "טוב" / "good".
  for (const [, re] of NEG_RE) {
    re.lastIndex = 0;
    const n = (rest.match(re) || []).length;
    if (n) { score -= n; rest = rest.replace(re, ' '); }
  }
  for (const re of POS_RE) { re.lastIndex = 0; score += (rest.match(re) || []).length; }
  if (Number.isInteger(rating)) {
    if (rating <= 2) score -= 2;
    else if (rating >= 4) score += 2;
  }
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  const lower = original.toLowerCase();
  const hit = CATEGORIES.find(([, words]) => words.some(w => lower.includes(w)));
  return { sentiment, category: hit ? hit[0] : 'other' };
}
