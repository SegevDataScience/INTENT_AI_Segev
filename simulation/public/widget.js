/* Intent AI — local simulation widget.
 * Usage: <script src="/widget.js" data-api-key="..." data-page-url="https://real-site/" data-site-name="..."></script>
 *
 * Compliance (see compliance/02_ACTION_ITEMS_CHECKLIST.md):
 *  - Nothing is collected before the user reads the notice and actively consents (ENG-001, GDPR Art. 7/13).
 *  - The notice discloses browser speech-to-text (Google / Microsoft) and the retention period.
 *  - Users can export / delete their data and withdraw consent from the panel footer (Art. 15/17).
 *  - Global Privacy Control: no persistent identifier is stored when GPC is on (ANL-007).
 */
(function () {
  const script = document.currentScript;
  if (!script) return;
  const API_KEY = script.dataset.apiKey;
  const PAGE_URL = script.dataset.pageUrl || location.href;
  const SITE_NAME = script.dataset.siteName || 'האתר';
  const GPC = navigator.globalPrivacyControl === true;
  const BASE = new URL(script.src, location.href).origin;
  const MAX_RECORD_MS = 120000;
  const MAX_TEXT = 5000;

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

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.className = 'iai-root';
  root.innerHTML = `
    <button class="iai-launcher" type="button" aria-expanded="false" aria-controls="iai-panel">💬 משוב</button>
    <section class="iai-panel" id="iai-panel" role="dialog" aria-label="משוב Intent AI" hidden>
      <div class="iai-head">
        <div><h2>ספרו לנו מה דעתכם</h2><small>בקול או בטקסט · מופעל ע״י Intent AI</small></div>
        <button class="iai-close" type="button" aria-label="סגירה">×</button>
      </div>
      <div class="iai-consent" data-view="consent" hidden>
        <h3>לפני ששולחים משוב</h3>
        <ul class="iai-notice">
          <li><strong>מה נאסף:</strong> תוכן המשוב (טקסט, או הקלטת קול והתמלול שלה), דירוג, כתובת העמוד (ללא פרמטרים) ומזהה אנונימי של הדפדפן.</li>
          <li><strong>כדי להבחין בין כותבים שונים:</strong> סוג הדפדפן, מערכת ההפעלה וסוג המכשיר, שפה ואזור זמן (להערכת מדינה), וטביעה מוצפנת חד-כיוונית של כתובת ה-IP. כתובת ה-IP עצמה, שם ואימייל לא נשמרים.</li>
          <li><strong>למה:</strong> כדי ש<span class="iai-site"></span> יבין את החוויה שלכם וישפר את השירות. הסנטימנט והנושא מזוהים לפי מילות מפתח, ללא זיהוי קולי של הדובר.</li>
          <li><strong>תמלול:</strong> בהקלטה, הקול נשלח לשירות זיהוי הדיבור של הדפדפן (Google ב-Chrome, Microsoft ב-Edge), שעשוי לעבד אותו מחוץ לישראל.</li>
          <li><strong>שמירה:</strong> <span class="iai-retention">90</span> ימים, ואז נמחק אוטומטית.</li>
          <li><strong>הזכויות שלכם:</strong> אפשר להוריד או למחוק את הנתונים ולבטל את ההסכמה בכל רגע, מתחתית החלון.</li>
        </ul>
        <p class="iai-gpc" hidden>זוהה אות Global Privacy Control — המזהה לא יישמר בדפדפן אחרי סגירת הדף.</p>
        <label class="iai-check"><input type="checkbox" class="iai-agree"> קראתי ואני מסכים/ה לאיסוף ולעיבוד המשוב כמתואר</label>
        <div class="iai-row">
          <button class="iai-secondary iai-decline" type="button">לא, תודה</button>
          <button class="iai-send iai-accept" type="button" disabled>המשך</button>
        </div>
        <a class="iai-link iai-privacy" target="_blank" rel="noopener">מדיניות הפרטיות המלאה</a>
      </div>

      <div data-view="form" hidden>
        <div class="iai-tabs" role="tablist">
          <button class="iai-tab" type="button" role="tab" data-tab="voice" aria-selected="true">🎤 קול</button>
          <button class="iai-tab" type="button" role="tab" data-tab="text" aria-selected="false">✍️ טקסט</button>
        </div>

        <div class="iai-body" data-pane="voice">
          <div class="iai-rec-wrap">
            <button class="iai-rec" type="button" aria-label="התחלת הקלטה">🎤</button>
            <div class="iai-timer">לחצו והתחילו לדבר · עד 2 דקות</div>
          </div>
          <p class="iai-label">תמלול</p>
          <textarea class="iai-textarea iai-transcript" maxlength="${MAX_TEXT}" placeholder="התמלול יופיע כאן בזמן שאתם מדברים. אפשר לתקן אותו לפני השליחה."></textarea>
          <audio class="iai-audio" controls hidden></audio>
          <div class="iai-row" data-recorded hidden>
            <button class="iai-secondary iai-rerecord" type="button">הקלטה מחדש</button>
            <button class="iai-send iai-send-voice" type="button">שליחת ההקלטה</button>
          </div>
          <div class="iai-note iai-voice-note"></div>
        </div>

        <div class="iai-body" data-pane="text" hidden>
          <p class="iai-label">איך הייתה החוויה?</p>
          <div class="iai-stars" role="radiogroup" aria-label="דירוג">
            ${[1, 2, 3, 4, 5].map(n => `<button class="iai-star" type="button" data-n="${n}" role="radio" aria-checked="false" aria-label="${n} כוכבים">★</button>`).join('')}
          </div>
          <textarea class="iai-textarea iai-text" maxlength="${MAX_TEXT}" placeholder="מה עבד טוב? מה הפריע? (למשל: המשלוח הגיע באיחור)"></textarea>
          <div class="iai-count">0 / ${MAX_TEXT}</div>
          <button class="iai-send iai-send-text" type="button" disabled>שליחה</button>
        </div>

        <div class="iai-body" style="padding-top:0"><div class="iai-status" role="status" aria-live="polite"></div></div>
        <div class="iai-footer">
          <a class="iai-link iai-privacy" target="_blank" rel="noopener">🔒 פרטיות</a>
          <button class="iai-link iai-export" type="button">⬇ הורדת הנתונים שלי</button>
          <button class="iai-link iai-delete" type="button">🗑 מחיקת הנתונים שלי</button>
          <button class="iai-link iai-withdraw" type="button">ביטול הסכמה</button>
        </div>
      </div>

      <div class="iai-thanks" data-view="thanks" hidden>
        <div class="big">🙏</div>
        <h3>תודה! המשוב התקבל</h3>
        <p>הצוות של האתר יקבל אותו מיד.</p>
        <span class="iai-pill"></span><br>
        <button class="iai-secondary iai-again" type="button">שליחת משוב נוסף</button>
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

  root.querySelectorAll('.iai-site').forEach(n => { n.textContent = SITE_NAME; });
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
    q('.iai-retention').textContent = String(c.retentionDays);
    showView();
  }).catch(() => { consentView.hidden = false; setStatus('לא ניתן להתחבר לשרת המשוב.', true); });

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
      setStatus('הורד קובץ עם ' + data.feedback.length + ' משובים.');
    } catch (err) {
      setStatus('ההורדה נכשלה (' + err.message + ').', true);
    }
  });
  q('.iai-delete').addEventListener('click', async () => {
    if (!confirm('למחוק לצמיתות את כל המשובים וההקלטות ששלחתם ל' + SITE_NAME + '?')) return;
    try {
      const res = await fetch(BASE + '/api/my-data', { method: 'DELETE', headers: dsrHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { deleted } = await res.json();
      setStatus(deleted ? 'נמחקו ' + deleted + ' משובים והקלטות.' : 'לא נמצאו נתונים שלכם למחיקה.');
    } catch (err) {
      setStatus('המחיקה נכשלה (' + err.message + ').', true);
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
  const timerEl = q('.iai-timer');
  const transcriptEl = q('.iai-transcript');
  const audioEl = q('.iai-audio');
  const recordedRow = q('[data-recorded]');
  const voiceNote = q('.iai-voice-note');
  const sendVoiceBtn = q('.iai-send-voice');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recorder = null, chunks = [], recStart = 0, timerInt = null, autoStop = null;
  let recognition = null, finalText = '', audioBlob = null, durationMs = 0, userEdited = false;
  transcriptEl.addEventListener('input', () => { userEdited = true; });

  if (!SR) voiceNote.textContent = 'התמלול לא נתמך בדפדפן הזה — ההקלטה תישמר בלי תמלול. לתמלול אוטומטי פתחו את הדף ב-Chrome.';
  const baseNote = voiceNote.textContent;

  const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
      return setStatus('לא ניתן לקרוא את ההקלטה. נסו להקליט שוב.', true);
    }
    await submit({
      type: 'voice', content: transcriptEl.value.trim(), audioBase64,
      audioMime: audioBlob.type || 'audio/webm', audioDurationMs: durationMs,
    }, sendVoiceBtn);
  });

  async function startRecording() {
    setStatus('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return setStatus('הדפדפן הזה לא תומך בהקלטה. אפשר לעבור לטאב טקסט.', true);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setStatus('אין גישה למיקרופון. אשרו הרשאה בסרגל הכתובת של הדפדפן, או עברו לטאב טקסט.', true);
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
      timerEl.textContent = `הוקלטו ${fmt(durationMs)} · אפשר להאזין, לתקן את התמלול ולשלוח`;
      // Late results may still arrive right after stop; check a moment later.
      setTimeout(() => {
        if (!transcriptEl.value.trim() && !voiceNote.textContent) {
          voiceNote.textContent = 'לא התקבל תמלול. ההקלטה תישמר בכל מקרה — אפשר להקליד את התוכן בתיבה לפני השליחה.';
        }
      }, 1500);
    };
    recorder.start(250);
    recStart = Date.now();
    recBtn.classList.add('recording');
    recBtn.textContent = '■';
    recBtn.setAttribute('aria-label', 'עצירת הקלטה');
    audioEl.hidden = true;
    recordedRow.hidden = true;
    timerEl.textContent = `מקליט… 0:00 / ${fmt(MAX_RECORD_MS)}`;
    timerInt = setInterval(() => { timerEl.textContent = `מקליט… ${fmt(Date.now() - recStart)} / ${fmt(MAX_RECORD_MS)}`; }, 250);
    autoStop = setTimeout(stopRecording, MAX_RECORD_MS);
    startRecognition();
  }

  function stopRecording() {
    clearInterval(timerInt);
    clearTimeout(autoStop);
    recBtn.classList.remove('recording');
    recBtn.textContent = '🎤';
    recBtn.setAttribute('aria-label', 'התחלת הקלטה');
    if (recorder && recorder.state === 'recording') recorder.stop();
    if (recognition) { const r = recognition; recognition = null; try { r.stop(); } catch { /* already stopped */ } }
  }

  function startRecognition() {
    finalText = '';
    userEdited = false;
    transcriptEl.value = '';
    voiceNote.textContent = baseNote;
    if (!SR) return;
    const r = new SR();
    r.lang = 'he-IL';
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
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') voiceNote.textContent = 'התמלול חסום בדפדפן — ההקלטה עדיין תישמר.';
      else if (e.error === 'network') voiceNote.textContent = 'התמלול דורש חיבור לאינטרנט — ההקלטה עדיין תישמר.';
      else if (e.error === 'language-not-supported') voiceNote.textContent = 'הדפדפן לא תומך בתמלול עברית — ההקלטה עדיין תישמר.';
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
    timerEl.textContent = 'לחצו והתחילו לדבר · עד 2 דקות';
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
  const SENTIMENT = { positive: '😊 סנטימנט חיובי', neutral: '😐 סנטימנט ניטרלי', negative: '😟 סנטימנט שלילי' };

  async function submit(payload, button) {
    button.disabled = true;
    setStatus('שולח…');
    try {
      const res = await fetch(BASE + '/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ ...payload, endUserId: endUserId(), pageUrl: PAGE_URL, consent: { version: consentVersion, given: hasConsent() },
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
      setStatus(`השליחה נכשלה (${err.message}). הטיוטה נשמרה — נסו שוב.`, true);
      button.disabled = false;
    }
  }

  function showThanks(fb) {
    const pill = q('.iai-pill');
    pill.className = `iai-pill ${fb.sentiment}`;
    pill.textContent = SENTIMENT[fb.sentiment] || '';
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
})();
