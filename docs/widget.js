/* Intent AI — local simulation widget (Hebrew · English · Arabic).
 * Usage: <script src="/widget.js" data-api-key="..." data-page-url="https://real-site/" data-site-name="..." [data-lang="he|en|ar"]></script>
 *
 * Compliance (see compliance/02_ACTION_ITEMS_CHECKLIST.md):
 *  - Nothing is collected before the user reads the notice and actively consents (ENG-001, GDPR Art. 7/13).
 *  - The notice discloses browser speech-to-text (Google / Microsoft) and the retention period — in every language.
 *  - Users can export / delete their data and withdraw consent from the panel footer (Art. 15/17).
 *  - Global Privacy Control: no persistent identifier is stored when GPC is on (ANL-007).
 */
(function () {
  const script = document.currentScript;
  if (!script) return;
  const API_KEY = script.dataset.apiKey;
  const PAGE_URL = script.dataset.pageUrl || location.href;
  const SITE_NAME = script.dataset.siteName || '';
  const GPC = navigator.globalPrivacyControl === true;
  // Folder the widget was served from (no trailing slash): works at the site root and under a sub-path (GitHub Pages).
  const BASE = new URL('.', new URL(script.src, location.href)).href.replace(/\/$/, '');
  const MAX_RECORD_MS = 120000;
  const MAX_TEXT = 5000;

  // ---------- languages ----------
  const LANGS = {
    he: { label: 'עב', dir: 'rtl', sr: 'he-IL', name: 'עברית' },
    en: { label: 'EN', dir: 'ltr', sr: 'en-US', name: 'English' },
    ar: { label: 'ع', dir: 'rtl', sr: 'ar-IL', name: 'العربية' },
  };
  const I18N = {
    he: {
      launcher: '💬 משוב', panel: 'משוב Intent AI', title: 'ספרו לנו מה דעתכם', subtitle: 'בקול או בטקסט · מופעל ע״י Intent AI', close: 'סגירה',
      consentTitle: 'לפני ששולחים משוב', site: 'האתר',
      notice: [
        ['מה נאסף:', 'תוכן המשוב (טקסט, או הקלטת קול והתמלול שלה), דירוג, כתובת העמוד (ללא פרמטרים) ומזהה אנונימי של הדפדפן.'],
        ['כדי להבחין בין כותבים שונים:', 'סוג הדפדפן, מערכת ההפעלה וסוג המכשיר, שפה ואזור זמן (להערכת מדינה), וטביעה מוצפנת חד-כיוונית של כתובת ה-IP. כתובת ה-IP עצמה, שם ואימייל לא נשמרים.'],
        ['למה:', 'כדי ש{site} יבין את החוויה שלכם וישפר את השירות. הסנטימנט והנושא מזוהים לפי מילות מפתח, ללא זיהוי קולי של הדובר.'],
        ['תמלול:', 'בהקלטה, הקול נשלח לשירות זיהוי הדיבור של הדפדפן (Google ב-Chrome, Microsoft ב-Edge), שעשוי לעבד אותו מחוץ לישראל.'],
        ['שמירה:', '{days} ימים, ואז נמחק אוטומטית.'],
        ['הזכויות שלכם:', 'אפשר להוריד או למחוק את הנתונים ולבטל את ההסכמה בכל רגע, מתחתית החלון.'],
      ],
      gpc: 'זוהה אות Global Privacy Control — המזהה לא יישמר בדפדפן אחרי סגירת הדף.',
      agree: 'קראתי ואני מסכים/ה לאיסוף ולעיבוד המשוב כמתואר', decline: 'לא, תודה', accept: 'המשך', privacyFull: 'מדיניות הפרטיות המלאה',
      tabVoice: '🎤 קול', tabText: '✍️ טקסט', recStart: 'התחלת הקלטה', recStop: 'עצירת הקלטה',
      timerIdle: 'לחצו והתחילו לדבר · עד 2 דקות', transcript: 'תמלול',
      transcriptPh: 'התמלול יופיע כאן בזמן שאתם מדברים. אפשר לתקן אותו לפני השליחה.',
      rerecord: 'הקלטה מחדש', sendVoice: 'שליחת ההקלטה', rate: 'איך הייתה החוויה?', rating: 'דירוג', star: n => `${n} כוכבים`,
      textPh: 'מה עבד טוב? מה הפריע? (למשל: המשלוח הגיע באיחור)', send: 'שליחה',
      privacy: '🔒 פרטיות', export: '⬇ הורדת הנתונים שלי', delete: '🗑 מחיקת הנתונים שלי', withdraw: 'ביטול הסכמה',
      thanksTitle: 'תודה! המשוב התקבל', thanksText: 'הצוות של האתר יקבל אותו מיד.', again: 'שליחת משוב נוסף',
      srUnsupported: 'התמלול לא נתמך בדפדפן הזה — ההקלטה תישמר בלי תמלול. לתמלול אוטומטי פתחו את הדף ב-Chrome.',
      serverDown: 'לא ניתן להתחבר לשרת המשוב.', exported: n => `הורד קובץ עם ${n} משובים.`, exportFailed: e => `ההורדה נכשלה (${e}).`,
      confirmDelete: s => `למחוק לצמיתות את כל המשובים וההקלטות ששלחתם ל${s}?`,
      deleted: n => (n ? `נמחקו ${n} משובים והקלטות.` : 'לא נמצאו נתונים שלכם למחיקה.'), deleteFailed: e => `המחיקה נכשלה (${e}).`,
      readFail: 'לא ניתן לקרוא את ההקלטה. נסו להקליט שוב.', noRecorder: 'הדפדפן הזה לא תומך בהקלטה. אפשר לעבור לטאב טקסט.',
      noMic: 'אין גישה למיקרופון. אשרו הרשאה בסרגל הכתובת של הדפדפן, או עברו לטאב טקסט.',
      recorded: d => `הוקלטו ${d} · אפשר להאזין, לתקן את התמלול ולשלוח`,
      noTranscript: 'לא התקבל תמלול. ההקלטה תישמר בכל מקרה — אפשר להקליד את התוכן בתיבה לפני השליחה.',
      recording: (a, b) => `מקליט… ${a} / ${b}`, srBlocked: 'התמלול חסום בדפדפן — ההקלטה עדיין תישמר.',
      srNetwork: 'התמלול דורש חיבור לאינטרנט — ההקלטה עדיין תישמר.', srLang: 'הדפדפן לא תומך בתמלול בשפה הזו — ההקלטה עדיין תישמר.',
      sending: 'שולח…', sendFailed: e => `השליחה נכשלה (${e}). הטיוטה נשמרה — נסו שוב.`,
      sentiment: { positive: '😊 סנטימנט חיובי', neutral: '😐 סנטימנט ניטרלי', negative: '😟 סנטימנט שלילי' },
    },
    en: {
      launcher: '💬 Feedback', panel: 'Intent AI feedback', title: 'Tell us what you think', subtitle: 'By voice or text · powered by Intent AI', close: 'Close',
      consentTitle: 'Before you send feedback', site: 'the site',
      notice: [
        ['What we collect:', 'your feedback (text, or a voice recording and its transcript), a rating, the page address (without parameters) and an anonymous browser ID.'],
        ['To tell different writers apart:', 'browser type, operating system and device type, language and time zone (to estimate the country), and a one-way encrypted fingerprint of the IP address. The IP address itself, your name and email are not stored.'],
        ['Why:', 'so that {site} understands your experience and improves the service. Sentiment and topic are detected from keywords, with no voice identification of the speaker.'],
        ['Transcription:', "when you record, your voice is sent to the browser's speech recognition service (Google in Chrome, Microsoft in Edge), which may process it outside Israel."],
        ['Retention:', '{days} days, then deleted automatically.'],
        ['Your rights:', 'you can download or delete your data and withdraw consent at any time, from the bottom of this window.'],
      ],
      gpc: 'Global Privacy Control detected — the ID will not be kept in the browser after you close the page.',
      agree: 'I have read and agree to the collection and processing of my feedback as described', decline: 'No, thanks', accept: 'Continue', privacyFull: 'Full privacy policy',
      tabVoice: '🎤 Voice', tabText: '✍️ Text', recStart: 'Start recording', recStop: 'Stop recording',
      timerIdle: 'Tap and start talking · up to 2 minutes', transcript: 'Transcript',
      transcriptPh: 'The transcript appears here as you speak. You can edit it before sending.',
      rerecord: 'Record again', sendVoice: 'Send recording', rate: 'How was your experience?', rating: 'Rating', star: n => `${n} stars`,
      textPh: 'What worked well? What got in the way? (e.g. the delivery arrived late)', send: 'Send',
      privacy: '🔒 Privacy', export: '⬇ Download my data', delete: '🗑 Delete my data', withdraw: 'Withdraw consent',
      thanksTitle: 'Thank you! Feedback received', thanksText: 'The site team will get it right away.', again: 'Send more feedback',
      srUnsupported: 'Transcription is not supported in this browser — the recording will be saved without a transcript. Open the page in Chrome for automatic transcription.',
      serverDown: 'Cannot reach the feedback server.', exported: n => `Downloaded a file with ${n} feedback items.`, exportFailed: e => `Download failed (${e}).`,
      confirmDelete: s => `Permanently delete all feedback and recordings you sent to ${s}?`,
      deleted: n => (n ? `Deleted ${n} feedback items and recordings.` : 'No data of yours was found.'), deleteFailed: e => `Deletion failed (${e}).`,
      readFail: 'Could not read the recording. Please record again.', noRecorder: 'This browser does not support recording. You can switch to the text tab.',
      noMic: 'No microphone access. Allow it in the browser address bar, or switch to the text tab.',
      recorded: d => `Recorded ${d} · listen, fix the transcript and send`,
      noTranscript: 'No transcript came back. The recording will still be saved — you can type the content in the box before sending.',
      recording: (a, b) => `Recording… ${a} / ${b}`, srBlocked: 'Transcription is blocked in the browser — the recording will still be saved.',
      srNetwork: 'Transcription needs an internet connection — the recording will still be saved.', srLang: 'The browser cannot transcribe this language — the recording will still be saved.',
      sending: 'Sending…', sendFailed: e => `Sending failed (${e}). Your draft is kept — please try again.`,
      sentiment: { positive: '😊 Positive sentiment', neutral: '😐 Neutral sentiment', negative: '😟 Negative sentiment' },
    },
    ar: {
      launcher: '💬 ملاحظات', panel: 'ملاحظات Intent AI', title: 'أخبرونا برأيكم', subtitle: 'بالصوت أو بالنص · بتشغيل Intent AI', close: 'إغلاق',
      consentTitle: 'قبل إرسال الملاحظات', site: 'الموقع',
      notice: [
        ['ما الذي نجمعه:', 'محتوى الملاحظة (نص، أو تسجيل صوتي ونصه المكتوب)، تقييم، عنوان الصفحة (بدون معلمات) ومعرّف مجهول للمتصفح.'],
        ['للتمييز بين الكتّاب:', 'نوع المتصفح ونظام التشغيل ونوع الجهاز، اللغة والمنطقة الزمنية (لتقدير الدولة)، وبصمة مشفّرة باتجاه واحد لعنوان IP. لا يتم حفظ عنوان IP نفسه أو الاسم أو البريد الإلكتروني.'],
        ['لماذا:', 'لكي يفهم {site} تجربتكم ويحسّن الخدمة. يتم تحديد المشاعر والموضوع حسب كلمات مفتاحية، دون التعرّف الصوتي على المتحدث.'],
        ['التفريغ النصي:', 'عند التسجيل، يُرسل الصوت إلى خدمة التعرّف على الكلام في المتصفح (Google في Chrome، وMicrosoft في Edge)، وقد تتم معالجته خارج إسرائيل.'],
        ['مدة الحفظ:', '{days} يومًا، ثم يُحذف تلقائيًا.'],
        ['حقوقكم:', 'يمكنكم تنزيل بياناتكم أو حذفها وسحب الموافقة في أي وقت، من أسفل هذه النافذة.'],
      ],
      gpc: 'تم رصد إشارة Global Privacy Control — لن يُحفظ المعرّف في المتصفح بعد إغلاق الصفحة.',
      agree: 'قرأت وأوافق على جمع ملاحظاتي ومعالجتها كما هو موضح', decline: 'لا، شكرًا', accept: 'متابعة', privacyFull: 'سياسة الخصوصية الكاملة',
      tabVoice: '🎤 صوت', tabText: '✍️ نص', recStart: 'بدء التسجيل', recStop: 'إيقاف التسجيل',
      timerIdle: 'اضغطوا وابدؤوا الكلام · حتى دقيقتين', transcript: 'النص',
      transcriptPh: 'سيظهر النص هنا أثناء حديثكم. يمكنكم تعديله قبل الإرسال.',
      rerecord: 'إعادة التسجيل', sendVoice: 'إرسال التسجيل', rate: 'كيف كانت تجربتكم؟', rating: 'التقييم', star: n => `${n} نجوم`,
      textPh: 'ما الذي كان جيدًا؟ ما الذي أزعجكم؟ (مثلًا: التوصيل تأخر)', send: 'إرسال',
      privacy: '🔒 الخصوصية', export: '⬇ تنزيل بياناتي', delete: '🗑 حذف بياناتي', withdraw: 'سحب الموافقة',
      thanksTitle: 'شكرًا! تم استلام ملاحظاتكم', thanksText: 'سيتلقاها فريق الموقع فورًا.', again: 'إرسال ملاحظة أخرى',
      srUnsupported: 'التفريغ النصي غير مدعوم في هذا المتصفح — سيُحفظ التسجيل بدون نص. افتحوا الصفحة في Chrome للتفريغ التلقائي.',
      serverDown: 'تعذّر الاتصال بخادم الملاحظات.', exported: n => `تم تنزيل ملف يحتوي على ${n} ملاحظات.`, exportFailed: e => `فشل التنزيل (${e}).`,
      confirmDelete: s => `حذف جميع الملاحظات والتسجيلات التي أرسلتموها إلى ${s} نهائيًا؟`,
      deleted: n => (n ? `تم حذف ${n} من الملاحظات والتسجيلات.` : 'لم يتم العثور على بيانات لحذفها.'), deleteFailed: e => `فشل الحذف (${e}).`,
      readFail: 'تعذّرت قراءة التسجيل. حاولوا التسجيل مرة أخرى.', noRecorder: 'هذا المتصفح لا يدعم التسجيل. يمكنكم الانتقال إلى تبويب النص.',
      noMic: 'لا يوجد وصول إلى الميكروفون. اسمحوا بذلك من شريط العنوان في المتصفح، أو انتقلوا إلى تبويب النص.',
      recorded: d => `تم تسجيل ${d} · يمكنكم الاستماع وتصحيح النص والإرسال`,
      noTranscript: 'لم يصل نص. سيُحفظ التسجيل على أي حال — يمكنكم كتابة المحتوى في المربع قبل الإرسال.',
      recording: (a, b) => `جارٍ التسجيل… ${a} / ${b}`, srBlocked: 'التفريغ النصي محظور في المتصفح — سيُحفظ التسجيل على أي حال.',
      srNetwork: 'التفريغ النصي يتطلب اتصالًا بالإنترنت — سيُحفظ التسجيل على أي حال.', srLang: 'المتصفح لا يدعم تفريغ هذه اللغة — سيُحفظ التسجيل على أي حال.',
      sending: 'جارٍ الإرسال…', sendFailed: e => `فشل الإرسال (${e}). تم الاحتفاظ بالمسودة — حاولوا مرة أخرى.`,
      sentiment: { positive: '😊 مشاعر إيجابية', neutral: '😐 مشاعر محايدة', negative: '😟 مشاعر سلبية' },
    },
  };

  const pickLang = () => {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    let saved = null;
    try { saved = localStorage.getItem('iai_lang'); } catch { /* storage unavailable */ }
    const nav = (navigator.language || '').slice(0, 2);
    return [fromUrl, saved, script.dataset.lang, nav].find(l => l && I18N[l]) || 'he';
  };
  let lang = pickLang();
  const T = () => I18N[lang];
  const siteName = () => SITE_NAME || T().site;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = BASE + '/widget.css';
  document.head.appendChild(css);

  // ---------- end-user identity ----------
  let memoryId = null;
  function endUserId() {
    if (GPC) return (memoryId ||= crypto.randomUUID()); // GPC: session-only identifier
    try {
      let id = localStorage.getItem('iai_end_user');
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('iai_end_user', id); }
      return id;
    } catch {
      return (memoryId ||= crypto.randomUUID());
    }
  }

  // ---------- DOM (texts are filled in by applyLang) ----------
  const root = document.createElement('div');
  root.className = 'iai-root';
  root.innerHTML = `
    <button class="iai-launcher" type="button" aria-expanded="false" aria-controls="iai-panel" data-i18n="launcher"></button>
    <section class="iai-panel" id="iai-panel" role="dialog" hidden>
      <div class="iai-head">
        <div><h2 data-i18n="title"></h2><small data-i18n="subtitle"></small></div>
        <div class="iai-head-actions">
          <div class="iai-langs" role="group" aria-label="Language / שפה / اللغة">
            ${Object.entries(LANGS).map(([k, v]) => `<button type="button" class="iai-lang" data-lang="${k}" lang="${k}" title="${v.name}">${v.label}</button>`).join('')}
          </div>
          <button class="iai-close" type="button" data-i18n-aria="close">×</button>
        </div>
      </div>
      <div class="iai-consent" data-view="consent" hidden>
        <h3 data-i18n="consentTitle"></h3>
        <ul class="iai-notice"></ul>
        <p class="iai-gpc" data-i18n="gpc" hidden></p>
        <label class="iai-check"><input type="checkbox" class="iai-agree"> <span data-i18n="agree"></span></label>
        <div class="iai-row">
          <button class="iai-secondary iai-decline" type="button" data-i18n="decline"></button>
          <button class="iai-send iai-accept" type="button" data-i18n="accept" disabled></button>
        </div>
        <a class="iai-link iai-privacy" target="_blank" rel="noopener" data-i18n="privacyFull"></a>
      </div>

      <div data-view="form" hidden>
        <div class="iai-tabs" role="tablist">
          <button class="iai-tab" type="button" role="tab" data-tab="voice" aria-selected="true" data-i18n="tabVoice"></button>
          <button class="iai-tab" type="button" role="tab" data-tab="text" aria-selected="false" data-i18n="tabText"></button>
        </div>

        <div class="iai-body" data-pane="voice">
          <div class="iai-rec-wrap">
            <button class="iai-rec" type="button" data-i18n-aria="recStart">🎤</button>
            <div class="iai-timer"></div>
          </div>
          <p class="iai-label" data-i18n="transcript"></p>
          <textarea class="iai-textarea iai-transcript" maxlength="${MAX_TEXT}" data-i18n-ph="transcriptPh"></textarea>
          <audio class="iai-audio" controls hidden></audio>
          <div class="iai-row" data-recorded hidden>
            <button class="iai-secondary iai-rerecord" type="button" data-i18n="rerecord"></button>
            <button class="iai-send iai-send-voice" type="button" data-i18n="sendVoice"></button>
          </div>
          <div class="iai-note iai-voice-note"></div>
        </div>

        <div class="iai-body" data-pane="text" hidden>
          <p class="iai-label" data-i18n="rate"></p>
          <div class="iai-stars" role="radiogroup" data-i18n-aria="rating">
            ${[1, 2, 3, 4, 5].map(n => `<button class="iai-star" type="button" data-n="${n}" role="radio" aria-checked="false">★</button>`).join('')}
          </div>
          <textarea class="iai-textarea iai-text" maxlength="${MAX_TEXT}" data-i18n-ph="textPh"></textarea>
          <div class="iai-count">0 / ${MAX_TEXT}</div>
          <button class="iai-send iai-send-text" type="button" data-i18n="send" disabled></button>
        </div>

        <div class="iai-body" style="padding-top:0"><div class="iai-status" role="status" aria-live="polite"></div></div>
        <div class="iai-footer">
          <a class="iai-link iai-privacy" target="_blank" rel="noopener" data-i18n="privacy"></a>
          <button class="iai-link iai-export" type="button" data-i18n="export"></button>
          <button class="iai-link iai-delete" type="button" data-i18n="delete"></button>
          <button class="iai-link iai-withdraw" type="button" data-i18n="withdraw"></button>
        </div>
      </div>

      <div class="iai-thanks" data-view="thanks" hidden>
        <div class="big">🙏</div>
        <h3 data-i18n="thanksTitle"></h3>
        <p data-i18n="thanksText"></p>
        <span class="iai-pill"></span><br>
        <button class="iai-secondary iai-again" type="button" data-i18n="again"></button>
      </div>
    </section>`;
  document.body.appendChild(root);

  const q = sel => root.querySelector(sel);
  const launcher = q('.iai-launcher');
  const panel = q('.iai-panel');
  const statusEl = q('.iai-status');
  const formView = q('[data-view="form"]');
  const thanksView = q('[data-view="thanks"]');
  const consentView = q('[data-view="consent"]');
  const timerEl = q('.iai-timer');
  const voiceNote = q('.iai-voice-note');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let retentionDays = 90;
  let lastSentiment = null;
  let timerState = { kind: 'idle' }; // idle | recording | recorded — re-rendered on language change

  function renderNotice() {
    const ul = q('.iai-notice');
    ul.replaceChildren(...T().notice.map(([label, text]) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = label + ' ';
      li.append(strong, text.replace('{site}', siteName()).replace('{days}', String(retentionDays)));
      return li;
    }));
  }
  const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function renderTimer() {
    if (timerState.kind === 'recording') timerEl.textContent = T().recording(fmt(Date.now() - recStart), fmt(MAX_RECORD_MS));
    else if (timerState.kind === 'recorded') timerEl.textContent = T().recorded(fmt(timerState.ms));
    else timerEl.textContent = T().timerIdle;
  }

  function applyLang(next) {
    lang = I18N[next] ? next : 'he';
    try { localStorage.setItem('iai_lang', lang); } catch { /* storage unavailable */ }
    const dir = LANGS[lang].dir;
    panel.setAttribute('dir', dir);
    panel.setAttribute('lang', lang);
    panel.setAttribute('aria-label', T().panel);
    launcher.setAttribute('dir', dir);
    root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = T()[n.dataset.i18n]; });
    root.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = T()[n.dataset.i18nPh]; });
    root.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', T()[n.dataset.i18nAria]); });
    root.querySelectorAll('.iai-star').forEach(s => s.setAttribute('aria-label', T().star(s.dataset.n)));
    root.querySelectorAll('.iai-lang').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    const recBtnEl = q('.iai-rec');
    recBtnEl.setAttribute('aria-label', recBtnEl.classList.contains('recording') ? T().recStop : T().recStart);
    renderNotice();
    renderTimer();
    if (!SR) voiceNote.textContent = T().srUnsupported;
    if (lastSentiment) q('.iai-pill').textContent = T().sentiment[lastSentiment] || '';
  }
  root.querySelectorAll('.iai-lang').forEach(b => b.addEventListener('click', () => {
    applyLang(b.dataset.lang);
    if (recognition) { const r = recognition; recognition = null; try { r.stop(); } catch { /* ignore */ } startRecognition(true); }
  }));

  // ---------- consent ----------
  let consentVersion = null; // current notice version from the server
  let memoryConsent = null;
  const readConsent = () => {
    if (GPC) return memoryConsent;
    try { return localStorage.getItem('iai_consent'); } catch { return memoryConsent; }
  };
  const writeConsent = v => {
    memoryConsent = v;
    if (GPC) return;
    try { if (v) localStorage.setItem('iai_consent', v); else localStorage.removeItem('iai_consent'); } catch { /* storage unavailable */ }
  };
  const hasConsent = () => !!consentVersion && readConsent() === consentVersion;

  root.querySelectorAll('.iai-privacy').forEach(a => { a.href = BASE + '/privacy.html'; });
  q('.iai-gpc').hidden = !GPC;

  function showView() {
    const consented = hasConsent();
    consentView.hidden = consented;
    formView.hidden = !consented;
    thanksView.hidden = true;
  }

  fetch(BASE + '/api/consent').then(r => r.json()).then(c => {
    consentVersion = c.version;
    retentionDays = c.retentionDays;
    renderNotice();
    showView();
  }).catch(() => { consentView.hidden = false; setStatus(T().serverDown, true); });

  const agree = q('.iai-agree');
  agree.addEventListener('change', () => { q('.iai-accept').disabled = !agree.checked; });
  q('.iai-accept').addEventListener('click', () => {
    if (!agree.checked || !consentVersion) return;
    writeConsent(consentVersion);
    showView();
  });
  q('.iai-decline').addEventListener('click', () => toggle(false));
  q('.iai-withdraw').addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording();
    writeConsent(null);
    agree.checked = false;
    q('.iai-accept').disabled = true;
    showView();
  });

  // ---------- data-subject rights ----------
  const dsrHeaders = () => ({ 'X-API-Key': API_KEY, 'X-End-User-Id': endUserId() });
  q('.iai-export').addEventListener('click', async () => {
    try {
      const res = await fetch(BASE + '/api/my-data', { headers: dsrHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'my-feedback-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus(T().exported(data.feedback.length));
    } catch (err) {
      setStatus(T().exportFailed(err.message), true);
    }
  });
  q('.iai-delete').addEventListener('click', async () => {
    if (!confirm(T().confirmDelete(siteName()))) return;
    try {
      const res = await fetch(BASE + '/api/my-data', { method: 'DELETE', headers: dsrHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { deleted } = await res.json();
      setStatus(T().deleted(deleted));
    } catch (err) {
      setStatus(T().deleteFailed(err.message), true);
    }
  });

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', isError);
  }

  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (!open && recorder && recorder.state === 'recording') stopRecording();
  }
  launcher.addEventListener('click', () => toggle(panel.hidden));
  q('.iai-close').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });

  // ---------- tabs ----------
  root.querySelectorAll('.iai-tab').forEach(tab => tab.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording();
    root.querySelectorAll('.iai-tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
    setStatus('');
  }));

  // ---------- text ----------
  let rating = null;
  const textEl = q('.iai-text');
  const sendTextBtn = q('.iai-send-text');
  const countEl = q('.iai-count');
  root.querySelectorAll('.iai-star').forEach(star => star.addEventListener('click', () => {
    rating = Number(star.dataset.n);
    root.querySelectorAll('.iai-star').forEach(s => {
      const on = Number(s.dataset.n) <= rating;
      s.classList.toggle('on', on);
      s.setAttribute('aria-checked', String(Number(s.dataset.n) === rating));
    });
  }));
  textEl.addEventListener('input', () => {
    countEl.textContent = `${textEl.value.length} / ${MAX_TEXT}`;
    sendTextBtn.disabled = !textEl.value.trim();
  });
  sendTextBtn.addEventListener('click', async () => {
    const content = textEl.value.trim();
    if (!content) return;
    await submit({ type: 'text', content, rating }, sendTextBtn);
  });

  // ---------- voice ----------
  const recBtn = q('.iai-rec');
  const transcriptEl = q('.iai-transcript');
  const audioEl = q('.iai-audio');
  const recordedRow = q('[data-recorded]');
  const sendVoiceBtn = q('.iai-send-voice');

  let recorder = null, chunks = [], recStart = 0, timerInt = null, autoStop = null;
  let recognition = null, finalText = '', audioBlob = null, durationMs = 0, userEdited = false;
  transcriptEl.addEventListener('input', () => { userEdited = true; });

  recBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording();
    else startRecording();
  });
  q('.iai-rerecord').addEventListener('click', () => { resetVoice(); startRecording(); });
  sendVoiceBtn.addEventListener('click', async () => {
    if (!audioBlob) return;
    sendVoiceBtn.disabled = true;
    let audioBase64;
    try {
      audioBase64 = await blobToBase64(audioBlob);
    } catch {
      sendVoiceBtn.disabled = false;
      return setStatus(T().readFail, true);
    }
    await submit({
      type: 'voice', content: transcriptEl.value.trim(), audioBase64,
      audioMime: audioBlob.type || 'audio/webm', audioDurationMs: durationMs,
    }, sendVoiceBtn);
  });

  async function startRecording() {
    setStatus('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setStatus(T().noRecorder, true);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setStatus(T().noMic, true);
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find(m => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      durationMs = Date.now() - recStart;
      audioBlob = new Blob(chunks, { type: (recorder.mimeType || 'audio/webm') });
      if (audioEl.src) URL.revokeObjectURL(audioEl.src);
      audioEl.src = URL.createObjectURL(audioBlob);
      audioEl.hidden = false;
      recordedRow.hidden = false;
      sendVoiceBtn.disabled = false;
      timerState = { kind: 'recorded', ms: durationMs };
      renderTimer();
      // Late results may still arrive right after stop; check a moment later.
      setTimeout(() => {
        if (!transcriptEl.value.trim() && !voiceNote.textContent) voiceNote.textContent = T().noTranscript;
      }, 1500);
    };
    recorder.start(250);
    recStart = Date.now();
    recBtn.classList.add('recording');
    recBtn.textContent = '■';
    recBtn.setAttribute('aria-label', T().recStop);
    audioEl.hidden = true;
    recordedRow.hidden = true;
    timerState = { kind: 'recording' };
    renderTimer();
    timerInt = setInterval(renderTimer, 250);
    autoStop = setTimeout(stopRecording, MAX_RECORD_MS);
    startRecognition();
  }

  function stopRecording() {
    clearInterval(timerInt);
    clearTimeout(autoStop);
    recBtn.classList.remove('recording');
    recBtn.textContent = '🎤';
    recBtn.setAttribute('aria-label', T().recStart);
    if (recorder && recorder.state === 'recording') recorder.stop();
    if (recognition) { const r = recognition; recognition = null; try { r.stop(); } catch { /* already stopped */ } }
  }

  // keepText: when switching language mid-recording, continue appending to what was already transcribed
  function startRecognition(keepText = false) {
    if (!keepText) {
      finalText = '';
      userEdited = false;
      transcriptEl.value = '';
    } else {
      finalText = transcriptEl.value ? transcriptEl.value + ' ' : '';
    }
    voiceNote.textContent = SR ? '' : T().srUnsupported;
    if (!SR) return;
    const r = new SR();
    r.lang = LANGS[lang].sr;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      // Late results can arrive after stop: never clobber the user's own edits or write an empty result.
      const text = (finalText + interim).trim();
      if (!userEdited && text) transcriptEl.value = text;
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') voiceNote.textContent = T().srBlocked;
      else if (e.error === 'network') voiceNote.textContent = T().srNetwork;
      else if (e.error === 'language-not-supported') voiceNote.textContent = T().srLang;
    };
    // Browsers end recognition after silence; restart while we're still recording.
    r.onend = () => { if (recognition === r && recorder && recorder.state === 'recording') { try { r.start(); } catch { /* ignore */ } } };
    recognition = r;
    try { r.start(); } catch { /* ignore */ }
  }

  function resetVoice() {
    audioBlob = null;
    durationMs = 0;
    transcriptEl.value = '';
    audioEl.hidden = true;
    recordedRow.hidden = true;
    timerState = { kind: 'idle' };
    renderTimer();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // ---------- submit ----------
  async function submit(payload, button) {
    button.disabled = true;
    setStatus(T().sending);
    try {
      const res = await fetch(BASE + '/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ ...payload, endUserId: endUserId(), pageUrl: PAGE_URL, lang,
          consent: { version: consentVersion, given: hasConsent() },
          locale: navigator.language, timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && /consent/.test(data.error || '')) {
        writeConsent(null); // notice changed or consent missing → ask again; the draft stays in the form
        button.disabled = false;
        setStatus('');
        showView();
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showThanks(data);
    } catch (err) {
      setStatus(T().sendFailed(err.message), true);
      button.disabled = false;
    }
  }

  function showThanks(fb) {
    lastSentiment = fb.sentiment;
    const pill = q('.iai-pill');
    pill.className = `iai-pill ${fb.sentiment}`;
    pill.textContent = T().sentiment[fb.sentiment] || '';
    formView.hidden = true;
    thanksView.hidden = false;
  }

  q('.iai-again').addEventListener('click', () => {
    textEl.value = '';
    textEl.dispatchEvent(new Event('input'));
    rating = null;
    root.querySelectorAll('.iai-star').forEach(s => { s.classList.remove('on'); s.setAttribute('aria-checked', 'false'); });
    resetVoice();
    setStatus('');
    showView();
  });

  applyLang(lang);
})();
