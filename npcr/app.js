// NPCR Practice — app paralela a HanziPractice con el contenido de
// New Practical Chinese Reader 1. Mismo proyecto Supabase (login, perfiles,
// clases compartidos) pero contenido y progreso en tablas propias npcr_*.
const SUPABASE_URL = 'https://pwqwlfrlaxnybnkdauvk.supabase.co';
const SUPABASE_KEY = 'sb_publishable__0T0_tkgiEdgUGtwMoSHjA_xRd8btWE';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { useState, useEffect, useMemo } = React;
const { createRoot } = ReactDOM;

const html = React.createElement;
const STORAGE_KEY = 'npcr-practice-progress-v1';
const NAME_KEY = 'npcr-practice-name-v1';
// El simulacro de examen y los diálogos son contenido propio del curso CUI.
const ENABLE_CUI_EXAM = false;
// Código personal de alumno (NOMBRE-XXXX), opcional al entrar. El laoshi lo genera
// en su panel; al activarlo, la cuenta anónima pasa a ser fija y el alumno entra
// con ese código desde cualquier dispositivo conservando su progreso.
const STUDENT_EMAIL_DOMAIN = 'alumno.npcr.app';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I

function normalizeCode(c) { return (c || '').toUpperCase().replace(/\s+/g, '').trim(); }
function studentEmail(code) { return normalizeCode(code).toLowerCase() + '@' + STUDENT_EMAIL_DOMAIN; }
// El código ES la llave de acceso del alumno: la contraseña se deriva del mail de la cuenta.
function studentPassword(email) { return 'npcr·' + email + '·acceso'; }
function isCodeAccount(email) { return !!email && email.endsWith('@' + STUDENT_EMAIL_DOMAIN); }

function makeStudentCode(name) {
  const base = (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'ALUMNO';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return base + '-' + tail;
}

function timeAgo(iso) {
  if (!iso) return 'nunca';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'recién';
  if (mins < 60) return 'hace ' + mins + ' min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'hace ' + hrs + ' h';
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'ayer' : 'hace ' + days + ' días';
}
// Audio grabado y SVG de trazos del mazo NPCR (npcr_media.js, generado).
const NPCR_MEDIA = window.NPCR_MEDIA || { audio: {}, svg: {} };
const MEDIA_PUNCT_RE = /[，。？！,.?!\s、；;：:]/g;

function loadVocab() {
  // Sin fallback hardcodeado: arranca vacío y se llena 100% desde Supabase
  // (tabla `vocabulary`). Ver App() -> useEffect de carga de contenido.
  return {};
}

function loadProgress() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {}
  return { lessons: {} };
}

function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LESSON_THEMES = {}; // se puebla 100% desde Supabase (tabla lesson_themes)
// Frases para "completá la frase" tras "Lo sabía" (desde Supabase): las del libro
// (npcr_sentences, con audio) y las escritas para cada palabra (npcr_context_sentences).
let CONTEXT_SENTENCES = [];
let WORD_SENTENCES = [];

// ── Sonidos de acierto / error: suaves, y se pueden apagar (🔔/🔕) ──
const SOUND_KEY = 'npcr-sound-on';
let _soundOn = (() => { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; } })();
function isSoundOn() { return _soundOn; }
function setSoundOn(on) {
  _soundOn = on;
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch (e) {}
}

let _fxCtx = null;
function softTone(freq, start, dur, vol) {
  const ctx = _fxCtx || (_fxCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// Sin sonido de acierto (pedido del usuario); solo suena el error.
function playCorrect() {}

function playWrong() {
  if (!_soundOn) return;
  try { softTone(220, 0, 0.25, 0.05); } catch (e) {}
}

function SoundToggle({ className, withLabel }) {
  const [on, setOn] = useState(isSoundOn());
  const toggle = () => { setSoundOn(!on); setOn(!on); if (!on) setTimeout(playWrong, 0); };
  return html('button', { className, onClick: toggle, title: on ? 'Silenciar sonidos' : 'Activar sonidos' },
    (on ? '🔔' : '🔕') + (withLabel ? (on ? ' Sonidos activados' : ' Sonidos apagados') : ''));
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function downloadResumen(vocab, progress, lessons, playerName) {
  const safeName = escapeHtml(playerName);
  const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const pp = progress.prueba || {};

  const scoreColor = (p) => p >= 80 ? '#58CC02' : p >= 50 ? '#FFC800' : '#C1432B';
  const star = (p) => p >= 80 ? '⭐' : p > 0 ? '🔸' : '—';

  // Helper: render a table of missed words (hanzi / pinyin / español)
  const wordRows = (arr) => arr.map(w =>
    `<tr>
      <td style="font-family:'Noto Serif SC',serif;font-size:20px;padding:10px 12px;border-bottom:1px solid #E5E5E5">${w.hanzi}</td>
      <td style="color:#C1432B;font-weight:700;padding:10px 12px;border-bottom:1px solid #E5E5E5">${w.pinyin}</td>
      <td style="color:#777777;padding:10px 12px;border-bottom:1px solid #E5E5E5">${w.es}</td>
    </tr>`
  ).join('');

  // ── Lecciones regulares (1-8): tabla de puntajes ─────────────────────────
  const regularLessons = lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros');
  const specialLessons = lessons.filter(id => id === 'mod-paises' || id === 'mod-numeros');

  const lessonRows = regularLessons.map(id => {
    const lp = progress.lessons[id] || {};
    const theme = LESSON_THEMES[id] || { name: 'Lección ' + id };
    const m = lp.match || 0, c = lp.cards || 0, q = lp.quiz || 0;
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E5E5"><strong>Lección ${id}</strong><br><span style="font-size:12px;color:#777777">${theme.name}</span></td>
      <td style="color:${scoreColor(m)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(m)} ${m}%</td>
      <td style="color:${scoreColor(c)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(c)} ${c}%</td>
      <td style="color:${scoreColor(q)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(q)} ${q}%</td>
    </tr>`;
  }).join('');

  // ── Módulos especiales (países y números) ─────────────────────────────────
  const specialRows = specialLessons.map(id => {
    const lp = progress.lessons[id] || {};
    const theme = LESSON_THEMES[id] || { name: id === 'mod-paises' ? 'Países del mundo' : 'Los números' };
    const m = lp.match || 0, c = lp.cards || 0, q = lp.quiz || 0;
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E5E5"><strong>${theme.name}</strong></td>
      <td style="color:${scoreColor(m)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(m)} ${m}%</td>
      <td style="color:${scoreColor(c)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(c)} ${c}%</td>
      <td style="color:${scoreColor(q)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(q)} ${q}%</td>
    </tr>`;
  }).join('');

  // ── Para repasar: errores reales por módulo ───────────────────────────────
  let repasarHTML = '';

  // Lecciones regulares
  regularLessons.forEach(id => {
    const lp = progress.lessons[id] || {};
    const theme = LESSON_THEMES[id] || { name: 'Lección ' + id };
    ['match', 'cards', 'quiz'].forEach(mode => {
      const modeLabel = { match: 'Emparejar', cards: 'Tarjetas', quiz: 'Quiz' }[mode];
      const missed = lp[mode + '_missed'] || [];
      if (missed.length === 0) return;
      const unique = missed.filter((w, i, arr) => arr.findIndex(x => x.hanzi === w.hanzi) === i);
      repasarHTML += `<h3 style="margin:24px 0 6px;color:#3C3C3C;font-size:15px">
        Lección ${id} · ${theme.name} — <em>${modeLabel}</em>
        <span style="font-size:12px;color:#C1432B;font-weight:700">(${unique.length} ${unique.length === 1 ? 'error' : 'errores'})</span>
      </h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">${wordRows(unique)}</table>`;
    });
  });

  // Módulos especiales
  specialLessons.forEach(id => {
    const lp = progress.lessons[id] || {};
    const theme = LESSON_THEMES[id] || { name: id === 'mod-paises' ? 'Países del mundo' : 'Los números' };
    ['match', 'cards', 'quiz'].forEach(mode => {
      const modeLabel = { match: 'Emparejar', cards: 'Tarjetas', quiz: 'Quiz' }[mode];
      const missed = lp[mode + '_missed'] || [];
      if (missed.length === 0) return;
      const unique = missed.filter((w, i, arr) => arr.findIndex(x => x.hanzi === w.hanzi) === i);
      repasarHTML += `<h3 style="margin:24px 0 6px;color:#3C3C3C;font-size:15px">
        ${theme.name} — <em>${modeLabel}</em>
        <span style="font-size:12px;color:#C1432B;font-weight:700">(${unique.length} ${unique.length === 1 ? 'error' : 'errores'})</span>
      </h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">${wordRows(unique)}</table>`;
    });
  });

  // Prueba games
  const pruebaLabels = { clas: 'Clasificadores', modal: 'Verbos modales', tiempo: 'Expresiones de tiempo', dialogo: 'Completa el diálogo', orden: 'Ordena la oración' };
  ['clas', 'dialogo', 'orden'].forEach(game => {
    const missed = pp[game + '_missed'] || [];
    if (missed.length === 0) return;
    const unique = missed.filter((w, i, arr) => arr.findIndex(x => x.hanzi === w.hanzi) === i);
    repasarHTML += `<h3 style="margin:24px 0 6px;color:#3C3C3C;font-size:15px">
      ${pruebaLabels[game]}
      <span style="font-size:12px;color:#C1432B;font-weight:700">(${unique.length} ${unique.length === 1 ? 'error' : 'errores'})</span>
    </h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px">${wordRows(unique)}</table>`;
  });

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <!-- © 2026 大卫 · dawei.com.ar -->
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700&family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
  <title>说中文 ShuoZhongwen · Resumen${safeName ? ' · ' + safeName : ''}</title>
  <style>
    body{font-family:'Nunito',sans-serif;background:#FFFFFF;color:#3C3C3C;max-width:700px;margin:40px auto;padding:0 24px}
    h1{color:#C1432B;margin-bottom:4px}
    h2{color:#3C3C3C;border-bottom:2px solid #E5E5E5;padding-bottom:8px;margin-top:32px}
    table{width:100%;border-collapse:collapse}
    th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#777777;padding:8px 12px;border-bottom:2px solid #E5E5E5;text-align:left}
    @media print{body{background:#fff}}
  </style></head><body>
  <h1>说中文 ShuoZhongwen · Resumen de repaso</h1>
  ${safeName ? `<p style="margin-top:0;font-size:18px">👋 <strong>${safeName}</strong></p>` : ''}
  <p style="color:#777777;margin-top:0">New Practical Chinese Reader 1 &nbsp;|&nbsp; ${date}</p>

  <h2>📚 Lecciones</h2>
  <table><thead><tr>
    <th>Lección</th><th>Emparejar</th><th>Tarjetas</th><th>Quiz</th>
  </tr></thead><tbody>${lessonRows}</tbody></table>

  ${specialRows ? `<h2>🌍 Módulos especiales</h2>
  <table><thead><tr>
    <th>Módulo</th><th>Emparejar</th><th>Tarjetas</th><th>Quiz</th>
  </tr></thead><tbody>${specialRows}</tbody></table>` : ''}

  <h2>🧠 ¿Cuánto aprendiste?</h2>
  <table><tbody>
    <tr><td style="padding:10px 12px;border-bottom:1px solid #E5E5E5">Clasificadores</td><td style="color:${scoreColor(pp.clas||0)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(pp.clas||0)} ${pp.clas||0}%</td></tr>
    <tr><td style="padding:10px 12px;border-bottom:1px solid #E5E5E5">Completa el diálogo</td><td style="color:${scoreColor(pp.dialogo||0)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(pp.dialogo||0)} ${pp.dialogo||0}%</td></tr>
    <tr><td style="padding:10px 12px;border-bottom:1px solid #E5E5E5">Ordena la oración</td><td style="color:${scoreColor(pp.orden||0)};font-weight:800;padding:10px 12px;border-bottom:1px solid #E5E5E5">${star(pp.orden||0)} ${pp.orden||0}%</td></tr>
  </tbody></table>

  ${repasarHTML
    ? '<h2>📝 Errores para repasar</h2>' + repasarHTML
    : '<h2>✅ ¡Sin errores pendientes!</h2><p>No cometiste errores en ningún módulo. ¡Excelente trabajo!</p>'
  }
  <p style="margin-top:48px;font-size:11px;color:#aaa;text-align:center">© 2026 大卫 · dawei.com.ar</p>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileSlug = playerName ? '-' + playerName.toLowerCase().replace(/[^a-z0-9]/gi, '_') : '';
  a.download = 'hanzi-resumen' + fileSlug + '-' + new Date().toISOString().slice(0,10) + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----------------- Prueba: Audio -----------------
let _zhVoice = null;
function getZhVoice() {
  if (_zhVoice) return _zhVoice;
  const voices = window.speechSynthesis.getVoices();
  _zhVoice = voices.find(v => v.lang === 'zh-CN') ||
             voices.find(v => v.lang.startsWith('zh')) ||
             null;
  return _zhVoice;
}
window.speechSynthesis.onvoiceschanged = () => { _zhVoice = null; };

let _npcrAudio = null;
// Regla de la app: solo audios grabados del material (libro / HSK). Nunca voz sintética.
const hasRealAudio = (text) => { const k = text && String(text).replace(MEDIA_PUNCT_RE, ''); return !!(k && (NPCR_MEDIA.audio[k] || EXTRA_AUDIO[k])); };
const EXTRA_AUDIO = {}; // audios de módulos aparte (HSK 1), se llenan con los datos de Supabase
let _speakToken = 0;
function speak(text, onEnd) {
  const token = ++_speakToken;
  const ended = () => { if (onEnd && token === _speakToken) onEnd(); };
  window.speechSynthesis.cancel();
  if (_npcrAudio) { _npcrAudio.pause(); _npcrAudio = null; }
  const key = text && text.replace(MEDIA_PUNCT_RE, '');
  const file = key && (NPCR_MEDIA.audio[key] || EXTRA_AUDIO[key]);
  if (file) {
    _npcrAudio = new Audio(file);
    _npcrAudio.onended = ended;
    _npcrAudio.play().catch(() => { if (onEnd) setTimeout(ended, 300); });
    return;
  }
  // Sin grabación del libro no se reproduce nada (nunca voz sintética)
  if (onEnd) setTimeout(ended, 0);
}

function buildAudioRound(allWords) {
  const picked = shuffle(allWords.filter(w => hasRealAudio(w.hanzi))).slice(0, 6);
  const soundCol = shuffle(picked.map((w, i) => ({ ...w, sid: 's' + i })));
  const hanziCol = shuffle(picked.map((w, i) => ({ ...w, hid: 'h' + i })));
  return { picked, soundCol, hanziCol };
}

function AudioGame({ allWords, onBack, onFinish, playerName }) {
  const [round, setRound] = useState(() => buildAudioRound(allWords));
  const [selectedSound, setSelectedSound] = useState(null);
  const [selectedHanzi, setSelectedHanzi] = useState(null);
  const [matched, setMatched] = useState(new Set());
  const [wrong, setWrong] = useState([]);
  const [errors, setErrors] = useState(0);
  const [missed, setMissed] = useState([]);
  const [playing, setPlaying] = useState(null);
  const [done, setDone] = useState(false);

  const { soundCol, hanziCol, picked } = round;

  const playSound = (item) => {
    setPlaying(item.sid);
    speak(item.hanzi);
    setTimeout(() => setPlaying(null), 1200);
    if (!matched.has(item.hanzi)) setSelectedSound(item);
  };

  const pickHanzi = (item) => {
    if (matched.has(item.hanzi) || !selectedSound) return;
    setSelectedHanzi(item);

    if (selectedSound.hanzi === item.hanzi) {
      // Correcto
      const newMatched = new Set(matched);
      newMatched.add(item.hanzi);
      setMatched(newMatched);
      setSelectedSound(null);
      setSelectedHanzi(null);

      if (newMatched.size === picked.length) {
        const pct = Math.round((picked.length / (picked.length + errors)) * 100);
        if (onFinish) onFinish(pct, missed);
        setDone(true);
      }
    } else {
      // Incorrecto
      const newErrors = errors + 1;
      setErrors(newErrors);
      if (!missed.find(m => m.hanzi === selectedSound.hanzi)) {
        setMissed(prev => [...prev, { hanzi: selectedSound.hanzi, pinyin: selectedSound.pinyin, es: selectedSound.es }]);
      }
      setWrong([selectedSound.sid, item.hid]);
      setTimeout(() => {
        setWrong([]);
        setSelectedSound(null);
        setSelectedHanzi(null);
      }, 600);
    }
  };

  const retry = () => {
    setRound(buildAudioRound(allWords));
    setSelectedSound(null);
    setSelectedHanzi(null);
    setMatched(new Set());
    setWrong([]);
    setErrors(0);
    setMissed([]);
    setPlaying(null);
    setDone(false);
  };

  if (done) return html(PruebaResult, {
    percent: Math.round((picked.length / (picked.length + errors)) * 100),
    total: picked.length, correct: picked.length, missed,
    onRetry: retry, onBack, playerName,
  });

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px', paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Reconocer por audio'),
        html('div', { className: 'flash-counter' }, matched.size + '/' + picked.length),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' }, html('i', null, '✕'), 'Errores: ' + errors),
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), 'Aciertos: ' + matched.size),
      ),
      html('p', { style: { textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700, margin: '4px 0 12px' } },
        selectedSound
          ? '👆 Ahora tocá el hanzi que corresponde'
          : '👆 Tocá un 🔊 para escuchar la palabra'
      ),
      html('div', { className: 'audio-game-cols' },
        // Columna izquierda: botones de audio
        html('div', { className: 'audio-col' },
          soundCol.map(item => {
            const isMatched = matched.has(item.hanzi);
            const isPlaying = playing === item.sid;
            const isSelected = selectedSound && selectedSound.sid === item.sid;
            const isWrong = wrong.includes(item.sid);
            let cls = 'audio-sound-btn';
            if (isMatched) cls += ' matched';
            else if (isWrong) cls += ' wrong';
            else if (isPlaying) cls += ' playing';
            else if (isSelected) cls += ' selected';
            return html('button', { key: item.sid, className: cls, onClick: () => !isMatched && playSound(item) },
              html('span', null, isMatched ? '✓' : '🔊'),
              html('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' } }, isMatched ? item.hanzi : '#' + (soundCol.indexOf(item) + 1)),
            );
          })
        ),
        // Columna derecha: hanzi
        html('div', { className: 'audio-col' },
          hanziCol.map(item => {
            const isMatched = matched.has(item.hanzi);
            const isSelected = selectedHanzi && selectedHanzi.hid === item.hid;
            const isWrong = wrong.includes(item.hid);
            let cls = 'audio-hanzi-btn';
            if (isMatched) cls += ' matched';
            else if (isWrong) cls += ' wrong';
            else if (isSelected) cls += ' selected';
            return html('button', { key: item.hid, className: cls, onClick: () => pickHanzi(item) },
              item.hanzi,
              isMatched && html('span', { className: 'audio-matched-info' },
                html(TonedPinyin, { text: item.pinyin, style: { fontSize: 12, fontWeight: 800 } }),
                html('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)' } }, item.es),
              ),
            );
          })
        ),
      ),
    ),
  );
}

// ----------------- AuthGate: solo nombre → Supabase anonymous auth -----------------
// El alumno ingresa solo su nombre. Se crea una sesión anónima real en Supabase
// (auth.uid() verificable, RLS funciona igual). El nombre queda en `profiles`.
// Requiere "Enable anonymous sign-ins" activado en Supabase Auth Settings.
// Nombre obligatorio: al menos 2 letras y nada genérico como "alumno"
const GENERIC_NAMES = /^(alumn[oa]s?|estudiante|usuario|user|test|prueba|nombre|x+|a+)$/i;
function validStudentName(n) {
  const t = String(n || '').trim();
  return t.replace(/[^\p{L}]/gu, '').length >= 2 && !GENERIC_NAMES.test(t);
}

function AuthGate({ onAuthenticated, onBeforeAuth }) {
  const [name, setName] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const code = normalizeCode(studentCode);
    if (!code && !validStudentName(name)) { setErr('Ingresá tu nombre real (al menos 2 letras).'); return; }
    setLoading(true);
    setErr('');

    // Con código: verificarlo antes de crear ninguna cuenta
    let codeInfo = null;
    if (code) {
      const { data: st, error: stErr } = await db.rpc('npcr_code_status', { p_code: code });
      codeInfo = st && st[0];
      if (stErr || !codeInfo || !codeInfo.found) {
        setErr(stErr ? 'No se pudo verificar el código. Revisá tu conexión.' : 'Ese código no existe. Revisalo con tu lǎoshī.');
        setLoading(false);
        return;
      }
      // Código ya activado → entrar a esa cuenta (otro dispositivo)
      if (codeInfo.claimed) {
        if (!codeInfo.login_email) {
          setErr('Ese código ya fue usado en otro dispositivo y no se pudo vincular. Pedile a tu lǎoshī uno nuevo.');
          setLoading(false);
          return;
        }
        const { data, error } = await db.auth.signInWithPassword({ email: codeInfo.login_email, password: studentPassword(codeInfo.login_email) });
        setLoading(false);
        if (error || !data.session) { setErr('No se pudo entrar con ese código. Pedile ayuda a tu lǎoshī.'); return; }
        onAuthenticated(data.session, '', null);
        return;
      }
    }

    const displayName = name.trim() || (codeInfo && codeInfo.display_name) || '';
    if (onBeforeAuth) onBeforeAuth(displayName, code || null);
    // Intento 1: anonymous auth (requiere estar habilitado en Supabase)
    let sessionData = null;
    const anonRes = await db.auth.signInAnonymously();
    if (!anonRes.error && anonRes.data?.session) {
      sessionData = anonRes.data.session;
    } else {
      // Fallback: credenciales derivadas del dispositivo (estables, sin contraseña visible)
      let did = localStorage.getItem('hanzi-device-id');
      if (!did) {
        did = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('hanzi-device-id', did);
      }
      const email = did + '@hanziapp.internal';
      const pwd   = 'hz' + did.replace(/-/g, '').slice(0, 20);
      let res = await db.auth.signInWithPassword({ email, password: pwd });
      if (res.error) {
        res = await db.auth.signUp({ email, password: pwd, options: { data: { name: displayName } } });
      }
      if (res.error || !res.data?.session) {
        setErr('No se pudo conectar. Verificá tu conexión.');
        setLoading(false);
        return;
      }
      sessionData = res.data.session;
    }
    setLoading(false);
    onAuthenticated(sessionData, displayName, code || null);
  };

  const inputStyle = { marginTop: 8, letterSpacing: 1.5, textTransform: 'uppercase' };
  return html('div', { className: 'name-modal-overlay' },
    html('div', { className: 'name-modal' },
      html('div', { className: 'name-modal-hanzi hanzi-font' }, '你好！'),
      html('h2', { className: 'name-modal-title' }, '¿Cómo te llamás?'),
      html('p', { className: 'name-modal-sub' }, 'Ingresá tu nombre para empezar.'),
      html('form', { onSubmit: handleSubmit },
        html('input', {
          className: 'name-modal-input', type: 'text', placeholder: 'Tu nombre...',
          value: name, autoFocus: true, maxLength: 30,
          onChange: (e) => setName(e.target.value),
          disabled: loading,
        }),
        html('input', {
          className: 'name-modal-input', type: 'text', placeholder: 'Código de alumno (opcional)',
          value: studentCode, maxLength: 14, autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false,
          onChange: (e) => setStudentCode(e.target.value.toUpperCase()),
          disabled: loading,
          style: studentCode ? inputStyle : { marginTop: 8 },
        }),
        html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 6, textAlign: 'left' } },
          '🎓 Si tu lǎoshī te dio un código, ponelo para guardar tu progreso y entrar desde cualquier dispositivo.'),
        err && html('div', { style: { color: 'var(--lacquer-dark)', fontSize: 13, fontWeight: 700, marginTop: 6 } }, err),
        html('button', {
          className: 'primary-btn', type: 'submit',
          disabled: (!name.trim() && !normalizeCode(studentCode)) || loading,
          style: { width: '100%', marginTop: 10 },
        }, loading ? 'Un momento...' : '¡Comenzar! →'),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reportes: helpers y componentes
// ─────────────────────────────────────────────────────────────────────────────

function BarChart({ items, colorFn }) {
  const max = Math.max(...items.map(d => d.value), 1);
  return html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    items.map((d, i) => html('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10 } },
      html('div', { style: { width: 88, fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.label),
      html('div', { style: { flex: 1, height: 18, background: 'var(--paper-deep)', borderRadius: 4, overflow: 'hidden' } },
        html('div', { style: {
          height: '100%',
          width: Math.round(d.value / max * 100) + '%',
          background: colorFn ? colorFn(d.value) : (d.value >= 80 ? 'var(--jade)' : d.value >= 50 ? 'var(--gold)' : 'var(--lacquer)'),
          borderRadius: 4, transition: 'width 0.6s ease',
        } })
      ),
      html('div', { style: { width: 36, fontSize: 12, fontWeight: 800, textAlign: 'right', flexShrink: 0, color: 'var(--ink)' } }, d.suffix !== undefined ? d.suffix : d.value + '%'),
    ))
  );
}

// ═══════════════════════════════════════════════════════════
// ANÁLISIS DE CLASE (laoshi/admin): resumen, ranking, mapa de calor,
// palabras difíciles, tareas y ficha por alumno.
// Datos: npcr_class_report / npcr_class_hard_words (npcr_fase2.sql).
// ═══════════════════════════════════════════════════════════

// Color del dominio: gris (sin datos) → rojo → ámbar → verde
function masteryColor(v) {
  if (v == null || v <= 0) return { bg: '#F1EEE8', fg: '#A8A29E' };
  if (v < 40) return { bg: '#FDE2DC', fg: '#9A2E1C' };
  if (v < 70) return { bg: '#FFF1C2', fg: '#8A5A00' };
  return { bg: '#DDF5CC', fg: '#2F6B12' };
}

function MasteryPill({ value, small }) {
  const c = masteryColor(value);
  return html('span', { style: { display: 'inline-block', minWidth: small ? 34 : 44, textAlign: 'center', padding: small ? '2px 4px' : '3px 8px', borderRadius: 8, fontWeight: 800, fontSize: small ? 11 : 13, background: c.bg, color: c.fg } },
    value == null ? '—' : value + '%');
}

function KpiCard({ icon, value, label, sub, tone }) {
  return html('div', { className: 'kpi-card' + (tone ? ' ' + tone : '') },
    html('div', { className: 'kpi-icon' }, icon),
    html('div', { className: 'kpi-value' }, value),
    html('div', { className: 'kpi-label' }, label),
    sub && html('div', { className: 'kpi-sub' }, sub),
  );
}

function daysSince(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null; }

function StudentFile({ row, vocab, lessons, tasks, onBack }) {
  const [weak, setWeak] = useState(null);
  const [acts, setActs] = useState([]);
  const [daily, setDaily] = useState([]);
  useEffect(() => {
    if (!row.user_id) { setWeak([]); return; }
    db.from('npcr_card_state').select('card_key,box,lapses,reviews').eq('student_id', row.user_id).then(({ data }) => {
      const list = (data || []).filter(c => c.card_key.startsWith('w|') && (c.lapses > 0 || (c.box === 0 && c.reviews > 0)))
        .sort((a, b) => b.lapses - a.lapses).slice(0, 15)
        .map(c => { const [, l, h] = c.card_key.split('|'); const w = (vocab[l] || []).find(x => x.hanzi === h) || {}; return { lesson: l, hanzi: h, pinyin: w.pinyin, es: w.es, lapses: c.lapses, box: c.box }; });
      setWeak(list);
    });
    db.from('npcr_activity').select('kind,lesson,mode,percent,total,created_at').eq('student_id', row.user_id).order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => setActs(data || []));
    db.from('npcr_daily_log').select('day,cards,first_try_ok').eq('student_id', row.user_id).order('day', { ascending: false }).limit(120)
      .then(({ data }) => setDaily(data || []));
  }, [row.user_id]);

  const last14 = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * DAY_MS); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const doneDays = new Set(daily.map(d => d.day));
  const modeName = { match: 'Emparejar', cards: 'Tarjetas', quiz: 'Opción múltiple', frases: 'Frases clave', frase: 'Completá la frase', orden: 'Ordená la oración', audio: 'Audio', escritura: 'Escritura',
    tonos: 'Tonos', dictado: 'Dictado', semana: 'Palabras de la semana', 'refuerzo-clase': 'Refuerzo de clase', dificiles: 'Sus palabras difíciles' };
  const modeIcon = { match: '🔗', cards: '🀄', quiz: '✅', frases: '💬', frase: '🧩', orden: '🔀', audio: '🔊', escritura: '✍️', tonos: '🎵', dictado: '✍️', semana: '⭐', 'refuerzo-clase': '🧩', dificiles: '💪' };
  // Rendimiento por tipo de ejercicio (todo el historial)
  const byMode = {};
  acts.forEach(a => {
    const k = a.kind === 'daily' ? 'daily' : a.mode;
    if (!k) return;
    const m = byMode[k] || (byMode[k] = { n: 0, sum: 0, best: 0 });
    m.n++; m.sum += a.percent; m.best = Math.max(m.best, a.percent);
  });
  const modeRows = Object.entries(byMode).map(([k, m]) => ({ k, n: m.n, avg: Math.round(m.sum / m.n), best: m.best })).sort((a, b) => b.n - a.n);
  const firstDay = daily.length ? daily[daily.length - 1].day : null;
  const myTasks = (tasks || []).filter(t => (t.lesson_ids || []).length);

  return html('div', null,
    html('button', { className: 'secondary-btn', onClick: onBack, style: { margin: '0 0 12px', width: 'auto', padding: '8px 14px' } }, '← Volver a la clase'),
    html('div', { className: 'report-card' },
      html('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        html('div', { className: 'avatar-lg' }, (row.display_name || '?').charAt(0).toUpperCase()),
        html('div', { style: { flex: 1 } },
          html('div', { style: { fontWeight: 800, fontSize: 18 } }, row.display_name),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 } },
            row.user_id ? 'Código ' + row.code + ' · última actividad ' + timeAgo(row.last_activity || row.last_seen) : '⏳ Todavía no activó su código (' + row.code + ')'),
          html('button', { className: 'hint-link', style: { margin: '4px 0 0', display: 'inline-block', padding: 0 },
            onClick: () => copyText(inviteMessage(row.display_name.split(' ')[0], row.code), () => window.alert('📤 Invitación copiada: pegala en WhatsApp o mail.')) }, '📤 Copiar invitación'),
        ),
        html(MasteryPill, { value: row.user_id ? row.mastery : null }),
      ),
      row.user_id && html('div', { className: 'kpi-grid', style: { marginTop: 14 } },
        html(KpiCard, { icon: '🧠', value: row.words_learned, label: 'aprendidas', sub: 'de ' + row.words_seen + ' vistas' }),
        html(KpiCard, { icon: '🎯', value: row.acc_7d == null ? '—' : row.acc_7d + '%', label: 'precisión 7 días', tone: row.acc_7d != null && row.acc_7d < 60 ? 'warn' : '' }),
        html(KpiCard, { icon: '📅', value: row.daily_7d + '/7', label: 'entrenamientos' }),
        html(KpiCard, { icon: '🔥', value: row.streak_days, label: 'racha' }),
      ),
    ),
    row.user_id && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '📈 Historial'),
      html('div', { className: 'kpi-grid', style: { marginBottom: 0 } },
        html(KpiCard, { icon: '🕒', value: acts.length, label: 'sesiones en total' }),
        html(KpiCard, { icon: '🎯', value: daily.length, label: 'días de entrenamiento', sub: firstDay ? 'desde el ' + new Date(firstDay + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '' }),
        html(KpiCard, { icon: '🧩', value: row.words_struggling, label: 'palabras con dificultad', tone: row.words_struggling >= 8 ? 'warn' : '' }),
        html(KpiCard, { icon: '👁', value: row.words_seen, label: 'palabras vistas' }),
      ),
    ),
    row.user_id && modeRows.length > 0 && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🏋️ Rendimiento por tipo de ejercicio'),
      html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, modeRows.map(m => html('div', { key: m.k, className: 'lesson-bar-row' },
        html('span', { style: { width: 170, fontSize: 13, fontWeight: 800, flexShrink: 0 } }, m.k === 'daily' ? '🎯 Entrenamiento diario' : (modeIcon[m.k] || '•') + ' ' + (modeName[m.k] || m.k)),
        html('div', { className: 'lesson-bar-track' }, html('div', { className: 'lesson-bar-fill', style: { width: m.avg + '%', background: masteryColor(m.avg).fg } })),
        html('span', { style: { fontSize: 12, fontWeight: 800, minWidth: 110, textAlign: 'right', color: 'var(--ink-mid)' } }, m.avg + '% · ' + m.n + (m.n === 1 ? ' vez' : ' veces')),
      ))),
    ),
    row.user_id && myTasks.length > 0 && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '📋 Sus tareas'),
      myTasks.map(t => {
        const doneSet = new Set((t.lesson_ids || []).filter(tg => { const [l, m] = tg.split(':'); return acts.some(a => a.lesson === l && a.mode === m && a.percent >= 70 && new Date(a.created_at) >= new Date(t.created_at)); }));
        const all = doneSet.size === t.lesson_ids.length;
        return html('div', { key: t.id, style: { padding: '6px 0', borderBottom: '1px solid var(--paper-deep)' } },
          html('div', { style: { fontWeight: 800, fontSize: 13 } }, (all ? '✅ ' : '○ ') + t.title,
            html('span', { className: 'task-count' + (all ? ' done' : ''), style: { marginLeft: 8 } }, doneSet.size + '/' + t.lesson_ids.length)),
          html('div', { className: 'task-targets' }, t.lesson_ids.map(tg => { const [l, m] = tg.split(':'); return html('span', { key: tg, className: 'task-target' + (doneSet.has(tg) ? ' ok' : '') }, (doneSet.has(tg) ? '✓ ' : '○ ') + 'L' + l + ' · ' + (modeName[m] || m)); })),
        );
      }),
    ),
    row.user_id && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '📅 Entrenamiento diario · últimos 14 días'),
      html('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
        last14.map(d => html('div', { key: d, title: d, style: { width: 18, height: 18, borderRadius: 5, background: doneDays.has(d) ? 'var(--gold-dark)' : 'var(--paper-deep)' } }))),
    ),
    row.user_id && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '📚 Dominio por lección'),
      html('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 } },
        lessons.map(l => html('div', { key: l, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, background: 'var(--paper)', borderRadius: 10, padding: '6px 8px' } },
          html('span', { style: { fontWeight: 800, fontSize: 12 } }, 'L' + l),
          html(MasteryPill, { value: (row.lessons || {})[l], small: true }),
        ))),
    ),
    row.user_id && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '⚠️ Palabras que más le cuestan'),
      weak === null ? html('p', { className: 'admin-note' }, 'Cargando...')
      : weak.length === 0 ? html('p', { className: 'admin-note' }, 'No tiene palabras con errores todavía. 👏')
      : html('div', { className: 'word-chips' }, weak.map(w => html('div', { key: w.lesson + w.hanzi, className: 'word-chip-big', title: 'Lección ' + w.lesson, onClick: () => speak(w.hanzi) },
          html('div', { className: 'hanzi-font', style: { fontSize: 22, fontWeight: 700 } }, w.hanzi),
          html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--lacquer-dark)' } }, w.pinyin || ''),
          html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 } }, (w.es || '').slice(0, 22)),
          html('div', { style: { fontSize: 10, fontWeight: 800, color: 'var(--lacquer)', marginTop: 2 } }, '✕ ' + w.lapses),
        ))),
    ),
    row.user_id && html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🕒 Últimas sesiones'),
      acts.length === 0 ? html('p', { className: 'admin-note' }, 'Sin sesiones registradas todavía.')
      : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, acts.slice(0, 12).map((a, i) => html('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
          html('span', { style: { flex: 1, fontWeight: 700 } },
            a.kind === 'daily' ? '🎯 Entrenamiento diario' : (a.lesson ? 'L' + a.lesson + ' · ' : '') + (modeName[a.mode] || a.mode)),
          html(MasteryPill, { value: a.percent, small: true }),
          html('span', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700, minWidth: 70, textAlign: 'right' } }, timeAgo(a.created_at)),
        )))),
  );
}

function ClassAnalytics({ onBack, vocab, lessons, initialClassId }) {
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState(initialClassId || null);
  const [rows, setRows] = useState(null);
  const [hard, setHard] = useState([]);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('alumnos');
  const [flashMsg, setFlashMsg] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sort, setSort] = useState({ key: 'mastery', dir: -1 });
  const [student, setStudent] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState({ title: '', description: '', due_date: '', lesson: '', modes: [] });
  const [taskProgress, setTaskProgress] = useState({});
  const [settings, setSettings] = useState({ max_lesson: '', weekly_title: '', weekly_words: [] });
  const [pickLesson, setPickLesson] = useState('1');
  const [savedMsg, setSavedMsg] = useState(null);

  useEffect(() => {
    db.from('classes').select('id,name').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) { setErr(error.message); setClasses([]); return; }
      setClasses(data || []);
      if (!classId && data && data.length) setClassId(data[0].id);
    });
  }, []);

  const loadTasks = () => Promise.all([
    db.from('assignments').select('id,title,description,due_date,created_at,lesson_ids').eq('class_id', classId).order('due_date', { ascending: true }),
    db.rpc('npcr_assignment_progress', { p_class: classId }),
  ]).then(([t, pr]) => {
    setTasks(t.data || []);
    const m = {}; (pr.data || []).forEach(r => { m[r.assignment_id] = r; }); setTaskProgress(m);
  });
  const loadSettings = () => db.from('npcr_class_settings').select('max_lesson,weekly_title,weekly_words,hsk1_enabled,hsk1_exam_date').eq('class_id', classId).maybeSingle()
    .then(({ data }) => setSettings({ max_lesson: data && data.max_lesson ? String(data.max_lesson) : '', weekly_title: (data && data.weekly_title) || '', weekly_words: (data && data.weekly_words) || [],
      hsk1_enabled: !!(data && data.hsk1_enabled), hsk1_exam_date: (data && data.hsk1_exam_date) || '' }));
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await db.from('npcr_class_settings').upsert({ class_id: classId, max_lesson: next.max_lesson ? Number(next.max_lesson) : null,
      weekly_title: next.weekly_title || null, weekly_words: next.weekly_words,
      hsk1_enabled: !!next.hsk1_enabled, hsk1_exam_date: next.hsk1_exam_date || null, updated_at: new Date().toISOString() });
    setSavedMsg(error ? '❌ ' + error.message : '✅ Guardado');
    setTimeout(() => setSavedMsg(null), 2000);
  };

  useEffect(() => {
    if (!classId) return;
    setRows(null); setStudent(null); setErr(null);
    Promise.all([db.rpc('npcr_class_report', { p_class: classId }), db.rpc('npcr_class_hard_words', { p_class: classId })])
      .then(([r, h]) => {
        if (r.error) { setErr(r.error.message); setRows([]); return; }
        setRows(r.data || []); setHard(h.data || []);
      });
    loadTasks();
    loadSettings();
  }, [classId, reloadKey]);

  const createTask = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    const { data: { user } } = await db.auth.getUser();
    const targets = newTask.lesson ? newTask.modes.map(m => newTask.lesson + ':' + m) : [];
    const { error } = await db.from('assignments').insert({ class_id: classId, laoshi_id: user.id, title: newTask.title.trim(), description: newTask.description.trim() || null, due_date: newTask.due_date || null, lesson_ids: targets.length ? targets : null });
    if (error) { setErr(error.message); return; }
    setNewTask({ title: '', description: '', due_date: '', lesson: '', modes: [] });
    loadTasks();
  };
  const deleteTask = async (t) => {
    if (!window.confirm('¿Eliminar la tarea "' + t.title + '"?')) return;
    await db.from('assignments').delete().eq('id', t.id);
    loadTasks();
  };

  const cls = (classes || []).find(c => c.id === classId);
  const active = (rows || []).filter(r => r.user_id);
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  // Alertas
  const alerts = [];
  if (rows) {
    rows.filter(r => !r.user_id).forEach(r => alerts.push({ tone: 'info', text: '⏳ ' + r.display_name + ' todavía no activó su código (' + r.code + ').' }));
    active.forEach(r => {
      const d = daysSince(r.last_activity || r.last_seen);
      if (d === null || d >= 5) alerts.push({ tone: 'warn', text: '😴 ' + r.display_name + (d === null ? ' no registra práctica todavía.' : ' no practica hace ' + d + ' días.') });
      if (r.acc_7d != null && r.acc_7d < 60 && r.sessions_7d >= 2) alerts.push({ tone: 'warn', text: '📉 ' + r.display_name + ' tiene precisión baja esta semana (' + r.acc_7d + '%).' });
      if (r.words_struggling >= 8) alerts.push({ tone: 'warn', text: '🧩 ' + r.display_name + ' acumula ' + r.words_struggling + ' palabras con dificultad.' });
    });
    if (hard[0] && hard[0].students >= 2) alerts.push({ tone: 'info', text: '🎯 La palabra que más cuesta en la clase es ' + hard[0].hanzi + ' (' + (hard[0].es || '') + '): ' + hard[0].students + ' alumnos.' });
  }

  const sortedRows = rows ? [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    if (sort.key === 'display_name') return sort.dir * String(va).localeCompare(String(vb));
    const na = va == null ? -1 : (sort.key === 'last_activity' ? new Date(va).getTime() : va);
    const nb = vb == null ? -1 : (sort.key === 'last_activity' ? new Date(vb).getTime() : vb);
    return sort.dir * (na - nb);
  }) : [];
  const th = (key, label, title) => html('th', { title, onClick: () => setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 })), className: sort.key === key ? 'sorted' : '' },
    label + (sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''));

  const tabs = [['alumnos', '👥 Alumnos'], ['resumen', '📊 Resumen'], ['ranking', '🏆 Ranking'], ['mapa', '🗺️ Mapa'], ['palabras', '🧩 Palabras difíciles'], ['tareas', '📋 Tareas'],
    ...(settings && settings.hsk1_enabled ? [['hsk', '🎓 HSK 1']] : []), ['config', '⚙️ Configurar']];

  let body = null;
  if (err) body = html('div', { className: 'admin-status err' }, '❌ ' + err + (/function|does not exist/.test(err) ? ' — ¿Ejecutaste npcr_fase2.sql en Supabase?' : ''));
  else if (rows === null) body = html('p', { className: 'admin-note' }, 'Cargando análisis...');
  else if (student) body = html(StudentFile, { row: student, vocab, lessons, tasks, onBack: () => setStudent(null) });
  else if (tab === 'alumnos') {
    body = html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '👥 Alumnos de la clase'),
      html('p', { className: 'admin-note', style: { marginTop: 0 } },
        'Agregá a cada alumno con su nombre: la app le genera un código personal. Tocá el código para copiarlo, 📤 para copiar la invitación, 🔄 para darle un código nuevo y el nombre para ver su ficha.'),
      flashMsg && html('div', { className: 'admin-status ' + (flashMsg.type === 'ok' ? 'ok' : 'err'), style: { marginBottom: 10, cursor: 'pointer' }, onClick: () => setFlashMsg(null) }, flashMsg.msg),
      html(ClassStudents, {
        cls: { id: classId, name: cls ? cls.name : '' },
        flash: (type, msg) => setFlashMsg({ type, msg }),
        onChanged: () => setReloadKey(k => k + 1),
        onOpen: (r) => { const row = (rows || []).find(x => x.seat_id === r.id); if (row) setStudent(row); },
      }),
    );
  }
  else if (rows.length === 0 && tab !== 'tareas' && tab !== 'config') body = html('p', { className: 'admin-note' }, 'Esta clase todavía no tiene alumnos. Agregalos desde ⚙ Administrar → Mis clases.');
  else if (tab === 'resumen') {
    body = html('div', null,
      html('div', { className: 'kpi-grid' },
        html(KpiCard, { icon: '👥', value: active.length + '/' + rows.length, label: 'alumnos activos' }),
        html(KpiCard, { icon: '✅', value: active.filter(r => r.sessions_7d > 0).length, label: 'practicaron esta semana' }),
        html(KpiCard, { icon: '📅', value: (avg(active.map(r => r.daily_7d)) ?? 0) + '/7', label: 'entrenamientos promedio' }),
        html(KpiCard, { icon: '🎯', value: avg(active.filter(r => r.acc_7d != null).map(r => r.acc_7d)) == null ? '—' : avg(active.filter(r => r.acc_7d != null).map(r => r.acc_7d)) + '%', label: 'precisión 7 días' }),
        html(KpiCard, { icon: '🧠', value: (avg(active.map(r => r.mastery)) ?? 0) + '%', label: 'dominio promedio' }),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🔔 Alertas'),
        alerts.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todo en orden por ahora. 👏')
        : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, alerts.map((a, i) => html('div', { key: i, className: 'alert-row ' + a.tone }, a.text))),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '📚 Dominio promedio por lección'),
        html('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 } },
          lessons.map(l => {
            const vals = active.map(r => (r.lessons || {})[l]).filter(v => v != null);
            return html('div', { key: l, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, background: 'var(--paper)', borderRadius: 10, padding: '6px 8px' } },
              html('span', { style: { fontWeight: 800, fontSize: 12 } }, 'L' + l), html(MasteryPill, { value: avg(vals), small: true }));
          })),
      ),
    );
  } else if (tab === 'ranking') {
    body = html('div', { className: 'report-card', style: { padding: 0, overflowX: 'auto' } },
      html('table', { className: 'rank-table' },
        html('thead', null, html('tr', null,
          html('th', null, '#'), th('display_name', 'Alumno'), th('mastery', 'Dominio', 'Promedio de las lecciones: 60% tarjetas + 40% juegos'),
          th('words_learned', 'Aprendidas', 'Palabras en caja 3+ del repaso espaciado'), th('acc_7d', 'Precisión', 'Promedio de resultados de los últimos 7 días'),
          th('sessions_7d', 'Sesiones', 'Sesiones de práctica en 7 días'), th('daily_7d', 'Entren.', 'Entrenamientos diarios en 7 días'),
          th('streak_days', 'Racha'), th('words_struggling', 'Dificult.', 'Palabras con errores repetidos'), th('last_activity', 'Última vez'))),
        html('tbody', null, sortedRows.map((r, i) => html('tr', { key: r.seat_id, onClick: () => setStudent(r), className: r.user_id ? '' : 'pending' },
          html('td', { style: { fontWeight: 800, color: 'var(--ink-soft)' } }, r.user_id ? (i + 1) : '—'),
          html('td', { style: { fontWeight: 800, whiteSpace: 'nowrap' } }, r.display_name, !r.user_id && html('span', { style: { fontSize: 10, color: 'var(--ink-soft)', fontWeight: 700 } }, ' · sin activar')),
          html('td', null, html(MasteryPill, { value: r.user_id ? r.mastery : null, small: true })),
          html('td', null, r.user_id ? r.words_learned : '—'),
          html('td', null, r.acc_7d == null ? '—' : html(MasteryPill, { value: r.acc_7d, small: true })),
          html('td', null, r.user_id ? r.sessions_7d : '—'),
          html('td', null, r.user_id ? r.daily_7d + '/7' : '—'),
          html('td', null, r.user_id ? '🔥 ' + r.streak_days : '—'),
          html('td', { style: { color: r.words_struggling >= 8 ? 'var(--lacquer)' : 'inherit', fontWeight: 700 } }, r.user_id ? r.words_struggling : '—'),
          html('td', { style: { whiteSpace: 'nowrap', fontSize: 12 } }, r.user_id ? timeAgo(r.last_activity || r.last_seen) : '—'),
        )))),
      html('p', { className: 'admin-note', style: { padding: '8px 12px', margin: 0 } }, 'Tocá un encabezado para ordenar y un alumno para ver su ficha.'),
    );
  } else if (tab === 'mapa') {
    body = html('div', { className: 'report-card', style: { padding: 0, overflowX: 'auto' } },
      html('table', { className: 'heat-table' },
        html('thead', null, html('tr', null, html('th', null, 'Alumno'), lessons.map(l => html('th', { key: l }, 'L' + l)))),
        html('tbody', null, active.map(r => html('tr', { key: r.seat_id, onClick: () => setStudent(r) },
          html('td', { style: { fontWeight: 800, whiteSpace: 'nowrap', textAlign: 'left' } }, r.display_name),
          lessons.map(l => { const v = (r.lessons || {})[l]; const c = masteryColor(v); return html('td', { key: l, style: { background: c.bg, color: c.fg } }, v ? v : ''); }),
        )))),
      html('p', { className: 'admin-note', style: { padding: '8px 12px', margin: 0 } },
        'Dominio por lección (0–100). ', html('span', { style: { color: '#9A2E1C', fontWeight: 800 } }, 'Rojo < 40'), ' · ',
        html('span', { style: { color: '#8A5A00', fontWeight: 800 } }, 'ámbar < 70'), ' · ', html('span', { style: { color: '#2F6B12', fontWeight: 800 } }, 'verde ≥ 70'), '. Solo alumnos activos.'),
    );
  } else if (tab === 'palabras') {
    body = html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🧩 Lo que más le cuesta a la clase'),
      html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Palabras que los alumnos marcaron "No lo sabía" en el repaso. Buen material para reforzar en clase. Tocá una para escucharla.'),
      hard.length === 0 ? html('p', { className: 'admin-note' }, 'Todavía no hay datos suficientes.')
      : html('div', { className: 'word-chips' }, hard.map(w => html('div', { key: w.lesson + w.hanzi, className: 'word-chip-big', onClick: () => speak(w.hanzi), title: 'Lección ' + w.lesson },
          html('div', { className: 'hanzi-font', style: { fontSize: 24, fontWeight: 700 } }, w.hanzi),
          html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--lacquer-dark)' } }, w.pinyin || ''),
          html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 } }, (w.es || '').slice(0, 22)),
          html('div', { style: { fontSize: 10, fontWeight: 800, color: 'var(--lacquer)', marginTop: 3 } }, '👥 ' + w.students + ' · ✕ ' + w.lapses + ' · L' + w.lesson),
        ))),
    );
  } else if (tab === 'tareas') {
    body = html('div', null,
      html('form', { className: 'report-card', onSubmit: createTask },
        html('div', { className: 'report-h' }, '➕ Nueva tarea'),
        html('input', { value: newTask.title, onChange: e => setNewTask({ ...newTask, title: e.target.value }), placeholder: 'Título (ej: Repasar lección 9: Tarjetas y Frases clave)', maxLength: 120, style: { ...cmInput, width: '100%', marginBottom: 8 } }),
        html('input', { value: newTask.description, onChange: e => setNewTask({ ...newTask, description: e.target.value }), placeholder: 'Descripción (opcional)', maxLength: 300, style: { ...cmInput, width: '100%', marginBottom: 8 } }),
        html('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } },
          html('select', { value: newTask.lesson, onChange: e => setNewTask({ ...newTask, lesson: e.target.value, modes: e.target.value ? (newTask.modes.length ? newTask.modes : ['cards']) : [] }), style: { ...cmInput, flex: 'none' } },
            html('option', { value: '' }, 'Sin ejercicios (solo texto)'),
            lessons.map(l => html('option', { key: l, value: l }, 'Lección ' + l))),
          newTask.lesson && Object.entries(MODE_LABELS).map(([m, label]) => html('label', { key: m, className: 'mode-check' + (newTask.modes.includes(m) ? ' on' : '') },
            html('input', { type: 'checkbox', checked: newTask.modes.includes(m), onChange: () => setNewTask({ ...newTask, modes: newTask.modes.includes(m) ? newTask.modes.filter(x => x !== m) : [...newTask.modes, m] }) }),
            label)),
        ),
        newTask.lesson && html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Cada ejercicio se marca solo cuando el alumno lo hace con 70% o más después de asignar la tarea.'),
        html('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          html('label', { style: { fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' } }, 'Fecha límite'),
          html('input', { type: 'date', value: newTask.due_date, onChange: e => setNewTask({ ...newTask, due_date: e.target.value }), style: { ...cmInput, flex: 'none' } }),
          html('button', { className: 'primary-btn', type: 'submit', disabled: !newTask.title.trim(), style: { margin: '0 0 0 auto', width: 'auto', padding: '10px 16px' } }, 'Asignar'),
        ),
      ),
      tasks.length === 0 ? html('p', { className: 'admin-note' }, 'Esta clase no tiene tareas.')
      : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, tasks.map(t => html('div', { key: t.id, className: 'class-task', style: { display: 'flex', alignItems: 'center', gap: 10 } },
          html('div', { style: { flex: 1 } },
            html('div', { style: { fontWeight: 800 } }, '📋 ' + t.title),
            t.description && html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } }, t.description),
            t.due_date && html('div', { style: { fontSize: 12, fontWeight: 800, color: 'var(--lacquer-dark)', marginTop: 4 } }, '⏰ ' + new Date(t.due_date + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })),
            (t.lesson_ids || []).length > 0 && html('div', { className: 'task-targets' }, t.lesson_ids.map(tg => { const [l, m] = tg.split(':'); return html('span', { key: tg, className: 'task-target' }, 'L' + l + ' · ' + (MODE_LABELS[m] || m)); })),
            taskProgress[t.id] && (t.lesson_ids || []).length > 0 && html('div', { style: { fontSize: 12, fontWeight: 700, marginTop: 6 } },
              html('span', { className: 'task-count' + (taskProgress[t.id].done_count === taskProgress[t.id].total && taskProgress[t.id].total ? ' done' : '') }, taskProgress[t.id].done_count + '/' + taskProgress[t.id].total + ' completaron'),
              taskProgress[t.id].done_names.length > 0 && html('span', { style: { color: 'var(--jade-dark)', marginLeft: 8 } }, '✓ ' + taskProgress[t.id].done_names.join(', ')),
              taskProgress[t.id].pending_names.length > 0 && html('div', { style: { color: 'var(--ink-soft)', marginTop: 3 } }, '○ Pendientes: ' + taskProgress[t.id].pending_names.join(', ')),
            ),
          ),
          html('button', { title: 'Eliminar tarea', style: cmIconBtn, onClick: () => deleteTask(t) }, '🗑'),
        ))),
    );
  }

  if (!err && rows !== null && !student && tab === 'hsk') body = html(Hsk1ClassReport, { classId });

  if (!err && rows !== null && !student && tab === 'config') {
    const ww = settings.weekly_words || [];
    const has = (l, h) => ww.some(x => x.lesson === l && x.hanzi === h);
    const toggle = (l, h) => saveSettings({ weekly_words: has(l, h) ? ww.filter(x => !(x.lesson === l && x.hanzi === h)) : [...ww, { lesson: l, hanzi: h }] });
    body = html('div', null,
      savedMsg && html('div', { className: 'admin-status ' + (savedMsg.startsWith('✅') ? 'ok' : 'err'), style: { marginBottom: 10 } }, savedMsg),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🔒 Avance del grupo'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Los alumnos ven con candado las lecciones posteriores, y el entrenamiento diario, los tonos y el dictado usan solo las habilitadas.'),
        html('select', { value: settings.max_lesson, onChange: e => saveSettings({ max_lesson: e.target.value }), style: { ...cmInput, width: '100%', fontWeight: 700 } },
          html('option', { value: '' }, 'Todas las lecciones habilitadas'),
          lessons.map(l => html('option', { key: l, value: l }, 'Habilitado hasta la lección ' + l))),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🎓 Preparación HSK 1'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Sección aparte para preparar el examen (no cambia nada de NPCR). Los alumnos de esta clase la abren tocando 5 veces el logo 说.'),
        html('label', { className: 'mode-check' + (settings.hsk1_enabled ? ' on' : ''), style: { marginRight: 10 } },
          html('input', { type: 'checkbox', checked: !!settings.hsk1_enabled, onChange: e => saveSettings({ hsk1_enabled: e.target.checked }) }),
          settings.hsk1_enabled ? 'Habilitado para esta clase' : 'Habilitar para esta clase'),
        settings.hsk1_enabled && html('label', { style: { fontSize: 12, fontWeight: 700, color: 'var(--ink-mid)', display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 8 } },
          'Fecha del examen',
          html('input', { type: 'date', value: settings.hsk1_exam_date || '', onChange: e => saveSettings({ hsk1_exam_date: e.target.value }), style: { ...cmInput, width: 'auto' } })),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '⭐ Palabras de la semana'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Aparece como actividad en el aula de tus alumnos. Tocá palabras para agregarlas o quitarlas.'),
        html('input', { value: settings.weekly_title, placeholder: 'Título (ej: Comida y bebidas)', maxLength: 60, onChange: e => setSettings({ ...settings, weekly_title: e.target.value }), onBlur: () => saveSettings({}), style: { ...cmInput, width: '100%', marginBottom: 10 } }),
        ww.length > 0 && html('div', { className: 'word-pick-selected' },
          ww.map(x => html('button', { key: x.lesson + x.hanzi, className: 'word-pick on', onClick: () => toggle(x.lesson, x.hanzi), title: 'Quitar' }, x.hanzi + ' ✕')),
          html('button', { className: 'hint-link', onClick: () => saveSettings({ weekly_words: [] }) }, 'Vaciar lista'),
        ),
        html('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' } },
          html('select', { value: pickLesson, onChange: e => setPickLesson(e.target.value), style: { ...cmInput, flex: 'none' } },
            lessons.map(l => html('option', { key: l, value: l }, 'Lección ' + l))),
          hard.length > 0 && html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto', padding: '8px 12px', fontSize: 12 },
            onClick: () => saveSettings({ weekly_words: hard.slice(0, 15).map(h => ({ lesson: h.lesson, hanzi: h.hanzi })), weekly_title: settings.weekly_title || 'Refuerzo de la semana' }) }, '🧩 Usar las difíciles de la clase'),
        ),
        html('div', { className: 'word-pick-grid' },
          (vocab[pickLesson] || []).map(w => html('button', { key: w.hanzi, className: 'word-pick' + (has(pickLesson, w.hanzi) ? ' on' : ''), onClick: () => toggle(pickLesson, w.hanzi), title: w.pinyin + ' · ' + w.es },
            html('span', { className: 'hanzi-font' }, w.hanzi), html('small', null, (w.es || '').slice(0, 14))))),
      ),
    );
  }

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('div', { style: { flex: 1, minWidth: 0 } },
        html('h1', null, '🏫 ' + (cls ? cls.name : 'Clase')),
        html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } },
          rows ? rows.length + ' alumno' + (rows.length === 1 ? '' : 's') + ' · ' + rows.filter(r => r.user_id).length + ' activo' + (rows.filter(r => r.user_id).length === 1 ? '' : 's') : 'Cargando...'),
      ),
    ),
    html('div', { style: { padding: '0 16px' } },
      classes && classes.length === 0 && html('p', { className: 'admin-note' }, 'Todavía no hay clases. Creá una en ⚙ Administrar → Mis clases.'),
      !student && classId && html('div', { className: 'report-tabs' }, tabs.map(([k, label]) => html('button', { key: k, className: 'report-tab' + (tab === k ? ' active' : ''), onClick: () => setTab(k) }, label))),
      classId && body,
    ),
  );
}

// ----------------- BrandAnimText -----------------
const BRAND_FRAMES_DEFAULT = [
  { title: 'NPCR Practice', sub: '新实用汉语课本 1 · Lecciones 1–14' },
  { title: 'ShuōZhōngwén',  sub: 'New Practical Chinese Reader 1' },
];

function BrandAnimText({ frames, intervalSec }) {
  const frameData = (frames && frames.length) ? frames : BRAND_FRAMES_DEFAULT;
  const holdMs = ((intervalSec && intervalSec > 0) ? intervalSec : 9) * 1000;
  const [frame, setFrame] = useState(0);
  const [phase, setPhase] = useState('show'); // 'show' | 'out' | 'in'

  useEffect(() => {
    const hold = setTimeout(() => {
      setPhase('out');
      setTimeout(() => {
        setFrame(f => (f + 1) % frameData.length);
        setPhase('in');
        setTimeout(() => setPhase('show'), 400);
      }, 400);
    }, holdMs);
    return () => clearTimeout(hold);
  }, [frame, holdMs, frameData.length]);

  const { title, sub } = frameData[frame] || frameData[0];

  const styleMap = {
    show: { opacity: 1,   transform: 'translateY(0)',    filter: 'blur(0px)' },
    out:  { opacity: 0,   transform: 'translateY(-6px)', filter: 'blur(2px)' },
    in:   { opacity: 0,   transform: 'translateY(6px)',  filter: 'blur(2px)' },
  };

  const s = {
    ...styleMap[phase],
    transition: 'opacity 0.4s ease, transform 0.4s ease, filter 0.4s ease',
  };

  return html('div', { className: 'brand-text', style: s },
    html('strong', null, title),
    html('span', null, sub),
  );
}

// ----------------- App -----------------
function App() {
  const [vocab, setVocab] = useState(loadVocab);
  const [sentences, setSentences] = useState({});
  const [progress, setProgress] = useState(loadProgress);
  const [screen, setScreen] = useState({ name: 'home' });
  const [secretTaps, setSecretTaps] = useState(0);
  const [showSecretExam, setShowSecretExam] = useState(false);
  const [showDialogo, setShowDialogo] = useState(false);
  const secretTimer = React.useRef(null);
  const handleSecretTap = () => {
    clearTimeout(secretTimer.current);
    setSecretTaps(n => n + 1);
    secretTimer.current = setTimeout(() => setSecretTaps(0), 2000);
  };
  useEffect(() => {
    if (secretTaps < 5) return;
    setSecretTaps(0);
    clearTimeout(secretTimer.current);
    if (hsk1Allowed) setScreen({ name: 'hsk1' });
    else if (ENABLE_CUI_EXAM) setShowSecretExam(true);
  }, [secretTaps]);
  const [lastResults, setLastResults] = useState({});
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState(false);
  const [themesTick, setThemesTick] = useState(0); // fuerza re-render al mutar LESSON_THEMES
  const [appConfig, setAppConfig] = useState({});
  // --- Identidad del alumno: sesión anónima de Supabase Auth ---
  // El alumno ingresa solo su nombre. Se crea una sesión anónima (auth.uid() real).
  // El nombre queda en `profiles`. RLS y progreso funcionan igual que antes.
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [pendingName, setPendingName] = useState(null);
  // Nombre y código que eligió el alumno al entrar. Se guardan ANTES de iniciar sesión,
  // porque Supabase avisa la sesión nueva antes de que AuthGate llame a onAuthenticated.
  const pendingAuthRef = React.useRef({ name: null, code: null });

  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: listener } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const studentId = session ? session.user.id : null;

  // Las copias locales (progreso y repaso) son de UNA cuenta. Si en este
  // dispositivo entra otra cuenta, se descartan para no mezclar el avance.
  const CACHE_OWNER_KEY = 'npcr-cache-owner';
  useEffect(() => {
    if (!studentId) return;
    let owner = null;
    try { owner = localStorage.getItem(CACHE_OWNER_KEY); } catch (e) {}
    // Sin dueño registrado (versiones anteriores) también se descarta: el progreso
    // real de la cuenta se vuelve a bajar de Supabase en los efectos de abajo.
    if (owner !== studentId) {
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SRS_STORAGE_KEY); } catch (e) {}
      setProgress({ lessons: {} });
      setCardState({});
      setLastResults({});
    }
    try { localStorage.setItem(CACHE_OWNER_KEY, studentId); } catch (e) {}
    db.rpc('npcr_touch').then(() => {}); // registro de alumnos (fecha puesta por el servidor)
  }, [studentId]);

  // Contenido pedagógico 100% desde Supabase: nada hardcodeado, nada de
  // fallback local. Recién se pide cuando hay sesión (RLS exige auth.uid()).
  useEffect(() => {
    if (!studentId) return;
    setContentLoading(true);
    setContentError(false);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
    Promise.race([
      Promise.all([
        db.from('npcr_vocabulary').select('lesson,hanzi,pinyin,es').eq('hidden', false).order('id'),
        db.from('npcr_lesson_themes').select('lesson,name,icon,hidden'),
        db.from('npcr_app_config').select('key,value'),
        db.from('npcr_sentences').select('lesson,hanzi,pinyin,es').eq('hidden', false).order('id'),
        db.from('npcr_context_sentences').select('lesson,word,hanzi,pinyin,es').eq('hidden', false).order('id'),
      ]),
      timeout,
    ]).then(([vocabRes, themesRes, configRes, sentRes, ctxRes]) => {
      setVocab(supabaseRowsToVocab(vocabRes.data || []));
      setSentences(supabaseRowsToVocab(sentRes.data || []));
      CONTEXT_SENTENCES = (sentRes.data || []).map(r => ({ lesson: r.lesson, hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), es: nfc(r.es) }));
      WORD_SENTENCES = (ctxRes.data || []).map(r => ({ lesson: r.lesson, word: nfc(r.word), hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), es: nfc(r.es) }));
      Object.keys(LESSON_THEMES).forEach(k => delete LESSON_THEMES[k]);
      (themesRes.data || []).forEach(r => {
        LESSON_THEMES[r.lesson] = { name: nfc(r.name), icon: nfc(r.icon || r.lesson), hidden: !!r.hidden };
      });
      const cfg = {};
      (configRes.data || []).forEach(r => { cfg[r.key] = r.value; });
      setAppConfig(cfg);
      setThemesTick(t => t + 1);
      setContentLoading(false);
    }).catch(() => {
      setContentLoading(false);
      setContentError(true);
    });
  }, [studentId]);

  // Al loguearse: trae el perfil real, y actualiza racha + last_seen en Supabase.
  // Si es usuario anónimo nuevo (no hay profile), lo crea con el nombre ingresado.
  useEffect(() => {
    if (!studentId) { setProfile(null); return; }
    db.from('profiles').select('*').eq('id', studentId).maybeSingle().then(({ data }) => {
      const today     = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (!data) {
        // Usuario anónimo nuevo: crear profile con el nombre pendiente
        const nombre = pendingAuthRef.current.name || pendingName || '';
        pendingAuthRef.current.name = null;
        const newProfile = { id: studentId, name: nombre, streak_days: 1, streak_last_date: today, last_seen: new Date().toISOString() };
        db.from('profiles').upsert(newProfile).then(() => {});
        setProfile(newProfile);
        setPendingName(null);
        return;
      }
      if (data.streak_last_date === today) {
        setProfile(data);
        db.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', studentId).then(() => {});
        return;
      }
      const newStreak = data.streak_last_date === yesterday ? (data.streak_days || 0) + 1 : 1;
      db.from('profiles').update({
        streak_days: newStreak, streak_last_date: today, last_seen: new Date().toISOString(),
      }).eq('id', studentId).select().maybeSingle().then(({ data: updated }) => {
        setProfile(updated || data);
      });
    });
  }, [studentId]);


  const handleSignOut = () => { db.auth.signOut(); };

  // ── Estado extra ──
  const [assignments,  setAssignments]  = useState([]);
  const [myClasses,    setMyClasses]    = useState(null); // null = cargando
  const [codeNotice, setCodeNotice] = useState(null); // { type: 'ok'|'err', msg }

  const [classSettings, setClassSettings] = useState(null);
  const isStaffUser = !!(profile && ['laoshi', 'admin', 'superadmin'].includes(profile.role));
  const hsk1Allowed = isStaffUser || !!(classSettings && classSettings.hsk1_enabled);
  // Vista de alumno para el equipo docente: "Mi aula" de una de sus clases
  const staffRef = React.useRef(false);
  staffRef.current = isStaffUser;
  const [staffClasses, setStaffClasses] = useState([]);
  useEffect(() => { if (isStaffUser && studentId) loadMyClasses(); }, [isStaffUser, studentId]);
  const [previewClassId, setPreviewClassId] = useState(() => { try { return localStorage.getItem('npcr-preview-class') || ''; } catch (e) { return ''; } });
  const [classHard, setClassHard] = useState([]);
  // Equipo docente sin código de alumno: arma "Mi aula" con los datos de su clase
  const loadStaffPreview = async (wanted) => {
    const { data } = await db.from('classes').select('id,name,archived,created_at').order('created_at', { ascending: false });
    const list = (data || []).filter(c => !c.archived);
    setStaffClasses(list);
    const c = wanted === 'none' ? null : (list.find(x => x.id === wanted) || list[0]);
    if (!c) { setMyClasses([]); setAssignments([]); setClassSettings(null); setClassHard([]); return; }
    const [st, as, hw] = await Promise.all([
      db.from('npcr_class_settings').select('*').eq('class_id', c.id).maybeSingle(),
      db.from('assignments').select('id,title,description,due_date,lesson_ids,created_at').eq('class_id', c.id),
      db.rpc('npcr_class_hard_words', { p_class: c.id }),
    ]);
    const minDue = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
    setMyClasses([{ class_id: c.id, class_name: c.name, display_name: (profile && profile.name) || '', code: null, preview: true }]);
    setClassSettings(st.data ? { ...st.data, weekly_words: st.data.weekly_words || [] } : { class_id: c.id, max_lesson: null, weekly_title: null, weekly_words: [] });
    setAssignments((as.data || []).filter(a => !a.due_date || a.due_date >= minDue)
      .map(a => ({ ...a, class_name: c.name, targets: a.lesson_ids || [], targets_done: [], done: false })));
    setClassHard(hw.error ? [] : (hw.data || []));
  };
  const choosePreviewClass = (id) => {
    setPreviewClassId(id);
    try { localStorage.setItem('npcr-preview-class', id); } catch (e) {}
    loadStaffPreview(id);
  };

  const loadMyClasses = () => Promise.all([db.rpc('npcr_my_classes'), db.rpc('my_assignments'), db.rpc('npcr_my_class_settings'), db.rpc('npcr_my_class_hard_words')])
    .then(([cRes, aRes, sRes, hRes]) => {
      const list = cRes.error ? [] : (cRes.data || []);
      if (!list.length && staffRef.current) return loadStaffPreview(previewClassId);
      setMyClasses(list);
      setAssignments(aRes.error ? [] : (aRes.data || []));
      setClassSettings(!list.length || sRes.error ? null : ((sRes.data || [])[0] || null));
      setClassHard(!list.length || hRes.error ? [] : (hRes.data || []));
      // Con código, el nombre es el que cargó el laoshi: se guarda también en el perfil
      const official = list[0] && list[0].display_name;
      if (official && studentId) {
        setProfile(p => (p && p.name === official) ? p : { ...(p || { id: studentId }), name: official });
        db.from('profiles').update({ name: official }).eq('id', studentId).then(() => {});
      }
    });

  // Nombre visible en toda la app: el del laoshi si tiene código; si no, el que eligió
  const playerName = (myClasses && myClasses[0] && myClasses[0].display_name) || (profile ? (profile.name || '') : (pendingName || ''));

  // Activa un código de alumno con la sesión actual. Si el código ya está activado
  // en otra cuenta, pide permiso (allowSwitch) para entrar a esa cuenta.
  const activateStudentCode = async (rawCode, { allowSwitch = false } = {}) => {
    const code = normalizeCode(rawCode);
    const { data: st, error: stErr } = await db.rpc('npcr_code_status', { p_code: code });
    const info = st && st[0];
    if (stErr) return { ok: false, msg: 'No se pudo verificar el código. Revisá tu conexión.' };
    if (!info || !info.found) return { ok: false, msg: 'Ese código no existe. Revisalo con tu lǎoshī.' };
    const { data: { user } } = await db.auth.getUser();
    if (info.claimed && info.login_email && (!user || user.email !== info.login_email)) {
      if (!allowSwitch) return { ok: false, needsSwitch: true, info };
      const { error } = await db.auth.signInWithPassword({ email: info.login_email, password: studentPassword(info.login_email) });
      if (error) return { ok: false, msg: 'No se pudo entrar con ese código.' };
      return { ok: true, msg: '🎓 Entraste como ' + info.display_name + ' (' + info.class_name + ').' };
    }
    const { data: cl, error: clErr } = await db.rpc('npcr_claim_code', { p_code: code });
    const r = cl && cl[0];
    if (clErr) { console.error('npcr_claim_code', clErr); return { ok: false, msg: 'No se pudo activar el código (' + (clErr.message || clErr.code || 'error') + ').' }; }
    if (!r || r.status === 'invalid') return { ok: false, msg: 'Ese código no existe. Revisalo con tu lǎoshī.' };
    if (r.status === 'other') return { ok: false, msg: 'Ese código ya está activado en otra cuenta. Pedile a tu lǎoshī uno nuevo.' };
    // Cuenta anónima (o de dispositivo) → cuenta fija con el código como llave
    if (user && (!user.email || user.email.endsWith('@hanziapp.internal'))) {
      const email = studentEmail(code);
      // En dos pasos: primero el mail (queda confirmado al instante porque
      // "Confirm email" está apagado) y después la contraseña.
      let { error } = await db.auth.updateUser({ email });
      if (!error) ({ error } = await db.auth.updateUser({ password: studentPassword(email) }));
      if (error) return { ok: false, msg: 'Te sumaste a ' + r.class_name + ', pero no se pudo guardar la cuenta para otros dispositivos (' + error.message + ').' };
    }
    await loadMyClasses();
    return { ok: true, msg: r.status === 'already' ? '🎓 Ya estabas en ' + r.class_name + '.' : '🎓 ¡Listo! Te sumaste a ' + r.class_name + '.' };
  };

  // Al volver a la clase, refrescar tareas (para ver los ejercicios recién completados)
  useEffect(() => { if (screen.name === 'clase' && studentId) loadMyClasses(); }, [screen.name]);

  useEffect(() => {
    if (!studentId) { setMyClasses(null); setAssignments([]); setClassSettings(null); setClassHard([]); return; }
    const pendingCode = pendingAuthRef.current.code;
    pendingAuthRef.current.code = null;
    (pendingCode ? activateStudentCode(pendingCode, { allowSwitch: true }) : Promise.resolve(null))
      .then((res) => {
        if (res) setCodeNotice({ type: res.ok ? 'ok' : 'err', msg: res.msg });
        return loadMyClasses();
      });
  }, [studentId]);

  // Repaso espaciado: copia local (sirve sin conexión) + tabla npcr_card_state
  const [cardState, setCardState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SRS_STORAGE_KEY)) || {}; } catch (e) { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(SRS_STORAGE_KEY, JSON.stringify(cardState)); } catch (e) {}
  }, [cardState]);
  useEffect(() => {
    if (!studentId) return;
    db.from('npcr_card_state').select('card_key,box,due_at,reviews,lapses,updated_at').eq('student_id', studentId)
      .then(({ data, error }) => {
        if (error || !data) return;
        setCardState(prev => {
          const next = { ...prev };
          data.forEach(r => {
            const cur = next[r.card_key];
            if (!cur || new Date(r.updated_at) > new Date(cur.updated_at)) {
              next[r.card_key] = { box: r.box, due_at: r.due_at, reviews: r.reviews, lapses: r.lapses, updated_at: r.updated_at };
            }
          });
          return next;
        });
      });
  }, [studentId]);
  const recordCard = (key, kind) => {
    setCardState(prev => {
      const st = srsNext(prev[key], kind, Date.now());
      if (studentId) db.from('npcr_card_state').upsert({ student_id: studentId, card_key: key, ...st }).then(() => {});
      return { ...prev, [key]: st };
    });
  };

  const [wordErrorsMap, setWordErrorsMap] = useState({});

  // Entrenamiento diario: ¿ya lo hizo hoy? (copia local + npcr_daily_log)
  const [dailyDoneDay, setDailyDoneDay] = useState(null);
  useEffect(() => {
    if (!studentId) { setDailyDoneDay(null); return; }
    try { setDailyDoneDay(localStorage.getItem('npcr-daily-' + studentId)); } catch (e) {}
    db.from('npcr_daily_log').select('day').eq('student_id', studentId).eq('day', todayLocal()).maybeSingle()
      .then(({ data }) => { if (data) setDailyDoneDay(data.day); });
  }, [studentId]);
  const markDailyDone = (cards, firstTryOk) => {
    const day = todayLocal();
    setDailyDoneDay(day);
    try { localStorage.setItem('npcr-daily-' + studentId, day); } catch (e) {}
    if (studentId) db.from('npcr_daily_log').upsert({ student_id: studentId, day, cards, first_try_ok: firstTryOk, completed_at: new Date().toISOString() }).then(() => {});
  };

  // --- Progreso: al loguearse, traer de Supabase y fusionar con la copia local ---
  useEffect(() => {
    if (!studentId) return;
    Promise.all([
      db.from('npcr_progress').select('lesson_id,mode,percent,missed').eq('student_id', studentId),
      db.from('npcr_prueba_progress').select('game,percent,missed').eq('student_id', studentId),
    ]).then(([lessonsRes, pruebaRes]) => {
      setProgress(prev => {
        const next = { lessons: { ...prev.lessons }, prueba: { ...(prev.prueba || {}) } };
        (lessonsRes.data || []).forEach(r => {
          const cur = next.lessons[r.lesson_id] || {};
          next.lessons[r.lesson_id] = {
            ...cur,
            [r.mode]: Math.max(cur[r.mode] || 0, r.percent),
            [r.mode + '_missed']: (r.missed && r.missed.length) ? r.missed : (cur[r.mode + '_missed'] || []),
          };
        });
        (pruebaRes.data || []).forEach(r => {
          next.prueba[r.game] = Math.max(next.prueba[r.game] || 0, r.percent);
          next.prueba[r.game + '_missed'] = (r.missed && r.missed.length) ? r.missed : (next.prueba[r.game + '_missed'] || []);
        });
        return next;
      });
    });
  }, [studentId]);

  useEffect(() => { saveProgress(progress); }, [progress]);

  const lessons = Object.keys(vocab).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });

  // Registro de cada sesión de práctica (base del análisis del laoshi)
  const logActivity = (kind, lesson, mode, percent, total, missedCount) => {
    if (!studentId) return;
    db.from('npcr_activity').insert({ student_id: studentId, kind, lesson: lesson || null, mode: mode || null,
      percent: Math.round(percent || 0), total: total == null ? null : total, missed: missedCount == null ? null : missedCount }).then(() => {});
  };

  const updateLessonResult = (lessonId, mode, percent, missed) => {
    logActivity('lesson', lessonId, mode, percent, null, (missed || []).length);
    setProgress(prev => {
      const next = { ...prev, lessons: { ...prev.lessons } };
      const current = next.lessons[lessonId] || {};
      const prevBest = current[mode] || 0;
      const missedKey = mode + '_missed';
      const newPercent = Math.max(prevBest, percent);
      // Always overwrite missed list with latest run (most recent attempt)
      next.lessons[lessonId] = {
        ...current,
        [mode]: newPercent,
        [missedKey]: missed || [],
      };
      if (studentId) {
        db.from('npcr_progress').upsert({
          student_id: studentId, lesson_id: lessonId, mode,
          percent: newPercent, missed: missed || [],
          updated_at: new Date().toISOString(),
        }).then(() => {});
        // Registrar errores de palabras para repaso inteligente
        (missed || []).forEach(w => {
          if (w && w.hanzi) {
            db.rpc('record_word_error', { p_hanzi: w.hanzi, p_pinyin: w.pinyin || '', p_es: w.es || '' }).then(() => {});
            setWordErrorsMap(prev => {
              const cur = prev[w.hanzi] || { error_count: 0 };
              return { ...prev, [w.hanzi]: { ...cur, error_count: (cur.error_count || 0) + 1, last_error: new Date().toISOString() } };
            });
          }
        });
      }
      return next;
    });
  };

  const resultKey = (lessonId, mode) => lessonId + ':' + mode;

  const setLastResult = (lessonId, mode, result) => {
    setLastResults(prev => ({ ...prev, [resultKey(lessonId, mode)]: result }));
  };

  const clearLastResult = (lessonId, mode) => {
    setLastResults(prev => {
      const next = { ...prev };
      delete next[resultKey(lessonId, mode)];
      return next;
    });
  };

  const regularLessons = lessons.filter(id => !String(id).startsWith('mod-'));
  const maxLesson = classSettings && classSettings.max_lesson ? Number(classSettings.max_lesson) : null;
  const isLocked = (id) => !isStaffUser && maxLesson != null && !isNaN(parseFloat(id)) && parseFloat(id) > maxLesson;
  const openLessons = regularLessons.filter(id => !isLocked(id));
  const dailyDeckSize = useMemo(() => buildDailyDeck(vocab, openLessons, cardState).length, [vocab, cardState, lessons.length, maxLesson]);

  const totalWords = lessons.reduce((acc, l) => acc + vocab[l].length, 0);
  const totalStars = lessons.reduce((acc, l) => {
    const lp = progress.lessons[l] || {};
    const vals = [lp.match || 0, lp.cards || 0, lp.quiz || 0];
    return acc + vals.filter(v => v >= 80).length;
  }, 0);

  const needsName = !!(studentId && profile && myClasses !== null && !(myClasses && myClasses.length) && !isStaffUser && !validStudentName(profile.name));
  const saveName = async (n) => {
    const name = n.trim();
    await db.from('profiles').update({ name }).eq('id', studentId);
    setProfile(p => ({ ...(p || {}), name }));
  };

  let content;
  if (screen.name === 'home') {
    content = html(Home, {
      vocab, lessons, progress, totalWords, totalStars,
      modulesList: appConfig.modules_list,
      maxLesson,
      onSelectLesson: (id) => {
        if (isLocked(id)) { window.alert('🔒 Tu lǎoshī habilitó hasta la lección ' + maxLesson + '. ¡Esta llega pronto!'); return; }
        setScreen({ name: 'lesson', lessonId: id });
        if (studentId) db.from('activity_log')
          .update({ max_lesson: id, last_active: new Date().toISOString() })
          .eq('student_id', studentId)
          .order('connected_at', { ascending: false }).limit(1).then(() => {});
      },
      onAdmin: () => setScreen({ name: 'admin' }),
      onPrueba: (game) => setScreen({ name: 'prueba', game }),
      pruebaProgress: progress.prueba || {},
      onRefuerzo: () => setScreen({ name: 'refuerzo' }),
      onDownload: () => downloadResumen(vocab, progress, lessons, playerName),
      playerName,
      onChangeName: handleSignOut,
      streak: profile ? (profile.streak_days || 0) : 0,
      assignments, myClasses, onActivateCode: activateStudentCode, codeNotice, onDismissNotice: () => setCodeNotice(null),
      dailyCount: dailyDeckSize, dailyDone: dailyDoneDay === todayLocal(),
      onOpenClass: () => setScreen({ name: 'clase' }),
      onTraining: () => setScreen({ name: 'entrenamiento' }),
      onProgress: () => setScreen({ name: 'progreso' }),
      classSettings, hardCount: classHard.length,
      onActivity: (id) => setScreen({ name: id }),
      staffClasses, onPreviewClass: choosePreviewClass,
    });
  } else if (screen.name === 'hsk1' && hsk1Allowed) {
    content = html(Hsk1Screen, {
      studentId, appConfig,
      examDate: (classSettings && classSettings.hsk1_exam_date) || appConfig.hsk1_exam_date || null,
      onHome: () => setScreen({ name: 'home' }),
    });
  } else if (screen.name === 'lesson') {
    content = html(LessonMenu, {
      vocab, sentences, lessonId: screen.lessonId, progress, cardState,
      onBack: () => setScreen({ name: 'home' }),
      onSelectMode: (mode) => setScreen({ name: 'play', lessonId: screen.lessonId, mode }),
      onWorkbookListen: () => setScreen({ name: 'workbook-listen', lessonId: screen.lessonId }),
      onWorkbookStroke: () => setScreen({ name: 'workbook-stroke', lessonId: screen.lessonId }),
    });
  } else if (screen.name === 'workbook-listen') {
    content = html(WorkbookListeningGame, {
      lessonId: screen.lessonId, playerName,
      onBack: () => setScreen({ name: 'lesson', lessonId: screen.lessonId }),
      onFinish: (percent, missed) => updateLessonResult(screen.lessonId, 'workbook_listen', percent, missed),
    });
  } else if (screen.name === 'workbook-stroke') {
    content = html(WorkbookStrokeGame, {
      lessonId: screen.lessonId,
      onBack: () => setScreen({ name: 'lesson', lessonId: screen.lessonId }),
    });
  } else if (screen.name === 'play') {
    const modeOrder = (sentences[screen.lessonId] || []).length ? ['match', 'cards', 'quiz', 'frases'] : ['match', 'cards', 'quiz'];
    const modeIdx = modeOrder.indexOf(screen.mode);
    const lessonIdx = lessons.indexOf(screen.lessonId);
    let nextAction = null;
    if (modeIdx < modeOrder.length - 1) {
      const nextMode = modeOrder[modeIdx + 1];
      nextAction = { label: 'Siguiente ejercicio', go: () => setScreen({ name: 'play', lessonId: screen.lessonId, mode: nextMode }) };
    } else if (lessonIdx < lessons.length - 1) {
      const nextLessonId = lessons[lessonIdx + 1];
      nextAction = { label: 'Siguiente lección', go: () => setScreen({ name: 'play', lessonId: nextLessonId, mode: 'match' }) };
    }
    const key = resultKey(screen.lessonId, screen.mode);
    content = html(PlayScreen, {
      key,
      vocab, sentences, lessonId: screen.lessonId, mode: screen.mode,
      cardState, onRecordCard: recordCard,
      onBack: () => setScreen(screen.from === 'clase' ? { name: 'clase' } : { name: 'lesson', lessonId: screen.lessonId }),
      onHome: () => setScreen({ name: 'home' }),
      onFinish: (percent, missed) => updateLessonResult(screen.lessonId, screen.mode, percent, missed),
      nextAction,
      savedResult: lastResults[key] || null,
      onSaveResult: (result) => setLastResult(screen.lessonId, screen.mode, result),
      onClearResult: () => clearLastResult(screen.lessonId, screen.mode),
    });
  } else if (screen.name === 'clase' && myClasses && myClasses.length) {
    content = html(ClassHome, {
      cls: myClasses[0], assignments, dailyCount: dailyDeckSize, dailyDone: dailyDoneDay === todayLocal(),
      settings: classSettings, hardCount: classHard.length,
      onActivity: (id) => setScreen({ name: id }),
      onTarget: (l, m) => setScreen({ name: 'play', lessonId: l, mode: m, from: 'clase' }),
      onTraining: () => setScreen({ name: 'entrenamiento' }),
      onProgress: () => setScreen({ name: 'progreso' }),
      onBack: () => setScreen({ name: 'home' }),
    });
  } else if (screen.name === 'entrenamiento') {
    content = html(FlashcardGame, {
      key: 'entrenamiento-' + (screen.n || 0),
      words: [], lessonId: 'daily', cardState, onRecordCard: recordCard,
      deckBuilder: () => buildDailyDeck(vocab, openLessons, cardState),
      title: '🎯 Entrenamiento diario',
      emptyTitle: dailyDoneDay === todayLocal() ? '¡Entrenamiento de hoy completo!' : '¡Estás al día!',
      emptySub: 'No quedan tarjetas para hoy. Volvé mañana para seguir sumando: así se fija lo que aprendiste.',
      onBack: () => setScreen({ name: myClasses && myClasses.length ? 'clase' : 'home' }),
      onHome: () => setScreen({ name: 'home' }),
      onFinish: (percent, missed, total) => {
        markDailyDone(total, total - (missed || []).length);
        logActivity('daily', null, 'cards', percent, total, (missed || []).length);
      },
      nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {},
    });
  } else if (screen.name === 'practica') {
    content = html(PracticaHub, {
      modulesList: appConfig.modules_list,
      pruebaProgress: progress.prueba || {},
      onBack: () => setScreen({ name: 'home' }),
      onPrueba: (game) => setScreen({ name: 'prueba', game, from: 'practica' }),
    });
  } else if (screen.name === 'refuerzo') {
    const missedWords = getSmartMissedWords(progress, wordErrorsMap);
    const allWords = lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros').flatMap(id => vocab[id]);
    content = html(RefuerzoSession, {
      words: missedWords, allWords,
      onBack: () => setScreen({ name: 'home' }),
      playerName,
    });
  } else if (screen.name === 'admin') {
    content = html(AdminPanel, {
      vocab,
      appConfig,
      onAppConfigChange: (key, value) => setAppConfig(prev => ({ ...prev, [key]: value })),
      onBack: () => setScreen({ name: 'home' }),
      onVocabUpdate: (newVocab) => {
        setVocab(newVocab);
      },
      onReports: (classId) => setScreen({ name: 'reports', classId: typeof classId === 'string' ? classId : null }),
    });
  } else if (screen.name === 'reports') {
    content = html(ClassAnalytics, {
      vocab, lessons: regularLessons, initialClassId: screen.classId,
      onBack: () => setScreen({ name: 'admin' }),
    });
  } else if (screen.name === 'refuerzo-clase' || screen.name === 'semana') {
    const isWeek = screen.name === 'semana';
    const src = isWeek ? ((classSettings && classSettings.weekly_words) || []) : classHard;
    const toCards = () => src.map(x => { const w = (vocab[x.lesson] || []).find(v => v.hanzi === x.hanzi); return w ? { ...w, _lesson: x.lesson } : null; }).filter(Boolean);
    content = html(FlashcardGame, {
      key: screen.name,
      words: [], lessonId: 'class', cardState, onRecordCard: recordCard,
      deckBuilder: () => shuffle(toCards()),
      title: isWeek ? '⭐ ' + ((classSettings && classSettings.weekly_title) || 'Palabras de la semana') : '🧩 Refuerzo de clase',
      emptyTitle: 'Sin palabras por ahora', emptySub: 'Tu lǎoshī todavía no cargó palabras para esta actividad.',
      onBack: () => setScreen({ name: 'clase' }),
      onHome: () => setScreen({ name: 'home' }),
      onFinish: (percent, missed, total) => logActivity('prueba', null, isWeek ? 'semana' : 'refuerzo-clase', percent, total, (missed || []).length),
      nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {},
    });
  } else if ((screen.name === 'tonos' || screen.name === 'dictado') && myClasses && myClasses.length) {
    const Game = screen.name === 'tonos' ? ToneGame : DictationGame;
    content = html(Game, {
      key: screen.name, vocab, lessons: openLessons,
      onBack: () => setScreen({ name: myClasses && myClasses.length ? 'clase' : 'home' }),
      onFinish: (percent, missed, total) => logActivity('prueba', null, screen.name, percent, total, (missed || []).length),
    });
  } else if (screen.name === 'progreso' && myClasses && myClasses.length) {
    content = html(MyProgress, {
      vocab, lessons: regularLessons, cardState, progress, streak: profile ? (profile.streak_days || 0) : 0,
      onBack: () => setScreen({ name: myClasses && myClasses.length ? 'clase' : 'home' }),
      onPractice: () => setScreen({ name: 'dificiles' }),
    });
  } else if (screen.name === 'dificiles') {
    content = html(FlashcardGame, {
      key: 'dificiles',
      words: [], lessonId: 'weak', cardState, onRecordCard: recordCard,
      deckBuilder: () => weakCards(vocab, regularLessons, cardState).slice(0, 20),
      title: '💪 Mis palabras difíciles',
      emptyTitle: '¡No tenés palabras difíciles!',
      emptySub: 'Cuando marques "No lo sabía" en alguna tarjeta, va a aparecer acá para que la repases.',
      onBack: () => setScreen({ name: 'progreso' }),
      onHome: () => setScreen({ name: 'home' }),
      onFinish: (percent, missed, total) => logActivity('lesson', null, 'dificiles', percent, total, (missed || []).length),
      nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {},
    });
  } else if (screen.name === 'prueba') {
    const onPruebaFinish = (percent, missed) => {
      logActivity('prueba', null, screen.game, percent, null, (missed || []).length);
      setProgress(prev => {
        const pp = prev.prueba || {};
        const newPercent = Math.max(pp[screen.game] || 0, percent);
        const next = { ...prev, prueba: {
          ...pp,
          [screen.game]: newPercent,
          [screen.game + '_missed']: missed || [],
        }};
        if (studentId) {
          db.from('npcr_prueba_progress').upsert({
            student_id: studentId, game: screen.game,
            percent: newPercent, missed: missed || [],
            updated_at: new Date().toISOString(),
          }).then(() => {});
          db.from('activity_log')
            .update({ max_game: screen.game, max_game_score: newPercent, last_active: new Date().toISOString() })
            .eq('student_id', studentId)
            .order('connected_at', { ascending: false }).limit(1).then(() => {});
        }
        return next;
      });
    };
    const gameProps = {
      onBack: () => setScreen({ name: screen.from || 'practica' }),
      onFinish: onPruebaFinish,
      playerName,
      priorMissed: (progress.prueba || {})[screen.game + '_missed'] || [],
    };
    if (screen.game === 'frase') content = html(ClasificadorGame, { ...gameProps, tipo: 'frase' });
    else if (screen.game === 'clas') content = html(ClasificadorGame, { ...gameProps, tipo: 'clasificador' });
    else if (screen.game === 'modal') content = html(ClasificadorGame, { ...gameProps, tipo: 'modal' });
    else if (screen.game === 'tiempo') content = html(ClasificadorGame, { ...gameProps, tipo: 'tiempo' });
    else if (screen.game === 'dialogo') content = html(DialogoGame, gameProps);
    else if (screen.game === 'orden') content = html(OrdenGame, gameProps);
    else if (screen.game === 'audio') {
      const allWords = lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros').flatMap(id => vocab[id]);
      content = html(AudioGame, { ...gameProps, allWords });
    }
    else if (screen.game === 'escritura') {
      const allVocab = {};
      lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros').forEach(id => { allVocab[id] = vocab[id] || []; });
      content = html(HanziWriteGame, { ...gameProps, vocab: allVocab, writeConfig: appConfig.write_game_config, keyboardHint: appConfig.keyboard_hint_text });
    }
  }

  if (sessionLoading) {
    return html('div', { className: 'app-loader' },
      html('div', { className: 'app-loader-hanzi' }, '说'),
      html('div', { className: 'app-loader-dots' },
        html('span'), html('span'), html('span')
      ),
    );
  }

  if (!session) {
    return html('div', { className: 'app' }, html(AuthGate, { onBeforeAuth: (nombre, codigo) => { pendingAuthRef.current = { name: nombre || null, code: codigo || null }; }, onAuthenticated: (s, nombre, codigo) => {
      if (nombre) setPendingName(nombre);
      setSession(s);
      // Registrar conexión en activity_log una sola vez por día/sesión
      if (s && nombre) {
        const today = new Date().toISOString().slice(0, 10);
        const logKey = 'hanzi-log-' + s.user.id + '-' + today;
        if (!localStorage.getItem(logKey)) {
          db.from('activity_log').insert({
            student_id: s.user.id,
            name: nombre,
            connected_at: new Date().toISOString(),
            last_active: new Date().toISOString(),
          }).then(() => { localStorage.setItem(logKey, '1'); });
        }
      }
    } }));
  }

  if (contentLoading) {
    return html('div', { className: 'app-loader' },
      html('div', { className: 'app-loader-hanzi' }, '汉字'),
      html('div', { className: 'app-loader-dots' },
        html('span'), html('span'), html('span')
      ),
      html('div', { className: 'app-loader-msg' }, 'Preparando tus lecciones…'),
    );
  }

  if (contentError) {
    return html('div', { className: 'app-loader' },
      html('div', { style: { fontSize: 48, marginBottom: 12 } }, '📡'),
      html('div', { style: { fontWeight: 800, fontSize: 18, color: 'var(--ink)', marginBottom: 8 } }, 'Sin conexión'),
      html('div', { style: { fontSize: 14, color: 'var(--ink-soft)', marginBottom: 24, textAlign: 'center', maxWidth: 280 } },
        'No se pudo conectar con el servidor. Verificá tu conexión a internet e intentá de nuevo.',
      ),
      html('button', {
        className: 'primary-btn',
        onClick: () => { setContentError(false); setContentLoading(true); setStudentId && null; window.location.reload(); },
      }, '🔄 Reintentar'),
    );
  }

  if (showSecretExam) {
    if (showDialogo === 'oral') return html(DialogoPractica, { onBack: () => setShowDialogo(false) });
    if (showDialogo === 'escrito') return html(ExamenSimulacro, { onBack: () => setShowDialogo(false) });
    return html('main', { style: { paddingTop: 16, paddingBottom: 40 } },
      html('div', { style: { padding: '0 16px', maxWidth: 480, margin: '0 auto' } },
        html('div', { className: 'header-row' },
          html('button', { className: 'back-btn', onClick: () => setShowSecretExam(false) }, '←'),
          html('h1', null, '模拟考试 · Nivel III'),
        ),
        html('p', { style: { color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 } }, 'Elegí qué querés practicar:'),
        html('button', {
          className: 'mode-card', style: { width: '100%', marginBottom: 12 },
          onClick: () => setShowDialogo('oral'),
        },
          html('div', { className: 'mode-emoji', style: { background: '#EDE9FE', fontSize: 24 } }, '🎙️'),
          html('div', null,
            html('div', { className: 'mode-title' }, 'Práctica oral — Diálogo'),
            html('div', { className: 'mode-sub' }, 'Elegí tu rol y practicá en voz alta'),
          )
        ),
        html('button', {
          className: 'mode-card', style: { width: '100%' },
          onClick: () => setShowDialogo('escrito'),
        },
          html('div', { className: 'mode-emoji', style: { background: '#FEF3C7', fontSize: 24 } }, '📝'),
          html('div', null,
            html('div', { className: 'mode-title' }, 'Examen escrito — Simulacro'),
            html('div', { className: 'mode-sub' }, 'Todas las secciones · 100 pts'),
          )
        ),
      )
    );
  }

  const topbar = html('div', { className: 'topbar' },
    html('div', { className: 'brand' },
      html('div', { className: 'brand-mark hanzi-font', onClick: handleSecretTap, style: { cursor: 'default', userSelect: 'none' } }, '说'),
      html(BrandAnimText, { frames: appConfig.brand_frames, intervalSec: appConfig.brand_anim_interval }),
    ),
    html('div', { style: { display: 'flex', gap: 8 } },
      html(SoundToggle, { className: 'icon-btn' }),
      screen.name === 'home' && html('button', { className: 'icon-btn', onClick: () => setScreen({ name: 'admin' }), title: 'Administrar vocabulario' }, '⚙'),
    )
  );

  const streakDays = profile ? (profile.streak_days || 0) : 0;
  const navIsHome = screen.name === 'home';
  const navIsRefuerzo = screen.name === 'refuerzo';
  const navIsPractica = screen.name === 'practica' || screen.name === 'prueba';
  const navIsAdmin = screen.name === 'admin' || screen.name === 'reports';
  const navIsClase = ['clase', 'entrenamiento', 'refuerzo-clase', 'semana', 'tonos', 'dictado'].includes(screen.name);
  const navIsProgreso = screen.name === 'progreso' || screen.name === 'dificiles';

  const sidebar = html('aside', { className: 'sidebar' },
    html('div', { className: 'sidebar-brand' },
      html('div', { className: 'brand-mark hanzi-font', onClick: handleSecretTap, style: { cursor: 'default', userSelect: 'none' } }, '说'),
      html(BrandAnimText, { frames: appConfig.brand_frames, intervalSec: appConfig.brand_anim_interval }),
    ),
    html('nav', { className: 'sidebar-nav' },
      html('button', {
        className: 'sidebar-link' + (navIsHome ? ' active' : ''),
        onClick: () => setScreen({ name: 'home' }),
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('path', { d: 'M3 11.5 12 4l9 7.5' }),
          html('path', { d: 'M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9' }),
        ),
        'Aprender',
      ),
      myClasses && myClasses.length > 0 && html('button', {
        className: 'sidebar-link sidebar-link-class' + (navIsClase ? ' active' : ''),
        onClick: () => setScreen({ name: 'clase' }),
        title: myClasses[0].class_name,
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('path', { d: 'M22 10 12 5 2 10l10 5 10-5Z' }),
          html('path', { d: 'M6 12v5c3 2 9 2 12 0v-5' }),
        ),
        'Mi aula',
        dailyDoneDay !== todayLocal() && dailyDeckSize > 0 && html('span', { className: 'sidebar-badge' }, dailyDeckSize),
      ),
      html('button', {
        className: 'sidebar-link' + (navIsPractica ? ' active' : ''),
        onClick: () => setScreen({ name: 'practica' }),
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('circle', { cx: 12, cy: 12, r: 8 }),
          html('circle', { cx: 12, cy: 12, r: 4 }),
          html('circle', { cx: 12, cy: 12, r: 0.6, fill: 'currentColor' }),
        ),
        'Práctica',
      ),
      myClasses && myClasses.length > 0 && html('button', {
        className: 'sidebar-link' + (navIsProgreso ? ' active' : ''),
        onClick: () => setScreen({ name: 'progreso' }),
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('path', { d: 'M3 3v18h18' }),
          html('path', { d: 'M7 15l4-4 3 3 5-6' }),
        ),
        'Mi progreso',
      ),
      html('button', {
        className: 'sidebar-link' + (navIsRefuerzo ? ' active' : ''),
        onClick: () => setScreen({ name: 'refuerzo' }),
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
          html('path', { d: 'M21 3v5h-5' }),
          html('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
          html('path', { d: 'M3 21v-5h5' }),
        ),
        'Refuerzo',
      ),
      html('button', {
        className: 'sidebar-link' + (navIsAdmin ? ' active' : ''),
        onClick: () => setScreen({ name: 'admin' }),
      },
        html('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          html('circle', { cx: 12, cy: 12, r: 3 }),
          html('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z' }),
        ),
        'Administrar',
      ),
    ),
    html('div', { className: 'sidebar-progress-panel' },
      html('div', { className: 'sidebar-progress-title' }, '📊 Mi avance'),
      lessons
        .filter(id => id !== 'mod-paises' && id !== 'mod-numeros' && !LESSON_THEMES[id]?.hidden)
        .map(id => {
          const theme = LESSON_THEMES[id] || { name: 'Lección ' + id, icon: '汉' };
          const lp = progress.lessons[id] || {};
          const best = Math.round(((lp.match || 0) + (lp.cards || 0) + (lp.quiz || 0)) / 3);
          // % a repasar: palabras marcadas como errores en la última sesión
          const missedCount = [
            ...(lp.match_missed || []),
            ...(lp.cards_missed || []),
            ...(lp.quiz_missed || []),
          ].reduce((acc, w) => { if (!acc.includes(w?.hanzi)) acc.push(w?.hanzi); return acc; }, []).length;
          const wordCount = (vocab[id] || []).length || 1;
          const reviewPct = Math.min(100, Math.round((missedCount / wordCount) * 100));
          const okPct = best;
          return html('div', {
            key: id,
            className: 'sidebar-lesson-row',
            onClick: () => setScreen({ name: 'lesson', lessonId: id }),
          },
            html('div', { className: 'sidebar-lesson-row-top' },
              html('span', { className: 'sidebar-lesson-icon' }, theme.icon || '汉'),
              html('span', { className: 'sidebar-lesson-label' }, 'L' + id + ' · ' + theme.name),
              html('span', { className: 'pct-progress' }, okPct > 0 ? okPct + '%' : '—'),
            ),
            html('div', { className: 'sidebar-dual-bar' },
              html('div', { className: 'sidebar-bar-ok', style: { width: okPct + '%' } }),
              html('div', { className: 'sidebar-bar-review', style: { width: (100 - okPct) + '%', opacity: okPct > 0 ? 1 : 0 } }),
            ),
            okPct > 0 && html('div', { className: 'sidebar-accuracy-row' },
              html('span', { className: 'pct-ok' }, '✓ ' + okPct + '%'),
              html('span', { className: 'pct-err' }, '✕ ' + (100 - okPct) + '%'),
            ),
          );
        }),
      streakDays > 0 && html('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 0', marginTop: 4, borderTop: '1px solid var(--paper-deep)' } },
        html('span', { style: { fontSize: 18 } }, '🔥'),
        html('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: '#C07818' } }, streakDays + ' día' + (streakDays === 1 ? '' : 's') + ' seguido' + (streakDays === 1 ? '' : 's')),
      ),
    ),
    html(SoundToggle, { className: 'sidebar-signout', withLabel: true }),
    playerName && html('button', { className: 'sidebar-signout', onClick: handleSignOut }, '🚪 ' + playerName + ' · Salir'),
  );

  return html('div', { className: 'app-shell' }, sidebar, html('div', { className: 'app' }, topbar, content), needsName && html(NameRequired, { onSave: saveName }));
}

// ----------------- PanelLectura -----------------
const FRASES_DEL_DIA = [
  { zh: '今天天气很好！', py: 'Jīntiān tiānqì hěn hǎo!', es: '¡Hoy hace muy buen tiempo!' },
  { zh: '我想喝一杯茶。', py: 'Wǒ xiǎng hē yī bēi chá.', es: 'Me gustaría tomar una taza de té.' },
  { zh: '这个周末有聚会！', py: 'Zhège zhōumò yǒu jùhuì!', es: '¡Este fin de semana hay una fiesta!' },
  { zh: '我们去吃中餐吧。', py: 'Wǒmen qù chī zhōngcān ba.', es: 'Vamos a comer comida china.' },
  { zh: '明天是我的生日。', py: 'Míngtiān shì wǒde shēngrì.', es: 'Mañana es mi cumpleaños.' },
  { zh: '下午我有汉语课。', py: 'Xiàwǔ wǒ yǒu Hànyǔ kè.', es: 'Por la tarde tengo clase de chino.' },
  { zh: '我买了一瓶红葡萄酒。', py: 'Wǒ mǎi le yī píng hóng pútaojiǔ.', es: 'Compré una botella de vino tinto.' },
  { zh: '你今年多大了？', py: 'Nǐ jīnnián duō dà le?', es: '¿Cuántos años tienes este año?' },
  { zh: '晚上我们去参加聚会。', py: 'Wǎnshang wǒmen qù cānjiā jùhuì.', es: 'Esta noche vamos a la fiesta.' },
  { zh: '祝贺你生日快乐！', py: 'Zhùhè nǐ shēngrì kuàilè!', es: '¡Feliz cumpleaños!' },
  { zh: '我上午没有课。', py: 'Wǒ shàngwǔ méiyǒu kè.', es: 'Por la mañana no tengo clase.' },
  { zh: '今天星期几？', py: 'Jīntiān xīngqī jǐ?', es: '¿Qué día de la semana es hoy?' },
  { zh: '我属龙。你呢？', py: 'Wǒ shǔ lóng. Nǐ ne?', es: 'Soy del año del dragón. ¿Y tú?' },
  { zh: '我们去吃蛋糕吧！', py: 'Wǒmen qù chī dàngāo ba!', es: '¡Vamos a comer torta!' },
  { zh: '你喝可乐还是茶？', py: 'Nǐ hē kělè háishì chá?', es: '¿Tomás Coca-Cola o té?' },
  { zh: '今天是个好日子！', py: 'Jīntiān shì gè hǎo rìzi!', es: '¡Hoy es un buen día!' },
  { zh: '我出生在北京。', py: 'Wǒ chūshēng zài Běijīng.', es: 'Nací en Pekín.' },
  { zh: '我想吃热狗和面包。', py: 'Wǒ xiǎng chī règǒu hé miànbāo.', es: 'Quiero comer pancho y pan.' },
  { zh: '这个星期我很忙。', py: 'Zhège xīngqī wǒ hěn máng.', es: 'Esta semana estoy muy ocupado/a.' },
  { zh: '晚上好！今天怎么样？', py: 'Wǎnshang hǎo! Jīntiān zěnmeyàng?', es: '¡Buenas noches! ¿Cómo estuvo el día?' },
];
const DIAS_ZH = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function PanelLectura({ playerName }) {
  const [mostrarPinyin, setMostrarPinyin] = useState(false);
  const [mostrarTrad, setMostrarTrad] = useState(false);
  const [dbFrases, setDbFrases] = useState(null);
  useEffect(() => {
    db.from('frases_del_dia').select('zh,py,es').eq('active', true)
      .then(({ data }) => { if (data && data.length > 0) setDbFrases(data.map(nfcRow)); });
  }, []);
  const now = new Date();
  const hora = now.getHours();
  const minutos = String(now.getMinutes()).padStart(2, '0');
  const periodo = hora < 12 ? '上午' : hora < 20 ? '下午' : '晚上';
  const horaStr = (hora % 12 || 12) + ':' + minutos;
  const diaSemana = DIAS_ZH[now.getDay()];
  const diaNum = now.getDate();
  const mes = MESES_ES[now.getMonth()];
  const anio = now.getFullYear();
  const frasesSource = (dbFrases && dbFrases.length > 0) ? dbFrases : FRASES_DEL_DIA;
  const idx = (now.getFullYear() * 1000 + now.getMonth() * 31 + now.getDate()) % frasesSource.length;
  const frase = frasesSource[idx];
  const saludo = hora < 12 ? '早上好' : hora < 20 ? '下午好' : '晚上好';
  const nombre = playerName || '同学';
  return html('div', {
    style: { background: 'linear-gradient(135deg, var(--lacquer) 0%, var(--lacquer-dark) 100%)', borderRadius: 'var(--radius)', padding: '16px 18px', marginBottom: 18, color: '#fff', position: 'relative', overflow: 'hidden' }
  },
    html('div', { style: { fontSize: 11, fontWeight: 700, opacity: 0.75, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 } }, '📖 Lectura del día'),
    html('div', { className: 'hanzi-font', style: { fontSize: 22, fontWeight: 700, lineHeight: 1.4, marginBottom: 4 } },
      saludo + '，', html('span', { style: { color: '#FFD97D' } }, nombre), '！'
    ),
    html('div', { className: 'hanzi-font', style: { fontSize: 17, lineHeight: 1.6, marginBottom: 2 } },
      '今天是' + anio + '年' + (now.getMonth()+1) + '月' + diaNum + '日，' + diaSemana + '。'
    ),
    html('div', { className: 'hanzi-font', style: { fontSize: 17, lineHeight: 1.6, marginBottom: 12 } },
      '现在是' + periodo + horaStr + '。'
    ),
    html('div', { style: { borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 10, marginBottom: 10 } },
      html('div', { className: 'hanzi-font', style: { fontSize: 19, fontWeight: 700, marginBottom: 4 } }, '💬 ' + frase.zh),
      mostrarPinyin && html(TonedPinyin, { text: frase.py, mono: true, style: { fontSize: 14, color: '#fff', fontWeight: 700, fontStyle: 'italic', marginBottom: 4, display: 'block' } }),
      mostrarTrad && html('div', { style: { fontSize: 14, opacity: 0.9, marginBottom: 4 } }, '→ ' + frase.es),
    ),
    html('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      html('button', { onClick: () => setMostrarPinyin(p => !p), style: { fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: '1.5px solid rgba(255,255,255,0.5)', background: mostrarPinyin ? 'rgba(255,255,255,0.25)' : 'transparent', color: '#fff', cursor: 'pointer' } }, mostrarPinyin ? '🙈 Ocultar pīnyīn' : '👁 Ver pīnyīn'),
      html('button', { onClick: () => setMostrarTrad(t => !t), style: { fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: '1.5px solid rgba(255,255,255,0.5)', background: mostrarTrad ? 'rgba(255,255,255,0.25)' : 'transparent', color: '#fff', cursor: 'pointer' } }, mostrarTrad ? '🙈 Ocultar traducción' : '🌐 Ver traducción'),
      html('div', { style: { marginLeft: 'auto', fontSize: 11, opacity: 0.6, alignSelf: 'center' } }, diaNum + ' de ' + mes + ', ' + anio),
    )
  );
}

// ----------------- Home -----------------
const MODULES_LIST_DEFAULT = [
  { id: 'frase',     icon: '🧩', cls: 'clas',  title: 'Completá la frase',      sub: 'Elegí la palabra que falta en la frase clave',  active: true },
  { id: 'orden',     icon: '🔀', cls: 'orden', title: 'Ordená la oración',      sub: 'Las frases clave del libro, palabra por palabra', active: true },
  { id: 'audio',     icon: '🔊', cls: 'audio', title: 'Reconocer por audio',    sub: 'Escuchá el audio del libro y uní con el hanzi', active: true },
  { id: 'escritura', icon: '✍️', cls: 'clas',  title: 'Práctica de escritura',  sub: 'Escribí el hanzi desde cero · nivel progresivo', active: true },
];

function PracticaHub({ modulesList, pruebaProgress, onBack, onPrueba }) {
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('div', null,
        html('h1', null, 'Práctica'),
        html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } }, 'Actividades de gramática y vocabulario'),
      ),
    ),
    html('div', { style: { padding: '0 16px' } },
      html('div', { className: 'prueba-grid' },
        (modulesList || MODULES_LIST_DEFAULT)
          .filter(g => g.active !== false && !LESSON_THEMES['mod-' + g.id]?.hidden).map(g => {
          const best = pruebaProgress[g.id] || 0;
          const hasStar = best >= 80;
          return html('button', { key: g.id, className: 'prueba-card', onClick: () => onPrueba(g.id) },
            html('div', { className: 'prueba-icon ' + g.cls }, g.icon),
            html('div', { style: { flex: 1 } },
              html('div', { className: 'mode-title' }, g.title),
              html('div', { className: 'mode-sub' }, best > 0 ? '⭐ Mejor: ' + best + '%' : g.sub),
            ),
            hasStar && html('div', { style: { fontSize: 20 } }, '⭐'),
          );
        })
      ),
    ),
  );
}

// ── Mi progreso (alumno): se calcula en el dispositivo con su repaso y sus juegos ──
function lessonMasteryLocal(vocab, lesson, cardState, progress) {
  const words = vocab[lesson] || [];
  if (!words.length) return { mastery: 0, cardsPct: 0, gamesPct: 0, touched: false };
  let pts = 0, touched = false;
  words.forEach(w => { const st = cardState[cardKey(lesson, false, w.hanzi)]; if (st) { pts += Math.min(st.box, 3); touched = true; } });
  const lp = (progress.lessons || {})[lesson] || {};
  const games = ['match', 'cards', 'quiz'].filter(m => lp[m] != null).map(m => lp[m]);
  if (games.length) touched = true;
  const cardsPct = Math.min(pts / (3 * words.length), 1) * 100;
  const gamesPct = games.length ? games.reduce((a, b) => a + b, 0) / games.length : 0;
  return { mastery: Math.round(0.6 * cardsPct + 0.4 * gamesPct), cardsPct: Math.round(cardsPct), gamesPct: Math.round(gamesPct), touched };
}

function weakCards(vocab, lessons, cardState) {
  const out = [];
  lessons.forEach(l => (vocab[l] || []).forEach(w => {
    const st = cardState[cardKey(l, false, w.hanzi)];
    if (st && (st.lapses > 0 || (st.box === 0 && st.reviews > 0))) out.push({ ...w, _lesson: l, _lapses: st.lapses || 0, _box: st.box });
  }));
  const seen = new Set();
  return out.sort((a, b) => b._lapses - a._lapses || a._box - b._box).filter(w => !seen.has(w.hanzi) && seen.add(w.hanzi));
}

function MyProgress({ vocab, lessons, cardState, progress, streak, onBack, onPractice }) {
  const per = lessons.map(l => ({ lesson: l, name: (LESSON_THEMES[l] || {}).name || '', ...lessonMasteryLocal(vocab, l, cardState, progress) }));
  const touched = per.filter(p => p.touched);
  const learned = Object.entries(cardState).filter(([k, st]) => k.startsWith('w|') && st.box >= 3).length;
  const inProgress = Object.entries(cardState).filter(([k, st]) => k.startsWith('w|') && st.box > 0 && st.box < 3).length;
  const weak = weakCards(vocab, lessons, cardState);
  const overall = touched.length ? Math.round(touched.reduce((a, p) => a + p.mastery, 0) / touched.length) : 0;
  const strong = [...touched].sort((a, b) => b.mastery - a.mastery).filter(p => p.mastery >= 60).slice(0, 3);
  const toWork = [...touched].sort((a, b) => a.mastery - b.mastery).filter(p => p.mastery < 60).slice(0, 3);

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('div', null,
        html('h1', null, '📊 Mi progreso'),
        html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } }, 'En qué estás fuerte y qué conviene reforzar'),
      ),
    ),
    html('div', { style: { padding: '0 16px' } },
      html('div', { className: 'kpi-grid' },
        html(KpiCard, { icon: '🧠', value: overall + '%', label: 'dominio general', sub: touched.length ? 'en ' + touched.length + ' lecciones practicadas' : 'empezá una lección' }),
        html(KpiCard, { icon: '✅', value: learned, label: 'palabras aprendidas', sub: inProgress + ' en proceso' }),
        html(KpiCard, { icon: '⚠️', value: weak.length, label: 'para reforzar', tone: weak.length >= 8 ? 'warn' : '' }),
        html(KpiCard, { icon: '🔥', value: streak, label: 'días de racha' }),
      ),
      (strong.length > 0 || toWork.length > 0) && html('div', { className: 'progress-split' },
        html('div', { className: 'report-card' },
          html('div', { className: 'report-h' }, '💪 Tus lecciones fuertes'),
          strong.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todavía ninguna arriba de 60%. ¡Vas por buen camino!')
          : strong.map(p => html('div', { key: p.lesson, className: 'lesson-line' }, html('span', null, 'L' + p.lesson + ' · ' + p.name), html(MasteryPill, { value: p.mastery, small: true }))),
        ),
        html('div', { className: 'report-card' },
          html('div', { className: 'report-h' }, '🎯 Para reforzar'),
          toWork.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, '¡Todas tus lecciones practicadas están arriba de 60%! 👏')
          : toWork.map(p => html('div', { key: p.lesson, className: 'lesson-line' }, html('span', null, 'L' + p.lesson + ' · ' + p.name), html(MasteryPill, { value: p.mastery, small: true }))),
        ),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '⚠️ Palabras que más te cuestan'),
        weak.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'No tenés palabras con errores. Cuando marques "No lo sabía" en una tarjeta, aparece acá.')
        : html(React.Fragment, null,
            html('div', { className: 'word-chips' }, weak.slice(0, 12).map(w => html('div', { key: w._lesson + w.hanzi, className: 'word-chip-big', onClick: () => speak(w.hanzi) },
              html('div', { className: 'hanzi-font', style: { fontSize: 22, fontWeight: 700 } }, w.hanzi),
              html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--lacquer-dark)' } }, w.pinyin),
              html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 } }, (w.es || '').slice(0, 22)),
            ))),
            html('button', { className: 'primary-btn', onClick: onPractice, style: { marginTop: 12 } }, '💪 Practicar mis palabras difíciles'),
          ),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '📚 Dominio por lección'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Combina lo que fijaste con las tarjetas (60%) y tus resultados en los juegos (40%).'),
        per.map(p => html('div', { key: p.lesson, className: 'lesson-bar-row' },
          html('span', { className: 'lesson-bar-label' }, 'L' + p.lesson),
          html('div', { className: 'lesson-bar-track' }, html('div', { className: 'lesson-bar-fill', style: { width: p.mastery + '%', background: masteryColor(p.mastery).fg } })),
          html('span', { className: 'lesson-bar-val' }, p.touched ? p.mastery + '%' : '—'),
        )),
      ),
    ),
  );
}

// ── Palabras con audio del libro (para Tonos y Dictado) ──
function audioWords(vocab, lessons, filterFn) {
  const seen = new Set(), out = [];
  lessons.forEach(l => (vocab[l] || []).forEach(w => {
    if (seen.has(w.hanzi) || !NPCR_MEDIA.audio[w.hanzi.replace(MEDIA_PUNCT_RE, '')]) return;
    if (filterFn && !filterFn(w)) return;
    seen.add(w.hanzi); out.push({ ...w, _lesson: l });
  }));
  return out;
}

// Tarjeta de Tonos / Dictado: el hanzi en grande (o ？ si todavía no se revela)
// y un botón chiquito para repetir el audio. Al responder muestra pinyin y significado.
function ListenCard({ word, showHanzi, revealed, status, message }) {
  return html('div', { className: 'listen-card' + (status ? ' ' + status : '') },
    html('button', { type: 'button', className: 'listen-mini', title: 'Repetir audio', onClick: () => speak(word.hanzi) }, '🔊'),
    showHanzi
      ? html('div', { className: 'listen-hanzi hanzi-font' }, word.hanzi)
      : html('div', { className: 'sound-wave', 'aria-label': 'Escuchá con atención' }, [0, 1, 2, 3, 4, 5, 6].map(k => html('span', { key: k, style: { animationDelay: (k * 0.11) + 's' } }))),
    revealed
      ? html(React.Fragment, null,
          html(TonedPinyin, { text: word.pinyin, className: 'listen-pinyin' }),
          html('div', { className: 'listen-es' }, word.es),
          message && html('div', { className: 'listen-msg ' + (status || '') }, message),
        )
      : html('div', { className: 'listen-tap' }, showHanzi ? 'Tocá 🔊 para volver a escuchar' : 'Escuchá con atención · tocá 🔊 para repetir'),
  );
}

const TONE_NAMES = { 1: '1er tono ˉ', 2: '2do tono ˊ', 3: '3er tono ˇ', 4: '4to tono ˋ', 0: 'Neutro ·' };
const GAME_ROUND = 10;

// 🎵 Tonos: escuchá una palabra de una sílaba y elegí su tono
function ToneGame({ vocab, lessons, onBack, onFinish }) {
  const pool = useMemo(() => audioWords(vocab, lessons, w => [...w.hanzi].length === 1 && !/\s/.test(w.pinyin.trim())), []);
  const [qs, setQs] = useState(() => shuffle(pool).slice(0, GAME_ROUND));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [ok, setOk] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);
  const q = qs[i];
  const tone = q ? getTone(q.pinyin) : 0;
  useEffect(() => { if (q && !done) setTimeout(() => speak(q.hanzi), 250); }, [i, done]);

  if (!pool.length) return html(GameStatusScreen, { onBack, title: '🎵 Tonos', msg: 'Todavía no hay palabras disponibles para este ejercicio.' });
  if (done) return html(PruebaResult, {
    percent: Math.round(ok / qs.length * 100), total: qs.length, correct: ok, missed,
    onRetry: () => { setQs(shuffle(pool).slice(0, GAME_ROUND)); setI(0); setPicked(null); setOk(0); setMissed([]); setDone(false); }, onBack,
  });

  const pick = (t) => {
    if (picked !== null) return;
    setPicked(t);
    if (t === tone) setOk(o => o + 1);
    else { playWrong(); setMissed(m => [...m, { hanzi: q.hanzi, pinyin: q.pinyin, es: q.es }]); }
  };
  const next = () => {
    if (i + 1 >= qs.length) {
      const pct = Math.round(ok / qs.length * 100);
      onFinish && onFinish(pct, missed, qs.length);
      setDone(true);
    } else { setI(i + 1); setPicked(null); }
  };

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, '🎵 Tonos'),
      html('div', { className: 'flash-counter' }, (i + 1) + '/' + qs.length),
    ),
    html('div', { style: { padding: '0 16px', maxWidth: 520, margin: '0 auto' } },
      html('p', { style: { textAlign: 'center', fontWeight: 700, color: 'var(--ink-soft)', fontSize: 13 } }, 'Escuchá la palabra y elegí su tono'),
      html(ListenCard, {
        word: q, showHanzi: true, revealed: picked !== null,
        status: picked === null ? null : (picked === tone ? 'ok' : 'bad'),
        message: picked === null ? null : (picked === tone ? '¡Correcto! · ' + TONE_NAMES[tone] : 'Era el ' + TONE_NAMES[tone]),
      }),
      html('div', { className: 'tone-options' },
        [1, 2, 3, 4, 0].map(t => html('button', {
          key: t, onClick: () => pick(t),
          className: 'tone-btn' + (picked !== null && t === tone ? ' right' : '') + (picked === t && t !== tone ? ' wrong' : ''),
          style: { borderColor: TONE_COLORS[t], color: TONE_COLORS[t] },
        }, TONE_NAMES[t]))),
      picked !== null && html('button', { className: 'primary-btn', onClick: next, style: { marginTop: 14, width: '100%' } }, i + 1 >= qs.length ? 'Ver resultado' : 'Siguiente →'),
    ),
  );
}

// ✍️ Dictado: escuchá y escribí el pinyin (sin tildes)
// ✍️ Dictado 听写: suena la palabra (sin mostrar el hanzi) y el alumno la
// escribe en chino con el teclado de pinyin. Al comprobar aparece el hanzi.
const ZH_ONLY_RE = /[^\u3400-\u9fff\uf900-\ufaff]/g;
const DICTATION_KEYBOARD_HINT = '📱 Necesitás el teclado chino (pinyin) · iPhone: Ajustes → General → Teclado → Teclados → Chino simplificado · Android: Gboard → Idiomas → Chino (pinyin)';

function DictationGame({ vocab, lessons, onBack, onFinish }) {
  // Palabras de 1 a 4 caracteres, sin nombres propios (no se pueden adivinar de oído)
  const pool = useMemo(() => audioWords(vocab, lessons, w => {
    const n = w.hanzi.replace(ZH_ONLY_RE, '').length;
    return n >= 1 && n <= 4 && n === [...w.hanzi].length && !/\((estudiante|apellido|periodista|nombre|inmobiliaria|concierto)/.test(w.es || '');
  }), []);
  const [qs, setQs] = useState(() => shuffle(pool).slice(0, GAME_ROUND));
  const [i, setI] = useState(0);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(null); // 'ok' | 'bad'
  const [hint, setHint] = useState(false);
  const [ok, setOk] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);
  const inputRef = React.useRef(null);
  const composing = React.useRef(false); // el teclado chino usa Enter para elegir el carácter
  const q = qs[i];
  useEffect(() => { if (q && !done) { setTimeout(() => speak(q.hanzi), 250); inputRef.current && inputRef.current.focus(); } }, [i, done]);

  if (!pool.length) return html(GameStatusScreen, { onBack, title: '✍️ Dictado', msg: 'Todavía no hay palabras disponibles para este ejercicio.' });
  if (done) return html(PruebaResult, {
    percent: Math.round(ok / qs.length * 100), total: qs.length, correct: ok, missed,
    onRetry: () => { setQs(shuffle(pool).slice(0, GAME_ROUND)); setI(0); setInput(''); setChecked(null); setHint(false); setOk(0); setMissed([]); setDone(false); }, onBack,
  });

  const check = (e) => {
    e.preventDefault();
    if (composing.current) return;
    if (checked) { next(); return; }
    const typed = input.replace(ZH_ONLY_RE, '');
    if (!typed) return;
    const good = typed === q.hanzi.replace(ZH_ONLY_RE, '');
    setChecked(good ? 'ok' : 'bad');
    speak(q.hanzi);
    if (good) setOk(o => o + 1);
    else { playWrong(); setMissed(m => [...m, { hanzi: q.hanzi, pinyin: q.pinyin, es: q.es }]); }
  };
  const next = () => {
    if (i + 1 >= qs.length) {
      onFinish && onFinish(Math.round(ok / qs.length * 100), missed, qs.length);
      setDone(true);
    } else { setI(i + 1); setInput(''); setChecked(null); setHint(false); }
  };

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, '✍️ Dictado ', html('span', { className: 'hanzi-font', style: { color: 'var(--ink-soft)', fontWeight: 600 } }, '听写')),
      html('div', { className: 'flash-counter' }, (i + 1) + '/' + qs.length),
    ),
    html('form', { onSubmit: check, style: { padding: '0 16px', maxWidth: 520, margin: '0 auto' } },
      html('p', { style: { textAlign: 'center', fontWeight: 700, color: 'var(--ink-soft)', fontSize: 13 } }, 'Escuchá la palabra y escribila en chino'),
      html(ListenCard, {
        word: q, showHanzi: !!checked, revealed: !!checked, status: checked,
        message: checked === 'ok' ? '¡Correcto!' : checked === 'bad' ? 'Escribiste: ' + input : null,
      }),
      html('input', {
        ref: inputRef, value: input, disabled: !!checked, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, lang: 'zh-CN',
        placeholder: 'Escribí en chino (汉字)', onChange: e => setInput(e.target.value),
        onCompositionStart: () => { composing.current = true; },
        onCompositionEnd: () => { setTimeout(() => { composing.current = false; }, 0); },
        className: 'dictation-input hanzi-font' + (checked ? ' ' + checked : ''),
      }),
      !checked && html('button', { type: 'button', className: 'hint-link', onClick: () => setHint(true) },
        hint ? html(React.Fragment, null, '💡 Pinyin: ', html(TonedPinyin, { text: q.pinyin, style: { fontWeight: 800 } })) : '💡 Ver pista (pinyin)'),
      html('button', { type: 'submit', className: 'primary-btn', style: { marginTop: 14, width: '100%' } },
        !checked ? 'Comprobar' : i + 1 >= qs.length ? 'Ver resultado' : 'Siguiente →'),
      !checked && html('p', { className: 'keyboard-hint' }, DICTATION_KEYBOARD_HINT),
    ),
  );
}

const AULA_ICONS = {
  cap:      ['M22 10 12 5 2 10l10 5 10-5Z', 'M6 12v5c3 2 9 2 12 0v-5', 'M22 10v6'],
  target:   ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 12h.01'],
  check:    ['M20 6 9 17l-5-5'],
  chart:    ['M3 3v18h18', 'M8 16v-4', 'M13 16V8', 'M18 16v-7'],
  clipboard:['M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z', 'M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2', 'M9 12h6', 'M9 16h4'],
  layers:   ['M12 3 2 8l10 5 10-5-10-5Z', 'M2 13l10 5 10-5', 'M2 18l10 5 10-5'],
  star:     ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z'],
  music:    ['M9 18V5l11-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  pencil:   ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
};
const AULA_TONES = {
  red:    { bg: 'var(--lacquer-light)', fg: 'var(--lacquer)' },
  blue:   { bg: 'var(--blue-light)', fg: 'var(--blue-dark)' },
  gold:   { bg: 'var(--gold-light)', fg: 'var(--gold-dark)' },
  green:  { bg: 'var(--jade-light)', fg: 'var(--jade-dark)' },
  purple: { bg: 'var(--purple-light)', fg: 'var(--purple-dark)' },
  white:  { bg: 'rgba(255,255,255,0.22)', fg: '#fff' },
};
function AulaIcon({ name, tone = 'gold', size = 40 }) {
  const t = AULA_TONES[tone] || AULA_TONES.gold;
  return html('span', { className: 'aula-icon', style: { width: size, height: size, background: t.bg, color: t.fg } },
    html('svg', { viewBox: '0 0 24 24', width: size * 0.55, height: size * 0.55, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      (AULA_ICONS[name] || []).map((d, i) => html('path', { key: i, d }))));
}

function aulaActivities(settings, hardCount) {
  const weekly = (settings && settings.weekly_words) || [];
  return [
    { id: 'refuerzo-clase', icon: 'layers', tone: 'purple', title: 'Refuerzo de clase', sub: hardCount ? hardCount + ' palabras que le cuestan al grupo' : 'Todavía sin datos del grupo', disabled: !hardCount },
    weekly.length > 0 && { id: 'semana', icon: 'star', tone: 'gold', title: (settings && settings.weekly_title) || 'Palabras de la semana', sub: weekly.length + (weekly.length === 1 ? ' palabra elegida' : ' palabras elegidas') + ' por tu lǎoshī' },
    { id: 'tonos', icon: 'music', tone: 'green', title: 'Tonos', sub: 'Escuchá y elegí el tono' },
    { id: 'dictado', icon: 'pencil', tone: 'red', title: 'Dictado 听写', sub: 'Escuchá y escribí en chino' },
    { id: 'progreso', icon: 'chart', tone: 'blue', title: 'Mi progreso', sub: 'Fuertes y a reforzar' },
  ].filter(Boolean);
}

function ClassBox({ cls, dailyCount, dailyDone, assignments, settings, hardCount, onOpen, onTraining, onProgress, onActivity, staffClasses, onPreviewClass }) {
  const tasks = assignments || [];
  const pending = tasks.filter(t => !t.done);
  return html('div', { className: 'class-box' },
    html('div', { className: 'class-box-shine' }),
    cls.preview && html('div', { className: 'aula-preview-bar' },
      html('span', null, '👁 Vista de alumno'),
      html('select', { value: cls.class_id, onChange: e => onPreviewClass(e.target.value) },
        (staffClasses || []).map(c => html('option', { key: c.id, value: c.id }, c.name))),
      html('button', { onClick: () => onPreviewClass('none'), title: 'Ocultar' }, 'Ocultar')),
    html('div', { className: 'class-box-head', onClick: onOpen },
      html('div', { className: 'class-box-star' },
        html('svg', { viewBox: '0 0 24 24', width: 26, height: 26, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          AULA_ICONS.cap.map((d, i) => html('path', { key: i, d })))),
      html('div', { style: { flex: 1, minWidth: 0 } },
        html('div', { className: 'class-box-kicker' }, 'Mi aula'),
        html('div', { className: 'class-box-title' }, cls.class_name),
        html('div', { className: 'class-box-sub' }, 'Actividades exclusivas para ' + (cls.display_name || 'vos').split(' ')[0]),
      ),
      html('div', { className: 'class-box-badge', title: 'Aula' }, '课堂'),
    ),
    html('div', { className: 'class-box-actions' },
      html('button', { className: 'class-action' + (dailyDone ? ' done' : ''), onClick: onTraining },
        html(AulaIcon, { name: dailyDone ? 'check' : 'target', tone: dailyDone ? 'green' : 'red' }),
        html('span', null,
          html('div', { className: 'class-action-title' }, 'Entrenamiento diario'),
          html('div', { className: 'class-action-sub' }, dailyDone ? '¡Hecho hoy! Volvé mañana' : dailyCount ? dailyCount + ' tarjetas · unos 10 min' : 'Al día por hoy'),
        ),
      ),
      html('button', { className: 'class-action', onClick: onOpen },
        html(AulaIcon, { name: 'clipboard', tone: 'gold' }),
        html('span', null,
          html('div', { className: 'class-action-title' }, 'Tareas'),
          html('div', { className: 'class-action-sub' }, pending.length
            ? pending.length + ' pendiente' + (pending.length === 1 ? '' : 's') + (pending[0].due_date ? ' · hasta ' + new Date(pending[0].due_date + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '')
            : tasks.length ? '¡Todas completas!' : 'Sin tareas por ahora'),
        ),
      ),
      aulaActivities(settings, hardCount).map(a => html('button', {
        key: a.id, className: 'class-action' + (a.disabled ? ' disabled' : ''), disabled: a.disabled,
        onClick: () => a.id === 'progreso' ? onProgress() : onActivity(a.id),
      },
        html(AulaIcon, { name: a.icon, tone: a.tone }),
        html('span', null,
          html('div', { className: 'class-action-title' }, a.title),
          html('div', { className: 'class-action-sub' }, a.sub),
        ),
      )),
    ),
  );
}

const MODE_LABELS = { match: 'Emparejar', cards: 'Tarjetas', quiz: 'Opción múltiple', frases: 'Frases clave' };

function ClassHome({ cls, dailyCount, dailyDone, assignments, settings, hardCount, onTraining, onProgress, onActivity, onTarget, onBack }) {
  const tasks = assignments || [];
  const activities = aulaActivities(settings, hardCount);

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('div', null,
        html('h1', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, html(AulaIcon, { name: 'cap', tone: 'gold', size: 34 }), cls.class_name),
        html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } },
          'Tu aula' + (settings && settings.max_lesson ? ' · lecciones 1 a ' + settings.max_lesson : '')),
      ),
    ),
    html('div', { style: { padding: '0 16px' } },
      html('h2', { className: 'section-title' }, 'Hoy'),
      html('button', { className: 'class-training-card' + (dailyDone ? ' done' : ''), onClick: onTraining },
        html(AulaIcon, { name: dailyDone ? 'check' : 'target', tone: 'white', size: 52 }),
        html('div', { style: { flex: 1, textAlign: 'left' } },
          html('div', { style: { fontWeight: 800, fontSize: 17 } }, 'Entrenamiento diario'),
          html('div', { style: { fontSize: 13, opacity: 0.9, fontWeight: 600, marginTop: 3 } },
            dailyDone ? '¡Ya lo hiciste hoy! Si querés, podés repasar de nuevo.'
            : dailyCount ? dailyCount + ' tarjetas: primero las que más te cuestan, después palabras nuevas.'
            : 'No tenés tarjetas pendientes hoy. ¡Muy bien!'),
        ),
        html('div', { style: { fontSize: 22, fontWeight: 800 } }, '→'),
      ),

      html('h2', { className: 'section-title', style: { marginTop: 22 } }, 'Tareas de tu lǎoshī'),
      tasks.length === 0
        ? html('p', { className: 'admin-note' }, 'Tu lǎoshī todavía no asignó tareas. Cuando lo haga, van a aparecer acá.')
        : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            tasks.map(t => {
              const targets = t.targets || [];
              const doneSet = new Set(t.targets_done || []);
              return html('div', { key: t.id, className: 'class-task' + (t.done ? ' done' : '') },
                html('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  html('div', { style: { fontWeight: 800, fontSize: 15, flex: 1 } }, (t.done ? '✅ ' : '📋 ') + t.title),
                  targets.length > 0 && html('span', { className: 'task-count' + (t.done ? ' done' : '') }, doneSet.size + '/' + targets.length),
                ),
                t.description && html('div', { style: { fontSize: 13, marginTop: 4, color: 'var(--ink-soft)', fontWeight: 600 } }, t.description),
                targets.length > 0 && html('div', { className: 'task-targets' },
                  targets.map(tg => {
                    const [l, m] = tg.split(':');
                    const ok = doneSet.has(tg);
                    return html('button', { key: tg, className: 'task-target' + (ok ? ' ok' : ''), onClick: () => onTarget(l, m) },
                      (ok ? '✓ ' : '○ ') + 'L' + l + ' · ' + (MODE_LABELS[m] || m));
                  })),
                t.due_date && html('div', { style: { fontSize: 12, marginTop: 8, fontWeight: 800, color: t.done ? 'var(--jade-dark)' : 'var(--lacquer-dark)' } },
                  (t.done ? '¡Completada! · ' : '⏰ Hasta el ') + new Date(t.due_date + 'T12:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })),
                targets.length > 0 && !t.done && html('div', { style: { fontSize: 11, marginTop: 6, color: 'var(--ink-soft)', fontWeight: 700 } }, 'Cada ejercicio se marca solo cuando lo hacés con 70% o más.'),
              );
            })
          ),

      html('h2', { className: 'section-title', style: { marginTop: 22 } }, 'Actividades de la clase'),
      html('div', { className: 'vip-activity-grid' },
        activities.map(a => html('button', {
          key: a.id, className: 'vip-activity' + (a.disabled ? ' disabled' : ''), disabled: a.disabled,
          onClick: () => a.id === 'progreso' ? onProgress() : onActivity(a.id),
        },
          html(AulaIcon, { name: a.icon, tone: a.tone, size: 44 }),
          html('div', { className: 'vip-activity-title' }, a.title),
          html('div', { className: 'vip-activity-sub' }, a.sub),
        ))),
    ),
  );
}

function StudentCodeCard({ myClasses, onActivateCode, notice, onDismissNotice }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  if (myClasses === null) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!normalizeCode(code)) return;
    setBusy(true); setStatus(null);
    let res = await onActivateCode(code);
    if (res.needsSwitch) {
      const ok = window.confirm('El código de ' + res.info.display_name + ' ya está activado en otra cuenta.\n\n' +
        '¿Entrar con esa cuenta? Lo que practicaste en este dispositivo sin código no se transfiere.');
      res = ok ? await onActivateCode(code, { allowSwitch: true }) : { ok: false, msg: 'Cancelado.' };
    }
    setBusy(false);
    setStatus({ type: res.ok ? 'ok' : 'err', msg: res.msg });
    if (res.ok) { setCode(''); setOpen(false); }
  };

  const shown = status || notice;
  const inClass = myClasses.length > 0;
  const msg = shown && html('div', {
    style: { fontSize: 12, fontWeight: 700, marginTop: 6, color: shown.type === 'ok' ? 'var(--jade-dark)' : 'var(--lacquer-dark)', cursor: 'pointer' },
    onClick: () => { setStatus(null); onDismissNotice && onDismissNotice(); },
  }, shown.msg);

  if (inClass && !shown) return null;
  return html('div', { style: { marginBottom: 14 } },
    !inClass && html('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      !open && html('button', {
        onClick: () => setOpen(true),
        style: { background: 'none', border: '1.5px dashed var(--paper-deep)', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', cursor: 'pointer' },
      }, '🎓 Tengo código de alumno'),
    ),
    !inClass && open && html('form', { onSubmit: submit, style: { display: 'flex', gap: 8, marginTop: 8 } },
      html('input', {
        value: code, maxLength: 14, placeholder: 'MARTA-K7P2', autoFocus: true, autoComplete: 'off', spellCheck: false,
        onChange: e => setCode(e.target.value.toUpperCase()),
        style: { flex: 1, padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--paper-deep)', fontSize: 15, fontWeight: 800, letterSpacing: 1.5, minWidth: 0 },
      }),
      html('button', { className: 'primary-btn', type: 'submit', disabled: busy || !normalizeCode(code), style: { margin: 0, padding: '9px 16px', width: 'auto' } }, busy ? '…' : 'Activar'),
      html('button', { type: 'button', className: 'secondary-btn', onClick: () => { setOpen(false); setStatus(null); }, style: { margin: 0, padding: '9px 12px', width: 'auto' } }, '✕'),
    ),
    msg,
  );
}

function NameRequired({ onSave }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!validStudentName(name)) { setErr('Escribí tu nombre real (al menos 2 letras).'); return; }
    setBusy(true); await onSave(name); setBusy(false);
  };
  return html('div', { className: 'name-modal-overlay' },
    html('div', { className: 'name-modal' },
      html('div', { className: 'name-modal-hanzi hanzi-font' }, '你好！'),
      html('h2', { className: 'name-modal-title' }, '¿Cómo te llamás?'),
      html('p', { className: 'name-modal-sub' }, 'Para seguir, escribí tu nombre. Así tu lǎoshī sabe quién sos.'),
      html('form', { onSubmit: submit },
        html('input', { className: 'name-modal-input', value: name, autoFocus: true, maxLength: 40, placeholder: 'Tu nombre', onChange: e => { setName(e.target.value); setErr(''); } }),
        err && html('div', { className: 'admin-status err', style: { marginTop: 8 } }, err),
        html('button', { type: 'submit', className: 'primary-btn', style: { width: '100%', marginTop: 12 }, disabled: busy }, busy ? 'Guardando…' : 'Continuar'),
      ),
    ),
  );
}

function Home({ vocab, lessons, progress, totalWords, totalStars, onSelectLesson, onAdmin, onPrueba, pruebaProgress, onDownload, onRefuerzo, playerName, onChangeName, streak, assignments, myClasses, onActivateCode, codeNotice, onDismissNotice, modulesList, dailyCount, dailyDone, onOpenClass, onTraining, onProgress, maxLesson, classSettings, hardCount, onActivity, staffClasses, onPreviewClass }) {
  const regularCount = lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros').length;
  return html(React.Fragment, null,
    playerName && html('div', { className: 'greeting-bar' },
      html('span', null, '👋 ¡Hola, ', html('strong', null, playerName), '!'),
      html('button', { className: 'change-name-btn', onClick: onChangeName, title: 'Cerrar sesión' }, '🚪'),
    ),
    html('main', null,
      html('div', { className: 'score-strip' },
        html('div', { className: 'score-chip' },
          html('div', { className: 'num' }, totalWords),
          html('div', { className: 'lbl' }, 'palabras')
        ),
        html('div', { className: 'score-chip' },
          html('div', { className: 'num' }, regularCount),
          html('div', { className: 'lbl' }, 'lecciones')
        ),
        html('div', { className: 'score-chip' },
          html('div', { className: 'num' }, totalStars + '/' + (regularCount * 3)),
          html('div', { className: 'lbl' }, 'estrellas')
        ),
      ),

      html(PanelLectura, { playerName }),

      myClasses && myClasses.length > 0 && html(ClassBox, { cls: myClasses[0], dailyCount, dailyDone, assignments, settings: classSettings, hardCount, onOpen: onOpenClass, onTraining, onProgress, onActivity, staffClasses, onPreviewClass }),
      (!myClasses || !myClasses.length) && staffClasses && staffClasses.length > 0 && html('button', { className: 'aula-preview-show', onClick: () => onPreviewClass('') }, '👁 Ver "Mi aula" como alumno'),

      streak > 0 && html('div', { style: {
        background: 'linear-gradient(135deg,#E09A2B,#C07818)', borderRadius: 14,
        padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12,
      } },
        html('span', { style: { fontSize: 24 } }, '🔥'),
        html('div', null,
          html('div', { style: { fontWeight: 800, fontSize: 15, color: '#fff' } },
            streak + ' día' + (streak === 1 ? '' : 's') + ' seguido' + (streak === 1 ? '' : 's')
          ),
          html('div', { style: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600 } },
            '¡Seguí practicando para mantener la racha!'
          ),
        ),
      ),

      html(StudentCodeCard, { myClasses, onActivateCode, notice: codeNotice, onDismissNotice }),

      html('h2', { className: 'section-title' }, 'Elegí una lección'),
      html('div', { className: 'lesson-grid' },
        lessons.filter(id => id !== 'mod-paises' && id !== 'mod-numeros' && !LESSON_THEMES[id]?.hidden).map(id => {
          const words = vocab[id];
          const theme = LESSON_THEMES[id] || { name: 'Lección ' + id, icon: words[0]?.hanzi?.[0] || '汉' };
          const lp = progress.lessons[id] || {};
          const best = Math.round(((lp.match || 0) + (lp.cards || 0) + (lp.quiz || 0)) / 3);
          const stars = [lp.match || 0, lp.cards || 0, lp.quiz || 0].filter(v => v >= 80).length;
          const locked = maxLesson != null && parseFloat(id) > maxLesson;
          return html('button', {
            key: id,
            className: 'lesson-card' + (locked ? ' locked' : ''),
            onClick: () => onSelectLesson(id),
          },
            locked && html('div', { className: 'lock-badge' }, '🔒'),
            !locked && stars > 0 && html('div', { className: 'seal hanzi-font' }, stars === 3 ? '✓' : stars),
            html('div', { className: 'hanzi-big hanzi-font' }, theme.icon),
            html('div', { className: 'lesson-name' }, 'Lección ' + id),
            html('div', { className: 'lesson-meta' }, theme.name + ' · ' + words.length + ' palabras'),
            html('div', { className: 'progress-track' },
              html('div', { className: 'progress-fill', style: { width: best + '%' } })
            ),
          );
        })
      ),

      // ── Módulos especiales ──
      vocab['mod-paises'] && !LESSON_THEMES['mod-paises']?.hidden && html(React.Fragment, null,
        html('h2', { className: 'section-title' }, 'Aprende los países'),
        html('button', {
          style: {
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', marginBottom: 14,
            background: '#fff', border: '2px solid var(--paper-deep)', borderRadius: 'var(--radius)',
            padding: '14px 18px', cursor: 'pointer', textAlign: 'left',
            boxShadow: 'var(--shadow-paper)',
          },
          onClick: () => onSelectLesson('mod-paises'),
        },
          html('div', { className: 'hanzi-font', style: { fontSize: 36, color: 'var(--lacquer)', minWidth: 44 } }, '国'),
          html('div', null,
            html('div', { style: { fontWeight: 800, fontSize: 15, color: 'var(--ink)' } }, 'Nombres de países en chino'),
            html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } },
              (vocab['mod-paises'] ? vocab['mod-paises'].length : 0) + ' países · Latinoamérica, Europa, Asia'
            ),
          ),
        ),
      ),

      vocab['mod-numeros'] && !LESSON_THEMES['mod-numeros']?.hidden && html(React.Fragment, null,
        html('h2', { className: 'section-title' }, 'Aprende los números'),
        html('button', {
          style: {
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', marginBottom: 14,
            background: '#fff', border: '2px solid var(--paper-deep)', borderRadius: 'var(--radius)',
            padding: '14px 18px', cursor: 'pointer', textAlign: 'left',
            boxShadow: 'var(--shadow-paper)',
          },
          onClick: () => onSelectLesson('mod-numeros'),
        },
          html('div', { className: 'hanzi-font', style: { fontSize: 36, color: 'var(--lacquer)', minWidth: 44 } }, '数'),
          html('div', null,
            html('div', { style: { fontWeight: 800, fontSize: 15, color: 'var(--ink)' } }, 'Del 0 al 100 en chino'),
            html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } }, '0 al 10 · decenas del 20 al 100'),
          ),
        ),
      ),
      html('h2', { className: 'section-title' }, '¿Cuánto aprendiste?'),
      html('div', { className: 'prueba-grid' },
        (modulesList || MODULES_LIST_DEFAULT)
          .filter(g => g.active !== false && !LESSON_THEMES['mod-' + g.id]?.hidden).map(g => {
          const best = pruebaProgress[g.id] || 0;
          const hasStar = best >= 80;
          return html('button', { key: g.id, className: 'prueba-card', onClick: () => onPrueba(g.id) },
            html('div', { className: 'prueba-icon ' + g.cls }, g.icon),
            html('div', { style: { flex: 1 } },
              html('div', { className: 'mode-title' }, g.title),
              html('div', { className: 'mode-sub' }, best > 0 ? '⭐ Mejor: ' + best + '%' : g.sub),
            ),
            hasStar && html('div', { style: { fontSize: 20 } }, '⭐'),
          );
        })
      ),
      html('button', {
        className: 'download-resumen-btn',
        onClick: onDownload,
      },
        html('span', { style: { fontSize: 22 } }, '📥'),
        html('span', null,
          html('div', { style: { fontWeight: 800, fontSize: 15 } }, 'Descargar mi resumen de repaso'),
          html('div', { style: { fontSize: 12, opacity: 0.75, fontWeight: 600 } }, 'Aciertos, errores y palabras para repasar'),
        ),
      ),
      !LESSON_THEMES['mod-refuerzo']?.hidden && html('h2', { className: 'section-title' }, 'Reforcemos'),
      !LESSON_THEMES['mod-refuerzo']?.hidden && html('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: 14,
          width: '100%', marginTop: 0, marginBottom: 12,
          background: 'linear-gradient(135deg, var(--lacquer) 0%, var(--lacquer-dark) 100%)',
          color: '#fff', border: 'none', borderRadius: 'var(--radius)',
          padding: '16px 20px', cursor: 'pointer', textAlign: 'left',
          boxShadow: '0 4px 16px rgba(193,67,43,0.28)',
        },
        onClick: onRefuerzo,
      },
        html('span', { style: { fontSize: 22 } }, '💪'),
        html('span', null,
          html('div', { style: { fontWeight: 800, fontSize: 15 } }, 'Práctica personalizada'),
          html('div', { style: { fontSize: 12, opacity: 0.8, fontWeight: 600, marginTop: 2 } }, 'Ejercicios con tus palabras para reforzar'),
        ),
      ),
    )
  );
}

// ----------------- Números: tabla interactiva -----------------
function NumbersIntro({ words, onBack, onPlay }) {
  const [active, setActive] = useState(null);

  const playNum = (w) => {
    setActive(w.hanzi);
    speak(w.hanzi);
    setTimeout(() => setActive(null), 1200);
  };

  const singles = words.filter(w => ['零','一','二','三','四','五','六','七','八','九','十'].includes(w.hanzi));
  const tens    = words.filter(w => w.hanzi.length > 1 && w.es.includes('·'));

  const NumCard = ({ w }) => html('button', {
    key: w.hanzi,
    onClick: () => playNum(w),
    style: {
      background: active === w.hanzi ? 'var(--lacquer)' : '#fff',
      border: '2px solid ' + (active === w.hanzi ? 'var(--lacquer)' : 'var(--paper-deep)'),
      borderRadius: 14, padding: '10px 6px', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      transition: 'all 0.15s',
    }
  },
    html('div', { className: 'hanzi-font', style: { fontSize: 32, color: active === w.hanzi ? '#fff' : 'var(--lacquer)', lineHeight: 1 } }, w.hanzi),
    html('div', { style: { fontSize: 11, fontWeight: 800, color: active === w.hanzi ? 'rgba(255,255,255,0.85)' : 'var(--lacquer-dark)', letterSpacing: 0.5 } }, w.pinyin),
    html('div', { style: { fontSize: 10, color: active === w.hanzi ? 'rgba(255,255,255,0.75)' : 'var(--ink-soft)', fontWeight: 600 } }, w.es.split('·')[0].trim()),
  );

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Los números'),
        html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 } }, 'Tocá para escuchar'),
      ),
      html('div', { style: { padding: '0 16px' } },

        html('p', { className: 'admin-note', style: { marginBottom: 12, textAlign: 'center' } }, '🔊 Tocá cada número para escuchar cómo suena'),

        html('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 } },
          singles.map(w => html(NumCard, { key: w.hanzi, w }))
        ),

        html('div', { style: { background: 'var(--jade-light)', borderRadius: 14, padding: '14px 16px', marginBottom: 20 } },
          html('div', { style: { fontWeight: 800, fontSize: 13, color: 'var(--jade-dark)', marginBottom: 8 } }, '💡 ¿Cómo se forman las decenas?'),
          html('div', { style: { fontSize: 13, color: 'var(--jade-dark)', lineHeight: 1.7 } },
            '二 + 十 = 二十 (20) · tres dieces = tres dieces', html('br', null),
            'El patrón es: ', html('strong', null, '[número] + 十'), ' para las decenas.',  html('br', null),
            'Ejemplo: 七十 = qīshí = 70 (siete + diez)',
          ),
        ),

        html('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 } },
          tens.map(w => html(NumCard, { key: w.hanzi, w }))
        ),

        html('button', { className: 'primary-btn', onClick: onPlay }, '¡Listo! Ir a practicar →'),
      ),
    )
  );
}

// ----------------- Lesson menu -----------------
function srsSub(words, lessonId, sentenceMode, cardState, fallback) {
  const st = deckStats(words, lessonId, sentenceMode, cardState || {});
  if (st.fresh === words.length) return fallback;
  const today = st.due + st.fresh;
  if (today === 0) return '✓ Al día' + (st.nextDue ? ' · próximo repaso ' + formatNextDue(st.nextDue) : '');
  return '📅 ' + today + ' para hoy' + (st.fresh ? ' (' + st.fresh + ' nuevas)' : '') + (st.learned ? ' · ' + st.learned + ' aprendidas' : '');
}

function LessonMenu({ vocab, sentences, lessonId, progress, cardState, onBack, onSelectMode, onWorkbookListen, onWorkbookStroke }) {
  const theme = LESSON_THEMES[lessonId] || { name: 'Lección ' + lessonId };
  const lp = progress.lessons[lessonId] || {};
  const hasWorkbook = false;

  const modes = [
    { id: 'match', emoji: '🔗', title: 'Emparejar', sub: 'Une carácter, pinyin y significado', cls: 'match', best: lp.match },
    { id: 'cards', emoji: '🀄', title: 'Tarjetas', sub: srsSub(vocab[lessonId] || [], lessonId, false, cardState, 'Repasá carácter por carácter'), cls: 'cards', best: lp.cards },
    { id: 'quiz', emoji: '✅', title: 'Opción múltiple', sub: 'Elegí el significado correcto', cls: 'quiz', best: lp.quiz },
  ];
  const sentenceCount = ((sentences || {})[lessonId] || []).length;
  if (sentenceCount) modes.push({ id: 'frases', emoji: '💬', title: 'Frases clave', sub: srsSub(sentences[lessonId], lessonId, true, cardState, sentenceCount + ' frases del libro con audio'), cls: 'cards', best: lp.frases });

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, (lessonId === 'mod-paises' || lessonId === 'mod-numeros') ? theme.name : 'Lección ' + lessonId + ' · ' + theme.name),
      ),
      html('div', { className: 'mode-list' },
        lessonId === 'mod-numeros' && html('button', { className: 'mode-card', onClick: () => onSelectMode('intro') },
          html('div', { className: 'mode-emoji', style: { background: '#FFF3C4', fontSize: 22 } }, '📊'),
          html('div', null,
            html('div', { className: 'mode-title' }, 'Explorar los números'),
            html('div', { className: 'mode-sub' }, 'Tabla interactiva con audio · toca para escuchar'),
          )
        ),
        modes.map(m => html('button', { key: m.id, className: 'mode-card', onClick: () => onSelectMode(m.id) },
          html('div', { className: 'mode-emoji ' + m.cls }, m.emoji),
          html('div', { style: { flex: 1 } },
            html('div', { className: 'mode-title' }, m.title),
            html('div', { className: 'mode-sub' }, m.sub),
            m.best ? html('div', { className: 'mode-stats-row' },
              html('span', { className: 'mode-stat-pct' }, m.best + '% completado'),
              html('span', { className: 'mode-stat-ok' }, '✓ ' + m.best + '%'),
              html('span', { className: 'mode-stat-err' }, '✕ ' + (100 - m.best) + '%'),
            ) : null,
          )
        ))
      ),
      hasWorkbook && html(React.Fragment, null,
        html('h2', { className: 'section-title', style: { marginTop: 20 } }, '📘 Libro de Ejercicios'),
        html('div', { className: 'mode-list' },
          html('button', { className: 'mode-card', onClick: onWorkbookListen },
            html('div', { className: 'mode-emoji', style: { background: '#DCEEE9', fontSize: 22 } }, '🎧'),
            html('div', null,
              html('div', { className: 'mode-title' }, 'Discriminación auditiva'),
              html('div', { className: 'mode-sub' }, 'Sonido y tono, con el audio real del libro'),
            )
          ),
          html('button', { className: 'mode-card', onClick: onWorkbookStroke },
            html('div', { className: 'mode-emoji', style: { background: '#F6E2B0', fontSize: 22 } }, '✍️'),
            html('div', null,
              html('div', { className: 'mode-title' }, 'Trazo de caracteres'),
              html('div', { className: 'mode-sub' }, 'Practicá el orden de trazos como en el libro'),
            )
          ),
        )
      )
    )
  );
}

// ----------------- Play screen router -----------------
function PlayScreen({ vocab, sentences, lessonId, mode, cardState, onRecordCard, onBack, onHome, onFinish, nextAction, savedResult, onSaveResult, onClearResult }) {
  const words = vocab[lessonId];
  // Tarjetas: siempre arrancan con el mazo del día (no se restaura el resultado anterior)
  const fresh = { savedResult: null, onSaveResult: () => {}, onClearResult: () => {} };
  if (mode === 'frases') return html(FlashcardGame, { words: sentences[lessonId] || [], sentenceMode: true, lessonId, cardState, onRecordCard, onBack, onHome, onFinish, nextAction, ...fresh });
  const extra = { savedResult, onSaveResult, onClearResult };
  if (mode === 'intro') return html(NumbersIntro, { words, onBack, onPlay: onBack });
  if (mode === 'match') return html(MatchGame, { words, lessonId, onBack, onHome, onFinish, nextAction, ...extra });
  if (mode === 'cards') return html(FlashcardGame, { words, lessonId, cardState, onRecordCard, onBack, onHome, onFinish, nextAction, ...fresh });
  if (mode === 'quiz') return html(QuizGame, { words, lessonId, onBack, onHome, onFinish, nextAction, ...extra });
  return null;
}

// ----------------- Matching game -----------------
const ROUND_SIZE = 6;

function buildMatchRound(words) {
  const picked = shuffle(words).slice(0, Math.min(ROUND_SIZE, words.length));
  const left = picked.map((w, i) => ({ id: i + '-h', pairId: i, kind: 'hanzi', text: w.hanzi, es: w.es }));
  const right = picked.map((w, i) => ({ id: i + '-p', pairId: i, kind: 'pinyin', text: w.pinyin, es: w.es }));
  return { left: shuffle(left), right: shuffle(right) };
}

function MatchGame({ words, lessonId, onBack, onHome, onFinish, nextAction, savedResult, onSaveResult, onClearResult }) {
  const [columns, setColumns] = useState(() => buildMatchRound(words));
  const [selected, setSelected] = useState(null);
  const [wrongPair, setWrongPair] = useState(null);
  const [matchedPairs, setMatchedPairs] = useState(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [missedWords, setMissedWords] = useState(() => (savedResult ? savedResult.reviewWords || [] : []));
  const [done, setDone] = useState(!!savedResult);

  const totalPairs = columns.left.length;

  const handleTap = (tile) => {
    if (matchedPairs.has(tile.pairId) || wrongPair) return;
    // Al tocar un hanzi suena su audio (el pinyin no, para no emparejar "de oído")
    if (tile.kind === 'hanzi') speak(tile.text);
    if (!selected) {
      setSelected(tile);
      return;
    }
    if (selected.id === tile.id) {
      setSelected(null);
      return;
    }
    if (selected.kind === tile.kind) {
      // Misma columna: simplemente cambia la selección
      setSelected(tile);
      return;
    }
    if (selected.pairId === tile.pairId) {
      playCorrect();
      const newMatched = new Set(matchedPairs);
      newMatched.add(tile.pairId);
      setMatchedPairs(newMatched);
      setSelected(null);
      if (newMatched.size === totalPairs) {
        const percent = Math.round((totalPairs / (totalPairs + mistakes)) * 100);
        setTimeout(() => {
          setDone(true);
          onFinish(percent, missedWords);
          onSaveResult({ percent, completed: mistakes === 0, reviewWords: missedWords });
        }, 400);
      }
    } else {
      const newMistakes = mistakes + 1;
      setMistakes(newMistakes);
      // Record the word that was missed (from the selected tile's pairId)
      const missedWord = words.find(w => w.hanzi === selected.pairId || w.pinyin === selected.pairId || (selected.kind === 'hanzi' ? selected.text === w.hanzi : selected.text === w.pinyin));
      if (missedWord && !missedWords.find(m => m.hanzi === missedWord.hanzi)) {
        setMissedWords(prev => [...prev, missedWord]);
      }
      playWrong();
      setWrongPair([selected.id, tile.id]);
      setTimeout(() => {
        setWrongPair(null);
        setSelected(null);
      }, 500);
    }
  };

  if (done) {
    const percent = savedResult ? savedResult.percent : Math.round((totalPairs / (totalPairs + mistakes)) * 100);
    const completed = savedResult ? savedResult.completed : mistakes === 0;
    const shownReview = savedResult ? (savedResult.reviewWords || []) : missedWords;
    return html(ResultScreen, {
      percent, lessonId, mode: 'match',
      completed,
      reviewWords: shownReview,
      onRetry: () => {
        setColumns(buildMatchRound(words));
        setSelected(null);
        setWrongPair(null);
        setMatchedPairs(new Set());
        setMistakes(0);
        setMissedWords([]);
        setDone(false);
        onClearResult();
      },
      onHome,
      nextAction,
    });
  }

  const renderTile = (tile) => {
    const isMatched = matchedPairs.has(tile.pairId);
    const isSelected = selected && selected.id === tile.id;
    const isWrong = wrongPair && wrongPair.includes(tile.id);
    let cls = 'match-tile ' + (tile.kind === 'hanzi' ? 'hanzi hanzi-font' : 'text pinyin');
    if (isMatched) cls += ' correct matched-hidden';
    else if (isWrong) cls += ' wrong';
    else if (isSelected) cls += ' selected';
    return html('button', {
      key: tile.id, className: cls,
      onClick: () => handleTap(tile),
      disabled: isMatched,
    },
      tile.kind === 'pinyin'
        ? html(React.Fragment, null, html(TonedPinyin, { text: tile.text }), html('span', { className: 'es-tooltip' }, tile.es))
        : tile.text
    );
  };

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Emparejar'),
        html('button', { className: 'back-btn', onClick: onHome, title: 'Ir al inicio' }, '⌂'),
      ),
      html('div', { className: 'match-progress-row' },
        html('div', { className: 'match-progress-track' },
          html('div', { className: 'match-progress-fill', style: { width: (matchedPairs.size / totalPairs * 100) + '%' } })
        ),
        html('div', { className: 'match-counter' }, matchedPairs.size + '/' + totalPairs)
      ),
      html('p', { className: 'admin-note', style: { textAlign: 'center', marginBottom: 14 } }, 'Pasá el mouse sobre el pinyin para ver el significado'),
      html('div', { className: 'match-columns' },
        html('div', { className: 'match-column' }, columns.left.map(renderTile)),
        html('div', { className: 'match-column' }, columns.right.map(renderTile)),
      )
    )
  );
}

// ----------------- Flashcards -----------------
// Orden de trazos animado (SVG de Make Me a Hanzi incluidos en el mazo NPCR).
// Tocar un carácter reinicia la animación.
function StrokeOrder({ hanzi }) {
  const [runs, setRuns] = useState({});
  const chars = [...(hanzi || '')].filter(ch => NPCR_MEDIA.svg[ch]);
  if (!chars.length) return null;
  return html('div', { className: 'stroke-row' },
    chars.map((ch, i) => html('img', {
      key: ch + i + ':' + (runs[i] || 0),
      className: 'stroke-svg',
      src: NPCR_MEDIA.svg[ch] + (runs[i] ? '?r=' + runs[i] : ''),
      alt: 'Orden de trazos de ' + ch,
      title: 'Tocá para repetir',
      onClick: (e) => { e.stopPropagation(); setRuns(r => ({ ...r, [i]: (r[i] || 0) + 1 })); },
    }))
  );
}

// Tarjetas con repetición dentro de la sesión (estilo Anki):
//   No lo sabía → vuelve pronto · Con dudas → vuelve más adelante · Lo sabía → sale del mazo.
// La sesión termina cuando todas quedaron en "Lo sabía". El puntaje cuenta solo los
// aciertos al primer intento; las que tuvieron "no" o "dudas" van a repaso (Refuerzo).
const FLASH_REQUEUE = { no: 2, maybe: 5 }; // cuántas tarjetas después vuelve a aparecer

// ── Repaso espaciado entre sesiones (cajas de Leitner) ──
// Se actualiza con la PRIMERA respuesta de cada tarjeta en la sesión:
//   Lo sabía → sube una caja · Con dudas → baja una (mínimo 1) · No lo sabía → caja 0.
// Caja 0 = vuelve la próxima vez; las demás esperan SRS_DAYS[caja] días.
const SRS_DAYS = [0, 1, 3, 7, 16, 35];
const SRS_STORAGE_KEY = 'npcr-card-state-v1';
const DAY_MS = 86400000;

function cardKey(lessonId, sentenceMode, hanzi) {
  return (sentenceMode ? 's|' : 'w|') + lessonId + '|' + hanzi;
}

function srsNext(prev, kind, now) {
  const box0 = prev ? prev.box : 0;
  const box = kind === 'yes' ? Math.min(box0 + 1, SRS_DAYS.length - 1)
            : kind === 'maybe' ? Math.max(box0 - 1, 1)
            : 0;
  return {
    box,
    due_at: new Date(now + SRS_DAYS[box] * DAY_MS).toISOString(),
    reviews: (prev ? prev.reviews : 0) + 1,
    lapses: (prev ? prev.lapses : 0) + (kind === 'no' ? 1 : 0),
    updated_at: new Date(now).toISOString(),
  };
}

function isDue(st, now) {
  return !st || new Date(st.due_at).getTime() <= now;
}

// Tarjetas que tocan hoy: primero las más difíciles (caja baja), después las nuevas.
function buildDueDeck(words, lessonId, sentenceMode, cardState) {
  const now = Date.now();
  const due = shuffle(words.filter(w => isDue(cardState[cardKey(lessonId, sentenceMode, w.hanzi)], now)));
  const rank = (w) => { const st = cardState[cardKey(lessonId, sentenceMode, w.hanzi)]; return st ? st.box : 99; };
  return due.sort((a, b) => rank(a) - rank(b));
}

function deckStats(words, lessonId, sentenceMode, cardState) {
  const now = Date.now();
  let due = 0, fresh = 0, learned = 0, nextDue = null;
  words.forEach(w => {
    const st = cardState[cardKey(lessonId, sentenceMode, w.hanzi)];
    if (!st) { fresh++; return; }
    if (isDue(st, now)) due++;
    else {
      if (st.box >= 3) learned++;
      const t = new Date(st.due_at).getTime();
      if (nextDue === null || t < nextDue) nextDue = t;
    }
  });
  return { due, fresh, learned, nextDue };
}

// ── Entrenamiento diario (alumnos de una clase) ──
// Hasta DAILY_MAX tarjetas: primero las que tocan hoy (las más difíciles),
// y se completa con hasta DAILY_NEW palabras nuevas en orden de lección.
const DAILY_MAX = 15;
const DAILY_NEW = 5;

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function buildDailyDeck(vocab, lessons, cardState) {
  const now = Date.now();
  const seen = new Set();
  const due = [], fresh = [];
  lessons.forEach(l => (vocab[l] || []).forEach(w => {
    if (seen.has(w.hanzi)) return; // mismo hanzi en dos lecciones: una sola tarjeta
    seen.add(w.hanzi);
    const st = cardState[cardKey(l, false, w.hanzi)];
    const card = { ...w, _lesson: l };
    if (!st) fresh.push(card);
    else if (isDue(st, now)) due.push({ card, box: st.box });
  }));
  due.sort((a, b) => a.box - b.box);
  const reviews = shuffle(due.slice(0, DAILY_MAX).map(d => d.card));
  const news = fresh.slice(0, Math.max(0, Math.min(DAILY_NEW, DAILY_MAX - reviews.length)));
  return [...reviews, ...news];
}

function formatNextDue(t) {
  const days = Math.ceil((t - Date.now()) / DAY_MS);
  if (days <= 1) return 'mañana';
  return 'en ' + days + ' días';
}

// Frase en contexto: las escritas para esa palabra más las del libro que la usan
// (sin ser la palabra sola), con preferencia por su misma lección.
function findContextSentence(word, lesson) {
  const w = (word.hanzi || '').replace(ZH_ONLY_RE, '');
  if (!w) return null;
  const own = WORD_SENTENCES.filter(s => s.word === word.hanzi && s.hanzi.includes(w));
  const hits = own.concat(CONTEXT_SENTENCES.filter(s => s.hanzi.includes(w) && s.hanzi.replace(ZH_ONLY_RE, '') !== w));
  if (!hits.length) return null;
  const same = hits.filter(s => String(s.lesson) === String(lesson));
  const pool = same.length ? same : hits;
  return pool[Math.floor(Math.random() * pool.length)];
}
function clozeOptions(word, allWords) {
  const w = word.hanzi.replace(ZH_ONLY_RE, '');
  const others = shuffle([...new Set(allWords.map(x => x.hanzi.replace(ZH_ONLY_RE, '')))].filter(h => h && h !== w));
  const sameLen = others.filter(h => h.length === w.length);
  const pick = [...sameLen, ...others.filter(h => h.length !== w.length)].slice(0, 3);
  return shuffle([w, ...pick]);
}

// 🗣 Completá la frase: aparece la frase con un hueco donde va la palabra,
// suena el audio (dictado) y el alumno escribe la palabra que falta.
function ClozeStep({ word, sentence, options, onDone }) {
  const target = word.hanzi.replace(ZH_ONLY_RE, '');
  // realOnly (HSK 1): solo audio grabado, nunca voz sintética
  const sayS = () => sentence.realOnly ? speakReal(sentence.hanzi) : speak(sentence.hanzi);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(null);
  const [showOpts, setShowOpts] = useState(false);
  const inputRef = React.useRef(null);
  const composing = React.useRef(false);
  useEffect(() => { setTimeout(() => sayS(), 250); inputRef.current && inputRef.current.focus(); }, []);
  const idx = sentence.hanzi.indexOf(target);
  const before = sentence.hanzi.slice(0, idx), after = sentence.hanzi.slice(idx + target.length);
  const resolve = (typed) => {
    if (checked) return;
    const good = typed.replace(ZH_ONLY_RE, '') === target;
    setChecked(good ? 'ok' : 'bad');
    if (!good) playWrong();
    sayS();
  };
  const submit = (e) => {
    e.preventDefault();
    if (composing.current) return;
    if (checked) { onDone(checked === 'ok'); return; }
    if (input.replace(ZH_ONLY_RE, '')) resolve(input);
  };
  return html('form', { onSubmit: submit, className: 'flashcard-wrap' },
    html('div', { className: 'listen-card cloze-card' + (checked ? ' ' + checked : '') },
      hasRealAudio(sentence.hanzi) && html('button', { type: 'button', className: 'listen-mini', title: 'Repetir audio', onClick: () => sayS() }, '🔊'),
      html('div', { className: 'cloze-title' }, checked ? 'Ahora decila en voz alta 🗣' : hasRealAudio(sentence.hanzi) ? 'Escuchá y completá la frase' : 'Completá la frase'),
      sentence.image && html('img', { className: 'cloze-img', src: sentence.image, alt: '' }),
      html('div', { className: 'cloze-sentence hanzi-font' },
        before,
        checked
          ? html('span', { className: 'cloze-word ' + checked }, target)
          : html('span', { className: 'cloze-blank' }, '＿'.repeat(target.length)),
        after),
      checked
        ? html(React.Fragment, null,
            html(TonedPinyin, { text: sentence.pinyin, className: 'cloze-pinyin' }),
            html('div', { className: 'listen-es' }, sentence.es),
            html('div', { className: 'listen-msg ' + checked }, checked === 'ok' ? '¡Correcto!' : 'Faltaba ' + target + (input ? ' · escribiste: ' + input : '')),
            html('div', { className: 'cloze-answer' },
              html('span', { className: 'hanzi-font' }, word.hanzi), ' · ',
              html(TonedPinyin, { text: word.pinyin }), ' · ', word.es))
        : html('div', { className: 'listen-es' }, sentence.es),
    ),
    !checked && html('input', {
      ref: inputRef, value: input, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, lang: 'zh-CN',
      placeholder: 'Escribí la palabra que falta (汉字)', onChange: e => setInput(e.target.value),
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: () => { setTimeout(() => { composing.current = false; }, 0); },
      className: 'dictation-input hanzi-font',
    }),
    !checked && (showOpts
      ? html('div', { className: 'cloze-options' }, options.map(o => html('button', { key: o, type: 'button', className: 'cloze-opt hanzi-font', onClick: () => { setInput(o); resolve(o); } }, o)))
      : html('button', { type: 'button', className: 'hint-link', onClick: () => setShowOpts(true) }, '💡 No tengo teclado chino · ver opciones')),
    html('button', { type: 'submit', className: 'primary-btn', style: { marginTop: 12, width: '100%' } }, checked ? 'Siguiente →' : 'Comprobar'),
  );
}

function FlashcardGame({ words: allWords, sentenceMode, lessonId, cardState = {}, onRecordCard, onBack, onHome, onFinish, nextAction, savedResult, onSaveResult, onClearResult,
                         deckBuilder, title, emptyTitle, emptySub, clozeFor }) {
  // deckBuilder: arma el mazo desde afuera (entrenamiento diario); si no, el mazo del día de la lección.
  const buildDeck = () => deckBuilder ? deckBuilder() : buildDueDeck(allWords, lessonId, sentenceMode, cardState);
  const keyOf = (c) => cardKey(c._lesson || lessonId, sentenceMode, c.hanzi);
  const [reviewAll, setReviewAll] = useState(false);
  const [words, setWords] = useState(buildDeck);
  const [queue, setQueue] = useState(() => words);
  const [flipped, setFlipped] = useState(false);
  const [firstAnswer, setFirstAnswer] = useState({}); // hanzi → 'no' | 'maybe' | 'yes'
  const [lastAnswer, setLastAnswer] = useState({});   // hanzi → última respuesta (para los contadores)
  const [mastered, setMastered] = useState(0);
  const [done, setDone] = useState(!!savedResult);
  const [result, setResult] = useState(savedResult || null);

  const total = words.length;
  const card = queue[0];

  const [cloze, setCloze] = useState(null); // { card, sentence, options } tras "Lo sabía"

  // "Lo sabía" en una palabra que aparece en una frase → primero hay que completarla.
  // Si la completa bien cuenta como sabida; si no, como "con dudas".
  const answer = (kind) => {
    if (!card || !flipped) return;
    if (kind === 'yes' && !sentenceMode) {
      const sentence = clozeFor ? clozeFor(card) : findContextSentence(card, card._lesson || lessonId);
      if (sentence) { setCloze({ card, sentence, options: clozeOptions(card, allWords) }); return; }
    }
    commit(kind);
  };
  const finishCloze = (good) => { setCloze(null); commit(good ? 'yes' : 'maybe'); };

  const commit = (kind) => {
    if (kind === 'yes') playCorrect(); else if (kind === 'no') playWrong();
    const first = firstAnswer[card.hanzi] ? firstAnswer : { ...firstAnswer, [card.hanzi]: kind };
    if (!firstAnswer[card.hanzi] && onRecordCard) onRecordCard(keyOf(card), kind);
    const rest = queue.slice(1);
    let next = rest;
    if (kind !== 'yes') {
      const pos = Math.min(FLASH_REQUEUE[kind], rest.length);
      next = [...rest.slice(0, pos), card, ...rest.slice(pos)];
    }
    setFirstAnswer(first);
    setLastAnswer(prev => ({ ...prev, [card.hanzi]: kind }));
    setFlipped(false);
    if (kind === 'yes') setMastered(m => m + 1);

    if (next.length === 0) {
      const firstTry = words.filter(w => first[w.hanzi] === 'yes').length;
      const percent = Math.round((firstTry / total) * 100);
      const reviewWords = words.filter(w => first[w.hanzi] !== 'yes');
      const res = { percent, completed: firstTry === total, reviewWords };
      setResult(res);
      setDone(true);
      onFinish(percent, reviewWords, total);
      onSaveResult(res);
    } else {
      setQueue(next);
    }
  };

  const flip = () => { if (!flipped && card) { setFlipped(true); speak(card.hanzi); } };

  // Atajos: espacio/enter da vuelta · 1 no · 2 dudas · 3 lo sabía
  useEffect(() => {
    if (done) return;
    const onKey = (e) => {
      if (cloze || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); }
      else if (flipped && e.key === '1') answer('no');
      else if (flipped && e.key === '2') answer('maybe');
      else if (flipped && e.key === '3') answer('yes');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (done && result) {
    return html(ResultScreen, {
      percent: result.percent, lessonId, mode: sentenceMode ? 'frases' : 'cards',
      completed: result.completed,
      reviewWords: result.reviewWords || [],
      onRetry: () => {
        const deck = buildDeck();
        setWords(deck);
        setQueue(deck);
        setReviewAll(false);
        setFlipped(false);
        setFirstAnswer({});
        setLastAnswer({});
        setMastered(0);
        setResult(null);
        setDone(false);
        onClearResult();
      },
      onHome,
      nextAction,
    });
  }

  if (!card) {
    const st = deckBuilder ? {} : deckStats(allWords, lessonId, sentenceMode, cardState);
    const startAll = () => { const deck = shuffle(allWords); setReviewAll(true); setWords(deck); setQueue(deck); };
    return html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, title || (sentenceMode ? 'Frases clave' : 'Tarjetas')),
      ),
      html('div', { className: 'result-screen' },
        html('div', { className: 'result-seal hanzi-font celebrate' },
          html('div', { className: 'pct' }, '好'),
          html('div', { className: 'label' }, 'al día'),
        ),
        html('div', { className: 'result-title' }, emptyTitle || '¡Estás al día!'),
        html('div', { className: 'result-sub' }, emptySub ||
          ('No tenés tarjetas para repasar hoy en esta lección.' +
          (st.nextDue ? ' Próximo repaso: ' + formatNextDue(st.nextDue) + '.' : ''))),
        html('div', { className: 'result-actions' },
          !deckBuilder && html('button', { className: 'primary-btn', onClick: startAll }, 'Repasar todas igual'),
          html('button', { className: deckBuilder ? 'primary-btn' : 'secondary-btn', onClick: onBack }, deckBuilder ? 'Volver' : 'Volver a la lección'),
        ),
      ),
    );
  }

  const pendingNo = queue.filter(w => lastAnswer[w.hanzi] === 'no').length;
  const pendingMaybe = queue.filter(w => lastAnswer[w.hanzi] === 'maybe').length;
  const isRepeat = card && lastAnswer[card.hanzi];

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, title || (sentenceMode ? 'Frases clave' : 'Tarjetas')),
        html('div', { className: 'flash-counter', title: reviewAll ? 'Repaso de todas las tarjetas' : 'Tarjetas de hoy: sabidas / total' }, '✓ ' + mastered + '/' + total),
        html('button', { className: 'back-btn', onClick: onHome, title: 'Ir al inicio' }, '⌂'),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' }, html('i', null, '✕'), 'No: ' + pendingNo),
        html('div', { className: 'flash-score-chip maybe' }, html('i', null, '?'), 'Dudas: ' + pendingMaybe),
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), 'Sabidas: ' + mastered),
      ),
      cloze ? html(ClozeStep, { key: cloze.card.hanzi + mastered, word: cloze.card, sentence: cloze.sentence, options: cloze.options, onDone: finishCloze }) :
      html('div', { className: 'flashcard-wrap' },
        html('div', { className: 'flashcard', onClick: flip },
          isRepeat && html('div', { className: 'flash-repeat-tag ' + isRepeat }, isRepeat === 'no' ? '↻ Otra vez' : '↻ Repaso'),
          !flipped
            ? html('div', { className: 'front hanzi-font' + (sentenceMode ? ' sentence' : '') }, card.hanzi)
            : html('div', { className: 'back-content' },
                sentenceMode && html('div', { className: 'back-hanzi hanzi-font' }, card.hanzi),
                html(TonedPinyin, { text: card.pinyin, className: 'back-pinyin' }),
                html('div', { className: 'back-es' }, card.es),
                !sentenceMode && html(StrokeOrder, { hanzi: card.hanzi }),
                hasRealAudio(card.hanzi) && html('button', { className: 'replay-btn', onClick: (e) => { e.stopPropagation(); speak(card.hanzi); } }, '🔊 Escuchar'),
              ),
          html('div', { className: 'tap-hint' }, flipped ? '' : 'Toca para ver la respuesta')
        ),
        flipped && html('div', { className: 'flash-controls three' },
          html('button', { className: 'flash-btn no', onClick: () => answer('no') }, 'No lo sabía'),
          html('button', { className: 'flash-btn maybe', onClick: () => answer('maybe') }, 'Con dudas'),
          html('button', { className: 'flash-btn yes', onClick: () => answer('yes') }, 'Lo sabía'),
        )
      )
    )
  );
}

// ═════════════════ HSK 1 (preparación del examen) ═════════════════
// Módulo aparte: contenido en hsk1_words y progreso en hsk1_card_state /
// hsk1_results. Lo ven el equipo docente y las clases con el HSK 1 habilitado.
const HSK1_LESSON = 'hsk1';

function hsk1Days(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const exam = new Date(y, m - 1, d);
  const t = new Date(); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((exam - today) / DAY_MS);
}
function formatLongDate(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}
const isToday = (iso) => iso && todayLocal() === (() => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

function Hsk1Screen({ studentId, appConfig, examDate, onHome }) {
  const [words, setWords] = useState(null);
  const [bank, setBank] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ name: 'home' });   // home | study | extra | all | list | section | exam | numeros | preguntas | pares | cuaderno
  const [cardState, setCardState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('npcr-hsk1-' + studentId)) || {}; } catch (e) { return {}; }
  });
  const dailyNew = Number(appConfig.hsk1_daily_new) || 10;

  useEffect(() => { try { localStorage.setItem('npcr-hsk1-' + studentId, JSON.stringify(cardState)); } catch (e) {} }, [cardState]);
  useEffect(() => {
    Promise.all([
      db.from('hsk1_words').select('id,hanzi,pinyin,es,audio,sentence,s_pinyin,s_es,s_audio,image').eq('hidden', false).order('id'),
      db.from('hsk1_card_state').select('card_key,box,due_at,reviews,lapses,updated_at,first_seen').eq('student_id', studentId),
      db.from('hsk1_items').select('kind,data').eq('hidden', false).order('id'),
      db.from('hsk1_results').select('kind,score,total,listening,reading,detail,created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(300),
    ]).then(([w, st, it, rs]) => {
      if (w.error) { setError(w.error.message); setWords([]); return; }
      const list = (w.data || []).map(r => ({ ...r, hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), sentence: nfc(r.sentence), _lesson: HSK1_LESSON }));
      list.forEach(r => {
        const k = r.hanzi.replace(MEDIA_PUNCT_RE, '');
        if (r.audio) EXTRA_AUDIO[k] = r.audio;
        if (r.s_audio) EXTRA_AUDIO[r.sentence.replace(MEDIA_PUNCT_RE, '')] = r.s_audio;
      });
      setWords(list);
      const b = { foto: [], escucha4: [], qa: [], leer4: [], par: [] };
      (it.data || []).forEach(r => { if (b[r.kind]) b[r.kind].push(r.data); });
      setBank(b);
      setResults(rs.data || []);
      if (!st.error && st.data) setCardState(prev => {
        const next = { ...prev };
        st.data.forEach(r => {
          const cur = next[r.card_key];
          if (!cur || new Date(r.updated_at) > new Date(cur.updated_at)) next[r.card_key] = { box: r.box, due_at: r.due_at, reviews: r.reviews, lapses: r.lapses, updated_at: r.updated_at, first_seen: r.first_seen };
        });
        return next;
      });
    });
  }, []);

  const keyOf = (w) => cardKey(HSK1_LESSON, false, w.hanzi);
  const recordCard = (key, kind) => setCardState(prev => {
    const st = { ...srsNext(prev[key], kind, Date.now()), first_seen: (prev[key] && prev[key].first_seen) || new Date().toISOString() };
    const { first_seen, ...row } = st;
    db.from('hsk1_card_state').upsert({ student_id: studentId, card_key: key, ...row }).then(() => {});
    return { ...prev, [key]: st };
  });
  // Guarda un resultado (práctica, simulacro, tarjetas) y lo suma a la lista local
  const saveResult = (row) => {
    if (!row.total) return;
    const full = { listening: null, reading: null, detail: {}, ...row, created_at: new Date().toISOString() };
    setResults(prev => [full, ...prev]);
    db.from('hsk1_results').insert(row).then(() => {});
  };

  const back = () => setView({ name: 'home' });
  if (!words) return html('main', { style: { paddingTop: 18 } }, html('p', { className: 'admin-note', style: { textAlign: 'center' } }, 'Cargando HSK 1…'));
  if (error || !words.length) return html(GameStatusScreen, { onBack: onHome, title: '🎓 HSK 1', msg: error ? 'No se pudo cargar el HSK 1: ' + error : 'El HSK 1 todavía no está habilitado para tu clase.' });

  const wm = {}; words.forEach(w => { wm[w.hanzi] = w; });
  const now = Date.now();
  const seen = words.filter(w => cardState[keyOf(w)]);
  const fresh = words.filter(w => !cardState[keyOf(w)]);
  const due = words.filter(w => { const st = cardState[keyOf(w)]; return st && isDue(st, now); });
  const learned = seen.filter(w => cardState[keyOf(w)].box >= 3).length;
  const newToday = seen.filter(w => isToday(cardState[keyOf(w)].first_seen)).length;
  const newLeft = Math.max(0, Math.min(dailyNew - newToday, fresh.length));
  const todayCount = due.length + newLeft;
  const days = hsk1Days(examDate);
  const daysNeeded = Math.ceil(fresh.length / dailyNew);

  const byBox = (list) => list.slice().sort((a, b) => cardState[keyOf(a)].box - cardState[keyOf(b)].box);
  const clozeFor = (card) => card.sentence ? { hanzi: card.sentence, pinyin: card.s_pinyin, es: card.s_es, image: card.image, realOnly: true } : null;
  const game = (title, deckBuilder, emptySub) => html(FlashcardGame, {
    words, sentenceMode: false, lessonId: HSK1_LESSON, cardState, onRecordCard: recordCard,
    onBack: back, onHome: back, nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {},
    onFinish: (percent, reviewWords, total) => saveResult({ kind: 'tarjetas', score: Math.round(percent * total / 100), total,
      detail: { missed: (reviewWords || []).map(w => ({ t: w.hanzi, py: w.pinyin, es: w.es })) } }),
    deckBuilder, title, emptyTitle: '¡Listo por hoy!', emptySub, clozeFor,
  });
  const ctx = { bank, wm, onBack: back, onSave: saveResult };

  if (view.name === 'study') return game('🎓 HSK 1 · Hoy', () => [...shuffle(byBox(due).slice(0, 40)), ...fresh.slice(0, newLeft)],
    'Ya hiciste el estudio de hoy. Mañana te esperan las palabras para repasar y ' + dailyNew + ' nuevas.');
  if (view.name === 'extra') return game('🎓 HSK 1 · Adelantar', () => fresh.slice(0, dailyNew), 'Ya viste las 150 palabras. ¡Ahora a repasar!');
  if (view.name === 'all') return game('🎓 HSK 1 · Repaso general', () => shuffle(seen), 'Todavía no estudiaste ninguna palabra.');
  if (view.name === 'errores') return game('🎓 HSK 1 · Mis errores', () => shuffle(view.words), 'No hay palabras para repasar.');
  if (view.name === 'list') return html(Hsk1WordList, { words, cardState, keyOf, onBack: back });
  if (view.name === 'section') return html(HskSectionPractice, { ...ctx, kind: view.kind, key: view.kind + (view.n || 0), onAgain: () => setView({ name: 'section', kind: view.kind, n: (view.n || 0) + 1 }) });
  if (view.name === 'exam') return html(HskExam, { ...ctx, key: 'exam' + (view.n || 0), onAgain: () => setView({ name: 'exam', n: (view.n || 0) + 1 }) });
  if (view.name === 'numeros') return html(HskDrill, { ...ctx, kind: 'numeros', key: 'n' + (view.n || 0), onAgain: () => setView({ name: 'numeros', n: (view.n || 0) + 1 }) });
  if (view.name === 'preguntas') return html(HskDrill, { ...ctx, kind: 'preguntas', key: 'p' + (view.n || 0), onAgain: () => setView({ name: 'preguntas', n: (view.n || 0) + 1 }) });
  if (view.name === 'pares') return html(HskDrill, { ...ctx, kind: 'pares', key: 'c' + (view.n || 0), onAgain: () => setView({ name: 'pares', n: (view.n || 0) + 1 }) });
  if (view.name === 'cuaderno') return html(HskNotebook, { results, wm, onBack: back, onReview: (list) => setView({ name: 'errores', words: list }) });

  const pct = Math.round(seen.length / words.length * 100);
  const lastOf = (kind) => results.find(r => r.kind === kind);
  const sims = results.filter(r => r.kind === 'simulacro');
  const bestSim = sims.reduce((m, r) => Math.max(m, r.score), 0);
  const sectionCard = (k) => {
    const meta = HSK_SECTIONS[k]; const last = lastOf(k);
    const p = last ? Math.round(last.score / last.total * 100) : null;
    return html('button', { key: k, className: 'hsk-sec', onClick: () => setView({ name: 'section', kind: k }) },
      html('span', { className: 'hsk-sec-tag ' + (k[0] === 'L' ? 'listen' : 'read') }, meta.short),
      html('span', { className: 'hsk-sec-title' }, meta.title),
      html('span', { className: 'hsk-sec-sub' }, meta.sub),
      p !== null && html('span', { className: 'hsk-sec-pct ' + (p >= 80 ? 'ok' : p >= 60 ? 'mid' : 'low') }, p + '%'));
  };

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onHome }, '←'),
      html('h1', null, '🎓 HSK 1'),
    ),
    html('div', { className: 'hsk-wrap' },
      days !== null && html('div', { className: 'hsk-countdown' + (days <= 7 ? ' soon' : '') },
        html('div', { className: 'hsk-days' }, days > 0 ? days : days === 0 ? '¡Hoy!' : '✓'),
        html('div', null,
          html('div', { className: 'hsk-days-label' }, days > 1 ? 'días para el examen' : days === 1 ? 'día para el examen' : days === 0 ? 'Es el día del examen · 加油！' : 'El examen ya pasó'),
          html('div', { className: 'hsk-date' }, formatLongDate(examDate)),
        ),
      ),
      html('div', { className: 'hsk-stats' },
        html('div', null, html('b', null, seen.length), html('span', null, 'vistas de ' + words.length)),
        html('div', null, html('b', null, learned), html('span', null, 'aprendidas')),
        html('div', null, html('b', null, bestSim ? bestSim : '—'), html('span', null, 'mejor simulacro')),
      ),
      html('div', { className: 'hsk-bar' }, html('i', { style: { width: pct + '%' } })),
      html('p', { className: 'hsk-plan' },
        fresh.length === 0 ? '¡Ya viste las 150 palabras! Ahora repasá todos los días y hacé simulacros.'
          : 'Plan: ' + dailyNew + ' palabras nuevas por día → terminás las ' + fresh.length + ' que faltan en ' + daysNeeded + ' día' + (daysNeeded === 1 ? '' : 's') +
            (days !== null && days > 0 ? (daysNeeded <= days ? ' y te quedan ' + (days - daysNeeded) + ' para repasar y hacer simulacros.' : '. ¡Adelantá palabras para llegar!') : '.')),
      html('button', { className: 'hsk-main' + (todayCount ? '' : ' done'), onClick: () => setView({ name: 'study' }), disabled: !todayCount },
        html(AulaIcon, { name: todayCount ? 'target' : 'check', tone: todayCount ? 'white' : 'green', size: 44 }),
        html('div', { style: { flex: 1, textAlign: 'left' } },
          html('div', { className: 'hsk-main-title' }, todayCount ? 'Estudio de hoy' : 'Estudio de hoy completo'),
          html('div', { className: 'hsk-main-sub' }, todayCount ? (due.length ? due.length + ' para repasar' : '') + (due.length && newLeft ? ' · ' : '') + (newLeft ? newLeft + ' nuevas' : '') : '¡Bien! Volvé mañana.'),
        ),
      ),
      html('div', { className: 'hsk-actions' },
        !todayCount && fresh.length > 0 && html('button', { className: 'hsk-action', onClick: () => setView({ name: 'extra' }) },
          html(AulaIcon, { name: 'layers', tone: 'gold', size: 36 }), html('span', null, 'Adelantar ' + Math.min(dailyNew, fresh.length) + ' nuevas')),
        seen.length > 0 && html('button', { className: 'hsk-action', onClick: () => setView({ name: 'all' }) },
          html(AulaIcon, { name: 'clipboard', tone: 'blue', size: 36 }), html('span', null, 'Repasar todas las vistas')),
        html('button', { className: 'hsk-action', onClick: () => setView({ name: 'list' }) },
          html(AulaIcon, { name: 'chart', tone: 'purple', size: 36 }), html('span', null, 'Las 150 palabras')),
      ),

      html('div', { className: 'hsk-block-title' }, 'Simulacro del examen'),
      html('button', { className: 'hsk-exam-card', onClick: () => setView({ name: 'exam' }) },
        html('div', { className: 'hsk-exam-seal hanzi-font' }, '考'),
        html('div', { style: { flex: 1, textAlign: 'left' } },
          html('div', { className: 'hsk-main-title' }, 'Simulacro completo'),
          html('div', { className: 'hsk-exam-sub' }, '40 preguntas · con reloj · nota sobre 200 (se aprueba con 120)'),
          sims.length > 0 && html('div', { className: 'hsk-exam-last' },
            'Último: ' + sims[0].score + ' · Mejor: ' + bestSim + ' · ' + sims.length + ' hecho' + (sims.length === 1 ? '' : 's')),
        ),
      ),

      html('div', { className: 'hsk-block-title' }, 'Practicá cada parte · 听力 Escuchar'),
      html('div', { className: 'hsk-secs' }, ['L1', 'L2', 'L3', 'L4'].map(sectionCard)),
      html('div', { className: 'hsk-block-title' }, 'Practicá cada parte · 阅读 Leer'),
      html('div', { className: 'hsk-secs' }, ['R1', 'R2', 'R3', 'R4'].map(sectionCard)),

      html('div', { className: 'hsk-block-title' }, 'Refuerzos'),
      html('div', { className: 'hsk-actions' },
        html('button', { className: 'hsk-action', onClick: () => setView({ name: 'numeros' }) },
          html(AulaIcon, { name: 'target', tone: 'red', size: 36 }), html('span', null, 'Números, horas, fechas y precios')),
        html('button', { className: 'hsk-action', onClick: () => setView({ name: 'preguntas' }) },
          html(AulaIcon, { name: 'music', tone: 'green', size: 36 }), html('span', null, 'Palabras para preguntar')),
        html('button', { className: 'hsk-action', onClick: () => setView({ name: 'pares' }) },
          html(AulaIcon, { name: 'layers', tone: 'purple', size: 36 }), html('span', null, 'Palabras que se confunden')),
        html('button', { className: 'hsk-action', onClick: () => setView({ name: 'cuaderno' }) },
          html(AulaIcon, { name: 'pencil', tone: 'gold', size: 36 }), html('span', null, 'Cuaderno de errores')),
      ),

      html('div', { className: 'hsk-exam-info' },
        html('div', { className: 'report-h' }, 'Cómo es el examen'),
        html('p', null, '40 preguntas en unos 40 minutos: 20 de comprensión auditiva (cada audio suena dos veces) y 20 de lectura. Son 200 puntos y se aprueba con 120. Todo el texto viene con pinyin.'),
      ),
    ),
  );
}

// ── Las 8 partes del examen ──
const HSK_SECTIONS = {
  L1: { short: '听力 1', title: 'Escuchar 1', sub: 'Palabra y foto: ✓ o ✗', instr: 'Escuchá la palabra y decidí si coincide con la foto.' },
  L2: { short: '听力 2', title: 'Escuchar 2', sub: 'Frase → elegí la foto', instr: 'Escuchá la frase y elegí la foto que corresponde.' },
  L3: { short: '听力 3', title: 'Escuchar 3', sub: 'Uní audios con fotos', instr: 'Tocá cada audio para escucharlo y unilo con su foto: tocá el audio y después la foto.' },
  L4: { short: '听力 4', title: 'Escuchar 4', sub: 'Frase → elegí qué significa', instr: 'Escuchá la frase y elegí qué significa.' },
  R1: { short: '阅读 1', title: 'Leer 1', sub: 'Palabra y foto: ✓ o ✗', instr: 'Leé la palabra y decidí si coincide con la foto.' },
  R2: { short: '阅读 2', title: 'Leer 2', sub: 'Uní frases con fotos', instr: 'Uní cada frase con su foto: tocá la frase y después la foto.' },
  R3: { short: '阅读 3', title: 'Leer 3', sub: 'Uní preguntas y respuestas', instr: 'Uní cada pregunta con su respuesta: tocá la pregunta y después la respuesta.' },
  R4: { short: '阅读 4', title: 'Leer 4', sub: 'Completá con la palabra', instr: 'Uní cada frase con la palabra que falta en el hueco.' },
};
const HSK_ORDER = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
const hskImg = (f) => 'hsk1/img/' + f.img + '.jpg';
const LETTERS = 'ABCDEF';

// Fotos de temas distintos (así ninguna foto "distractora" también es correcta)
function hskPickFotos(fotos, n, excludeScenes) {
  const used = new Set(excludeScenes || []); const out = [];
  for (const f of shuffle(fotos)) { if (used.has(f.scene)) continue; used.add(f.scene); out.push(f); if (out.length === n) break; }
  return out;
}
// Tipo de pregunta de una frase (para no ofrecer dos respuestas que sirvan)
function hskQGroup(q) {
  const keys = [['几点', 'hora'], ['什么时候', 'hora'], ['星期几', 'dia'], ['几月', 'fecha'], ['几号', 'fecha'], ['多大', 'edad'], ['几岁', 'edad'],
    ['几口', 'cuantos'], ['多少钱', 'precio'], ['多少', 'cuantos'], ['哪国', 'pais'], ['哪儿', 'lugar'], ['谁', 'quien'], ['怎么样', 'como'], ['怎么', 'modo'], ['什么', 'que'], ['吗', 'sino']];
  const k = keys.find(([w]) => q.includes(w));
  return k ? k[1] : q;
}
function hskPickDistinct(list, n, groupOf) {
  const used = new Set(); const out = [];
  for (const it of shuffle(list)) { const g = groupOf(it); if (used.has(g)) continue; used.add(g); out.push(it); if (out.length === n) break; }
  return out;
}
const wordInfo = (wm, h) => { const w = wm[h]; return { t: h, py: w ? w.pinyin : '', es: w ? w.es : '' }; };

// Arma una sección: preguntas sueltas (tf / img / text) o un tablero de unir
function buildHskSection(kind, bank, wm) {
  const fotos = bank.foto;
  // Frase grabada del material para cada foto (la foto de esa palabra ilustra esa frase)
  const byId = {}; Object.values(wm).forEach(w => { byId[w.id] = w; });
  const voiced = fotos.filter(f => byId[f.img] && byId[f.img].s_audio && hasRealAudio(byId[f.img].sentence));
  const sent = (f) => { const w = byId[f.img]; return { t: w.sentence, py: w.s_pinyin, es: w.s_es }; };
  if (kind === 'L1' || kind === 'R1') {
    return { type: 'single', items: hskPickFotos(fotos, 5).map(f => {
      const truth = Math.random() < 0.5;
      const shown = truth ? f.word : hskPickFotos(fotos, 1, [f.scene])[0].word;
      const info = wordInfo(wm, shown);
      return { q: 'tf', img: hskImg(f), say: kind === 'L1' ? shown : null, show: kind === 'R1' ? info : null, answer: truth,
        reveal: { ...info, note: truth ? null : 'En la foto: ' + f.word + ' (' + wordInfo(wm, f.word).py + ') · ' + wordInfo(wm, f.word).es }, missed: info };
    }) };
  }
  if (kind === 'L2') {
    return { type: 'single', items: hskPickFotos(voiced, 5).map(f => ({
      q: 'img', say: sent(f).t, options: shuffle([f, ...hskPickFotos(fotos, 2, [f.scene])]).map(o => ({ img: hskImg(o), ok: o === f })),
      reveal: sent(f), missed: sent(f),
    })) };
  }
  if (kind === 'L4') {
    const pool = Object.values(wm).filter(w => w.s_audio && hasRealAudio(w.sentence));
    return { type: 'single', items: shuffle(pool).slice(0, 5).map(w => {
      const others = shuffle(pool.filter(o => o !== w && o.s_es !== w.s_es)).slice(0, 2);
      const s0 = { t: w.sentence, py: w.s_pinyin, es: w.s_es };
      return { q: 'text', say: w.sentence, options: shuffle([w, ...others]).map(o => ({ h: o.s_es, es: true, ok: o === w })), reveal: s0, missed: s0 };
    }) };
  }
  if (kind === 'L3') {
    const six = hskPickFotos(voiced, 6); const five = shuffle(six).slice(0, 5);
    return { type: 'board', photos: true,
      left: five.map(f => ({ id: f.img, say: sent(f).t, lines: [[sent(f).t, sent(f).py]], es: sent(f).es, missed: sent(f) })),
      right: six.map(f => ({ id: f.img, img: hskImg(f) })) };
  }
  if (kind === 'R2') {
    const six = hskPickFotos(fotos, 6); const five = shuffle(six).slice(0, 5);
    return { type: 'board', photos: true,
      left: five.map(f => ({ id: f.img, h: f.text, py: f.py, es: f.es, missed: { t: f.text, py: f.py, es: f.es } })),
      right: six.map(f => ({ id: f.img, img: hskImg(f) })) };
  }
  if (kind === 'R3') {
    const six = hskPickDistinct(bank.qa, 6, it => hskQGroup(it.q)); const five = shuffle(six).slice(0, 5);
    return { type: 'board',
      left: five.map(it => ({ id: it.q, h: it.q, py: it.qpy, es: it.es, missed: { t: it.q + ' ' + it.a, py: it.qpy + ' ' + it.apy, es: it.es } })),
      right: shuffle(six).map(it => ({ id: it.q, h: it.a, py: it.apy })) };
  }
  if (kind === 'R4') {
    const six = hskPickDistinct(bank.leer4, 6, it => it.ans); const five = shuffle(six).slice(0, 5);
    return { type: 'board',
      left: five.map(it => ({ id: it.ans, h: it.s, es: it.es, full: it.py, missed: { t: it.s.replace('＿＿', it.ans), py: it.py, es: it.es } })),
      right: shuffle(six).map(it => ({ id: it.ans, h: it.ans, py: wordInfo(wm, it.ans).py })) };
  }
  return null;
}

// HSK 1: solo audios grabados del material (nunca voz sintética)
function speakReal(text, onEnd) { if (hasRealAudio(text)) speak(text, onEnd); else if (onEnd) onEnd(); }
// Encadena grabaciones de palabras sueltas (ej. 三 + 点) para números, horas y precios
function speakChain(tokens, onEnd) {
  const list = tokens.filter(hasRealAudio);
  const step = (k) => { if (k >= list.length) { onEnd && onEnd(); return; } speak(list[k], () => setTimeout(() => step(k + 1), 60)); };
  step(0);
}
// Audio "como en el examen": suena dos veces
function speakTwice(text) { speakReal(text, () => setTimeout(() => speakReal(text), 900)); }

function HskSectionHead({ kind, onBack, right, exam }) {
  const meta = HSK_SECTIONS[kind];
  return html(React.Fragment, null,
    html('div', { className: 'header-row' },
      onBack ? html('button', { className: 'back-btn', onClick: onBack }, '←') : null,
      html('h1', null, html('span', { className: 'hsk-sec-tag ' + (kind[0] === 'L' ? 'listen' : 'read'), style: { marginRight: 8, verticalAlign: 'middle' } }, meta.short), meta.title),
      right,
    ),
    html('p', { className: 'hsk-instr' }, meta.instr),
  );
}

// Preguntas sueltas. mode 'practice' muestra la corrección; 'exam' avanza sin corregir.
function HskSingles({ items, mode, onProgress, onDone }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState({ ok: 0, missed: [] });
  const it = items[i];
  useEffect(() => { if (it && it.say) setTimeout(() => speakTwice(it.say), 300); }, [i]);

  const isOk = (choice) => it.q === 'tf' ? choice === it.answer : it.options[choice].ok;
  const pick = (choice) => {
    if (picked !== null) return;
    const good = isOk(choice);
    const next = { ok: score.ok + (good ? 1 : 0), missed: good ? score.missed : [...score.missed, it.missed] };
    setScore(next); onProgress && onProgress(next);
    if (mode === 'exam') { advance(next); return; }
    setPicked(choice);
    if (!good) playWrong();
  };
  const advance = (sc) => {
    if (i + 1 >= items.length) onDone(sc || score);
    else { setI(i + 1); setPicked(null); }
  };
  const done = picked !== null;
  const good = done && isOk(picked);

  return html('div', { className: 'hsk-q' },
    html('div', { className: 'hsk-q-count' }, (i + 1) + ' / ' + items.length),
    it.say && html('button', { className: 'hsk-replay', onClick: () => speakTwice(it.say) }, '🔊 Escuchar otra vez'),
    it.q === 'tf' && html('div', { className: 'hsk-tf' },
      html('img', { className: 'hsk-tf-img', src: it.img, alt: '' }),
      it.show && html('div', { className: 'hsk-tf-word' }, html(TonedPinyin, { text: it.show.py, className: 'hsk-py' }), html('div', { className: 'hanzi-font' }, it.show.t)),
      html('div', { className: 'hsk-tf-btns' },
        [true, false].map(v => html('button', { key: String(v), onClick: () => pick(v),
          className: 'hsk-tf-btn ' + (v ? 'yes' : 'no') + (done && v === it.answer ? ' right' : '') + (done && picked === v && v !== it.answer ? ' wrong' : '') }, v ? '✓' : '✗'))),
    ),
    it.q === 'img' && html('div', { className: 'hsk-img-opts' }, it.options.map((o, k) => html('button', { key: k, onClick: () => pick(k),
      className: 'hsk-img-opt' + (done && o.ok ? ' right' : '') + (done && picked === k && !o.ok ? ' wrong' : '') },
      html('span', { className: 'hsk-letter' }, LETTERS[k]), html('img', { src: o.img, alt: '' })))),
    it.q === 'text' && html('div', { className: 'hsk-text-opts' }, it.options.map((o, k) => html('button', { key: k, onClick: () => pick(k),
      className: 'hsk-text-opt' + (done && o.ok ? ' right' : '') + (done && picked === k && !o.ok ? ' wrong' : '') },
      html('span', { className: 'hsk-letter' }, LETTERS[k]),
      html('span', null, o.py && html(TonedPinyin, { text: o.py, className: 'hsk-py' }), html('span', { className: o.es ? 'hsk-opt-es' : 'hanzi-font hsk-opt-h' }, o.h))))),
    done && html('div', { className: 'hsk-feedback ' + (good ? 'ok' : 'bad') },
      html('div', { className: 'hsk-fb-title' }, good ? '¡Correcto!' : 'Incorrecto'),
      html('div', { className: 'hanzi-font hsk-fb-h' }, it.reveal.t),
      html(TonedPinyin, { text: it.reveal.py, className: 'hsk-py' }),
      html('div', { className: 'hsk-fb-es' }, it.reveal.es),
      it.reveal.note && html('div', { className: 'hsk-fb-es' }, it.reveal.note),
      html('button', { className: 'primary-btn', style: { marginTop: 10, width: '100%' }, onClick: () => advance() }, i + 1 >= items.length ? 'Ver resultado' : 'Siguiente →'),
    ),
  );
}

// Tablero para unir con líneas: tocás un elemento de la izquierda y después
// uno de la derecha (o al revés). Tocar un elemento unido lo suelta.
function HskBoard({ board, mode, onProgress, onDone }) {
  const [pairs, setPairs] = useState({});      // leftId → rightId
  const [sel, setSel] = useState(null);        // { side, id }
  const [checked, setChecked] = useState(false);
  const [lines, setLines] = useState([]);
  const wrap = React.useRef(null);
  const refs = React.useRef({});
  const usedRight = new Set(Object.values(pairs));

  const result = (p) => {
    const missed = board.left.filter(l => p[l.id] !== l.id).map(l => l.missed);
    return { ok: board.left.length - missed.length, missed };
  };
  const setPair = (p) => { setPairs(p); onProgress && onProgress(result(p)); };
  const tap = (side, id) => {
    if (checked) return;
    if (side === 'left' && pairs[id] !== undefined) { const p = { ...pairs }; delete p[id]; setPair(p); setSel(null); return; }
    if (side === 'right' && usedRight.has(id)) { const p = { ...pairs }; Object.keys(p).forEach(k => { if (p[k] === id) delete p[k]; }); setPair(p); setSel(null); return; }
    if (sel && sel.side !== side) {
      const leftId = side === 'left' ? id : sel.id; const rightId = side === 'right' ? id : sel.id;
      setPair({ ...pairs, [leftId]: rightId }); setSel(null); return;
    }
    setSel({ side, id });
    if (side === 'left') { const l = board.left.find(x => x.id === id); if (l && l.say) speakReal(l.say); }
  };

  // Dibuja las líneas entre los elementos unidos
  const measure = () => {
    if (!wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    setLines(Object.entries(pairs).map(([lid, rid]) => {
      const a = refs.current['l:' + lid], b = refs.current['r:' + rid];
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const lItem = board.left.find(x => String(x.id) === lid);
      return { key: lid, x1: ra.right - box.left, y1: ra.top + ra.height / 2 - box.top, x2: rb.left - box.left, y2: rb.top + rb.height / 2 - box.top,
        ok: lItem && String(lItem.id) === String(rid) };
    }).filter(Boolean));
  };
  React.useLayoutEffect(measure, [pairs, checked]);
  useEffect(() => { window.addEventListener('resize', measure); const t = setTimeout(measure, 400); return () => { window.removeEventListener('resize', measure); clearTimeout(t); }; });

  const allPaired = Object.keys(pairs).length === board.left.length;
  const finish = () => {
    const r = result(pairs);
    if (mode === 'exam') { onDone(r); return; }
    setChecked(true);
    if (r.ok < board.left.length) playWrong();
  };
  const rightLetter = (id) => { const k = board.right.findIndex(x => x.id === id); return LETTERS[k]; };

  return html('div', { className: 'hsk-q' },
    html('div', { className: 'hsk-board' + (board.photos ? ' photos' : ''), ref: wrap },
      html('svg', { className: 'hsk-lines' }, lines.map(l => html('line', { key: l.key, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
        className: checked ? (l.ok ? 'ok' : 'bad') : '' }))),
      html('div', { className: 'hsk-col left' }, board.left.map((l, k) => {
        const paired = pairs[l.id] !== undefined;
        const st = checked ? (pairs[l.id] === l.id ? ' right' : ' wrong') : '';
        return html('button', { key: l.id, ref: el => { refs.current['l:' + l.id] = el; }, onClick: () => tap('left', l.id),
          className: 'hsk-item' + (sel && sel.side === 'left' && sel.id === l.id ? ' sel' : '') + (paired ? ' paired' : '') + st },
          html('span', { className: 'hsk-num' }, k + 1),
          l.say && !l.h ? html('span', { className: 'hsk-item-audio' }, '🔊 Audio ' + (k + 1))
            : html('span', { className: 'hsk-item-txt' }, l.py && html(TonedPinyin, { text: l.py, className: 'hsk-py' }), html('span', { className: 'hanzi-font' }, l.h)),
          paired && html('span', { className: 'hsk-chosen' }, rightLetter(pairs[l.id])));
      })),
      html('div', { className: 'hsk-col right' }, board.right.map((r, k) => html('button', { key: r.id, ref: el => { refs.current['r:' + r.id] = el; }, onClick: () => tap('right', r.id),
        className: 'hsk-item' + (r.img ? ' photo' : '') + (sel && sel.side === 'right' && sel.id === r.id ? ' sel' : '') + (usedRight.has(r.id) ? ' paired' : '') },
        html('span', { className: 'hsk-letter' }, LETTERS[k]),
        r.img ? html('img', { src: r.img, alt: '' })
          : html('span', { className: 'hsk-item-txt' }, r.py && html(TonedPinyin, { text: r.py, className: 'hsk-py' }), html('span', { className: 'hanzi-font' }, r.h))))),
    ),
    !checked && html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 12 }, disabled: mode !== 'exam' && !allPaired, onClick: finish },
      mode === 'exam' ? 'Siguiente parte →' : allPaired ? 'Comprobar' : 'Uní las ' + board.left.length + ' (' + Object.keys(pairs).length + '/' + board.left.length + ')'),
    checked && html('div', { className: 'hsk-feedback ' + (result(pairs).ok === board.left.length ? 'ok' : 'bad') },
      html('div', { className: 'hsk-fb-title' }, result(pairs).ok + ' de ' + board.left.length + ' correctas'),
      board.left.map((l, k) => html('div', { key: l.id, className: 'hsk-fb-row' + (pairs[l.id] === l.id ? ' ok' : ' bad') },
        html('b', null, (k + 1) + ' → ' + rightLetter(l.id) + (pairs[l.id] === l.id ? ' ✓' : ' ✗')), ' ',
        l.lines ? l.lines.map((ln, j) => html('div', { key: j }, html('span', { className: 'hanzi-font' }, ln[0]), ' ', html(TonedPinyin, { text: ln[1], className: 'hsk-py' })))
          : html('span', null, html('span', { className: 'hanzi-font' }, l.full ? l.h.replace('＿＿', rightOf(board, l.id)) : l.h), ' ', l.full && html(TonedPinyin, { text: l.full, className: 'hsk-py' })),
        html('div', { className: 'hsk-fb-es' }, l.es))),
      html('button', { className: 'primary-btn', style: { marginTop: 10, width: '100%' }, onClick: () => onDone(result(pairs)) }, 'Ver resultado'),
    ),
  );
}
const rightOf = (board, id) => { const r = board.right.find(x => x.id === id); return r ? r.h : ''; };

function HskSectionBody({ kind, section, mode, onProgress, onDone }) {
  return section.type === 'single'
    ? html(HskSingles, { items: section.items, mode, onProgress, onDone })
    : html(HskBoard, { board: section, mode, onProgress, onDone });
}

// Práctica de una parte del examen
function HskSectionPractice({ kind, bank, wm, onBack, onSave, onAgain }) {
  const [section] = useState(() => buildHskSection(kind, bank, wm));
  const [res, setRes] = useState(null);
  if (!section) return html(GameStatusScreen, { onBack, title: HSK_SECTIONS[kind].title, msg: 'Falta contenido para esta parte.' });
  const done = (r) => { setRes(r); onSave({ kind, score: r.ok, total: 5, detail: { missed: r.missed } }); };
  if (res) return html(HskResult, { title: HSK_SECTIONS[kind].title, ok: res.ok, total: 5, missed: res.missed, onAgain, onBack });
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html(HskSectionHead, { kind, onBack }),
    html('div', { className: 'hsk-wrap' }, html(HskSectionBody, { kind, section, mode: 'practice', onDone: done })),
  );
}

function HskResult({ title, ok, total, missed, onAgain, onBack, children }) {
  const p = Math.round(ok / total * 100);
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, title)),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'result-seal hanzi-font' + (p >= 80 ? ' celebrate' : '') }, html('div', { className: 'pct' }, ok + '/' + total), html('div', { className: 'label' }, p + '%')),
      children,
      missed && missed.length > 0 && html('div', { className: 'hsk-exam-info', style: { marginTop: 12 } },
        html('div', { className: 'report-h' }, 'Para repasar'),
        missed.map((m, k) => html('div', { key: k, className: 'hsk-miss', onClick: () => speakReal(m.t) },
          html('span', { className: 'hanzi-font' }, m.t), ' ', html(TonedPinyin, { text: m.py, className: 'hsk-py' }), html('div', { className: 'hsk-fb-es' }, m.es)))),
      html('div', { className: 'result-actions' },
        html('button', { className: 'primary-btn', onClick: onAgain }, 'Otra vez'),
        html('button', { className: 'secondary-btn', onClick: onBack }, 'Volver'),
      ),
    ),
  );
}

// ── Simulacro: las 8 partes en orden, con reloj, sin corrección hasta el final ──
const HSK_TIME = { L: 15 * 60, R: 17 * 60 };
function HskExam({ bank, wm, onBack, onSave, onAgain }) {
  const [sections] = useState(() => { const o = {}; HSK_ORDER.forEach(k => { o[k] = buildHskSection(k, bank, wm); }); return o; });
  const [stage, setStage] = useState('intro');          // intro | run | result
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState({});             // kind → { ok, missed }
  const [left, setLeft] = useState(HSK_TIME.L);
  const progress = React.useRef({});
  const kind = HSK_ORDER[idx];
  const phase = kind ? kind[0] : 'R';

  const finishSection = (r) => {
    const all = { ...scores, [kind]: r || progress.current[kind] || { ok: 0, missed: [] } };
    setScores(all);
    goTo(idx + 1, all);
  };
  const goTo = (n, all) => {
    if (n >= HSK_ORDER.length) { finishExam(all); return; }
    if (HSK_ORDER[n][0] !== phase) setLeft(HSK_TIME.R);
    setIdx(n);
  };
  const finishExam = (all) => {
    const L = ['L1', 'L2', 'L3', 'L4'].reduce((s, k) => s + ((all[k] || {}).ok || 0), 0) * 5;
    const R = ['R1', 'R2', 'R3', 'R4'].reduce((s, k) => s + ((all[k] || {}).ok || 0), 0) * 5;
    const missed = HSK_ORDER.flatMap(k => (all[k] || {}).missed || []);
    const secs = {}; HSK_ORDER.forEach(k => { secs[k] = (all[k] || {}).ok || 0; });
    onSave({ kind: 'simulacro', score: L + R, total: 200, listening: L, reading: R, detail: { sections: secs, missed } });
    setScores(all); setStage('result');
  };
  // Reloj por fase: al terminarse el tiempo, se cierra la fase (lo no respondido cuenta mal)
  useEffect(() => {
    if (stage !== 'run') return;
    if (left <= 0) {
      const all = { ...scores };
      HSK_ORDER.forEach((k, n) => { if (n >= idx && k[0] === phase) all[k] = progress.current[k] || { ok: 0, missed: [] }; });
      setScores(all);
      const nextIdx = HSK_ORDER.findIndex(k => k[0] !== phase && HSK_ORDER.indexOf(k) > idx);
      if (nextIdx === -1) finishExam(all); else { setLeft(HSK_TIME.R); setIdx(nextIdx); }
      return;
    }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, left]);

  if (stage === 'intro') return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, '考 Simulacro HSK 1')),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'hsk-exam-info' },
        html('p', null, html('b', null, '听力 Comprensión auditiva'), ' · 20 preguntas · unos 15 minutos. Cada audio suena dos veces.'),
        html('p', null, html('b', null, '阅读 Lectura'), ' · 20 preguntas · 17 minutos.'),
        html('p', null, 'No hay corrección hasta el final y no se puede volver atrás. Cada respuesta correcta vale 5 puntos: 200 en total, se aprueba con 120.'),
        html('p', { style: { color: 'var(--ink-soft)' } }, 'Buscá un lugar tranquilo y usá auriculares.'),
      ),
      html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 14 }, onClick: () => { setStage('run'); setLeft(HSK_TIME.L); } }, 'Empezar'),
    ));

  if (stage === 'result') {
    const L = ['L1', 'L2', 'L3', 'L4'].reduce((s, k) => s + ((scores[k] || {}).ok || 0), 0) * 5;
    const R = ['R1', 'R2', 'R3', 'R4'].reduce((s, k) => s + ((scores[k] || {}).ok || 0), 0) * 5;
    const total = L + R, pass = total >= 120;
    const missed = HSK_ORDER.flatMap(k => (scores[k] || {}).missed || []);
    return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, 'Resultado del simulacro')),
      html('div', { className: 'hsk-wrap' },
        html('div', { className: 'hsk-score ' + (pass ? 'pass' : 'fail') },
          html('div', { className: 'hsk-score-n' }, total, html('small', null, ' / 200')),
          html('div', { className: 'hsk-score-v' }, pass ? '¡Aprobado! 🎉' : 'Te faltan ' + (120 - total) + ' puntos para aprobar'),
          html('div', { className: 'hsk-score-parts' },
            html('span', null, '听力 Escuchar: ', html('b', null, L), ' / 100'),
            html('span', null, '阅读 Leer: ', html('b', null, R), ' / 100'))),
        html('div', { className: 'hsk-secs', style: { marginTop: 12 } }, HSK_ORDER.map(k => {
          const ok = (scores[k] || {}).ok || 0;
          return html('div', { key: k, className: 'hsk-sec static' },
            html('span', { className: 'hsk-sec-tag ' + (k[0] === 'L' ? 'listen' : 'read') }, HSK_SECTIONS[k].short),
            html('span', { className: 'hsk-sec-title' }, HSK_SECTIONS[k].title),
            html('span', { className: 'hsk-sec-pct ' + (ok >= 4 ? 'ok' : ok >= 3 ? 'mid' : 'low') }, ok + '/5'));
        })),
        missed.length > 0 && html('div', { className: 'hsk-exam-info', style: { marginTop: 12 } },
          html('div', { className: 'report-h' }, 'Para repasar (' + missed.length + ')'),
          missed.map((m, k) => html('div', { key: k, className: 'hsk-miss', onClick: () => speakReal(m.t) },
            html('span', { className: 'hanzi-font' }, m.t), ' ', html(TonedPinyin, { text: m.py, className: 'hsk-py' }), html('div', { className: 'hsk-fb-es' }, m.es)))),
        html('div', { className: 'result-actions' },
          html('button', { className: 'primary-btn', onClick: onAgain }, 'Otro simulacro'),
          html('button', { className: 'secondary-btn', onClick: onBack }, 'Volver')),
      ));
  }

  const mm = String(Math.floor(Math.max(left, 0) / 60)).padStart(2, '0') + ':' + String(Math.max(left, 0) % 60).padStart(2, '0');
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html(HskSectionHead, { kind, exam: true, right: html('div', { className: 'hsk-timer' + (left <= 60 ? ' low' : '') }, '⏱ ' + mm) }),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'hsk-exam-progress' }, HSK_ORDER.map((k, n) => html('i', { key: k, className: n < idx ? 'done' : n === idx ? 'now' : '' }))),
      html(HskSectionBody, { key: kind, kind, section: sections[kind], mode: 'exam',
        onProgress: (r) => { progress.current[kind] = r; }, onDone: finishSection }),
    ));
}

// ── Refuerzos: números/horas/fechas/precios, palabras para preguntar, pares que se confunden ──
const ZH_DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PY_CH = { 零: 'líng', 一: 'yī', 二: 'èr', 两: 'liǎng', 三: 'sān', 四: 'sì', 五: 'wǔ', 六: 'liù', 七: 'qī', 八: 'bā', 九: 'jiǔ', 十: 'shí',
  点: 'diǎn', 分: 'fēn', 半: 'bàn', 块: 'kuài', 钱: 'qián', 月: 'yuè', 号: 'hào', 星: 'xīng', 期: 'qī', 日: 'rì', 岁: 'suì', 现: 'xiàn', 在: 'zài', 今: 'jīn', 天: 'tiān', 是: 'shì', 我: 'wǒ', 了: 'le' };
function numZh(n, measure) {
  if (n === 2 && measure) return '两';
  if (n < 10) return ZH_DIG[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + ZH_DIG[n % 10];
  return ZH_DIG[Math.floor(n / 10)] + '十' + (n % 10 ? ZH_DIG[n % 10] : '');
}
const pyOf = (zh) => [...zh].map(c => PY_CH[c] || c).join(' ').replace(/ (?=[，。])/g, '');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEK = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Distractores típicos: 4/10 (sì/shí), 14/40, 17/71, ±1
function confusable(n, max) {
  const c = [n + 1, n - 1, n === 4 ? 10 : n === 10 ? 4 : n + 10, n === 14 ? 40 : n === 40 ? 14 : n - 10,
    n % 10 && n > 10 ? (n % 10) * 10 + Math.floor(n / 10) : n + 2].filter(x => x >= 1 && x <= max && x !== n);
  return [...new Set(c)];
}
// Cada pregunta trae los "tokens" (palabras grabadas) que se encadenan para el audio
const numTokens = (n) => n <= 10 ? [ZH_DIG[n] || '十'] : n < 20 ? ['十', ZH_DIG[n % 10]] : [ZH_DIG[Math.floor(n / 10)], '十', ...(n % 10 ? [ZH_DIG[n % 10]] : [])];
const pick2 = (lo, hi) => { let n; do { n = rnd(lo, hi); } while (n === 2); return n; };  // 2 delante de clasificador es 两 (sin grabación)
function buildNumberQ() {
  const type = ['hora', 'fecha', 'dia', 'precio', 'edad'][rnd(0, 4)];
  const opts = (n, max, fmt) => shuffle([n, ...shuffle(confusable(n, max).filter(x => x !== 2)).slice(0, 2)]).map(x => ({ h: fmt(x), ok: x === n }));
  const mk = (tokens, es, label, options) => { const zh = tokens.join('') + '。'; return { zh, tokens, py: pyOf(zh), es, label, options }; };
  if (type === 'hora') {
    const h = pick2(1, 12);
    return mk(['现在', ...numTokens(h), '点'], 'Son las ' + h + ':00.', '¿Qué hora es?', opts(h, 12, x => x + ':00'));
  }
  if (type === 'fecha') {
    const mo = rnd(1, 12), d = rnd(1, 31);
    const fmt = (x) => x + ' de ' + MONTHS[mo - 1];
    return mk(['今天', ...numTokens(mo), '月', ...numTokens(d), '号'], 'Hoy es ' + fmt(d) + '.', '¿Qué fecha es?', opts(d, 31, fmt));
  }
  if (type === 'dia') {
    const d = rnd(1, 6);
    const others = shuffle([1, 2, 3, 4, 5, 6, 7].filter(x => x !== d)).slice(0, 2);
    return mk(['今天', '星期', ZH_DIG[d]], 'Hoy es ' + WEEK[d - 1] + '.', '¿Qué día es?', shuffle([d, ...others]).map(x => ({ h: WEEK[x - 1], ok: x === d })));
  }
  if (type === 'precio') {
    const n = pick2(3, 99);
    return mk([...numTokens(n), '块', '钱'], 'Cuesta ' + n + ' yuanes.', '¿Cuánto cuesta?', opts(n, 99, x => x + ' yuanes'));
  }
  const n = pick2(3, 90);
  return mk(['我', ...numTokens(n), '岁'], 'Tengo ' + n + ' años.', '¿Cuántos años tiene?', opts(n, 99, x => x + ' años'));
}

function HskDrill({ kind, bank, wm, onBack, onSave, onAgain }) {
  const TITLES = { numeros: 'Números, horas y precios', preguntas: 'Palabras para preguntar', pares: 'Palabras que se confunden' };
  const INSTR = { numeros: 'Escuchá y elegí lo que oíste. Ojo con 四 sì (4) y 十 shí (10).', preguntas: 'Leé la pregunta y elegí la respuesta que tiene sentido.', pares: 'Elegí la palabra que va en el hueco.' };
  const [qs] = useState(() => {
    if (kind === 'numeros') return Array.from({ length: 10 }, buildNumberQ);
    if (kind === 'preguntas') return shuffle(bank.qa).slice(0, 10).map(it => {
      const others = hskPickDistinct(bank.qa.filter(x => hskQGroup(x.q) !== hskQGroup(it.q)), 2, x => hskQGroup(x.q));
      return { zh: it.q, py: it.qpy, es: it.es, options: shuffle([it, ...others]).map(x => ({ h: x.a, py: x.apy, ok: x === it })) };
    });
    return shuffle(bank.par).slice(0, 10).map(it => ({ zh: it.s, py: it.py, es: it.es, tip: it.tip, full: it.s.replace('＿', it.ans), options: it.opts.map(o => ({ h: o, py: wordInfo(wm, o).py, ok: o === it.ans })) }));
  });
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [ok, setOk] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);
  const q = qs[i];
  const listen = kind === 'numeros';
  useEffect(() => { if (!done && listen) setTimeout(() => speakChain(q.tokens), 300); }, [i]);

  if (done) return html(HskResult, { title: TITLES[kind], ok, total: qs.length, missed, onAgain, onBack });
  const pick = (k) => {
    if (picked !== null) return;
    setPicked(k);
    if (q.options[k].ok) setOk(o => o + 1);
    else { playWrong(); setMissed(m => [...m, { t: q.full || q.zh, py: q.py, es: q.es }]); }
  };
  const next = () => {
    if (i + 1 >= qs.length) { setDone(true); onSave({ kind, score: ok, total: qs.length, detail: { missed } }); }
    else { setI(i + 1); setPicked(null); }
  };
  const answered = picked !== null;
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, TITLES[kind]),
      html('div', { className: 'flash-counter' }, (i + 1) + '/' + qs.length)),
    html('p', { className: 'hsk-instr' }, INSTR[kind]),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'hsk-q' },
        listen && html('button', { className: 'hsk-replay', onClick: () => speakChain(q.tokens) }, '🔊 Escuchar otra vez'),
        q.label && html('div', { className: 'hsk-q-count' }, q.label),
        !listen && html('div', { className: 'hsk-drill-s' },
          kind === 'preguntas' && html(TonedPinyin, { text: q.py, className: 'hsk-py' }),
          html('div', { className: 'hanzi-font' }, answered && q.full ? q.full : q.zh)),
        html('div', { className: 'hsk-text-opts' }, q.options.map((o, k) => html('button', { key: k, onClick: () => pick(k),
          className: 'hsk-text-opt' + (answered && o.ok ? ' right' : '') + (answered && picked === k && !o.ok ? ' wrong' : '') },
          html('span', { className: 'hsk-letter' }, LETTERS[k]),
          html('span', null, o.py && html(TonedPinyin, { text: o.py, className: 'hsk-py' }), html('span', { className: (kind === 'numeros' ? '' : 'hanzi-font ') + 'hsk-opt-h' }, o.h))))),
        answered && html('div', { className: 'hsk-feedback ' + (q.options[picked].ok ? 'ok' : 'bad') },
          html('div', { className: 'hsk-fb-title' }, q.options[picked].ok ? '¡Correcto!' : 'Incorrecto'),
          html('div', { className: 'hanzi-font hsk-fb-h' }, q.full || q.zh),
          html(TonedPinyin, { text: q.py, className: 'hsk-py' }),
          html('div', { className: 'hsk-fb-es' }, q.es),
          q.tip && html('div', { className: 'hsk-tip' }, '💡 ' + q.tip),
          html('button', { className: 'primary-btn', style: { marginTop: 10, width: '100%' }, onClick: next }, i + 1 >= qs.length ? 'Ver resultado' : 'Siguiente →')),
      )));
}

// ── Cuaderno de errores: todo lo que fallaste en prácticas y simulacros ──
function HskNotebook({ results, wm, onBack, onReview }) {
  const map = {};
  results.forEach(r => ((r.detail && r.detail.missed) || []).forEach(m => {
    if (!m || !m.t) return;
    const e = map[m.t] || (map[m.t] = { ...m, n: 0, last: r.created_at });
    e.n++;
  }));
  const list = Object.values(map).sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)));
  const asWords = list.map(m => wm[m.t]).filter(Boolean);
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, 'Cuaderno de errores')),
    html('div', { className: 'hsk-wrap' },
      !list.length && html('p', { className: 'admin-note', style: { textAlign: 'center' } }, 'Todavía no hay errores anotados. Acá aparece todo lo que falles en las prácticas y simulacros.'),
      asWords.length > 0 && html('button', { className: 'primary-btn', style: { width: '100%', marginBottom: 12 }, onClick: () => onReview(asWords) },
        'Repasar en tarjetas las ' + asWords.length + ' palabras'),
      list.map((m, k) => html('div', { key: k, className: 'hsk-miss', onClick: () => speakReal(m.t) },
        html('span', { className: 'hsk-miss-n' }, '×' + m.n),
        html('span', { className: 'hanzi-font' }, m.t), ' ', html(TonedPinyin, { text: m.py, className: 'hsk-py' }),
        html('div', { className: 'hsk-fb-es' }, m.es))),
    ));
}

function Hsk1WordList({ words, cardState, keyOf, onBack }) {
  const [filter, setFilter] = useState('all');
  const status = (w) => { const st = cardState[keyOf(w)]; return !st ? 'new' : st.box >= 3 ? 'ok' : 'learning'; };
  const shown = words.filter(w => filter === 'all' || status(w) === filter);
  const LABEL = { all: 'Todas', new: 'Sin ver', learning: 'Aprendiendo', ok: 'Aprendidas' };
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, 'Las 150 palabras'),
    ),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'report-tabs' }, Object.keys(LABEL).map(k => html('button', { key: k, className: 'report-tab' + (filter === k ? ' active' : ''), onClick: () => setFilter(k) },
        LABEL[k] + ' (' + (k === 'all' ? words.length : words.filter(w => status(w) === k).length) + ')'))),
      html('div', { className: 'hsk-list' }, shown.map(w => html('button', { key: w.id, className: 'hsk-word ' + status(w), onClick: () => speakReal(w.hanzi), title: 'Escuchar' },
        html('span', { className: 'hsk-word-n' }, w.id),
        html('span', { className: 'hsk-word-h hanzi-font' }, w.hanzi),
        html('span', { className: 'hsk-word-txt' }, html(TonedPinyin, { text: w.pinyin }), html('small', null, w.es)),
      ))),
    ),
  );
}

// Reporte HSK 1 de la clase (para el profe)
function Hsk1ClassReport({ classId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setRows(null);
    db.rpc('hsk1_class_report', { p_class: classId }).then(({ data, error }) => { if (error) setErr(error.message); setRows(data || []); });
  }, [classId]);
  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err + ' (¿ejecutaste npcr_hsk1.sql?)');
  if (!rows) return html('p', { className: 'admin-note' }, 'Cargando…');
  const active = rows.filter(r => r.user_id);
  const withSim = active.filter(r => r.last_sim !== null);
  const passing = withSim.filter(r => r.last_sim >= 120).length;
  const cell = (v) => v === undefined || v === null ? html('td', { className: 'hsk-cell none' }, '—')
    : html('td', { className: 'hsk-cell ' + (v >= 80 ? 'ok' : v >= 60 ? 'mid' : 'low') }, v + '%');
  return html('div', null,
    html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🎓 Preparación HSK 1'),
      html('p', { className: 'admin-note', style: { margin: 0 } },
        withSim.length ? passing + ' de ' + withSim.length + ' alumnos aprobarían según su último simulacro (120/200).' : 'Todavía nadie hizo un simulacro.'),
    ),
    html('div', { style: { overflowX: 'auto' } },
      html('table', { className: 'rank-table hsk-report' },
        html('thead', null, html('tr', null,
          html('th', null, 'Alumno'), html('th', null, 'Palabras'), html('th', null, 'Último simulacro'), html('th', null, 'Mejor'),
          HSK_ORDER.map(k => html('th', { key: k, title: HSK_SECTIONS[k].title }, HSK_SECTIONS[k].short)), html('th', null, 'Prácticas'))),
        html('tbody', null, rows.map((r, k) => html('tr', { key: k, style: r.user_id ? null : { opacity: 0.45 } },
          html('td', { style: { fontWeight: 700 } }, r.display_name),
          html('td', null, r.words_seen + '/150', html('div', { style: { fontSize: 11, color: 'var(--ink-soft)' } }, r.words_learned + ' aprendidas')),
          html('td', null, r.last_sim === null ? '—' : html('span', { className: 'hsk-sim ' + (r.last_sim >= 120 ? 'pass' : 'fail') }, r.last_sim),
            r.last_sim !== null && html('div', { style: { fontSize: 11, color: 'var(--ink-soft)' } }, 'E ' + (r.last_listening || 0) + ' · L ' + (r.last_reading || 0))),
          html('td', null, r.best_sim === null ? '—' : r.best_sim),
          HSK_ORDER.map(k => html(React.Fragment, { key: k }, cell((r.sections || {})[k]))),
          html('td', null, r.practices)))),
      )),
  );
}

// ----------------- Quiz -----------------
const FLAG_RE = /^\p{Emoji_Presentation}/u;
const FLAG_CODE_RE = /^([\u{1F1E0}-\u{1F1FF}]{2})/u;
function getFlagCode(es) {
  if (!es) return null;
  const m = es.match(FLAG_CODE_RE);
  if (!m) return null;
  return [...m[1]].map(c => String.fromCharCode(c.codePointAt(0) - 0x1F1A5)).join('').toLowerCase();
}
function stripFlag(es) {
  return es ? es.replace(/^[\u{1F1E0}-\u{1F1FF}]{2}\s*/u, '') : es;
}
function FlagImg({ es, size }) {
  const code = getFlagCode(es);
  if (!code) return null;
  const h = size || 18;
  const w = Math.round(h * 1.33);
  return html('img', { src: 'https://flagcdn.com/' + w + 'x' + h + '/' + code + '.png', style: { borderRadius: 2, verticalAlign: 'middle', marginRight: 6 }, alt: code.toUpperCase() });
}
function sameCategory(a, b) {
  // Si ambas tienen bandera (países) o ambas no tienen, son misma categoría
  return FLAG_RE.test(a.es) === FLAG_RE.test(b.es);
}
function buildQuizQuestions(words) {
  const picked = shuffle(words).slice(0, Math.min(8, words.length));
  return picked.map(w => {
    // Preferir distractores de la misma categoría (países con países, palabras con palabras)
    const samePool = shuffle(words.filter(x => x.es !== w.es && sameCategory(w, x)));
    const diffPool = shuffle(words.filter(x => x.es !== w.es && !sameCategory(w, x)));
    const pool = [...samePool, ...diffPool];
    const distractors = pool.slice(0, 3).map(x => x.es);
    const options = shuffle([w.es, ...distractors]);
    return { hanzi: w.hanzi, pinyin: w.pinyin, correct: w.es, options };
  });
}

function QuizGame({ words, lessonId, onBack, onHome, onFinish, nextAction, savedResult, onSaveResult, onClearResult }) {
  const [questions, setQuestions] = useState(() => buildQuizQuestions(words));
  const [index, setIndex] = useState(0);
  const [selectedOpt, setSelectedOpt] = useState(null);
  const [showPinyin, setShowPinyin] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [reviewWords, setReviewWords] = useState(() => (savedResult ? savedResult.reviewWords || [] : []));
  const [done, setDone] = useState(!!savedResult);

  const q = questions[index];

  const handlePick = (opt) => {
    if (selectedOpt) return;
    setSelectedOpt(opt);
    const isCorrect = opt === q.correct;
    if (isCorrect) playCorrect(); else playWrong();
    speak(q.hanzi);
    const newCount = correctCount + (isCorrect ? 1 : 0);
    const newWrong = wrongCount + (isCorrect ? 0 : 1);
    const newReview = isCorrect ? reviewWords : [...reviewWords, { hanzi: q.hanzi, pinyin: q.pinyin, es: q.correct }];
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        const percent = Math.round((newCount / questions.length) * 100);
        setCorrectCount(newCount);
        setWrongCount(newWrong);
        setReviewWords(newReview);
        setDone(true);
        onFinish(percent, newReview);
        onSaveResult({ percent, completed: newCount === questions.length, reviewWords: newReview });
      } else {
        setCorrectCount(newCount);
        setWrongCount(newWrong);
        setReviewWords(newReview);
        setIndex(index + 1);
        setSelectedOpt(null);
        setShowPinyin(false);
      }
    }, 700);
  };

  if (done) {
    const percent = savedResult ? savedResult.percent : Math.round((correctCount / questions.length) * 100);
    const completed = savedResult ? savedResult.completed : correctCount === questions.length;
    const shownReview = savedResult ? (savedResult.reviewWords || []) : reviewWords;
    return html(ResultScreen, {
      percent, lessonId, mode: 'quiz',
      completed,
      reviewWords: shownReview,
      onRetry: () => {
        setQuestions(buildQuizQuestions(words));
        setIndex(0);
        setSelectedOpt(null);
        setCorrectCount(0);
        setWrongCount(0);
        setReviewWords([]);
        setDone(false);
        onClearResult();
      },
      onHome,
      nextAction,
    });
  }

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Opción múltiple'),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + questions.length),
        html('button', { className: 'back-btn', onClick: onHome, title: 'Ir al inicio' }, '⌂'),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' },
          html('i', null, '✕'), 'Incorrectas: ' + wrongCount
        ),
        html('div', { className: 'flash-score-chip yes' },
          html('i', null, '✓'), 'Correctas: ' + correctCount
        ),
      ),
      html('div', { className: 'quiz-prompt' },
        !selectedOpt && html('button', { className: 'pinyin-toggle-btn', style: { marginBottom: 6 }, onClick: () => setShowPinyin(v => !v) },
          showPinyin ? '🙈 Ocultar pīnyīn' : '👁 Ver pīnyīn'
        ),
        (showPinyin || selectedOpt) && html(TonedPinyin, { text: q.pinyin, className: 'q-label' }),
        html('div', { className: 'q-hanzi hanzi-font' }, q.hanzi),
      ),
      html('div', { className: 'quiz-options' },
        q.options.map(opt => {
          let cls = 'quiz-option';
          if (selectedOpt) {
            cls += ' disabled';
            if (opt === q.correct) cls += ' correct';
            else if (opt === selectedOpt) cls += ' wrong';
          }
          return html('button', { key: opt, className: cls, onClick: () => handlePick(opt) }, stripFlag(opt));
        })
      )
    )
  );
}

// ----------------- Result screen -----------------
function ReviewList({ reviewWords }) {
  if (!reviewWords || reviewWords.length === 0) return null;
  return html('div', { className: 'review-list' },
    html('div', { className: 'review-list-title' }, 'Para repasar (' + reviewWords.length + ')'),
    reviewWords.map((w, i) => html('div', { key: i, className: 'review-item' },
      html('div', { className: 'review-hanzi hanzi-font' }, w.hanzi),
      html('div', { className: 'review-info' },
        html('div', { className: 'review-pinyin' }, w.pinyin),
        html('div', { className: 'review-es' }, w.es),
      )
    ))
  );
}

function ResultScreen({ percent, mode, completed, reviewWords, onRetry, onHome, nextAction }) {
  if (completed) {
    return html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'result-screen' },
        html('div', { className: 'result-seal hanzi-font celebrate' },
          html('div', { className: 'pct' }, '完'),
          html('div', { className: 'label' }, '100%')
        ),
        html('div', { className: 'result-title' }, '¡Felicitaciones!'),
        html('div', { className: 'result-sub' }, 'Completaste este ejercicio sin errores'),
        html('div', { className: 'result-actions' },
          nextAction && html('button', { className: 'primary-btn', onClick: nextAction.go }, nextAction.label),
          html('button', { className: nextAction ? 'secondary-btn' : 'primary-btn', onClick: onRetry }, 'Volver a intentar'),
          html('button', { className: 'secondary-btn', onClick: onHome }, 'Volver al inicio'),
        ),
        html(ReviewList, { reviewWords })
      )
    );
  }

  let title, sub;
  if (percent >= 90) { title = '¡Excelente!'; sub = 'Dominaste esta lección'; }
  else if (percent >= 70) { title = '¡Muy bien!'; sub = 'Casi perfecto, seguí practicando'; }
  else if (percent >= 50) { title = 'Buen intento'; sub = 'Repasá un poco más y volvé a intentar'; }
  else { title = 'Sigamos practicando'; sub = 'Cada repaso ayuda a memorizar'; }

  return html('main', { style: { paddingTop: '18px' } },
    html('div', { className: 'result-screen' },
      html('div', { className: 'result-seal hanzi-font' },
        html('div', { className: 'pct' }, percent + '%'),
        html('div', { className: 'label' }, 'SCORE')
      ),
      html('div', { className: 'result-title' }, title),
      html('div', { className: 'result-sub' }, sub),
      html('div', { className: 'result-actions' },
        nextAction && html('button', { className: 'primary-btn', onClick: nextAction.go }, nextAction.label),
        html('button', { className: nextAction ? 'secondary-btn' : 'primary-btn', onClick: onRetry }, 'Volver a intentar'),
        html('button', { className: 'secondary-btn', onClick: onHome }, 'Volver al inicio'),
      ),
      html(ReviewList, { reviewWords })
    )
  );
}

// ----------------- Refuerzo: helpers -----------------
function getMissedWords(progress) {
  const all = [];
  const lp = progress.lessons || {};
  Object.keys(lp).forEach(lid => {
    ['match', 'cards', 'quiz'].forEach(mode => {
      (lp[lid][mode + '_missed'] || []).forEach(w => { if (w && w.hanzi) all.push(w); });
    });
  });
  const pp = progress.prueba || {};
  ['clas', 'dialogo', 'orden', 'audio'].forEach(game => {
    (pp[game + '_missed'] || []).forEach(w => { if (w && w.hanzi) all.push(w); });
  });
  const seen = new Set();
  return all.filter(w => {
    if (seen.has(w.hanzi)) return false;
    seen.add(w.hanzi);
    return true;
  });
}

// Versión con pesos: prioriza palabras con más errores y errores recientes
function getSmartMissedWords(progress, wordErrorsMap) {
  const base = getMissedWords(progress);
  if (!wordErrorsMap || Object.keys(wordErrorsMap).length === 0) return base;
  const now = Date.now();
  return base.map(w => {
    const err = wordErrorsMap[w.hanzi];
    if (!err) return { ...w, _score: 1 };
    const daysSinceError   = err.last_error   ? (now - new Date(err.last_error).getTime())   / 86400000 : 30;
    const daysSinceCorrect = err.last_correct ? (now - new Date(err.last_correct).getTime()) / 86400000 : 999;
    const recency      = daysSinceError < 1 ? 2.0 : daysSinceError < 3 ? 1.5 : daysSinceError < 7 ? 1.1 : 0.8;
    const correctBonus = daysSinceCorrect < 1 ? 0.2 : daysSinceCorrect < 3 ? 0.5 : 1.0;
    return { ...w, _score: (err.error_count || 1) * recency * correctBonus };
  }).sort((a, b) => b._score - a._score);
}

// ----------------- Refuerzo: Tarjetas de estudio -----------------
function StudyCardsPhase({ words, onDone, onBack }) {
  const [deck] = useState(() => shuffle([...words]));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const w = deck[index];
  const isLast = index === deck.length - 1;
  return html(React.Fragment, null,
    html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Tarjetas de estudio'),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + deck.length),
      ),
      html('div', { style: { padding: '16px 16px 0' } },
        html('div', {
          onClick: () => { setFlipped(f => !f); if (!flipped) speak(w.hanzi); },
          style: {
            minHeight: 220, borderRadius: 20, background: '#fff',
            boxShadow: 'var(--shadow-paper)', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '32px 24px', gap: 14, marginBottom: 24, transition: 'background 0.2s',
          }
        },
          !flipped
            ? html(React.Fragment, null,
                html('div', { className: 'hanzi-font', style: { fontSize: 96, color: 'var(--lacquer)', lineHeight: 1.1 } }, w.hanzi),
                html('div', { style: { fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 8 } }, '👆 Tocá para ver'),
              )
            : html(React.Fragment, null,
                html('div', { className: 'hanzi-font', style: { fontSize: 72, color: 'var(--lacquer)', lineHeight: 1.1, marginBottom: 4 } }, w.hanzi),
                html(TonedPinyin, { text: w.pinyin, style: { fontSize: 20, fontWeight: 800, letterSpacing: 1 } }),
                html('div', { style: { fontSize: 16, color: 'var(--ink-mid)', fontWeight: 600, textAlign: 'center', marginTop: 6 } }, w.es),
              ),
        ),
        html('div', { style: { display: 'flex', gap: 12 } },
          html('button', {
            className: 'secondary-btn', style: { margin: 0, flex: 1 },
            disabled: index === 0,
            onClick: () => { setFlipped(false); setIndex(i => i - 1); },
          }, '← Anterior'),
          isLast
            ? html('button', { className: 'primary-btn', style: { flex: 1 }, onClick: onDone }, '¡Listo! →')
            : html('button', { className: 'primary-btn', style: { flex: 1 }, onClick: () => { setFlipped(false); setIndex(i => i + 1); } }, 'Siguiente →'),
        ),
      ),
    )
  );
}

// ----------------- Refuerzo: Quiz genérico -----------------
function buildRefuerzoMC(words, allWords, mode) {
  return shuffle([...words]).map(w => {
    let show, hint, correct, distractor;
    if (mode === 'pinyin') { show = w.hanzi; hint = w.es; correct = w.pinyin; distractor = x => x.pinyin; }
    else if (mode === 'hanzi') { show = w.es; hint = w.pinyin; correct = w.hanzi; distractor = x => x.hanzi; }
    else { show = w.hanzi; hint = w.pinyin; correct = w.es; distractor = x => x.es; }
    const pool = shuffle([...allWords].filter(x => x.hanzi !== w.hanzi && distractor(x) !== correct));
    const options = shuffle([correct, ...pool.slice(0, 2).map(distractor)]);
    return { show, hint, correct, options, word: w };
  });
}

function RefuerzoMC({ words, allWords, mode, title, onDone, onBack, playerName }) {
  const [questions] = useState(() => buildRefuerzoMC(words, allWords, mode));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [correctRef, setCorrectRef] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);

  const q = questions[index];
  const isHanzi = mode === 'hanzi';
  const isCorrect = selected !== null && selected === q.correct;

  const handlePick = (opt) => {
    if (selected !== null) return;
    setSelected(opt);
    const ok = opt === q.correct;
    if (ok) playCorrect(); else playWrong();
    // Pronunciar el hanzi (si el modo lo muestra) o la respuesta correcta en hanzi
    const hanziToSpeak = mode === 'es' || mode === 'pinyin' ? q.show : q.correct;
    if (hanziToSpeak && /[一-鿿]/.test(hanziToSpeak)) speak(hanziToSpeak);
    const nc = correct + (ok ? 1 : 0);
    setCorrectRef(nc);
    if (ok) setCorrect(nc);
    else {
      const orig = words.find(w => (mode === 'pinyin' || mode === 'es' ? w.hanzi : w.es) === q.show) || {};
      setMissed(m => [...m, orig]);
    }
  };

  const handleNext = () => {
    const next = index + 1;
    if (next >= questions.length) {
      setDone(true);
      if (onDone) onDone();
    } else { setIndex(next); setSelected(null); }
  };

  if (done) return html(PruebaResult, {
    percent: Math.round((correctRef / questions.length) * 100),
    total: questions.length, correct: correctRef, missed,
    onRetry: () => { setIndex(0); setSelected(null); setCorrect(0); setCorrectRef(0); setMissed([]); setDone(false); },
    onBack, playerName,
  });

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: 18 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, title),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + questions.length),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), correct + ' correctas'),
      ),
      html('div', { style: { padding: '16px 16px 0' } },
        html('div', { style: { background: '#fff', borderRadius: 20, boxShadow: 'var(--shadow-paper)', padding: '28px 24px', textAlign: 'center', marginBottom: 20 } },
          isHanzi
            ? html(React.Fragment, null,
                html('div', { style: { fontSize: 16, color: 'var(--ink-mid)', fontWeight: 600, marginBottom: 10 } }, q.show),
                html(TonedPinyin, { text: q.hint, style: { fontSize: 15, color: 'var(--lacquer-dark)', fontWeight: 700, letterSpacing: 0.5 } }),
              )
            : html(React.Fragment, null,
                html('div', { className: 'hanzi-font', style: { fontSize: 60, color: 'var(--lacquer)', lineHeight: 1.1, marginBottom: 8 } }, q.show),
                mode === 'pinyin'
                  ? html('div', { style: { fontSize: 14, color: 'var(--ink-soft)', fontWeight: 600 } }, q.hint)
                  : html(TonedPinyin, { text: q.hint, style: { fontSize: 14, color: 'var(--ink-soft)', fontWeight: 600 } }),
              ),
        ),
        selected !== null
          ? html(React.Fragment, null,
              html('div', { style: {
                borderRadius: 16, padding: '18px 20px', textAlign: 'center', fontWeight: 800, marginBottom: 16,
                background: isCorrect ? 'var(--jade-light)' : '#FDE4DD',
                color: isCorrect ? 'var(--jade-dark)' : 'var(--lacquer-dark)',
              }},
                html('div', { style: { fontSize: 36 } }, isCorrect ? '✓' : '✗'),
                html('div', { style: { fontSize: 18, marginTop: 4 } }, isCorrect ? '¡Correcto!' : 'La respuesta era:'),
                html('div', { className: 'answer-trio' },
                  html('div', { className: 'hanzi-font answer-trio-hanzi' }, q.word.hanzi),
                  html(TonedPinyin, { text: q.word.pinyin, className: 'answer-trio-pinyin' }),
                  html('div', { className: 'answer-trio-es' }, q.word.es),
                ),
              ),
              html('button', { className: 'primary-btn', onClick: handleNext },
                index < questions.length - 1 ? 'Siguiente →' : 'Ver resultado'
              ),
            )
          : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              q.options.map((opt, i) => html('button', {
                key: i, className: 'quiz-option',
                style: {
                  textAlign: 'center',
                  fontFamily: isHanzi ? 'Noto Serif SC, serif' : 'Nunito, sans-serif',
                  fontSize: isHanzi ? 24 : 15,
                },
                onClick: () => handlePick(opt),
              }, String.fromCharCode(65 + i) + '.  ' + opt)),
            ),
      ),
    )
  );
}

// ----------------- Refuerzo: Session hub -----------------
const REFUERZO_EXERCISES = [
  { id: 'cards',  icon: '📖', label: 'Tarjetas de estudio',    sub: 'Repasá hanzi, pinyin y significado' },
  { id: 'es',     icon: '🇪🇸', label: '¿Qué significa?',        sub: 'Ves el hanzi, elegís el significado' },
  { id: 'pinyin', icon: '🔤', label: '¿Cuál es el pinyin?',      sub: 'Ves el hanzi, elegís el pinyin' },
  { id: 'hanzi',  icon: '汉', label: '¿Cómo se escribe?',       sub: 'Ves el significado, elegís el hanzi' },
  { id: 'match',  icon: '🔗', label: 'Emparejamiento',          sub: 'Une hanzi con su pinyin y significado' },
];

function RefuerzoSession({ words, allWords, onBack, playerName }) {
  const [current, setCurrent] = useState(null);
  const [done, setDone] = useState(new Set());

  const markDone = (id) => { setDone(prev => new Set([...prev, id])); setCurrent(null); };
  const goBack = () => setCurrent(null);
  const noop = () => {};

  if (!words || words.length === 0) return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('div', null, html('h1', null, 'Reforcemos')),
    ),
    html('div', { style: { padding: '0 16px', marginTop: 24 } },
      html('div', { style: { background: 'var(--card)', borderRadius: 16, padding: '28px 20px', textAlign: 'center', border: '1.5px solid var(--border)' } },
        html('div', { style: { fontSize: 48, marginBottom: 12 } }, '🌱'),
        html('div', { style: { fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 } }, 'Todavía no tenés palabras para repasar'),
        html('div', { style: { fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55 } },
          'Esta sección se llena automáticamente con las palabras donde te equivocaste en Tarjetas, Quiz y los juegos.',
          html('br', null),
          html('br', null),
          'Practicá algunas actividades — cuando cometas errores, esas palabras aparecerán acá para reforzarlas. 💪',
        ),
      ),
    ),
  );

  if (current === 'cards') return html(StudyCardsPhase, { words, onDone: () => markDone('cards'), onBack: goBack });
  if (current === 'es')    return html(RefuerzoMC, { words, allWords, mode: 'es',    title: '¿Qué significa?',   onDone: () => markDone('es'),    onBack: goBack, playerName });
  if (current === 'pinyin') return html(RefuerzoMC, { words, allWords, mode: 'pinyin', title: '¿Cuál es el pinyin?',     onDone: () => markDone('pinyin'), onBack: goBack, playerName });
  if (current === 'hanzi')  return html(RefuerzoMC, { words, allWords, mode: 'hanzi',  title: '¿Cómo se escribe?', onDone: () => markDone('hanzi'),  onBack: goBack, playerName });
  if (current === 'match')  return html(MatchGame, {
    words, lessonId: null,
    onBack: goBack, onHome: goBack,
    onFinish: () => markDone('match'),
    nextAction: null, savedResult: null, onSaveResult: noop, onClearResult: noop,
  });

  // Hub
  const allDone = done.size === REFUERZO_EXERCISES.length;
  return html(React.Fragment, null,
    html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('div', null,
          html('h1', null, 'Reforcemos'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 } }, 'Práctica personalizada · ' + words.length + ' palabras'),
        ),
        html('div', { style: { fontSize: 13, fontWeight: 800, color: done.size === REFUERZO_EXERCISES.length ? 'var(--jade)' : 'var(--ink-soft)' } },
          done.size + '/' + REFUERZO_EXERCISES.length + ' ✓'
        ),
      ),
      html('div', { style: { padding: '0 16px' } },
        html('div', { style: { display: 'flex', gap: 6, marginBottom: 20 } },
          REFUERZO_EXERCISES.map((e, i) => html('div', {
            key: e.id,
            style: {
              flex: 1, height: 5, borderRadius: 4,
              background: done.has(e.id) ? 'var(--jade)' : 'var(--paper-deep)',
            }
          }))
        ),
        allDone && html('div', { style: {
          background: 'var(--jade-light)', borderRadius: 16, padding: '16px 20px',
          textAlign: 'center', marginBottom: 20, fontWeight: 800, color: 'var(--jade-dark)',
        }},
          html('div', { style: { fontSize: 32 } }, '🎉'),
          html('div', { style: { fontSize: 17, marginTop: 6 } }, '¡Completaste todos los ejercicios!'),
        ),
        REFUERZO_EXERCISES.map(e => html('button', {
          key: e.id,
          className: 'prueba-card',
          style: { marginBottom: 10, opacity: 1 },
          onClick: () => setCurrent(e.id),
        },
          html('div', { className: 'prueba-icon', style: { fontFamily: 'Noto Serif SC, serif', fontSize: e.id === 'hanzi' ? 22 : 20, background: done.has(e.id) ? 'var(--jade-light)' : 'var(--paper)' } }, e.icon),
          html('div', { style: { flex: 1 } },
            html('div', { className: 'mode-title' }, e.label),
            html('div', { className: 'mode-sub' }, e.sub),
          ),
          done.has(e.id) && html('div', { style: { fontSize: 20, color: 'var(--jade)' } }, '✓'),
        )),
      ),
    )
  );
}

// ----------------- Admin panel -----------------
function parseVocabText(text) {
  // Expects lines like: 5 | 餐厅 | cāntīng | comedor
  // or tab-separated, grouped by "Lección N" headers
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {};
  let currentLesson = null;
  for (const line of lines) {
    const lessonMatch = line.match(/lecci[oó]n\s+(\d+)/i);
    if (lessonMatch) {
      currentLesson = lessonMatch[1];
      if (!result[currentLesson]) result[currentLesson] = [];
      continue;
    }
    const parts = line.split(/\t|\|/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      let lesson = currentLesson;
      let hanzi, pinyin, es;
      if (parts.length >= 4 && /^\d+$/.test(parts[0])) {
        lesson = parts[0];
        [hanzi, pinyin, es] = [parts[1], parts[2], parts[3]];
      } else {
        [hanzi, pinyin, es] = [parts[0], parts[1], parts[2]];
      }
      if (!lesson) lesson = '1';
      if (!result[lesson]) result[lesson] = [];
      if (hanzi && pinyin && es && hanzi !== 'Carácter') {
        result[lesson].push({ hanzi, pinyin, es });
      }
    }
  }
  return result;
}

// Helper: convierte filas de Supabase al formato { "5": [{hanzi,pinyin,es},...], ... }
// Normaliza strings NFD→NFC para que las tildes del pinyin se muestren correctas
function nfc(s) { return s ? s.normalize('NFC') : s; }

function supabaseRowsToVocab(rows) {
  const vocab = {};
  rows.forEach(r => {
    if (!vocab[r.lesson]) vocab[r.lesson] = [];
    vocab[r.lesson].push({ hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), es: nfc(r.es) });
  });
  return vocab;
}

// ═══════════════════════════════════════════════════════════
// SIMULACRO DE EXAMEN — Nivel III, Lecciones 9-11 (admin only)
// ═══════════════════════════════════════════════════════════
const EXAM_EJ1A = [
  { hanzi: '蛋糕', pinyin: 'dàngāo', es: 'pastel' },
  { hanzi: '便宜', pinyin: 'piányi', es: 'barato' },
  { hanzi: '英语', pinyin: 'Yīngyǔ', es: 'inglés' },
  { hanzi: '睡觉', pinyin: 'shuìjiào', es: 'dormir' },
  { hanzi: '一刻', pinyin: 'kè', es: 'cuarto (de hora)' },
];
const EXAM_EJ1B_LEFT  = ['买', '差', '祝你', '我晚上', '他今年', '一张'];
const EXAM_EJ1B_RIGHT = ['生日快乐', '在家看书', '一斤苹果', '音乐光盘', '二十二岁', '五分十点'];
// correcto: LEFT[i] → RIGHT[ EXAM_EJ1B_ANS[i] ]
const EXAM_EJ1B_ANS   = [2, 5, 0, 1, 4, 3];

const EXAM_EJ2 = [
  { q: '苹果多少钱一 ______？', opts: ['A 斤', 'B 个', 'C 瓶'], ans: 0 },
  { q: '我 ______ 林娜去买生日蛋糕。', opts: ['A 都', 'B 跟', 'C 很'], ans: 1 },
  { q: '这个星期天是我的 ______。', opts: ['A 聚会', 'B 快乐', 'C 生日'], ans: 2 },
  { q: '我们早上八点 ______ 上课。', opts: ['A 分', 'B 半', 'C 差'], ans: 1 },
  { q: '你的手机号码是 ______？', opts: ['A 多大', 'B 几', 'C 多少'], ans: 2 },
  { q: '您 ______？', opts: ['A 怎么卖', 'B 贵姓', 'C 多少钱'], ans: 1 },
];

const EXAM_EJ3 = [
  { words: ['去','下午','书店','星期一','我'], correct: '星期一下午我去书店', es: 'El lunes por la tarde voy a la librería.' },
  { words: ['买','音乐光盘','你','几张','要'], correct: '你要买几张音乐光盘', es: '¿Cuántos CDs de música querés comprar?' },
  { words: ['我们','见面','点','晚上','差一刻','七'], correct: '我们晚上差一刻七点见面', es: 'Nos encontramos a las siete menos cuarto de la noche.' },
  { words: ['朋友','她','常常','玩儿','去','家'], correct: '她常常去朋友家玩儿', es: 'Ella a menudo va a la casa de su amigo a pasarla bien.' },
  { words: ['是','号码','多少','你的','手机'], correct: '你的手机号码是多少', es: '¿Cuál es tu número de celular?' },
];

const EXAM_EJ4_PARTES = [
  { t: '今天是星期六。大卫晚上有一个生日聚会。上午他' },
  { blank: 0, ans: '跟' },
  { t: '宋华去商场买东西。商场的苹果很便宜，他买了两斤。他' },
  { blank: 1, ans: '还' },
  { t: '买了三个面包。大卫问宋华："你晚上' },
  { blank: 2, ans: '怎么' },
  { t: '去聚会？"宋华说："我打的(dǎdī)去。"晚上七点' },
  { blank: 3, ans: '半' },
  { t: '，他们' },
  { blank: 4, ans: '在' },
  { t: '朋友家一起吃生日蛋糕，听中国音乐。' },
];
const EXAM_EJ4_BANCO = ['在', '半', '跟', '还', '怎么'];

const EXAM_EJ4B = [
  { s: '今天是星期天。', ans: false, exp: '→ 今天是星期六' },
  { s: '大卫买了三斤苹果。', ans: false, exp: '→ 买了两斤' },
  { s: '宋华晚上打的去聚会。', ans: true, exp: '✓ Correcto' },
  { s: '聚会晚上七点半开始。', ans: true, exp: '✓ Correcto' },
  { s: '他们在商场吃蛋糕。', ans: false, exp: '→ 在朋友家吃蛋糕' },
];

const EXAM_EJ5A = [
  { q: '马大为早上 ______ 起床。', opts: ['A 七点', 'B 八点', 'C 九点'], ans: 1 },
  { q: '他下午 ______ 下课。', opts: ['A 差一刻两点', 'B 两点', 'C 两点半'], ans: 0 },
  { q: '晚上他在家 ______。', opts: ['A 听音乐', 'B 睡觉', 'C 看书'], ans: 2 },
  { q: '马大为 ______ 吃早饭。', opts: ['A 7:00', 'B 7:30', 'C 8:00'], ans: 1 },
  { q: '他几点睡觉？', opts: ['A 十点', 'B 十点半', 'C 十一点'], ans: 2 },
];

const EXAM_EJ5B = [
  { s: '马大为每天早上八点起床。', ans: false, exp: '→ 七点起床' },
  { s: '他在学院上课。', ans: false, exp: '→ No se menciona en el texto' },
  { s: '晚上他去朋友家。', ans: false, exp: '→ Está en casa leyendo' },
  { s: '差一刻两点是1:45。', ans: true, exp: '✓ Correcto' },
  { s: '他十一点去睡觉。', ans: true, exp: '✓ Correcto' },
];

// ── Diálogos para práctica oral ──
const DIALOGOS_PRACTICA = {
  reunion: {
    titulo: '朋友们去买东西 — Amigos que van de compras',
    roles: ['朋友A (David)', '朋友B (Lin)'],
    turns: [
      { quien: 0, texto: '喂，你好，林娜！这个星期六你有没有时间？', pinyin: 'Wèi, nǐ hǎo, Línnà! Zhège xīngqīliù nǐ yǒu méiyou shíjiān?', es: '¡Hola Lin! ¿Tenés tiempo este sábado?' },
      { quien: 1, texto: '有！你想做什么？', pinyin: 'Yǒu! Nǐ xiǎng zuò shénme?', es: '¡Sí! ¿Qué tenés en mente?' },
      { quien: 0, texto: '我们一起去商场买东西，怎么样？', pinyin: 'Wǒmen yīqǐ qù shāngchǎng mǎi dōngxi, zěnmeyàng?', es: '¿Vamos juntos al shopping a comprar cosas?' },
      { quien: 1, texto: '好主意！几点见面？在哪儿见？', pinyin: 'Hǎo zhǔyi! Jǐ diǎn jiànmiàn? Zài nǎr jiàn?', es: '¡Buena idea! ¿A qué hora y dónde nos encontramos?' },
      { quien: 0, texto: '上午十点，在学院门口，好吗？', pinyin: 'Shàngwǔ shí diǎn, zài xuéyuàn ménkǒu, hǎo ma?', es: 'A las diez de la mañana, en la entrada del instituto, ¿te parece?' },
      { quien: 1, texto: '好的，没问题！那你想买什么？', pinyin: 'Hǎo de, méi wèntí! Nà nǐ xiǎng mǎi shénme?', es: '¡Perfecto, sin problema! ¿Y qué querés comprar?' },
      { quien: 0, texto: '我想买一张音乐光盘，还想买一点儿水果。你呢？', pinyin: 'Wǒ xiǎng mǎi yī zhāng yīnyuè guāngpán, hái xiǎng mǎi yīdiǎnr shuǐguǒ. Nǐ ne?', es: 'Quiero comprar un CD de música y también un poco de fruta. ¿Y vos?' },
      { quien: 1, texto: '我想买苹果和蛋糕，是我朋友的生日！', pinyin: 'Wǒ xiǎng mǎi píngguǒ hé dàngāo, shì wǒ péngyou de shēngrì!', es: '¡Quiero comprar manzanas y una torta, es el cumpleaños de mi amigo!' },
      { quien: 0, texto: '太好了！祝你朋友生日快乐！星期六见！', pinyin: 'Tài hǎo le! Zhù nǐ péngyou shēngrì kuàilè! Xīngqīliù jiàn!', es: '¡Qué bueno! ¡Feliz cumpleaños a tu amigo! ¡Nos vemos el sábado!' },
      { quien: 1, texto: '好，再见！', pinyin: 'Hǎo, zàijiàn!', es: '¡Hasta el sábado!' },
    ]
  },
  compras: {
    titulo: '在商场买东西 — En el shopping (compra + regateo)',
    roles: ['老板 (vendedor)', 'Cliente'],
    turns: [
      { quien: 1, texto: '你好！这张光盘多少钱？', pinyin: 'Nǐ hǎo! Zhè zhāng guāngpán duōshao qián?', es: '¡Hola! ¿Cuánto cuesta este CD?' },
      { quien: 0, texto: '十五块钱。', pinyin: 'Shíwǔ kuài qián.', es: 'Quince yuan.' },
      { quien: 1, texto: '太贵了！便宜一点儿，好吗？', pinyin: 'Tài guì le! Piányi yīdiǎnr, hǎo ma?', es: '¡Es muy caro! ¿Un poco más barato, por favor?' },
      { quien: 0, texto: '好，十二块钱，怎么样？', pinyin: 'Hǎo, shíèr kuài qián, zěnmeyàng?', es: 'Bueno, doce yuan, ¿qué te parece?' },
      { quien: 1, texto: '好的，我买。苹果多少钱一斤？', pinyin: 'Hǎo de, wǒ mǎi. Píngguǒ duōshao qián yī jīn?', es: 'Bien, lo compro. ¿A cuánto está el medio kilo de manzanas?' },
      { quien: 0, texto: '三块钱一斤。你要几斤？', pinyin: 'Sān kuài qián yī jīn. Nǐ yào jǐ jīn?', es: 'Tres yuan el medio kilo. ¿Cuántos jin querés?' },
      { quien: 1, texto: '我要两斤。一共多少钱？', pinyin: 'Wǒ yào liǎng jīn. Yīgòng duōshao qián?', es: 'Quiero dos jin. ¿Cuánto es en total?' },
      { quien: 0, texto: '光盘十二块，苹果六块，一共十八块钱。', pinyin: 'Guāngpán shíèr kuài, píngguǒ liù kuài, yīgòng shíbā kuài qián.', es: 'El CD doce yuan, las manzanas seis yuan, en total dieciocho yuan.' },
      { quien: 1, texto: '给你二十块钱。', pinyin: 'Gěi nǐ èrshí kuài qián.', es: 'Aquí tiene veinte yuan.' },
      { quien: 0, texto: '找你两块钱。谢谢，再见！', pinyin: 'Zhǎo nǐ liǎng kuài qián. Xièxie, zàijiàn!', es: 'Le devuelvo dos yuan. ¡Gracias, hasta luego!' },
      { quien: 1, texto: '谢谢！再见！', pinyin: 'Xièxie! Zàijiàn!', es: '¡Gracias! ¡Hasta luego!' },
    ]
  },
  vendedor: {
    titulo: 'Vendedor y cliente — frutas / CDs',
    roles: ['老板 (vendedor)', 'Cliente'],
    turns: [
      { quien: 1, texto: '你好！老板，苹果多少钱一斤？', pinyin: 'Nǐ hǎo! Lǎobǎn, píngguǒ duōshao qián yī jīn?', es: '¡Hola! ¿A cuánto está el medio kilo de manzanas?' },
      { quien: 0, texto: '你好！苹果三块二毛一斤。', pinyin: 'Nǐ hǎo! Píngguǒ sān kuài èr máo yī jīn.', es: '¡Hola! Las manzanas son 3,20 yuan el medio kilo (500g).' },
      { quien: 1, texto: '太贵了！便宜一点儿，好吗？', pinyin: 'Tài guì le! Piányi yīdiǎnr, hǎo ma?', es: '¡Demasiado caro! ¿Un poco más barato, por favor?' },
      { quien: 0, texto: '好，三块钱一斤。你要几斤？', pinyin: 'Hǎo, sān kuài qián yī jīn. Nǐ yào jǐ jīn?', es: 'Bueno, 3 yuan el medio kilo. ¿Cuántos jin querés?' },
      { quien: 1, texto: '我要两斤。一共多少钱？', pinyin: 'Wǒ yào liǎng jīn. Yīgòng duōshao qián?', es: 'Quiero dos jin (1kg). ¿Cuánto es en total?' },
      { quien: 0, texto: '一共六块钱。', pinyin: 'Yīgòng liù kuài qián.', es: 'En total son 6 yuan.' },
      { quien: 1, texto: '给你十块钱。', pinyin: 'Gěi nǐ shí kuài qián.', es: 'Aquí tiene diez yuan.' },
      { quien: 0, texto: '找你四块钱。谢谢！', pinyin: 'Zhǎo nǐ sì kuài qián. Xièxie!', es: 'Le devuelvo cuatro yuan. ¡Gracias!' },
      { quien: 1, texto: '谢谢，再见！', pinyin: 'Xièxie, zàijiàn!', es: '¡Gracias, hasta luego!' },
      { quien: 0, texto: '再见！', pinyin: 'Zàijiàn!', es: '¡Hasta luego!' },
    ]
  },
  amigos: {
    titulo: 'Dos amigos — acordar una actividad',
    roles: ['朋友A', '朋友B'],
    turns: [
      { quien: 0, texto: '喂，你好！这个星期六晚上你有没有时间？', pinyin: 'Wèi, nǐ hǎo! Zhège xīngqīliù wǎnshang nǐ yǒu méiyou shíjiān?', es: '¡Hola! ¿Tenés tiempo el sábado por la noche?' },
      { quien: 1, texto: '对不起，星期六晚上我去看京剧。星期三晚上怎么样？', pinyin: 'Duìbuqǐ, xīngqīliù wǎnshang wǒ qù kàn jīngjù. Xīngqīsān wǎnshang zěnmeyàng?', es: 'Lo siento, el sábado por la noche voy a ver ópera de Pekín. ¿Qué tal el miércoles por la noche?' },
      { quien: 0, texto: '星期三晚上可以。我们去游泳，好吗？', pinyin: 'Xīngqīsān wǎnshang kěyǐ. Wǒmen qù yóuyǒng, hǎo ma?', es: 'El miércoles por la noche está bien. ¿Vamos a nadar?' },
      { quien: 1, texto: '好主意！几点见面？', pinyin: 'Hǎo zhǔyi! Jǐ diǎn jiànmiàn?', es: '¡Buena idea! ¿A qué hora nos encontramos?' },
      { quien: 0, texto: '晚上七点，在学院门口，怎么样？', pinyin: 'Wǎnshang qī diǎn, zài xuéyuàn ménkǒu, zěnmeyàng?', es: 'A las siete de la noche, en la entrada del instituto. ¿Te parece?' },
      { quien: 1, texto: '好的，没问题！星期三晚上七点见！', pinyin: 'Hǎo de, méi wèntí! Xīngqīsān wǎnshang qī diǎn jiàn!', es: '¡Perfecto, sin problema! ¡Nos vemos el miércoles a las siete!' },
      { quien: 0, texto: '好，再见！', pinyin: 'Hǎo, zàijiàn!', es: '¡Genial, hasta luego!' },
      { quien: 1, texto: '再见！', pinyin: 'Zàijiàn!', es: '¡Hasta luego!' },
    ]
  },
};

const DIAL_AVATARES = {
  reunion: [
    { emoji: '🧑', nombre: 'David', color: '#E8EAF6', acento: '#3949ab' },
    { emoji: '👩', nombre: 'Lin', color: '#FCE4EC', acento: '#c2185b' },
  ],
  compras: [
    { emoji: '🧑‍💼', nombre: '老板', color: '#FFF3E0', acento: '#e65100' },
    { emoji: '🙋', nombre: 'Cliente', color: '#E3F2FD', acento: '#1565c0' },
  ],
  vendedor: [
    { emoji: '🧑‍💼', nombre: '老板', color: '#FFF3E0', acento: '#e65100' },
    { emoji: '🙋', nombre: 'Cliente', color: '#E3F2FD', acento: '#1565c0' },
  ],
  amigos: [
    { emoji: '🧑', nombre: '朋友A', color: '#F3E5F5', acento: '#6a1b9a' },
    { emoji: '👩', nombre: '朋友B', color: '#E8F5E9', acento: '#2e7d32' },
  ],
};

function hablarChino(texto) { speak(texto); }

function AvatarBurbuja({ avatar, nombre, texto, pinyin, es, miTurno, mostrarResp, onMostrar, onSiguiente, onAudio, esUltimo }) {
  const bg = miTurno ? '#EEF2FF' : avatar.color;
  const borde = miTurno ? '#6366f1' : avatar.acento;
  const textColor = miTurno ? '#4338ca' : avatar.acento;
  return html('div', { style: { marginBottom: 16 } },
    // Fila con avatar + burbuja
    html('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start', flexDirection: miTurno ? 'row-reverse' : 'row' } },
      // Avatar
      html('div', { style: {
        width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
        background: avatar.color, border: '2px solid ' + avatar.acento,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, lineHeight: 1,
      }},
        avatar.emoji,
        html('div', { style: { fontSize: 8, fontWeight: 800, color: avatar.acento, fontFamily: "'Nunito',sans-serif", marginTop: 1 } }, avatar.nombre),
      ),
      // Burbuja
      html('div', { style: {
        flex: 1, background: bg, borderRadius: miTurno ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
        padding: '14px 16px', border: '2px solid ' + borde,
      }},
        html('div', { style: { fontSize: 11, fontWeight: 700, color: textColor, marginBottom: 8 } },
          miTurno ? '🎤 Tu turno — ' + nombre : nombre + ' dice:',
        ),
        miTurno && !mostrarResp
          ? html('div', { style: { color: '#6366f1', fontSize: 14, fontStyle: 'italic' } }, 'Pensá tu respuesta en voz alta…')
          : html('div', null,
              html('div', { className: 'hanzi-font', style: { fontSize: 22, color: textColor, lineHeight: 1.4, marginBottom: 6 } }, texto),
              html('div', { style: { fontSize: 13, color: 'var(--ink-mid)', fontWeight: 600, marginBottom: 3 } }, pinyin),
              html('div', { style: { fontSize: 12, color: 'var(--ink-soft)' } }, es),
              // Botón audio
              !miTurno && hasRealAudio(texto) && html('button', {
                onClick: () => hablarChino(texto),
                style: { marginTop: 8, background: 'none', border: '1.5px solid ' + avatar.acento, borderRadius: 8, padding: '3px 10px', fontSize: 13, color: avatar.acento, cursor: 'pointer', fontWeight: 700 },
              }, '🔊 Escuchar'),
            ),
      ),
    ),
    // Botones de acción
    html('div', { style: { marginTop: 10 } },
      miTurno
        ? !mostrarResp
          ? html('button', {
              className: 'secondary-btn', style: { width: '100%', borderColor: '#6366f1', color: '#4338ca' },
              onClick: onMostrar,
            }, '💡 Ver respuesta sugerida')
          : html('button', { className: 'primary-btn', style: { width: '100%' }, onClick: onSiguiente },
              esUltimo ? '🔁 Repetir diálogo' : 'Siguiente →')
        : html('button', { className: 'primary-btn', style: { width: '100%' }, onClick: onSiguiente },
            esUltimo ? '🔁 Repetir diálogo' : 'Mi turno →'),
    ),
  );
}

function DialogoPractica({ onBack }) {
  const [escenario, setEscenario] = useState(null);
  const [miRol, setMiRol] = useState(null);
  const [turno, setTurno] = useState(0);
  const [mostrarResp, setMostrarResp] = useState(false);
  const [dialogosDB, setDialogosDB] = useState(null); // null=cargando

  useEffect(() => {
    Promise.all([
      db.from('exam_dialogues').select('*').order('sort_order'),
      db.from('dialogue_turns').select('*').order('dialogue_key,turn_order'),
    ]).then(([dialRes, turnsRes]) => {
      if (dialRes.data && dialRes.data.length > 0) {
        const result = {};
        dialRes.data.forEach(d => {
          result[d.key] = {
            titulo: nfc(d.titulo),
            roles: (d.roles || []).map(nfc),
            turns: (turnsRes.data || [])
              .filter(t => t.dialogue_key === d.key)
              .map(t => ({ quien: t.quien, texto: nfc(t.texto), pinyin: nfc(t.pinyin), es: nfc(t.es) })),
          };
        });
        setDialogosDB(result);
      } else {
        setDialogosDB(DIALOGOS_PRACTICA);
      }
    }).catch(() => setDialogosDB(DIALOGOS_PRACTICA));
  }, []);

  // Hook debe estar antes de cualquier return condicional
  useEffect(() => {
    if (escenario === null || miRol === null || !dialogosDB) return;
    const dial = (dialogosDB || DIALOGOS_PRACTICA)[escenario];
    if (!dial) return;
    const turnoActual = dial.turns[turno];
    if (turnoActual && turnoActual.quien !== miRol) hablarChino(turnoActual.texto);
  }, [turno, escenario, miRol, dialogosDB]);

  if (dialogosDB === null) return html('div', { className: 'app-loader' },
    html('div', { className: 'app-loader-hanzi' }, '说'),
    html('div', { className: 'app-loader-dots' }, html('span'), html('span'), html('span')),
    html('div', { className: 'app-loader-msg' }, 'Preparando los diálogos…'),
  );

  if (!escenario) return html('div', { style: { padding: '20px 16px', maxWidth: 480, margin: '0 auto' } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, '🎙️ Práctica oral'),
    ),
    html('p', { style: { color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 } }, 'Elegí el escenario que querés practicar:'),
    // ── Diálogos nuevos para el oral ──
    html('div', { style: { fontSize: 10, fontWeight: 800, color: 'var(--lacquer)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, '⭐ Para el examen oral'),
    html('button', { className: 'mode-card', style: { width: '100%', marginBottom: 10, borderColor: 'var(--lacquer)', borderWidth: 2 }, onClick: () => setEscenario('reunion') },
      html('div', { className: 'mode-emoji', style: { background: '#E8EAF6', fontSize: 24 } }, '📞'),
      html('div', null,
        html('div', { className: 'mode-title' }, '朋友们去买东西 — Acordar salida + compras'),
        html('div', { className: 'mode-sub' }, 'Llamada entre amigos: día, hora, lugar y qué comprar'),
      )
    ),
    html('button', { className: 'mode-card', style: { width: '100%', marginBottom: 16, borderColor: 'var(--lacquer)', borderWidth: 2 }, onClick: () => setEscenario('compras') },
      html('div', { className: 'mode-emoji', style: { background: '#FFF3E0', fontSize: 24 } }, '🛒'),
      html('div', null,
        html('div', { className: 'mode-title' }, '在商场买东西 — En el shopping (CD + frutas)'),
        html('div', { className: 'mode-sub' }, 'Preguntar precio, regatear, pagar y recibir vuelto'),
      )
    ),
    // ── Diálogos originales ──
    html('div', { style: { fontSize: 10, fontWeight: 800, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, 'Práctica adicional'),
    html('button', { className: 'mode-card', style: { width: '100%', marginBottom: 10 }, onClick: () => setEscenario('vendedor') },
      html('div', { className: 'mode-emoji', style: { background: '#FFF3E0', fontSize: 24 } }, '🛍️'),
      html('div', null,
        html('div', { className: 'mode-title' }, 'Opción B — Vendedor / Cliente (frutas)'),
        html('div', { className: 'mode-sub' }, 'Frutas, precio, cantidad y vuelto'),
      )
    ),
    html('button', { className: 'mode-card', style: { width: '100%' }, onClick: () => setEscenario('amigos') },
      html('div', { className: 'mode-emoji', style: { background: '#E8F5E9', fontSize: 24 } }, '📅'),
      html('div', null,
        html('div', { className: 'mode-title' }, 'Opción A — Acordar una actividad'),
        html('div', { className: 'mode-sub' }, 'Dos amigos, horarios y plan semanal'),
      )
    ),
  );

  const dial = (dialogosDB || DIALOGOS_PRACTICA)[escenario] || DIALOGOS_PRACTICA[escenario];
  const avatares = DIAL_AVATARES[escenario];

  if (miRol === null) return html('div', { style: { padding: '20px 16px', maxWidth: 480, margin: '0 auto' } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: () => setEscenario(null) }, '←'),
      html('h1', null, dial.titulo),
    ),
    html('p', { style: { color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 } }, '¿Qué rol querés practicar?'),
    dial.roles.map((rol, i) => {
      const av = avatares[i];
      return html('button', { key: i,
        className: 'mode-card', style: { width: '100%', marginBottom: 12 },
        onClick: () => { setMiRol(i); setTurno(0); setMostrarResp(false); },
      },
        html('div', { style: {
          width: 44, height: 44, borderRadius: '50%', background: av.color,
          border: '2px solid ' + av.acento, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 22, flexShrink: 0,
        }}, av.emoji),
        html('div', null,
          html('div', { className: 'mode-title' }, rol),
          html('div', { className: 'mode-sub' }, 'La app hace de ' + dial.roles[1 - i]),
        )
      );
    }),
  );

  const turnoActual = dial.turns[turno];
  const esAppTurn = turnoActual.quien !== miRol;
  const esUltimo = turno >= dial.turns.length - 1;
  const avatarHablante = avatares[turnoActual.quien];

  const siguiente = () => {
    window.speechSynthesis && window.speechSynthesis.cancel();
    if (esUltimo) { setTurno(0); setMostrarResp(false); }
    else { setTurno(t => t + 1); setMostrarResp(false); }
  };

  return html('main', { style: { paddingTop: 16, paddingBottom: 40 } },
    html('div', { style: { padding: '0 16px', maxWidth: 500, margin: '0 auto' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: () => { window.speechSynthesis && window.speechSynthesis.cancel(); setMiRol(null); } }, '←'),
        html('h1', { style: { fontSize: 16 } }, dial.titulo),
      ),
      // Progreso
      html('div', { style: { display: 'flex', gap: 4, marginBottom: 16 } },
        dial.turns.map((t, i) =>
          html('div', { key: i, style: {
            flex: 1, height: 5, borderRadius: 3,
            background: i < turno ? 'var(--jade-dark)' : i === turno ? 'var(--lacquer)' : 'var(--paper-deep)',
          }})
        )
      ),
      // Mini avatares de rol
      html('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '8px 12px', background: 'var(--paper-deep)', borderRadius: 10 } },
        html('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: avatares[miRol].acento } },
          html('span', { style: { fontSize: 18 } }, avatares[miRol].emoji),
          'Vos: ' + dial.roles[miRol],
        ),
        html('div', { style: { fontSize: 11, color: 'var(--ink-soft)' } }, turno + 1 + ' / ' + dial.turns.length),
        html('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: avatares[1-miRol].acento } },
          'App: ' + dial.roles[1 - miRol],
          html('span', { style: { fontSize: 18 } }, avatares[1-miRol].emoji),
        ),
      ),
      html(AvatarBurbuja, {
        avatar: avatarHablante,
        nombre: dial.roles[turnoActual.quien],
        texto: turnoActual.texto,
        pinyin: turnoActual.pinyin,
        es: turnoActual.es,
        miTurno: !esAppTurn,
        mostrarResp,
        onMostrar: () => setMostrarResp(true),
        onSiguiente: siguiente,
        onAudio: () => hablarChino(turnoActual.texto),
        esUltimo,
      }),
    )
  );
}

const EXAM_ORAL_PREGUNTAS = [
  '你今年多大？','星期日是几号？','你哪年出生？你属什么？','今天是几月几号？',
  '你什么时候生日？','明天上午你有没有课？','一斤苹果多少钱？',
  '星期天你常常去哪儿？','请问，现在几点？','我们几点上课？','你为什么不能来上课？',
];

const EXAM_HORARIO_ROWS = [
  { time: '上午', mon: '汉语课', tue: '文化课', wed: '汉语课', thu: '', fri: '汉语课', sat: '看朋友', sun: '' },
  { time: '下午', mon: '', tue: '汉语课', wed: '', thu: '汉语课', fri: '打球 dǎ qiú', sat: '', sun: '生日聚会' },
  { time: '晚上\nwǎnshang', mon: '朋友来', tue: '', wed: '游泳\nyóuyǒng', thu: '', fri: '', sat: '看京剧\njīngjù', sun: '' },
];

function SimMC({ items, ptsCada, title, answers, setAnswers }) {
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, title),
    items.map((item, i) =>
      html('div', { key: i, className: 'sim-q-block' },
        html('div', { className: 'sim-q-text hanzi-font' }, (i+1) + '. ' + item.q),
        html('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
          item.opts.map((opt, j) =>
            html('button', {
              key: j,
              className: 'sim-opt-btn' + (answers[i] === j ? ' selected' : ''),
              onClick: () => setAnswers({ ...answers, [i]: j }),
            }, opt)
          )
        )
      )
    )
  );
}

function SimVF({ items, ptsCada, title, answers, setAnswers }) {
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, title),
    items.map((item, i) =>
      html('div', { key: i, className: 'sim-q-block' },
        html('div', { className: 'sim-q-text hanzi-font' }, (i+1) + '. ' + item.s),
        html('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          html('button', {
            className: 'sim-opt-btn vf' + (answers[i] === true ? ' selected ok' : ''),
            onClick: () => setAnswers({ ...answers, [i]: true }),
          }, '✓ Verdadero'),
          html('button', {
            className: 'sim-opt-btn vf' + (answers[i] === false ? ' selected err' : ''),
            onClick: () => setAnswers({ ...answers, [i]: false }),
          }, '✗ Falso'),
        )
      )
    )
  );
}

function SimOrdenar({ items, answers, setAnswers }) {
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, '练习三 · Ordenar las palabras (4 pts c/u · 20 pts)'),
    items.map((item, qi) => {
      const chosen = answers[qi] || [];
      const available = item.words.map((w, i) => ({ w, i }))
        .filter(x => !chosen.find(c => c.i === x.i));
      const tapAvail = (it) => setAnswers({ ...answers, [qi]: [...chosen, it] });
      const tapChosen = (it) => setAnswers({ ...answers, [qi]: chosen.filter(c => c.i !== it.i) });
      return html('div', { key: qi, className: 'sim-q-block' },
        html('div', { className: 'sim-q-text', style: { fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 } }, (qi+1) + '. Ordená las palabras:'),
        html('div', {
          style: {
            minHeight: 48, background: 'var(--paper-deep)', borderRadius: 10,
            padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8,
            border: '2px dashed var(--paper-mid, #ddd)',
          }
        },
          chosen.length === 0
            ? html('span', { style: { color: 'var(--ink-soft)', fontSize: 13, alignSelf: 'center' } }, 'Tocá las palabras de abajo →')
            : chosen.map(it => html('button', { key: it.i, className: 'word-chip placed', onClick: () => tapChosen(it) }, it.w))
        ),
        html('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          available.map(it => html('button', { key: it.i, className: 'word-chip', onClick: () => tapAvail(it) }, it.w))
        ),
        chosen.length > 0 && html('button', {
          style: { marginTop: 6, fontSize: 11, color: 'var(--ink-soft)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
          onClick: () => setAnswers({ ...answers, [qi]: [] }),
        }, '↺ Limpiar'),
      );
    })
  );
}

function SimRellenar({ partes, banco, answers, setAnswers }) {
  const ej4Partes = partes || EXAM_EJ4_PARTES;
  const ej4Banco  = banco  || EXAM_EJ4_BANCO;
  const total = ej4Banco.length;
  const bancoUsado = (answers || []).filter(Boolean);
  const disponible = ej4Banco.filter(w => !bancoUsado.includes(w));
  const fillNext = (word) => {
    const newAns = [...(answers || Array(total).fill(null))];
    const idx = newAns.findIndex(v => v === null || v === undefined);
    if (idx !== -1) { newAns[idx] = word; setAnswers([...newAns]); }
  };
  const clearBlank = (blankIdx) => {
    const newAns = [...(answers || Array(total).fill(null))];
    newAns[blankIdx] = null;
    setAnswers([...newAns]);
  };
  const ans = answers || Array(total).fill(null);
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, '练习四A · Completar el texto (2 pts c/u · 10 pts)'),
    html('p', { style: { fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 } }, 'Banco de palabras: Tocá una palabra del banco para rellenar el próximo hueco. Tocá un hueco para liberar esa palabra.'),
    html('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 } },
      ej4Banco.map(w =>
        html('button', {
          key: w,
          className: 'word-chip' + (disponible.includes(w) ? '' : ' placed'),
          style: { opacity: disponible.includes(w) ? 1 : 0.4, cursor: disponible.includes(w) ? 'pointer' : 'default' },
          onClick: () => disponible.includes(w) && fillNext(w),
        }, w)
      )
    ),
    html('div', { className: 'sim-q-text hanzi-font', style: { lineHeight: 2.2, fontSize: 18 } },
      ej4Partes.map((p, i) =>
        p.t
          ? html('span', { key: i }, p.t)
          : html('button', {
              key: i,
              onClick: () => ans[p.blank] && clearBlank(p.blank),
              style: {
                display: 'inline-block', minWidth: 60, padding: '2px 8px',
                background: ans[p.blank] ? 'var(--gold-light)' : 'transparent',
                border: '2px solid ' + (ans[p.blank] ? 'var(--gold)' : 'var(--lacquer)'),
                borderRadius: 6, cursor: ans[p.blank] ? 'pointer' : 'default',
                fontFamily: 'Nunito, sans-serif', fontSize: 15, fontWeight: 700,
                color: ans[p.blank] ? '#6b4c00' : 'var(--lacquer)',
                margin: '0 2px',
              }
            }, ans[p.blank] || '___')
      )
    )
  );
}

function SimConectar1A({ items, answers, setAnswers }) {
  const ej1a = items || EXAM_EJ1A;
  const [pinyins] = useState(() => shuffle([...ej1a.map(x => x.pinyin)]));
  const [meanings] = useState(() => shuffle([...ej1a.map(x => x.es)]));
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, '练习一A · Conectar hanzi, pinyin y significado (2 pts c/u · 10 pts)'),
    html('p', { style: { fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 } }, 'Seleccioná el pinyin y el significado correcto para cada carácter.'),
    html('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 } },
      html('thead', null,
        html('tr', null,
          html('th', { style: simThStyle }, '汉字'),
          html('th', { style: simThStyle }, 'Pinyin'),
          html('th', { style: simThStyle }, 'Significado'),
        )
      ),
      html('tbody', null,
        ej1a.map((item, i) => {
          const cur = answers[i] || {};
          return html('tr', { key: i },
            html('td', { style: { ...simTdStyle, fontFamily: 'Noto Serif SC, serif', fontSize: 22, color: 'var(--lacquer)' } }, item.hanzi),
            html('td', { style: simTdStyle },
              html('select', {
                className: 'sim-select',
                value: cur.pinyin || '',
                onChange: e => setAnswers({ ...answers, [i]: { ...(answers[i]||{}), pinyin: e.target.value } }),
              },
                html('option', { value: '' }, '— elegí —'),
                pinyins.map(p => html('option', { key: p, value: p }, p))
              )
            ),
            html('td', { style: simTdStyle },
              html('select', {
                className: 'sim-select',
                value: cur.es || '',
                onChange: e => setAnswers({ ...answers, [i]: { ...(answers[i]||{}), es: e.target.value } }),
              },
                html('option', { value: '' }, '— elegí —'),
                meanings.map(m => html('option', { key: m, value: m }, m))
              )
            ),
          );
        })
      )
    )
  );
}

const simThStyle = { background: 'var(--paper-deep)', padding: '8px 10px', textAlign: 'left', fontFamily: 'Nunito, sans-serif', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' };
const simTdStyle = { padding: '8px 10px', borderBottom: '1px solid var(--paper-deep)' };

function SimConectar1B({ left, right, answers, setAnswers }) {
  const ej1bLeft  = left  || EXAM_EJ1B_LEFT;
  const ej1bRight = right || EXAM_EJ1B_RIGHT;
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, '练习一B · Completar frases (2 pts c/u · 12 pts)'),
    ej1bLeft.map((leftItem, i) =>
      html('div', { key: i, className: 'sim-q-block', style: { display: 'flex', alignItems: 'center', gap: 10 } },
        html('span', { style: { fontFamily: 'Noto Serif SC, serif', fontSize: 18, color: 'var(--lacquer)', minWidth: 80 } }, (i+1) + '. ' + leftItem),
        html('span', { style: { color: 'var(--ink-soft)' } }, '→'),
        html('select', {
          className: 'sim-select',
          value: answers[i] !== undefined ? answers[i] : '',
          onChange: e => setAnswers({ ...answers, [i]: parseInt(e.target.value) }),
        },
          html('option', { value: '' }, '— elegí —'),
          ej1bRight.map((r, j) => html('option', { key: j, value: j }, r))
        )
      )
    )
  );
}

function SimOral({ preguntas, horario, onPracticarDialogo }) {
  const oralPregs   = preguntas || EXAM_ORAL_PREGUNTAS;
  const horarioRows = horario   || EXAM_HORARIO_ROWS;
  const dias = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
  return html('div', { className: 'sim-section' },
    html('h3', { className: 'sim-sec-title' }, '🎙️ Examen Oral · Nivel III'),
    html('button', {
      onClick: onPracticarDialogo,
      style: {
        width: '100%', marginBottom: 16, padding: '14px',
        background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
        color: '#fff', border: 'none', borderRadius: 12,
        fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }
    }, '🎙️ Practicar diálogo interactivo →'),
    html('p', { style: { fontSize: 13, color: 'var(--ink-mid)', marginBottom: 16, lineHeight: 1.6 } },
      'El examen oral tiene dos partes. Practicá en voz alta.'
    ),
    html('div', { style: { background: 'var(--jade-light)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 } },
      html('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--jade-dark)', marginBottom: 8 } }, 'Opción A — Diálogo con planilla de horarios'),
      html('p', { style: { fontSize: 12, color: 'var(--ink-mid)', marginBottom: 10 } }, 'Dos amigos quieren acordar una actividad juntos según este horario:'),
      html('div', { style: { overflowX: 'auto' } },
        html('table', { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
          html('thead', null,
            html('tr', null,
              html('th', { style: { ...simThStyle, minWidth: 70 } }, ''),
              dias.map(d => html('th', { key: d, style: simThStyle }, d))
            )
          ),
          html('tbody', null,
            horarioRows.map((row, i) =>
              html('tr', { key: i },
                html('td', { style: { ...simTdStyle, fontWeight: 700, fontSize: 11, whiteSpace: 'pre-line' } }, row.time),
                [row.mon, row.tue, row.wed, row.thu, row.fri, row.sat, row.sun].map((cell, j) =>
                  html('td', { key: j, style: { ...simTdStyle, fontSize: 12, textAlign: 'center', whiteSpace: 'pre-line', minWidth: 70 } }, cell || '')
                )
              )
            )
          )
        )
      )
    ),
    html('div', { style: { background: '#EEF2FF', borderRadius: 12, padding: '12px 14px', marginBottom: 16 } },
      html('div', { style: { fontWeight: 700, fontSize: 13, color: '#3730a3', marginBottom: 6 } }, 'Opción B — Diálogo vendedor / comprador'),
      html('p', { style: { fontSize: 12, color: 'var(--ink-mid)' } }, 'Diálogo sobre libros, CDs o frutas: preguntar precio y cantidad, pagar y dar el vuelto.'),
    ),
    html('div', { style: { marginTop: 16 } },
      html('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 8 } }, 'Parte 2 — Responder preguntas (2 por alumno)'),
      oralPregs.map((p, i) =>
        html('div', { key: i, className: 'sim-q-block', style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
          html('span', { style: { minWidth: 22, fontWeight: 700, color: 'var(--ink-soft)', fontSize: 13 } }, String.fromCharCode(96+i+1) + '.'),
          html('span', { className: 'hanzi-font', style: { fontSize: 17 } }, p),
        )
      )
    )
  );
}

function calcExamScore(ans) {
  let score = 0, max = 0;
  // EJ1A: 10 pts (2 cada uno)
  max += 10;
  const a1a = ans.ej1a || {};
  EXAM_EJ1A.forEach((item, i) => {
    const r = a1a[i] || {};
    if (r.pinyin === item.pinyin) score += 1;
    if (r.es === item.es) score += 1;
  });
  // EJ1B: 12 pts (2 cada uno)
  max += 12;
  const a1b = ans.ej1b || {};
  EXAM_EJ1B_ANS.forEach((correct, i) => {
    if (a1b[i] === correct) score += 2;
  });
  // EJ2: 18 pts (3 cada uno)
  max += 18;
  const a2 = ans.ej2 || {};
  EXAM_EJ2.forEach((item, i) => { if (a2[i] === item.ans) score += 3; });
  // EJ3: 20 pts (4 cada uno)
  max += 20;
  const a3 = ans.ej3 || {};
  EXAM_EJ3.forEach((item, qi) => {
    const chosen = (a3[qi] || []).map(c => c.w).join('');
    if (chosen === item.correct) score += 4;
  });
  // EJ4A: 10 pts (2 cada hueco)
  max += 10;
  const a4a = ans.ej4a || [];
  EXAM_EJ4_PARTES.filter(p => p.blank !== undefined).forEach((p, i) => {
    if (a4a[i] === p.ans) score += 2;
  });
  // EJ4B: 10 pts (2 cada uno)
  max += 10;
  const a4b = ans.ej4b || {};
  EXAM_EJ4B.forEach((item, i) => { if (a4b[i] === item.ans) score += 2; });
  // EJ5A: 10 pts (2 cada uno)
  max += 10;
  const a5a = ans.ej5a || {};
  EXAM_EJ5A.forEach((item, i) => { if (a5a[i] === item.ans) score += 2; });
  // EJ5B: 10 pts (2 cada uno)
  max += 10;
  const a5b = ans.ej5b || {};
  EXAM_EJ5B.forEach((item, i) => { if (a5b[i] === item.ans) score += 2; });
  return { score, max };
}

function ResDetailRow({ ok, label, tu, correcto, extra }) {
  return html('div', { style: {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    padding: '8px 10px', borderRadius: 8, marginBottom: 4,
    background: ok ? '#f0faf5' : '#fff5f5',
    border: '1.5px solid ' + (ok ? 'var(--jade-dark)' : 'var(--lacquer)'),
  }},
    html('span', { style: { fontSize: 16, flexShrink: 0 } }, ok ? '✓' : '✗'),
    html('div', { style: { flex: 1 } },
      html('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--ink-dark)', fontFamily: 'Noto Serif SC, serif' } }, label),
      !ok && html('div', { style: { fontSize: 12, marginTop: 3 } },
        html('span', { style: { color: 'var(--lacquer)', fontWeight: 600 } }, 'Tu resp: '),
        html('span', { style: { fontFamily: 'Noto Serif SC, serif' } }, tu || '—'),
      ),
      !ok && html('div', { style: { fontSize: 12, marginTop: 2 } },
        html('span', { style: { color: 'var(--jade-dark)', fontWeight: 600 } }, 'Correcto: '),
        html('span', { style: { fontFamily: 'Noto Serif SC, serif' } }, correcto),
      ),
      extra && html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 } }, extra),
    ),
  );
}

function ExamenResultados({ answers, onRetry, onBack }) {
  const [showDetail, setShowDetail] = useState(false);
  const { score, max } = calcExamScore(answers);
  const pct = Math.round((score / max) * 100);
  const nota = pct >= 60 ? (pct >= 80 ? '¡Excelente! 🎉' : 'Aprobado ✓') : 'A seguir practicando 📚';
  const color = pct >= 60 ? (pct >= 80 ? 'var(--jade-dark)' : '#1d6aa5') : 'var(--lacquer)';

  const secciones = [
    { label: '练习一A · Conectar 3 columnas', pts: (() => { let s=0; const a=answers.ej1a||{}; EXAM_EJ1A.forEach((item,i)=>{ const r=a[i]||{}; if(r.pinyin===item.pinyin)s+=1; if(r.es===item.es)s+=1; }); return s; })(), max: 10 },
    { label: '练习一B · Completar frases', pts: (() => { let s=0; const a=answers.ej1b||{}; EXAM_EJ1B_ANS.forEach((c,i)=>{ if(a[i]===c)s+=2; }); return s; })(), max: 12 },
    { label: '练习二 · Opción múltiple', pts: (() => { let s=0; const a=answers.ej2||{}; EXAM_EJ2.forEach((it,i)=>{ if(a[i]===it.ans)s+=3; }); return s; })(), max: 18 },
    { label: '练习三 · Ordenar palabras', pts: (() => { let s=0; const a=answers.ej3||{}; EXAM_EJ3.forEach((it,qi)=>{ if(((a[qi]||[]).map(c=>c.w).join(''))===it.correct)s+=4; }); return s; })(), max: 20 },
    { label: '练习四A · Completar texto', pts: (() => { let s=0; const a=answers.ej4a||[]; EXAM_EJ4_PARTES.filter(p=>p.blank!==undefined).forEach((p,i)=>{ if(a[i]===p.ans)s+=2; }); return s; })(), max: 10 },
    { label: '练习四B · Verdadero/Falso', pts: (() => { let s=0; const a=answers.ej4b||{}; EXAM_EJ4B.forEach((it,i)=>{ if(a[i]===it.ans)s+=2; }); return s; })(), max: 10 },
    { label: '练习五A · Escucha opciones', pts: (() => { let s=0; const a=answers.ej5a||{}; EXAM_EJ5A.forEach((it,i)=>{ if(a[i]===it.ans)s+=2; }); return s; })(), max: 10 },
    { label: '练习五B · Escucha V/F', pts: (() => { let s=0; const a=answers.ej5b||{}; EXAM_EJ5B.forEach((it,i)=>{ if(a[i]===it.ans)s+=2; }); return s; })(), max: 10 },
  ];

  const buildDetail = () => {
    const a1a = answers.ej1a || {}, a1b = answers.ej1b || {}, a2 = answers.ej2 || {};
    const a3 = answers.ej3 || {}, a4a = answers.ej4a || [], a4b = answers.ej4b || {};
    const a5a = answers.ej5a || {}, a5b = answers.ej5b || {};
    const blancos = EXAM_EJ4_PARTES.filter(p => p.blank !== undefined);
    return [
      // 1A
      html('div', { key: '1a', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习一A · Conectar'),
        EXAM_EJ1A.map((item, i) => {
          const r = a1a[i] || {};
          const okP = r.pinyin === item.pinyin, okE = r.es === item.es;
          return html(ResDetailRow, { key: i,
            ok: okP && okE,
            label: item.hanzi,
            tu: (!okP ? 'pinyin: ' + (r.pinyin||'—') : '') + (!okE ? ((!okP?' · ':'') + 'sig: ' + (r.es||'—')) : ''),
            correcto: item.pinyin + ' · ' + item.es,
          });
        })
      ),
      // 1B
      html('div', { key: '1b', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习一B · Completar frases'),
        EXAM_EJ1B_LEFT.map((left, i) => {
          const ok = a1b[i] === EXAM_EJ1B_ANS[i];
          return html(ResDetailRow, { key: i, ok,
            label: left + ' + …',
            tu: a1b[i] !== undefined ? EXAM_EJ1B_RIGHT[a1b[i]] : '—',
            correcto: EXAM_EJ1B_RIGHT[EXAM_EJ1B_ANS[i]],
          });
        })
      ),
      // 2
      html('div', { key: '2', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习二 · Opción múltiple'),
        EXAM_EJ2.map((item, i) => {
          const ok = a2[i] === item.ans;
          return html(ResDetailRow, { key: i, ok,
            label: item.q,
            tu: a2[i] !== undefined ? item.opts[a2[i]] : '—',
            correcto: item.opts[item.ans],
          });
        })
      ),
      // 3
      html('div', { key: '3', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习三 · Ordenar palabras'),
        EXAM_EJ3.map((item, qi) => {
          const chosen = (a3[qi] || []).map(c => c.w).join('');
          const ok = chosen === item.correct;
          return html(ResDetailRow, { key: qi, ok,
            label: item.words.join(' / '),
            tu: chosen || '—',
            correcto: item.correct,
            extra: item.es,
          });
        })
      ),
      // 4A
      html('div', { key: '4a', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习四A · Completar el texto'),
        blancos.map((p, i) => {
          const ok = a4a[i] === p.ans;
          return html(ResDetailRow, { key: i, ok,
            label: 'Hueco ' + (i+1) + ': «' + p.ans + '»',
            tu: a4a[i] || '—',
            correcto: p.ans,
          });
        })
      ),
      // 4B
      html('div', { key: '4b', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习四B · Verdadero/Falso'),
        EXAM_EJ4B.map((item, i) => {
          const ok = a4b[i] === item.ans;
          return html(ResDetailRow, { key: i, ok,
            label: item.s,
            tu: a4b[i] === undefined ? '—' : a4b[i] ? 'Verdadero' : 'Falso',
            correcto: item.ans ? 'Verdadero' : 'Falso',
            extra: !ok ? item.exp : null,
          });
        })
      ),
      // 5A
      html('div', { key: '5a', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习五A · Escucha — Opción múltiple'),
        EXAM_EJ5A.map((item, i) => {
          const ok = a5a[i] === item.ans;
          return html(ResDetailRow, { key: i, ok,
            label: item.q,
            tu: a5a[i] !== undefined ? item.opts[a5a[i]] : '—',
            correcto: item.opts[item.ans],
          });
        })
      ),
      // 5B
      html('div', { key: '5b', style: { marginBottom: 16 } },
        html('div', { className: 'sim-sec-title', style: { fontSize: 13 } }, '练习五B · Escucha — Verdadero/Falso'),
        EXAM_EJ5B.map((item, i) => {
          const ok = a5b[i] === item.ans;
          return html(ResDetailRow, { key: i, ok,
            label: item.s,
            tu: a5b[i] === undefined ? '—' : a5b[i] ? 'Verdadero' : 'Falso',
            correcto: item.ans ? 'Verdadero' : 'Falso',
            extra: !ok ? item.exp : null,
          });
        })
      ),
    ];
  };

  return html('main', { style: { paddingTop: 16, paddingBottom: 40 } },
    html('div', { style: { padding: '0 16px', maxWidth: 580, margin: '0 auto' } },
      // Puntaje total
      html('div', { style: { textAlign: 'center', padding: '24px 0 20px' } },
        html('div', { style: { fontSize: 72, fontWeight: 900, color, fontFamily: 'var(--font-display)', lineHeight: 1 } }, score + '/' + max),
        html('div', { style: { fontSize: 24, fontWeight: 700, color, marginTop: 4 } }, pct + '%'),
        html('div', { style: { fontSize: 16, color: 'var(--ink-mid)', marginTop: 4 } }, nota),
      ),
      // Resumen por sección
      html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 } },
        secciones.map(({ label, pts, max: m }) =>
          html('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--paper-deep)', borderRadius: 8, padding: '8px 12px' } },
            html('div', { style: {
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: pts === m ? 'var(--jade-dark)' : pts === 0 ? 'var(--lacquer)' : '#f59e0b',
            }}),
            html('span', { style: { flex: 1, fontSize: 12, fontWeight: 600 } }, label),
            html('span', { style: { fontWeight: 800, fontSize: 13, color: pts === m ? 'var(--jade-dark)' : pts === 0 ? 'var(--lacquer)' : '#92400e' } }, pts + '/' + m),
          )
        )
      ),
      // Toggle detalle
      html('button', {
        onClick: () => setShowDetail(d => !d),
        style: {
          width: '100%', padding: '12px', borderRadius: 10, marginBottom: 16,
          border: '2px solid var(--paper-deep)', background: '#fff',
          fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', color: 'var(--ink-mid)',
        }
      }, showDetail ? '▲ Ocultar detalle pregunta a pregunta' : '▼ Ver detalle pregunta a pregunta'),
      showDetail && html('div', null, ...buildDetail()),
      // Botones
      html('div', { style: { display: 'flex', gap: 10, marginTop: 8 } },
        html('button', { className: 'secondary-btn', style: { flex: 1, margin: 0 }, onClick: onBack }, '← Volver al admin'),
        html('button', { className: 'primary-btn', style: { flex: 1 }, onClick: onRetry }, '↺ Repetir examen'),
      )
    )
  );
}

const SIM_SECTIONS = ['ej1a','ej1b','ej2','ej3','ej4a','ej4b','ej5a','ej5b','oral'];
const SIM_LABELS   = ['1A','1B','2','3','4A','4B','5A','5B','Oral'];

function ExamenSimulacro({ onBack }) {
  const [sec, setSec] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [practicaOral, setPracticaOral] = useState(false);
  const [examDB, setExamDB] = useState(null); // null=cargando, obj=listo
  const setSecAns = (key) => (val) => setAnswers(a => ({ ...a, [key]: val }));

  useEffect(() => {
    db.from('exam_content').select('*').order('sort_order')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const map = {};
          data.forEach(row => { map[row.section_key] = row.data; });
          setExamDB(map);
        } else {
          setExamDB({});
        }
      })
      .catch(() => setExamDB({}));
  }, []);

  if (practicaOral) return html(DialogoPractica, { onBack: () => setPracticaOral(false) });

  if (examDB === null) return html('div', { className: 'app-loader' },
    html('div', { className: 'app-loader-hanzi' }, '试'),
    html('div', { className: 'app-loader-dots' }, html('span'), html('span'), html('span')),
    html('div', { className: 'app-loader-msg' }, 'Preparando el examen…'),
  );

  // DB tiene prioridad; si no hay contenido, se usan las constantes locales como respaldo
  const ej1a        = (examDB.ej1a)        || EXAM_EJ1A;
  const ej1b_left   = (examDB.ej1b_left)   || EXAM_EJ1B_LEFT;
  const ej1b_right  = (examDB.ej1b_right)  || EXAM_EJ1B_RIGHT;
  const ej1b_ans    = (examDB.ej1b_ans)    || EXAM_EJ1B_ANS;
  const ej2         = (examDB.ej2)         || EXAM_EJ2;
  const ej3         = (examDB.ej3)         || EXAM_EJ3;
  const ej4_partes  = (examDB.ej4_partes)  || EXAM_EJ4_PARTES;
  const ej4_banco   = (examDB.ej4_banco)   || EXAM_EJ4_BANCO;
  const ej4b        = (examDB.ej4b)        || EXAM_EJ4B;
  const ej5a        = (examDB.ej5a)        || EXAM_EJ5A;
  const ej5b        = (examDB.ej5b)        || EXAM_EJ5B;
  const oralPregs   = (examDB.oral_preguntas) || EXAM_ORAL_PREGUNTAS;
  const horarioRows = (examDB.horario_rows)   || EXAM_HORARIO_ROWS;

  if (submitted) return html(ExamenResultados, {
    answers,
    onRetry: () => { setAnswers({}); setSec(0); setSubmitted(false); },
    onBack,
  });

  const isLast = sec === SIM_SECTIONS.length - 1;

  const renderSection = () => {
    switch (SIM_SECTIONS[sec]) {
      case 'ej1a': return html(SimConectar1A, { items: ej1a, answers: answers.ej1a || {}, setAnswers: setSecAns('ej1a') });
      case 'ej1b': return html(SimConectar1B, { left: ej1b_left, right: ej1b_right, answers: answers.ej1b || {}, setAnswers: setSecAns('ej1b') });
      case 'ej2':  return html(SimMC, { items: ej2, ptsCada: 3, title: '练习二 · Opción múltiple (3 pts c/u · 18 pts)', answers: answers.ej2 || {}, setAnswers: setSecAns('ej2') });
      case 'ej3':  return html(SimOrdenar, { items: ej3, answers: answers.ej3 || {}, setAnswers: setSecAns('ej3') });
      case 'ej4a': return html(SimRellenar, { partes: ej4_partes, banco: ej4_banco, answers: answers.ej4a, setAnswers: setSecAns('ej4a') });
      case 'ej4b': return html(SimVF, { items: ej4b, ptsCada: 2, title: '练习四B · Verdadero / Falso (2 pts c/u · 10 pts)', answers: answers.ej4b || {}, setAnswers: setSecAns('ej4b') });
      case 'ej5a': return html(SimMC, { items: ej5a, ptsCada: 2, title: '练习五A · Comprensión auditiva — Opción múltiple (2 pts c/u · 10 pts)', answers: answers.ej5a || {}, setAnswers: setSecAns('ej5a') });
      case 'ej5b': return html(SimVF, { items: ej5b, ptsCada: 2, title: '练习五B · Comprensión auditiva — Verdadero / Falso (2 pts c/u · 10 pts)', answers: answers.ej5b || {}, setAnswers: setSecAns('ej5b') });
      case 'oral': return html(SimOral, { preguntas: oralPregs, horario: horarioRows, onPracticarDialogo: () => setPracticaOral(true) });
    }
  };

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: 16, paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, '模拟考试 · Simulacro Nivel III'),
      ),
      // Barra de progreso de secciones
      html('div', { style: { display: 'flex', gap: 4, padding: '0 16px', marginBottom: 16, overflowX: 'auto' } },
        SIM_LABELS.map((label, i) =>
          html('button', {
            key: i,
            onClick: () => setSec(i),
            style: {
              flex: '0 0 auto', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              background: i === sec ? 'var(--lacquer)' : 'var(--paper-deep)',
              color: i === sec ? '#fff' : 'var(--ink-mid)',
            }
          }, label)
        )
      ),
      html('div', { style: { padding: '0 16px' } }, renderSection()),
      html('div', { style: { display: 'flex', gap: 10, padding: '20px 16px 0' } },
        sec > 0 && html('button', { className: 'secondary-btn', style: { margin: 0 }, onClick: () => setSec(s => s - 1) }, '← Anterior'),
        html('div', { style: { flex: 1 } }),
        isLast
          ? html('button', { className: 'primary-btn', style: { margin: 0 }, onClick: () => setSubmitted(true) }, '🏁 Ver resultados')
          : html('button', { className: 'primary-btn', style: { margin: 0 }, onClick: () => setSec(s => s + 1) }, 'Siguiente →'),
      )
    )
  );
}

// ── Editor de preguntas por módulo ────────────────────────────────────────────
function ModuleQuestionsEditor({ modId }) {
  const CONFIGS = {
    'mod-frase': {
      table: 'npcr_clasificador_questions',
      tipos: [
        { key: 'frase',        label: '🧩 Completá la frase' },
        { key: 'clasificador', label: '🔢 Clasificadores' },
        { key: 'modal',        label: '🔵 Verbos modales' },
        { key: 'tiempo',       label: '🕐 Expresiones de tiempo' },
      ],
      hasTipo: true,
      fields: [
        { key: 'sentence',       label: 'Oración (con ___)', type: 'text' },
        { key: 'pinyin',         label: 'Pinyin de la oración', type: 'text' },
        { key: 'answer',         label: 'Respuesta correcta', type: 'text', sm: true },
        { key: 'answer_pinyin',  label: 'Pinyin de la respuesta', type: 'text', sm: true },
        { key: 'options',        label: 'Opciones (separadas por coma)', type: 'options' },
        { key: 'hint',           label: 'Pista', type: 'text' },
      ],
      defaultTipo: 'frase',
    },
    'mod-dialogo': {
      table: 'npcr_dialogo_questions',
      hasTipo: false,
      fields: [
        { key: 'context',       label: 'Contexto', type: 'text' },
        { key: 'line_a',        label: 'Línea A (usa ___ para el hueco)', type: 'text' },
        { key: 'line_b',        label: 'Línea B (usa ___ para el hueco)', type: 'text' },
        { key: 'blank_in',      label: 'Hueco en', type: 'select', opts: ['A','B'] },
        { key: 'answer',        label: 'Respuesta correcta', type: 'text', sm: true },
        { key: 'answer_pinyin', label: 'Pinyin respuesta', type: 'text', sm: true },
        { key: 'answer_es',     label: 'Traducción respuesta', type: 'text', sm: true },
        { key: 'options',       label: 'Opciones (separadas por coma)', type: 'options' },
        { key: 'explanation',   label: 'Explicación (opcional)', type: 'text' },
      ],
    },
    'mod-orden': {
      table: 'npcr_orden_questions',
      hasTipo: false,
      fields: [
        { key: 'words',   label: 'Palabras (separadas por coma)', type: 'options' },
        { key: 'correct', label: 'Orden correcto (separado por coma)', type: 'options' },
        { key: 'pinyin',  label: 'Pinyin de la oración', type: 'text' },
        { key: 'es',      label: 'Traducción', type: 'text' },
      ],
    },
  };

  const cfg = CONFIGS[modId];
  if (!cfg) {
    return html('div', { className: 'admin-note', style: { padding: '12px 0' } },
      'Este módulo usa el vocabulario de las lecciones. Para editarlo, modificá las palabras desde la sección de lecciones.'
    );
  }

  const [activeTipo, setActiveTipo] = useState(cfg.defaultTipo || null);
  const [rows, setRows] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [addDraft, setAddDraft] = useState({});
  const [msg, setMsg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // id a eliminar

  const loadRows = () => {
    let q = db.from(cfg.table).select('*').eq('active', true);
    if (cfg.hasTipo && activeTipo) q = q.eq('tipo', activeTipo);
    q.order('id', { ascending: true }).then(({ data }) => setRows((data || []).map(nfcRow)));
  };

  useEffect(() => { setRows(null); loadRows(); }, [activeTipo]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };

  const optionsToArr = (v) => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return String(v).split(',').map(s => s.trim()).filter(Boolean); }
  };
  const arrToDisplay = (v) => {
    if (Array.isArray(v)) return v.join(', ');
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.join(', '); } catch {}
    return v;
  };

  const buildPayload = (draft) => {
    const out = {};
    cfg.fields.forEach(f => {
      if (f.type === 'options') out[f.key] = optionsToArr(draft[f.key] || '');
      else out[f.key] = draft[f.key] || '';
    });
    if (cfg.hasTipo) out.tipo = activeTipo;
    if (cfg.table === 'npcr_clasificador_questions') out.active = true;
    return out;
  };

  const startEdit = (row) => {
    const draft = {};
    cfg.fields.forEach(f => {
      draft[f.key] = f.type === 'options' ? arrToDisplay(row[f.key]) : (row[f.key] || '');
    });
    setEditDraft(draft);
    setEditId(row.id);
    setAddMode(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    const { error } = await db.from(cfg.table).update(buildPayload(editDraft)).eq('id', editId);
    setSaving(false);
    if (error) { flash('❌ Error: ' + error.message); return; }
    flash('✅ Guardado');
    setEditId(null);
    loadRows();
  };

  // Se desactiva (papelera); solo el superadmin la borra definitivo
  const deleteRow = async (id) => {
    await db.from(cfg.table).update({ active: false }).eq('id', id);
    setConfirmDelete(null);
    loadRows();
  };

  const saveAdd = async () => {
    setSaving(true);
    const payload = buildPayload(addDraft);
    if (cfg.table === 'npcr_clasificador_questions') payload.lesson = 1;
    const { error } = await db.from(cfg.table).insert(payload);
    setSaving(false);
    if (error) { flash('❌ Error: ' + error.message); return; }
    flash('✅ Pregunta agregada');
    setAddMode(false);
    setAddDraft({});
    loadRows();
  };

  const FieldInput = ({ fieldCfg, draft, setDraft }) =>
    fieldCfg.type === 'select'
      ? html('select', {
          value: draft[fieldCfg.key] || fieldCfg.opts[0],
          onChange: e => setDraft(d => ({ ...d, [fieldCfg.key]: e.target.value })),
          style: { padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-deep)', fontSize: 13, background: '#fff' }
        }, ...fieldCfg.opts.map(o => html('option', { key: o, value: o }, o)))
      : html('input', {
          type: 'text',
          value: draft[fieldCfg.key] || '',
          onChange: e => setDraft(d => ({ ...d, [fieldCfg.key]: e.target.value })),
          placeholder: fieldCfg.label,
          style: { width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-deep)', fontSize: 13, boxSizing: 'border-box' }
        });

  const FormBlock = ({ draft, setDraft, onSave, onCancel }) =>
    html('div', { style: { background: 'var(--paper)', borderRadius: 12, padding: 14, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 } },
      ...cfg.fields.map(f =>
        html('div', { key: f.key },
          html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3, fontWeight: 700 } }, f.label),
          html(FieldInput, { fieldCfg: f, draft, setDraft })
        )
      ),
      html('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
        html('button', { className: 'primary-btn', style: { fontSize: 13, padding: '7px 16px' }, onClick: onSave, disabled: saving },
          saving ? 'Guardando...' : '💾 Guardar'
        ),
        html('button', { className: 'secondary-btn', style: { fontSize: 13, padding: '7px 16px' }, onClick: onCancel }, 'Cancelar'),
      )
    );

  return html('div', { style: { marginTop: 10 } },

    // Tabs de tipo (solo para clasificadores)
    cfg.hasTipo && html('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
      cfg.tipos.map(t =>
        html('button', {
          key: t.key,
          onClick: () => { setActiveTipo(t.key); setEditId(null); setAddMode(false); },
          style: {
            padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
            background: activeTipo === t.key ? 'var(--lacquer)' : 'var(--paper-deep)',
            color: activeTipo === t.key ? '#fff' : 'var(--ink)',
          }
        }, t.label)
      )
    ),

    // Mensaje flash
    msg && html('div', { style: { background: '#f0fdf4', color: '#166534', borderRadius: 8, padding: '7px 12px', fontSize: 13, marginBottom: 8 } }, msg),

    // Lista de preguntas
    rows === null
      ? html('p', { className: 'admin-note' }, '⏳ Cargando...')
      : rows.length === 0
        ? html('p', { className: 'admin-note' }, 'No hay preguntas todavía.')
        : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto', paddingRight: 4 } },
            rows.map((row, i) =>
              html('div', { key: row.id || i },
                editId === row.id
                  ? html(FormBlock, { draft: editDraft, setDraft: setEditDraft, onSave: saveEdit, onCancel: () => setEditId(null) })
                  : html('div', {
                      style: { background: '#fff', borderRadius: 10, padding: '9px 12px', boxShadow: 'var(--shadow-paper)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }
                    },
                      html('div', { style: { flex: 1, minWidth: 0 } },
                        html('div', { className: 'hanzi-font', style: { fontSize: 15, fontWeight: 700 } },
                          row.sentence || row.line_a || (Array.isArray(row.words) ? row.words.join(' ') : row.words) || '—'
                        ),
                        html('div', { style: { color: 'var(--ink-soft)', fontSize: 12, marginTop: 2 } },
                          row.pinyin || row.answer_pinyin || ''
                        ),
                        row.answer && html('div', { style: { marginTop: 3, fontSize: 12 } },
                          html('span', { style: { background: 'var(--jade-light)', color: 'var(--jade-dark)', borderRadius: 6, padding: '2px 7px', fontWeight: 700 } }, '✓ ' + row.answer)
                        ),
                        row.es && html('div', { style: { color: 'var(--ink-soft)', fontSize: 11, marginTop: 2 } }, row.es),
                      ),
                      html('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 } },
                        html('button', { onClick: () => startEdit(row), style: { background: 'var(--paper-deep)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 } }, '✏️'),
                        confirmDelete === row.id
                          ? html('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                              html('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--lacquer)' } }, '¿Quitar?'),
                              html('button', { onClick: () => deleteRow(row.id), style: { background: 'var(--lacquer)', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 } }, 'Sí'),
                              html('button', { onClick: () => setConfirmDelete(null), style: { background: 'var(--paper-deep)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 } }, 'No'),
                            )
                          : html('button', { onClick: () => setConfirmDelete(row.id), style: { background: '#fee2e2', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 } }, '🗑️'),
                      )
                    )
              )
            )
          ),

    // Agregar pregunta
    html('div', { style: { marginTop: 10 } },
      !addMode
        ? html('button', { className: 'secondary-btn', style: { fontSize: 13 }, onClick: () => { setAddMode(true); setAddDraft({}); setEditId(null); } }, '+ Agregar pregunta')
        : html(FormBlock, { draft: addDraft, setDraft: setAddDraft, onSave: saveAdd, onCancel: () => setAddMode(false) })
    ),
  );
}

// ═══════════════════════════════════════════════════════════
// Constantes de HanziWriteGame (aquí para que AppConfigEditor
// las pueda usar como fallback antes de su definición)
// ═══════════════════════════════════════════════════════════
const WRITE_LEVELS_DEFAULT = [
  { level: 1, label: '1 carácter',     minChars: 1, maxChars: 1,   hint: 'Escribí el carácter en chino' },
  { level: 2, label: '2 caracteres',   minChars: 2, maxChars: 2,   hint: 'Escribí la palabra en chino' },
  { level: 3, label: '3-4 caracteres', minChars: 3, maxChars: 4,   hint: 'Escribí la palabra o frase' },
  { level: 4, label: 'Oración',        minChars: 5, maxChars: 999, hint: 'Completá el espacio en blanco' },
];
const WRITE_STREAK_DEFAULT = 3;

// ═══════════════════════════════════════════════════════════
// AppConfigEditor — edita app_config en Supabase
// ═══════════════════════════════════════════════════════════
function AppConfigEditor({ appConfig, onAppConfigChange }) {
  const [saving, setSaving] = useState(null);       // key que se está guardando
  const [saveStatus, setSaveStatus] = useState({}); // { [key]: 'ok' | 'err' }
  const [editingKey, setEditingKey] = useState(null);

  // Estados de edición por sección
  const [brandFrames, setBrandFrames] = useState(null);
  const [brandInterval, setBrandInterval] = useState(null);
  const [modulesList, setModulesList] = useState(null);
  const [writeConfig, setWriteConfig] = useState(null);
  const [kbHint, setKbHint] = useState(null);

  const openEdit = (key) => {
    if (editingKey === key) { setEditingKey(null); return; }
    setEditingKey(key);
    if (key === 'brand_frames') setBrandFrames(JSON.parse(JSON.stringify(appConfig.brand_frames || BRAND_FRAMES_DEFAULT)));
    if (key === 'brand_anim_interval') setBrandInterval(appConfig.brand_anim_interval || 9);
    if (key === 'modules_list') setModulesList(JSON.parse(JSON.stringify(appConfig.modules_list || MODULES_LIST_DEFAULT)));
    if (key === 'write_game_config') setWriteConfig(JSON.parse(JSON.stringify(appConfig.write_game_config || { streak_to_level_up: WRITE_STREAK_DEFAULT, levels: WRITE_LEVELS_DEFAULT })));
    if (key === 'keyboard_hint_text') setKbHint(appConfig.keyboard_hint_text || '📱 Necesitás el teclado chino (Pinyin) activado · iOS: Ajustes → General → Teclado · Android: Ajustes → Idioma');
  };

  const save = async (key, value) => {
    setSaving(key);
    setSaveStatus(s => ({ ...s, [key]: null }));
    const { error } = await db.from('npcr_app_config')
      .upsert({ key, value, label: { brand_frames: 'Textos de animación de marca', brand_anim_interval: 'Segundos entre cambios de marca', modules_list: 'Módulos de práctica', write_game_config: 'Juego de escritura — niveles', keyboard_hint_text: 'Instrucción teclado chino' }[key] || key });
    setSaving(null);
    if (error) {
      setSaveStatus(s => ({ ...s, [key]: 'err' }));
    } else {
      onAppConfigChange(key, value);
      setSaveStatus(s => ({ ...s, [key]: 'ok' }));
      setEditingKey(null);
    }
  };

  const sectionStyle = { background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-paper)', marginBottom: 10 };
  const headerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' };
  const editBtnStyle = (open) => ({ background: open ? 'var(--lacquer)' : 'var(--paper-deep)', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: open ? '#fff' : 'var(--ink)' });
  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--paper-deep)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const saveBtnStyle = { background: 'var(--jade)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, marginTop: 10 };

  return html('div', null,
    // ── Animación de marca ──
    html('div', { style: sectionStyle },
      html('div', { style: headerStyle, onClick: () => openEdit('brand_frames') },
        html('div', null,
          html('div', { style: { fontWeight: 800, fontSize: 14 } }, '🎬 Animación de marca'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 } }, (appConfig.brand_frames || BRAND_FRAMES_DEFAULT).map(f => f.title).join(' → ')),
        ),
        html('button', { style: editBtnStyle(editingKey === 'brand_frames'), onClick: e => { e.stopPropagation(); openEdit('brand_frames'); } }, editingKey === 'brand_frames' ? '▲ Cerrar' : '▼ Editar'),
      ),
      editingKey === 'brand_frames' && brandFrames && html('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
        brandFrames.map((f, i) =>
          html('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
            html('div', { style: { fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', minWidth: 24 } }, (i + 1) + '.'),
            html('input', { style: { ...inputStyle, flex: 1 }, placeholder: 'Título', value: f.title, onChange: e => { const n = [...brandFrames]; n[i] = { ...n[i], title: e.target.value }; setBrandFrames(n); } }),
            html('input', { style: { ...inputStyle, flex: 1 }, placeholder: 'Subtítulo', value: f.sub, onChange: e => { const n = [...brandFrames]; n[i] = { ...n[i], sub: e.target.value }; setBrandFrames(n); } }),
            brandFrames.length > 1 && html('button', { onClick: () => setBrandFrames(brandFrames.filter((_, j) => j !== i)), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--lacquer)', padding: '0 4px' } }, '🗑'),
          )
        ),
        html('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 } },
          html('button', { onClick: () => setBrandFrames([...brandFrames, { title: '', sub: '' }]), style: { background: 'none', border: '1.5px dashed var(--paper-deep)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' } }, '+ Agregar frame'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)' } }, 'Intervalo: '),
          html('input', { type: 'number', min: 3, max: 60, value: appConfig.brand_anim_interval || 9, onChange: async (e) => { const v = parseInt(e.target.value) || 9; await save('brand_anim_interval', v); onAppConfigChange('brand_anim_interval', v); }, style: { ...inputStyle, width: 60 } }),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)' } }, 'seg'),
        ),
        html('button', { style: saveBtnStyle, disabled: saving === 'brand_frames', onClick: () => save('brand_frames', brandFrames) }, saving === 'brand_frames' ? '⏳ Guardando…' : '💾 Guardar'),
        saveStatus.brand_frames === 'ok' && html('div', { style: { color: 'var(--jade-dark)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '✅ Guardado'),
        saveStatus.brand_frames === 'err' && html('div', { style: { color: 'var(--lacquer)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '❌ Error al guardar'),
      ),
    ),

    // ── Módulos de práctica ──
    html('div', { style: sectionStyle },
      html('div', { style: headerStyle, onClick: () => openEdit('modules_list') },
        html('div', null,
          html('div', { style: { fontWeight: 800, fontSize: 14 } }, '📋 Módulos de práctica'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 } }, (appConfig.modules_list || MODULES_LIST_DEFAULT).filter(m => m.active !== false).length + ' activos · orden y textos editables'),
        ),
        html('button', { style: editBtnStyle(editingKey === 'modules_list'), onClick: e => { e.stopPropagation(); openEdit('modules_list'); } }, editingKey === 'modules_list' ? '▲ Cerrar' : '▼ Editar'),
      ),
      editingKey === 'modules_list' && modulesList && html('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
        modulesList.map((m, i) =>
          html('div', { key: m.id || i, style: { background: 'var(--paper)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, opacity: m.active === false ? 0.6 : 1 } },
            html('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              html('input', { style: { ...inputStyle, width: 50, textAlign: 'center', fontSize: 18 }, placeholder: '🔢', value: m.icon, onChange: e => { const n = [...modulesList]; n[i] = { ...n[i], icon: e.target.value }; setModulesList(n); } }),
              html('input', { style: { ...inputStyle, flex: 1, fontWeight: 700 }, placeholder: 'Título', value: m.title, onChange: e => { const n = [...modulesList]; n[i] = { ...n[i], title: e.target.value }; setModulesList(n); } }),
              html('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                html('input', { type: 'checkbox', id: 'mod-active-' + i, checked: m.active !== false, onChange: e => { const n = [...modulesList]; n[i] = { ...n[i], active: e.target.checked }; setModulesList(n); } }),
                html('label', { htmlFor: 'mod-active-' + i, style: { fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Activo'),
              ),
            ),
            html('input', { style: inputStyle, placeholder: 'Descripción', value: m.sub, onChange: e => { const n = [...modulesList]; n[i] = { ...n[i], sub: e.target.value }; setModulesList(n); } }),
          )
        ),
        html('button', { style: saveBtnStyle, disabled: saving === 'modules_list', onClick: () => save('modules_list', modulesList) }, saving === 'modules_list' ? '⏳ Guardando…' : '💾 Guardar'),
        saveStatus.modules_list === 'ok' && html('div', { style: { color: 'var(--jade-dark)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '✅ Guardado'),
        saveStatus.modules_list === 'err' && html('div', { style: { color: 'var(--lacquer)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '❌ Error al guardar'),
      ),
    ),

    // ── Juego de escritura ──
    html('div', { style: sectionStyle },
      html('div', { style: headerStyle, onClick: () => openEdit('write_game_config') },
        html('div', null,
          html('div', { style: { fontWeight: 800, fontSize: 14 } }, '✍️ Práctica de escritura'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 } }, 'Racha para subir nivel: ' + ((appConfig.write_game_config && appConfig.write_game_config.streak_to_level_up) || WRITE_STREAK_DEFAULT) + ' · ' + ((appConfig.write_game_config && appConfig.write_game_config.levels) || WRITE_LEVELS_DEFAULT).length + ' niveles'),
        ),
        html('button', { style: editBtnStyle(editingKey === 'write_game_config'), onClick: e => { e.stopPropagation(); openEdit('write_game_config'); } }, editingKey === 'write_game_config' ? '▲ Cerrar' : '▼ Editar'),
      ),
      editingKey === 'write_game_config' && writeConfig && html('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
        html('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          html('label', { style: { fontSize: 13, fontWeight: 700, minWidth: 180 } }, 'Aciertos para subir nivel:'),
          html('input', { type: 'number', min: 1, max: 10, value: writeConfig.streak_to_level_up, onChange: e => setWriteConfig({ ...writeConfig, streak_to_level_up: parseInt(e.target.value) || 3 }), style: { ...inputStyle, width: 70 } }),
        ),
        html('div', { style: { fontSize: 13, fontWeight: 800, color: 'var(--ink-soft)', marginTop: 4 } }, 'Niveles de dificultad:'),
        (writeConfig.levels || []).map((lv, i) =>
          html('div', { key: i, style: { background: 'var(--paper)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 } },
            html('div', { style: { display: 'flex', gap: 8 } },
              html('input', { style: { ...inputStyle, flex: 1 }, placeholder: 'Etiqueta', value: lv.label, onChange: e => { const n = [...writeConfig.levels]; n[i] = { ...n[i], label: e.target.value }; setWriteConfig({ ...writeConfig, levels: n }); } }),
              html('input', { type: 'number', min: 1, placeholder: 'Min', value: lv.minChars, onChange: e => { const n = [...writeConfig.levels]; n[i] = { ...n[i], minChars: parseInt(e.target.value) || 1 }; setWriteConfig({ ...writeConfig, levels: n }); }, style: { ...inputStyle, width: 60 } }),
              html('input', { type: 'number', min: 1, placeholder: 'Max', value: lv.maxChars === 999 ? '' : lv.maxChars, onChange: e => { const n = [...writeConfig.levels]; n[i] = { ...n[i], maxChars: parseInt(e.target.value) || 999 }; setWriteConfig({ ...writeConfig, levels: n }); }, style: { ...inputStyle, width: 60 } }),
            ),
            html('input', { style: inputStyle, placeholder: 'Pista para el alumno', value: lv.hint, onChange: e => { const n = [...writeConfig.levels]; n[i] = { ...n[i], hint: e.target.value }; setWriteConfig({ ...writeConfig, levels: n }); } }),
          )
        ),
        html('button', { style: saveBtnStyle, disabled: saving === 'write_game_config', onClick: () => save('write_game_config', writeConfig) }, saving === 'write_game_config' ? '⏳ Guardando…' : '💾 Guardar'),
        saveStatus.write_game_config === 'ok' && html('div', { style: { color: 'var(--jade-dark)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '✅ Guardado'),
        saveStatus.write_game_config === 'err' && html('div', { style: { color: 'var(--lacquer)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '❌ Error al guardar'),
      ),
    ),

    // ── Instrucción teclado ──
    html('div', { style: sectionStyle },
      html('div', { style: headerStyle, onClick: () => openEdit('keyboard_hint_text') },
        html('div', null,
          html('div', { style: { fontWeight: 800, fontSize: 14 } }, '📱 Instrucción teclado chino'),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, appConfig.keyboard_hint_text || '—'),
        ),
        html('button', { style: editBtnStyle(editingKey === 'keyboard_hint_text'), onClick: e => { e.stopPropagation(); openEdit('keyboard_hint_text'); } }, editingKey === 'keyboard_hint_text' ? '▲ Cerrar' : '▼ Editar'),
      ),
      editingKey === 'keyboard_hint_text' && html('div', { style: { marginTop: 10 } },
        html('textarea', { rows: 3, style: { ...inputStyle, resize: 'vertical' }, value: kbHint || '', onChange: e => setKbHint(e.target.value) }),
        html('button', { style: saveBtnStyle, disabled: saving === 'keyboard_hint_text', onClick: () => save('keyboard_hint_text', kbHint) }, saving === 'keyboard_hint_text' ? '⏳ Guardando…' : '💾 Guardar'),
        saveStatus.keyboard_hint_text === 'ok' && html('div', { style: { color: 'var(--jade-dark)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '✅ Guardado'),
        saveStatus.keyboard_hint_text === 'err' && html('div', { style: { color: 'var(--lacquer)', fontWeight: 700, fontSize: 13, marginTop: 6 } }, '❌ Error al guardar'),
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════
// GESTOR DE CLASES (panel laoshi/admin): crear, renombrar, eliminar
// clases y cargar alumnos con su código personal.
// ═══════════════════════════════════════════════════════════
const cmInput = { flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--paper-deep)', fontSize: 14, minWidth: 0 };
const cmIconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '4px 6px' };

function inviteMessage(name, code) {
  const url = location.origin + location.pathname;
  return '¡Hola ' + name + '! 👋\nTu código de alumno para NPCR Practice es: ' + code +
    '\n\n1. Entrá a ' + url + '\n2. Escribí tu nombre y el código\n\nCon ese código entrás desde cualquier celular o compu y tu progreso queda guardado. 加油！';
}

function copyText(text, onDone) {
  const done = () => onDone && onDone();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
  else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); }
}

function ClassStudents({ cls, onCount, flash, onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [seatsRes, membersRes] = await Promise.all([
      db.from('npcr_class_students').select('id,display_name,code,user_id,created_at,claimed_at').eq('class_id', cls.id).order('created_at'),
      db.from('class_members').select('student_id').eq('class_id', cls.id),
    ]);
    if (seatsRes.error) { flash('err', '❌ ' + seatsRes.error.message); setRows([]); return; }
    const seats = seatsRes.data || [];
    const seatUsers = new Set(seats.map(x => x.user_id).filter(Boolean));
    const loose = (membersRes.data || []).map(m => m.student_id).filter(id => !seatUsers.has(id));
    const ids = [...seatUsers, ...loose];
    let profiles = {};
    if (ids.length) {
      const { data } = await db.from('profiles').select('id,name,last_seen,streak_days').in('id', ids);
      (data || []).forEach(p => { profiles[p.id] = p; });
    }
    const list = [
      ...seats.map(x => ({ kind: 'seat', ...x, profile: x.user_id ? profiles[x.user_id] : null })),
      ...loose.map(id => ({ kind: 'loose', id, user_id: id, display_name: (profiles[id] && profiles[id].name) || 'Sin nombre', profile: profiles[id] })),
    ];
    setRows(list);
    onCount && onCount(list.length, list.filter(r => r.user_id).length);
  };
  useEffect(() => { load(); }, [cls.id]);

  const addStudent = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    let error = null;
    for (let i = 0; i < 4; i++) { // reintenta si el código al azar ya existe
      ({ error } = await db.from('npcr_class_students').insert({ class_id: cls.id, display_name: name, code: makeStudentCode(name) }));
      if (!error || !/duplicate|unique/i.test(error.message)) break;
    }
    setBusy(false);
    if (error) { flash('err', '❌ ' + error.message); return; }
    setNewName('');
    load();
    onChanged && onChanged();
  };

  const remove = async (r) => {
    if (!window.confirm('¿Sacar a ' + r.display_name + ' de "' + cls.name + '"?\n\nNo pierde su progreso; solo deja de estar en esta clase' +
      (r.kind === 'seat' ? ' y su código deja de funcionar.' : '.'))) return;
    const { error } = r.kind === 'seat'
      ? await db.rpc('npcr_remove_student', { p_seat: r.id })
      : await db.rpc('npcr_remove_member', { p_class: cls.id, p_student: r.user_id });
    if (error) { flash('err', '❌ ' + error.message); return; }
    load();
    onChanged && onChanged();
  };

  const regenerate = async (r) => {
    if (!window.confirm('¿Generar un código nuevo para ' + r.display_name + '?\n\nEl código anterior (' + r.code + ') deja de funcionar. Su progreso no cambia.')) return;
    const { error } = await db.from('npcr_class_students').update({ code: makeStudentCode(r.display_name) }).eq('id', r.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    load();
  };

  if (rows === null) return html('p', { className: 'admin-note', style: { margin: '10px 0 0' } }, 'Cargando alumnos...');

  return html('div', null,
    html('form', { onSubmit: addStudent, style: { display: 'flex', gap: 8, marginBottom: 10 } },
      html('input', { value: newName, onChange: e => setNewName(e.target.value), placeholder: 'Nombre y apellido del alumno', maxLength: 40, style: cmInput }),
      html('button', { className: 'primary-btn', type: 'submit', disabled: busy || !newName.trim(), style: { margin: 0, padding: '10px 14px', width: 'auto' } }, busy ? '…' : '+ Alumno'),
    ),
    rows.length === 0
      ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todavía no hay alumnos. Agregá el primero: la app le genera su código personal.')
      : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          rows.map(r => {
            const active = !!r.user_id;
            const p = r.profile;
            return html('div', { key: r.kind + r.id, style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--paper)', borderRadius: 12, padding: '10px 12px' } },
              html('div', { style: { width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14,
                background: active ? 'var(--jade-light)' : 'var(--paper-deep)', color: active ? 'var(--jade-dark)' : 'var(--ink-soft)' } },
                (r.display_name || '?').trim().charAt(0).toUpperCase()),
              html('div', { style: { flex: '1 1 150px', minWidth: 0, cursor: onOpen ? 'pointer' : 'default' }, title: onOpen ? 'Ver ficha del alumno' : '', onClick: () => onOpen && onOpen(r) },
                html('div', { style: { fontWeight: 800, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.display_name),
                html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginTop: 2 } },
                  !active ? '⏳ Sin activar todavía'
                  : '✅ Activo · ' + (p && p.last_seen ? 'entró ' + timeAgo(p.last_seen) : 'sin actividad') + (p && p.streak_days ? ' · 🔥 ' + p.streak_days : '')
                    + (r.kind === 'loose' ? ' · sin código' : '')),
                onOpen && r.kind === 'seat' && html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--gold-dark)', marginTop: 2 } }, 'Ver ficha →'),
              ),
              html('div', { style: { display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' } },
              r.kind === 'seat' && html('span', {
                title: 'Tocá para copiar el código',
                onClick: () => copyText(r.code, () => flash('ok', '📋 Código ' + r.code + ' copiado.')),
                style: { fontFamily: 'monospace', fontWeight: 800, fontSize: 13, letterSpacing: 0.5, background: 'var(--gold-light)', padding: '4px 8px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' },
              }, r.code),
              r.kind === 'seat' && html('button', { title: 'Copiar mensaje de invitación', style: cmIconBtn,
                onClick: () => copyText(inviteMessage(r.display_name.split(' ')[0], r.code), () => flash('ok', '📤 Invitación para ' + r.display_name + ' copiada: pegala en WhatsApp o mail.')) }, '📤'),
              r.kind === 'seat' && html('button', { title: 'Generar código nuevo', style: cmIconBtn, onClick: () => regenerate(r) }, '🔄'),
              html('button', { title: 'Sacar de la clase', style: { ...cmIconBtn, color: 'var(--lacquer)' }, onClick: () => remove(r) }, '✕'),
              ),
            );
          })
        ),
  );
}

// Vista admin: "Mis aulas" primero y después un bloque desplegable por profe.
function ClassGroups({ classes, me, staff, openGroups, setOpenGroups, renderCard }) {
  const byOwner = {};
  classes.forEach(c => { (byOwner[c.laoshi_id] || (byOwner[c.laoshi_id] = [])).push(c); });
  const mine = byOwner[me] || [];
  const roleOrder = { superadmin: 0, admin: 1, laoshi: 2 };
  const others = Object.keys(byOwner).filter(id => id !== me && staff[id])
    .sort((a, b) => (roleOrder[staff[a].role] ?? 3) - (roleOrder[staff[b].role] ?? 3) || String(staff[a].name).localeCompare(String(staff[b].name)));
  const orphans = Object.keys(byOwner).filter(id => id !== me && !staff[id]).flatMap(id => byOwner[id]);
  const ROLE_TXT = { superadmin: 'Superadmin', admin: 'Admin', laoshi: 'Lǎoshī' };

  const group = (key, title, sub, list) => {
    const open = !!openGroups[key];
    return html('div', { key, className: 'class-group' + (open ? ' open' : '') },
      html('button', { className: 'class-group-head', onClick: () => setOpenGroups(g => ({ ...g, [key]: !open })) },
        html('span', { className: 'class-group-avatar' }, (title || '?').charAt(0).toUpperCase()),
        html('span', { style: { flex: 1, textAlign: 'left', minWidth: 0 } },
          html('div', { style: { fontWeight: 800, fontSize: 14, color: 'var(--ink)' } }, title),
          html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' } }, sub),
        ),
        html('span', { className: 'class-group-count' }, list.length + ' aula' + (list.length === 1 ? '' : 's')),
        html('span', { style: { fontWeight: 800, color: 'var(--ink-soft)', width: 14 } }, open ? '▲' : '▼'),
      ),
      open && html('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 0 2px' } }, list.map(renderCard)),
    );
  };

  return html('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    html('div', { className: 'class-group-title' }, '📌 Mis aulas'),
    mine.length === 0
      ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todavía no creaste aulas propias.')
      : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, mine.map(renderCard)),
    (others.length > 0 || orphans.length > 0) && html('div', { className: 'class-group-title', style: { marginTop: 6 } }, '👩‍🏫 Aulas de los profes'),
    others.map(id => group(id, staff[id].name, ROLE_TXT[staff[id].role] || '', byOwner[id])),
    orphans.length > 0 && group('__orphans', 'Sin profe activo', 'Aulas de cuentas a las que se les quitó el permiso', orphans),
  );
}

function ClassManager({ session, isAdmin, isSuper, onReports }) {
  const [classes, setClasses] = useState(null);
  const [newClassName, setNewClassName] = useState('');
  const [status, setStatus] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [counts, setCounts] = useState({}); // { [classId]: { total, active } }
  const [staff, setStaff] = useState({}); // { [userId]: { name, role } } (solo admin)
  const [openGroups, setOpenGroups] = useState({}); // grupos de profe desplegados
  const [archived, setArchived] = useState([]);
  const [showArchived, setShowArchived] = useState(false);

  const flash = (type, msg) => setStatus({ type, msg });

  const load = async () => {
    const { data, error } = await db.from('classes').select('id,name,laoshi_id,created_at,archived').order('created_at', { ascending: false });
    if (error) { flash('err', '❌ No se pudieron cargar las clases: ' + error.message); setClasses([]); return; }
    setClasses((data || []).filter(c => !c.archived));
    setArchived((data || []).filter(c => c.archived));
    if (isAdmin) {
      const { data: st } = await db.rpc('npcr_staff_list');
      const m = {}; (st || []).forEach(p => { m[p.id] = { name: p.name || p.email, role: p.role }; }); setStaff(m);
    }
    const { data: seats } = await db.from('npcr_class_students').select('class_id,user_id');
    const c = {};
    (seats || []).forEach(x => { const k = c[x.class_id] || (c[x.class_id] = { total: 0, active: 0 }); k.total++; if (x.user_id) k.active++; });
    setCounts(c);
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const name = newClassName.trim();
    if (!name) return;
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const { data, error } = await db.from('classes').insert({ name, code, laoshi_id: session.user.id }).select('id').maybeSingle();
    if (error) { flash('err', '❌ ' + error.message); return; }
    setNewClassName('');
    flash('ok', '✅ Clase "' + name + '" creada.');
    await load();
    if (data && onReports) onReports(data.id);
  };

  const saveRename = async () => {
    const name = renaming.name.trim();
    if (!name) return;
    const { error } = await db.from('classes').update({ name }).eq('id', renaming.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    setRenaming(null);
    load();
  };

  // Archivar: el aula deja de aparecer en la lista (los alumnos conservan todo). Se puede restaurar.
  const archive = async (c, value) => {
    if (value && !window.confirm('¿Archivar el aula "' + c.name + '"?\n\nDeja de aparecer en tu lista. Sus alumnos y su progreso se conservan, y la podés restaurar cuando quieras.')) return;
    const { error } = await db.from('classes').update({ archived: value }).eq('id', c.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    flash('ok', value ? '📦 Aula "' + c.name + '" archivada.' : '↩️ Aula "' + c.name + '" restaurada.');
    load();
  };

  // Eliminar definitivo: solo superadmin (y solo desde Archivadas)
  const removeForever = async (c) => {
    const n = (counts[c.id] || {}).total || 0;
    if (!window.confirm('⚠️ ¿ELIMINAR DEFINITIVAMENTE el aula "' + c.name + '"?\n\n' +
      (n ? 'Sus ' + n + ' alumno(s) quedan fuera del aula y sus códigos dejan de funcionar. ' : '') +
      'Esto no se puede deshacer.')) return;
    const { error } = await db.rpc('npcr_delete_class', { p_class: c.id });
    if (error) { flash('err', '❌ ' + error.message); return; }
    flash('ok', '🗑 Aula "' + c.name + '" eliminada definitivamente.');
    load();
  };


  const classCard = (c) => {
    const k = counts[c.id] || { total: 0, active: 0 };
    const isRenaming = renaming && renaming.id === c.id;
    return html('div', { key: c.id, style: { background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-paper)' } },
      html('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        isRenaming
          ? html('form', { onSubmit: e => { e.preventDefault(); saveRename(); }, style: { display: 'flex', gap: 6, flex: 1 } },
              html('input', { value: renaming.name, autoFocus: true, maxLength: 60, onChange: e => setRenaming({ ...renaming, name: e.target.value }), style: cmInput }),
              html('button', { type: 'submit', className: 'primary-btn', style: { margin: 0, padding: '8px 12px', width: 'auto' } }, 'Guardar'),
              html('button', { type: 'button', className: 'secondary-btn', onClick: () => setRenaming(null), style: { margin: 0, padding: '8px 10px', width: 'auto' } }, '✕'),
            )
          : html('div', { style: { flex: 1, minWidth: 0, cursor: 'pointer' }, onClick: () => onReports && onReports(c.id) },
              html('strong', { style: { fontSize: 15 } }, c.name),
              html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700, marginTop: 2 } },
                k.total + ' alumno' + (k.total === 1 ? '' : 's') + (k.total ? ' · ' + k.active + ' activo' + (k.active === 1 ? '' : 's') : '')),
            ),
        !isRenaming && html('button', { title: 'Renombrar', style: cmIconBtn, onClick: () => setRenaming({ id: c.id, name: c.name }) }, '✏️'),
        !isRenaming && html('button', { title: 'Archivar aula', style: cmIconBtn, onClick: () => archive(c, true) }, '📦'),
        !isRenaming && onReports && html('button', { title: 'Abrir la clase', className: 'class-open-btn', onClick: () => onReports(c.id) }, 'Abrir →'),
      ),
    );
  };

  return html('div', null,
    html('label', null, '🏫 Mis clases'),
    html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } },
      'Creá una clase y abrila para agregar a tus alumnos (cada uno recibe su código personal), ver su avance, asignar tareas y configurarla.'),
    html('form', { onSubmit: create, style: { display: 'flex', gap: 8, marginBottom: 14 } },
      html('input', { value: newClassName, onChange: e => setNewClassName(e.target.value), placeholder: 'Nombre de la clase (ej: Nivel 1 - Sábados)', maxLength: 60, style: cmInput }),
      html('button', { className: 'primary-btn', type: 'submit', disabled: !newClassName.trim(), style: { margin: 0, padding: '10px 16px', width: 'auto' } }, '+ Crear'),
    ),
    status && html('div', { className: 'admin-status ' + (status.type === 'ok' ? 'ok' : 'err'), style: { marginBottom: 12, cursor: 'pointer' }, onClick: () => setStatus(null) }, status.msg),
    classes === null
      ? html('p', { className: 'admin-note' }, 'Cargando clases...')
      : classes.length === 0
        ? html('p', { className: 'admin-note' }, 'Todavía no creaste ninguna clase.')
        : isAdmin ? html(ClassGroups, { classes, me: session.user.id, staff, openGroups, setOpenGroups, renderCard: classCard })
        : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, classes.map(classCard)),
    archived.length > 0 && html('div', { className: 'class-group' + (showArchived ? ' open' : ''), style: { marginTop: 12 } },
      html('button', { className: 'class-group-head', onClick: () => setShowArchived(v => !v) },
        html('span', { className: 'class-group-avatar', style: { background: 'var(--paper-deep)', borderColor: 'var(--paper-deep)', color: 'var(--ink-soft)' } }, '📦'),
        html('span', { style: { flex: 1, textAlign: 'left' } },
          html('div', { style: { fontWeight: 800, fontSize: 14 } }, 'Aulas archivadas'),
          html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' } }, isSuper ? 'Restaurar o eliminar definitivamente' : 'Se pueden restaurar'),
        ),
        html('span', { className: 'class-group-count' }, archived.length),
        html('span', { style: { fontWeight: 800, color: 'var(--ink-soft)', width: 14 } }, showArchived ? '▲' : '▼'),
      ),
      showArchived && html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 2px' } },
        archived.map(c => html('div', { key: c.id, className: 'staff-row' },
          html('div', { style: { flex: 1, minWidth: 0 } },
            html('div', { style: { fontWeight: 800 } }, c.name),
            html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' } },
              ((counts[c.id] || {}).total || 0) + ' alumnos' + (isAdmin && staff[c.laoshi_id] && c.laoshi_id !== session.user.id ? ' · de ' + staff[c.laoshi_id].name : '')),
          ),
          html('button', { className: 'mini-btn', onClick: () => archive(c, false) }, '↩️ Restaurar'),
          isSuper && html('button', { className: 'mini-btn danger', onClick: () => removeForever(c) }, 'Eliminar definitivo'),
        ))),
    ),
  );
}

// ═══════════════════════════════════════════════════════════
// EQUIPO DOCENTE (admin / superadmin): crear cuentas de profe y
// asignar o quitar roles. El admin maneja laoshis; solo el
// superadmin maneja admins. Nadie toca al superadmin.
// ═══════════════════════════════════════════════════════════
const ROLE_LABELS = { superadmin: '👑 Superadmin', admin: '🔓 Admin', laoshi: '🏫 Lǎoshī' };

function makePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function staffWelcome(name, email, password, role) {
  const url = location.origin + location.pathname;
  return '¡Hola ' + (name || '').split(' ')[0] + '! 👋\nYa tenés tu cuenta de ' + (role === 'admin' ? 'administrador' : 'profe') + ' en NPCR Practice.\n\n' +
    '1. Entrá a ' + url + '\n2. Tocá ⚙ Administrar\n3. Mail: ' + email + '\n   Contraseña: ' + password + '\n\nDesde ahí creás tus aulas y cargás a tus alumnos. 加油！';
}

function StaffManager({ session, isSuper }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: makePassword(), role: 'laoshi' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [created, setCreated] = useState(null); // datos para copiar

  const load = () => db.rpc('npcr_staff_list').then(({ data, error }) => {
    if (error) { setStatus({ type: 'err', msg: '❌ ' + error.message + (/function|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_roles.sql?' : '') }); setList([]); return; }
    setList(data || []);
  });
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const name = form.name.trim(), email = form.email.trim().toLowerCase();
    if (!name || !email) return;
    setBusy(true); setStatus(null); setCreated(null);
    // Cuenta nueva con un cliente aparte: no toca la sesión de quien la crea
    const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'npcr-tmp-signup' } });
    const { error: suErr } = await tmp.auth.signUp({ email, password: form.password, options: { data: { name } } });
    const existed = suErr && /already|registered|exists/i.test(suErr.message);
    if (suErr && !existed) { setBusy(false); setStatus({ type: 'err', msg: '❌ No se pudo crear la cuenta: ' + suErr.message }); return; }
    const { error } = await db.rpc('npcr_set_role', { p_email: email, p_role: form.role, p_name: name });
    setBusy(false);
    if (error) { setStatus({ type: 'err', msg: '❌ ' + error.message }); return; }
    setCreated({ name, email, password: existed ? null : form.password, role: form.role });
    setStatus({ type: 'ok', msg: existed
      ? '✅ ' + name + ' ya tenía cuenta: ahora es ' + ROLE_LABELS[form.role] + '. Entra con su contraseña de siempre.'
      : '✅ Cuenta creada: ' + name + ' es ' + ROLE_LABELS[form.role] + '.' });
    setForm({ name: '', email: '', password: makePassword(), role: 'laoshi' });
    load();
  };

  const setRole = async (p, role) => {
    const msg = role === 'student'
      ? '¿Quitarle los permisos de staff a ' + p.name + '?\n\nSus aulas siguen existiendo, pero ya no va a poder entrar al panel.'
      : '¿Hacer ' + ROLE_LABELS[role] + ' a ' + p.name + '?';
    if (!window.confirm(msg)) return;
    const { error } = await db.rpc('npcr_set_role', { p_email: p.email, p_role: role, p_name: null });
    if (error) { setStatus({ type: 'err', msg: '❌ ' + error.message }); return; }
    setStatus({ type: 'ok', msg: '✅ Listo.' });
    load();
  };

  const me = session.user.id;
  return html('div', null,
    html('label', null, '👩‍🏫 Equipo docente'),
    html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } },
      'Los lǎoshī crean sus aulas y cargan alumnos, pero no pueden cambiar el contenido. ' +
      (isSuper ? 'Como superadmin también podés crear administradores.' : 'Solo el superadmin puede crear administradores.')),
    html('form', { onSubmit: create, className: 'staff-form' },
      html('input', { value: form.name, onChange: e => setForm({ ...form, name: e.target.value }), placeholder: 'Nombre del profe', maxLength: 60, style: cmInput }),
      html('input', { value: form.email, onChange: e => setForm({ ...form, email: e.target.value }), placeholder: 'Mail', type: 'email', autoComplete: 'off', style: cmInput }),
      html('input', { value: form.password, onChange: e => setForm({ ...form, password: e.target.value }), placeholder: 'Contraseña', autoComplete: 'off', minLength: 6, style: { ...cmInput, fontFamily: 'monospace' }, title: 'Contraseña inicial (se la mandás al profe)' }),
      isSuper && html('select', { value: form.role, onChange: e => setForm({ ...form, role: e.target.value }), style: { ...cmInput, flex: 'none' } },
        html('option', { value: 'laoshi' }, 'Lǎoshī'), html('option', { value: 'admin' }, 'Admin')),
      html('button', { className: 'primary-btn', type: 'submit', disabled: busy || !form.name.trim() || !form.email.trim() || form.password.length < 6, style: { margin: 0, width: 'auto', padding: '10px 16px' } }, busy ? 'Creando…' : '+ Crear cuenta'),
    ),
    status && html('div', { className: 'admin-status ' + (status.type === 'ok' ? 'ok' : 'err'), style: { margin: '10px 0' } }, status.msg),
    created && created.password && html('div', { className: 'staff-created' },
      html('div', { style: { fontWeight: 800, marginBottom: 4 } }, '🔑 Datos de acceso de ' + created.name),
      html('div', { style: { fontFamily: 'monospace', fontSize: 13 } }, created.email + ' · ' + created.password),
      html('button', { className: 'secondary-btn', style: { margin: '8px 0 0', width: 'auto', padding: '7px 12px', fontSize: 12 },
        onClick: () => copyText(staffWelcome(created.name, created.email, created.password, created.role), () => setStatus({ type: 'ok', msg: '📤 Mensaje con los datos de acceso copiado: pegalo en WhatsApp o mail.' })) }, '📤 Copiar mensaje con los datos'),
    ),
    list === null ? html('p', { className: 'admin-note' }, 'Cargando equipo…')
    : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 } },
        list.map(p => {
          const self = p.id === me;
          const canTouch = !self && p.role !== 'superadmin' && (isSuper || p.role === 'laoshi');
          return html('div', { key: p.id, className: 'staff-row' },
            html('div', { className: 'avatar-lg', style: { width: 38, height: 38, fontSize: 15 } }, (p.name || '?').charAt(0).toUpperCase()),
            html('div', { style: { flex: 1, minWidth: 0 } },
              html('div', { style: { fontWeight: 800, fontSize: 14 } }, (p.name || p.email) + (self ? ' (vos)' : '')),
              html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' } },
                p.email + ' · ' + p.classes + ' aula' + (p.classes === 1 ? '' : 's') + (p.last_seen ? ' · entró ' + timeAgo(p.last_seen) : '')),
            ),
            html('span', { className: 'role-badge ' + p.role }, ROLE_LABELS[p.role] || p.role),
            canTouch && isSuper && p.role === 'laoshi' && html('button', { className: 'mini-btn', onClick: () => setRole(p, 'admin') }, '↑ Admin'),
            canTouch && isSuper && p.role === 'admin' && html('button', { className: 'mini-btn', onClick: () => setRole(p, 'laoshi') }, '↓ Lǎoshī'),
            canTouch && html('button', { className: 'mini-btn danger', onClick: () => setRole(p, 'student') }, 'Quitar'),
          );
        })),
  );
}

// ═══════════════════════════════════════════════════════════
// PAPELERA + HISTORIAL DE CAMBIOS (solo superadmin)
// Lo que el admin "quita" queda oculto: acá se restaura o se borra
// definitivamente. El historial permite revertir cualquier cambio.
// ═══════════════════════════════════════════════════════════
const QUESTION_TABLES = [
  ['npcr_clasificador_questions', 'Completá la frase'],
  ['npcr_orden_questions', 'Ordená la oración'],
  ['npcr_dialogo_questions', 'Diálogos'],
];
const HISTORY_TABLE_LABELS = { npcr_vocabulary: 'Vocabulario', npcr_sentences: 'Frases', npcr_context_sentences: 'Frases en contexto', npcr_lesson_themes: 'Lecciones', npcr_app_config: 'Configuración',
  npcr_orden_questions: 'Ordená la oración', npcr_clasificador_questions: 'Completá la frase', npcr_dialogo_questions: 'Diálogos' };

function historySummary(h) {
  const r = h.new_row || h.old_row || {};
  const base = r.hanzi || r.sentence || r.correct || r.name || r.key || r.line_a || ('#' + h.row_pk);
  if (h.action === 'UPDATE' && h.old_row && h.new_row) {
    const diffs = Object.keys(h.new_row).filter(k => JSON.stringify(h.new_row[k]) !== JSON.stringify(h.old_row[k]));
    if (diffs.includes('hidden')) return base + (h.new_row.hidden ? ' → ocultada' : ' → restaurada');
    if (diffs.includes('active')) return base + (h.new_row.active ? ' → activada' : ' → quitada');
    return base + ' · ' + diffs.map(k => k + ': "' + String(h.old_row[k] ?? '').slice(0, 30) + '" → "' + String(h.new_row[k] ?? '').slice(0, 30) + '"').join(' · ');
  }
  return base;
}

function ContentTrash() {
  const [tab, setTab] = useState(null); // null | 'papelera' | 'historial'
  const [words, setWords] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [history, setHistory] = useState([]);
  const [names, setNames] = useState({});
  const [msg, setMsg] = useState(null);

  const loadTrash = async () => {
    const { data: w } = await db.from('npcr_vocabulary').select('id,lesson,hanzi,pinyin,es').eq('hidden', true).order('lesson');
    setWords(w || []);
    const qs = [];
    for (const [t, label] of QUESTION_TABLES) {
      const { data } = await db.from(t).select('*').eq('active', false);
      (data || []).forEach(r => qs.push({ table: t, label, row: r }));
    }
    setQuestions(qs);
  };
  const loadHistory = async () => {
    const { data, error } = await db.from('npcr_content_history').select('*').order('changed_at', { ascending: false }).limit(150);
    if (error) { setMsg('❌ ' + error.message + (/relation|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_proteccion.sql?' : '')); return; }
    setHistory(data || []);
    const { data: st } = await db.rpc('npcr_staff_list');
    const m = {}; (st || []).forEach(p => { m[p.id] = p.name || p.email; }); setNames(m);
  };
  const open = (t) => { setMsg(null); setTab(t); if (t === 'papelera') loadTrash(); else loadHistory(); };
  const done = (text) => { setMsg(text); if (tab === 'papelera') loadTrash(); else loadHistory(); };

  const restoreWords = async (ids) => {
    const { error } = await db.from('npcr_vocabulary').update({ hidden: false }).in('id', ids);
    done(error ? '❌ ' + error.message : '↩️ Restaurado. Recargá la app para verlo en las lecciones.');
  };
  const purgeWords = async (ids) => {
    if (!window.confirm('⚠️ ¿Borrar DEFINITIVAMENTE ' + ids.length + ' palabra(s)?\n\nQuedan en el historial: si te arrepentís, podés recuperarlas desde ahí.')) return;
    const { error } = await db.from('npcr_vocabulary').delete().in('id', ids);
    done(error ? '❌ ' + error.message : '🗑 Borradas definitivamente.');
  };
  const restoreQ = async (q) => { const { error } = await db.from(q.table).update({ active: true }).eq('id', q.row.id); done(error ? '❌ ' + error.message : '↩️ Pregunta restaurada.'); };
  const purgeQ = async (q) => {
    if (!window.confirm('⚠️ ¿Borrar DEFINITIVAMENTE esta pregunta?')) return;
    const { error } = await db.from(q.table).delete().eq('id', q.row.id); done(error ? '❌ ' + error.message : '🗑 Borrada definitivamente.');
  };
  const revert = async (h) => {
    if (!window.confirm('¿Revertir este cambio?\n\n' + historySummary(h) + '\n\nEl registro vuelve a como estaba antes.')) return;
    const { error } = await db.rpc('npcr_revert_change', { p_id: h.id });
    done(error ? '❌ ' + error.message : '↩️ Cambio revertido. Recargá la app para verlo.');
  };

  // Palabras ocultas agrupadas por lección
  const byLesson = {};
  words.forEach(w => { (byLesson[w.lesson] || (byLesson[w.lesson] = [])).push(w); });
  const fmt = (d) => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ACT = { INSERT: ['➕', 'Alta'], UPDATE: ['✏️', 'Cambio'], DELETE: ['🗑', 'Borrado'] };

  return html('div', null,
    html('label', null, '🛡️ Papelera e historial de cambios'),
    html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } },
      'Solo vos (superadmin) podés borrar contenido. Lo que el admin quita queda en la papelera, y cada cambio queda registrado con quién lo hizo, para poder revertirlo.'),
    html('div', { className: 'reg-toolbar' },
      html('button', { className: 'report-tab' + (tab === 'papelera' ? ' active' : ''), onClick: () => open('papelera') }, '🗑 Papelera'),
      html('button', { className: 'report-tab' + (tab === 'historial' ? ' active' : ''), onClick: () => open('historial') }, '🕒 Historial de cambios'),
    ),
    msg && html('div', { className: 'admin-status ' + (msg.startsWith('❌') ? 'err' : 'ok'), style: { marginBottom: 10 } }, msg),
    tab === 'papelera' && html('div', null,
      Object.keys(byLesson).length === 0 && questions.length === 0 && html('p', { className: 'admin-note' }, 'La papelera está vacía.'),
      Object.entries(byLesson).map(([l, ws]) => html('div', { key: l, className: 'staff-row', style: { alignItems: 'flex-start' } },
        html('div', { style: { flex: 1, minWidth: 0 } },
          html('div', { style: { fontWeight: 800 } }, 'Lección ' + l + ' · ' + ws.length + ' palabra' + (ws.length === 1 ? '' : 's') + ' oculta' + (ws.length === 1 ? '' : 's')),
          html('div', { className: 'word-pick-selected', style: { marginTop: 6 } },
            ws.map(w => html('span', { key: w.id, className: 'word-pick', style: { flexDirection: 'row', fontSize: 14, padding: '3px 8px', cursor: 'default' }, title: w.pinyin + ' · ' + w.es }, w.hanzi))),
        ),
        html('button', { className: 'mini-btn', onClick: () => restoreWords(ws.map(w => w.id)) }, '↩️ Restaurar'),
        html('button', { className: 'mini-btn danger', onClick: () => purgeWords(ws.map(w => w.id)) }, 'Borrar definitivo'),
      )),
      questions.map(q => html('div', { key: q.table + q.row.id, className: 'staff-row' },
        html('div', { style: { flex: 1, minWidth: 0 } },
          html('div', { style: { fontWeight: 800, fontSize: 13 } }, q.row.sentence || q.row.correct || q.row.line_a || ('#' + q.row.id)),
          html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' } }, q.label),
        ),
        html('button', { className: 'mini-btn', onClick: () => restoreQ(q) }, '↩️ Restaurar'),
        html('button', { className: 'mini-btn danger', onClick: () => purgeQ(q) }, 'Borrar definitivo'),
      )),
    ),
    tab === 'historial' && html('div', { style: { overflowX: 'auto' } },
      history.length === 0 ? html('p', { className: 'admin-note' }, 'Todavía no hay cambios registrados.')
      : html('table', { className: 'rank-table' },
          html('thead', null, html('tr', null, ['Cuándo', 'Quién', 'Qué', 'Detalle', ''].map(h => html('th', { key: h, style: { cursor: 'default' } }, h)))),
          html('tbody', null, history.map(h => html('tr', { key: h.id, style: { cursor: 'default' } },
            html('td', { style: { fontSize: 12, whiteSpace: 'nowrap' } }, fmt(h.changed_at)),
            html('td', { style: { fontSize: 12, whiteSpace: 'nowrap', fontWeight: 700 } }, names[h.changed_by] || (h.changed_by ? 'otra cuenta' : 'sistema')),
            html('td', { style: { fontSize: 12, whiteSpace: 'nowrap' } }, (ACT[h.action] || ['', h.action]).join(' ') + ' · ' + (HISTORY_TABLE_LABELS[h.table_name] || h.table_name)),
            html('td', { style: { fontSize: 12 } }, historySummary(h)),
            html('td', null, html('button', { className: 'mini-btn', onClick: () => revert(h) }, '↩️ Revertir')),
          )))),
    ),
  );
}

function AdminPanel({ vocab, onBack, onVocabUpdate, onReports, appConfig, onAppConfigChange }) {
  const [showSimulacro, setShowSimulacro] = useState(false);
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [role, setRole] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginStatus, setLoginStatus] = useState(null);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [loginBlocked, setLoginBlocked] = useState(false);
  const [loginCooldown, setLoginCooldown] = useState(0);

  // El rol (admin / laoshi / alumno) decide qué puede ver cada quien.
  // Importante: ahora que los alumnos también tienen sesión real (mail),
  // NO alcanza con "hay sesión" para mostrar el panel — hay que chequear el rol.
  useEffect(() => {
    if (!session) { setRole(null); return; }
    db.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setRole(data ? data.role : null));
  }, [session]);
  // Niveles: superadmin > admin (contenido + equipo) > laoshi (solo sus aulas)
  const isSuper = role === 'superadmin';
  const isAdmin = isSuper || role === 'admin';
  const isLaoshi = isAdmin || role === 'laoshi';


  // texto manual (modo legacy)
  const [text, setText] = useState('');
  // archivo CSV
  const [csvFile, setCsvFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);

  // ── Audios reales por lección (Supabase Storage) ──
  const [audioLesson, setAudioLesson] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [audioTitle, setAudioTitle] = useState('');
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioStatus, setAudioStatus] = useState(null);
  const [audioList, setAudioList] = useState([]);

  const loadAudioList = async (lessonId) => {
    if (!lessonId) { setAudioList([]); return; }
    const { data } = await db.from('lesson_audio').select('id,title,storage_path,position')
      .eq('lesson', lessonId).order('position');
    setAudioList(data || []);
  };
  useEffect(() => { loadAudioList(audioLesson); }, [audioLesson]);

  const handleAudioUpload = async () => {
    if (!audioFile || !audioLesson) return;
    setAudioUploading(true);
    setAudioStatus(null);
    const safeName = audioFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = audioLesson + '/' + Date.now() + '-' + safeName;
    const { error: upErr } = await db.storage.from('lesson-audio').upload(path, audioFile, {
      contentType: audioFile.type || 'audio/mpeg',
    });
    if (upErr) { setAudioUploading(false); setAudioStatus({ type: 'err', msg: '❌ ' + upErr.message }); return; }
    const { error: rowErr } = await db.from('lesson_audio').insert({
      lesson: audioLesson, title: audioTitle.trim(), storage_path: path, position: audioList.length,
    });
    setAudioUploading(false);
    if (rowErr) { setAudioStatus({ type: 'err', msg: '❌ ' + rowErr.message }); return; }
    setAudioFile(null);
    setAudioTitle('');
    setAudioStatus({ type: 'ok', msg: '✅ Audio subido.' });
    loadAudioList(audioLesson);
  };

  const handleAudioDelete = async (track) => {
    await db.storage.from('lesson-audio').remove([track.storage_path]);
    await db.from('lesson_audio').delete().eq('id', track.id);
    loadAudioList(audioLesson);
  };

  // gestión de lecciones
  const [renamingLesson, setRenamingLesson] = useState(null);
  const [visibilityTick, setVisibilityTick] = useState(0);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  // editor de contenido de lección
  const [editingLesson, setEditingLesson] = useState(null);
  const [editWords, setEditWords] = useState([]);

  // log de inicios de sesión (admins)
  const [loginLog, setLoginLog] = useState([]);
  const [showLoginLog, setShowLoginLog] = useState(false);
  const loadLoginLog = () => {
    db.from('login_log').select('email,created_at').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setLoginLog(data || []));
    setShowLoginLog(true);
  };

  // módulo expandido en el panel de edición
  const [expandedMod, setExpandedMod] = useState(null);

  // log de actividad de alumnos
  const [activityLog, setActivityLog] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const loadActivityLog = () => {
    setActivityError(null);
    db.rpc('npcr_student_directory').then(({ data, error }) => {
      if (error) { setActivityError(error.message); setActivityLog([]); }
      else setActivityLog(data || []);
    });
    setShowActivityLog(true);
  };
  const [activityError, setActivityError] = useState(null);
  const [regFilter, setRegFilter] = useState('todos'); // todos | codigo | libre
  const [regSearch, setRegSearch] = useState('');

  const handleRenameLesson = (id) => {
    const theme = LESSON_THEMES[id] || { name: 'Lección ' + id };
    setRenamingLesson(id);
    setRenameValue(theme.name);
  };

  const handleRenameSave = async (id) => {
    if (renameValue.trim()) {
      const theme = { ...(LESSON_THEMES[id] || {}), name: renameValue.trim() };
      LESSON_THEMES[id] = theme;
      // Guardar en Supabase (para todos)
      await db.from('npcr_lesson_themes').upsert({ lesson: id, name: theme.name, icon: theme.icon || id });
      // Guardar en localStorage (fallback offline)
      const saved = JSON.parse(localStorage.getItem('hanzi-lesson-themes') || '{}');
      saved[id] = theme;
      localStorage.setItem('hanzi-lesson-themes', JSON.stringify(saved));
      setStatus({ type: 'ok', msg: '✅ Nombre de Lección ' + id + ' actualizado para todos.' });
    }
    setRenamingLesson(null);
  };


  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: listener } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loginBlocked) return;
    setLoginStatus(null);
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      if (newAttempts >= 5) {
        // Bloquear 60 segundos tras 5 intentos fallidos
        setLoginBlocked(true);
        setLoginCooldown(60);
        setLoginStatus({ type: 'err', msg: '🔒 Demasiados intentos. Esperá 60 segundos.' });
        const interval = setInterval(() => {
          setLoginCooldown(s => {
            if (s <= 1) { clearInterval(interval); setLoginBlocked(false); setLoginAttempts(0); return 0; }
            return s - 1;
          });
        }, 1000);
      } else {
        setLoginStatus({ type: 'err', msg: error.message + (newAttempts >= 3 ? ' (' + (5 - newAttempts) + ' intentos restantes)' : '') });
      }
      return;
    }
    setLoginAttempts(0);
    db.from('login_log').insert({ email: data.user?.email || email }).then(() => {});
  };

  const handleLogout = async () => {
    await db.auth.signOut();
    setStatus(null);
  };

  // nueva lección

  // Parsea CSV con formato: Lección, 汉字, Pīnyīn, Significado en español
  // Agrupa automáticamente por número de lección
  const parseCsvMultiLesson = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const sep = lines[0].includes(';') ? ';' : ',';
    // Saltar encabezado si la primera celda empieza con "Lecci"
    const startIdx = /^lecci/i.test(lines[0].split(sep)[0]) ? 1 : 0;
    const lessons = {}; // { id: { name, icon, words: [] } }
    lines.slice(startIdx).forEach(line => {
      // Parsear respetando comillas
      const parts = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === sep && !inQ) { parts.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      parts.push(cur.trim());
      if (parts.length < 4) return;
      const [lecCol, hanzi, pinyin, es] = parts;
      if (!hanzi || !pinyin || !es) return;
      // Extraer número de lección: "Lección 3 — ..." → "3"
      const numMatch = lecCol.match(/lecci[oó]n\s+(\d+)/i);
      if (!numMatch) return;
      const lid = numMatch[1];
      if (!lessons[lid]) {
        // Nombre: lo que viene después de "—" en la primera aparición
        const nameMatch = lecCol.match(/[—-]\s*(.+)/);
        const rawName = nameMatch ? nameMatch[1].trim() : ('Lección ' + lid);
        // Ícono: primer carácter chino del nombre
        const iconMatch = rawName.match(/[一-鿿]/);
        lessons[lid] = { name: rawName, icon: iconMatch ? iconMatch[0] : lid, words: [] };
      }
      lessons[lid].words.push({ lesson: lid, hanzi, pinyin, es });
    });
    return lessons;
  };

  // Subir CSV multi-lección al Supabase
  const handleCsvUpload = async () => {
    if (!csvFile) { setStatus({ type: 'err', msg: 'Seleccioná un archivo CSV primero.' }); return; }
    setUploading(true);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const lessons = parseCsvMultiLesson(e.target.result);
        const lessonIds = Object.keys(lessons);
        if (lessonIds.length === 0) { setStatus({ type: 'err', msg: 'No se encontraron lecciones. Verificá el formato del CSV.' }); setUploading(false); return; }

        let totalWords = 0;
        const newVocab = { ...vocab };

        for (const lid of lessonIds) {
          const { name, icon, words } = lessons[lid];
          // Sin borrar: se actualiza por hanzi, se agregan las nuevas y las que
          // ya no están en el CSV quedan ocultas (papelera).
          const { data: current, error: curErr } = await db.from('npcr_vocabulary').select('id,hanzi,hidden').eq('lesson', lid);
          if (curErr) throw curErr;
          const byHanzi = {}; (current || []).forEach(c => { if (!byHanzi[c.hanzi]) byHanzi[c.hanzi] = c; });
          const seenIds = new Set();
          for (const w of words) {
            const prev = byHanzi[w.hanzi];
            const { error } = prev
              ? await db.from('npcr_vocabulary').update({ pinyin: w.pinyin, es: w.es, hidden: false }).eq('id', prev.id)
              : await db.from('npcr_vocabulary').insert(w);
            if (error) throw error;
            if (prev) seenIds.add(prev.id);
          }
          const gone = (current || []).filter(c => !c.hidden && !seenIds.has(c.id)).map(c => c.id);
          if (gone.length) await db.from('npcr_vocabulary').update({ hidden: true }).in('id', gone);
          await db.from('npcr_lesson_themes').upsert({ lesson: lid, name, icon });
          LESSON_THEMES[lid] = { name, icon };
          newVocab[lid] = words.map(w => ({ hanzi: w.hanzi, pinyin: w.pinyin, es: w.es }));
          totalWords += words.length;
        }

        onVocabUpdate(newVocab);
        setStatus({ type: 'ok', msg: '✅ ' + lessonIds.length + ' lección(es) cargadas con ' + totalWords + ' palabras en total para todos los usuarios.' });
        setCsvFile(null);
      } catch (err) {
        setStatus({ type: 'err', msg: 'Error: ' + err.message });
      }
      setUploading(false);
    };
    reader.readAsText(csvFile, 'UTF-8');
  };

  // Eliminar lección (local + Supabase)
  const handleToggleVisibility = async (id) => {
    const theme = LESSON_THEMES[id] || { name: 'Lección ' + id };
    const newHidden = !theme.hidden;
    const updated = { ...theme, hidden: newHidden };
    LESSON_THEMES[id] = updated;
    await db.from('npcr_lesson_themes').upsert({ lesson: id, name: updated.name, icon: updated.icon || id, hidden: newHidden });
    setStatus({ type: 'ok', msg: newHidden ? '🚫 Módulo ocultado para los alumnos.' : '👁️ Módulo visible para los alumnos.' });
    setVisibilityTick(t => t + 1);
  };

  const handleDeleteLesson = async (id) => {
    // Se oculta la lección y sus palabras (papelera). Solo el superadmin borra definitivo.
    const { error: hErr } = await db.from('npcr_vocabulary').update({ hidden: true }).eq('lesson', id);
    if (hErr) { setStatus({ type: 'err', msg: '❌ ' + hErr.message }); setConfirmDelete(null); return; }
    await db.from('npcr_sentences').update({ hidden: true }).eq('lesson', id);
    const newVocab = { ...vocab };
    delete newVocab[id];
    onVocabUpdate(newVocab);
    setConfirmDelete(null);
    setStatus({ type: 'ok', msg: '📦 Lección ' + id + ' quitada: está en la papelera (el superadmin puede restaurarla).' });
  };

  const handleApply = () => {
    if (!text.trim()) { setStatus({ type: 'err', msg: 'Pegá el contenido del vocabulario antes de aplicar.' }); return; }
    try {
      const parsed = parseVocabText(text);
      const wordCount = Object.values(parsed).reduce((acc, arr) => acc + arr.length, 0);
      if (wordCount === 0) { setStatus({ type: 'err', msg: 'No se encontraron palabras.' }); return; }
      onVocabUpdate(parsed);
      setStatus({ type: 'ok', msg: 'Listo: ' + wordCount + ' palabras cargadas localmente.' });
    } catch (err) {
      setStatus({ type: 'err', msg: 'Error: ' + err.message });
    }
  };

  const handleReset = () => {
    setStatus({ type: 'ok', msg: 'Vocabulario original restaurado.' });
    setTimeout(() => window.location.reload(), 600);
  };

  // Abrir editor de palabras de una lección
  const handleEditLesson = async (id) => {
    setEditingLesson(id);
    setEditWords((vocab[id] || []).map((w, i) => ({ ...w, _key: Date.now() + i })));
    // Traer los ids reales para editar en el lugar (sin borrar y reinsertar)
    const { data } = await db.from('npcr_vocabulary').select('id,hanzi,pinyin,es').eq('lesson', id).eq('hidden', false).order('id');
    if (data) setEditWords(data.map((w, i) => ({ ...w, _key: Date.now() + i })));
  };

  // Guardar palabras editadas a Supabase
  const handleSaveEditLesson = async () => {
    setUploading(true);
    try {
      const rows = editWords
        .filter(w => w.hanzi && w.pinyin && w.es)
        .map(w => ({ lesson: editingLesson, hanzi: w.hanzi.trim(), pinyin: w.pinyin.trim(), es: w.es.trim() }));
      if (rows.length === 0) { setStatus({ type: 'err', msg: 'No hay palabras válidas para guardar.' }); setUploading(false); return; }
      // En el lugar: se actualiza lo que cambió, se agrega lo nuevo y lo quitado
      // queda OCULTO (va a la papelera; solo el superadmin borra definitivo).
      const { data: current, error: curErr } = await db.from('npcr_vocabulary').select('id,hanzi,pinyin,es').eq('lesson', editingLesson).eq('hidden', false);
      if (curErr) throw curErr;
      const keep = new Set();
      for (const w of editWords.filter(w => w.hanzi && w.pinyin && w.es)) {
        const row = { hanzi: w.hanzi.trim(), pinyin: w.pinyin.trim(), es: w.es.trim() };
        const prev = w.id && (current || []).find(c => c.id === w.id);
        if (prev) {
          keep.add(prev.id);
          if (prev.hanzi !== row.hanzi || prev.pinyin !== row.pinyin || prev.es !== row.es) {
            const { error } = await db.from('npcr_vocabulary').update(row).eq('id', prev.id);
            if (error) throw error;
          }
        } else {
          const { error } = await db.from('npcr_vocabulary').insert({ lesson: editingLesson, ...row });
          if (error) throw error;
        }
      }
      const removed = (current || []).filter(c => !keep.has(c.id)).map(c => c.id);
      if (removed.length) {
        const { error } = await db.from('npcr_vocabulary').update({ hidden: true }).in('id', removed);
        if (error) throw error;
      }
      const newVocab = { ...vocab, [editingLesson]: rows.map(r => ({ hanzi: r.hanzi, pinyin: r.pinyin, es: r.es })) };
      onVocabUpdate(newVocab);
      setStatus({ type: 'ok', msg: '✅ Lección ' + editingLesson + ' guardada con ' + rows.length + ' palabras para todos.' });
      setEditingLesson(null);
    } catch (err) {
      setStatus({ type: 'err', msg: 'Error: ' + err.message });
    }
    setUploading(false);
  };

  const updateEditWord = (key, field, value) => setEditWords(prev => prev.map(w => w._key === key ? { ...w, [field]: value } : w));
  const removeEditWord = (key) => setEditWords(prev => prev.filter(w => w._key !== key));
  const addEditWord = () => setEditWords(prev => [...prev, { hanzi: '', pinyin: '', es: '', _key: Date.now() }]);

  const totalWords = Object.values(vocab).reduce((acc, arr) => acc + arr.length, 0);

  if (loadingSession) return html('main', { style: { paddingTop: 40, textAlign: 'center' } }, '⏳ Cargando...');

  if (showSimulacro) return html(ExamenSimulacro, { onBack: () => setShowSimulacro(false) });

  // ── Editor de palabras ──
  if (editingLesson) {
    const theme = LESSON_THEMES[editingLesson] || { name: 'Lección ' + editingLesson };
    const inputStyle = { padding: '7px 9px', borderRadius: 8, border: '1.5px solid var(--paper-deep)', fontSize: 13, fontFamily: 'Nunito, sans-serif', width: '100%' };
    return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: () => setEditingLesson(null) }, '←'),
        html('div', null,
          html('h1', null, 'Editar lección ' + editingLesson),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 } }, theme.name + ' · ' + editWords.length + ' palabras'),
        ),
      ),
      html('div', { className: 'admin-panel' },
        html('div', { style: { display: 'grid', gridTemplateColumns: '2fr 2fr 3fr auto', gap: 6, marginBottom: 6 } },
          html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 } }, '汉字'),
          html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 } }, 'Pīnyīn'),
          html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 } }, 'Español'),
          html('div', null),
        ),
        html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 } },
          editWords.map(w => html('div', { key: w._key, style: { display: 'grid', gridTemplateColumns: '2fr 2fr 3fr auto', gap: 6, alignItems: 'center' } },
            html('input', { value: w.hanzi, onChange: e => updateEditWord(w._key, 'hanzi', e.target.value), style: { ...inputStyle, fontFamily: 'Noto Serif SC, serif', fontSize: 16 } }),
            html('input', { value: w.pinyin, onChange: e => updateEditWord(w._key, 'pinyin', e.target.value), style: inputStyle }),
            html('input', { value: w.es, onChange: e => updateEditWord(w._key, 'es', e.target.value), style: inputStyle }),
            html('button', { onClick: () => removeEditWord(w._key), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--lacquer)', padding: '0 4px' } }, '🗑️'),
          )),
        ),
        html('button', { className: 'secondary-btn', style: { marginBottom: 16 }, onClick: addEditWord }, '+ Agregar palabra'),
        html('button', { className: 'primary-btn', onClick: handleSaveEditLesson, disabled: uploading }, uploading ? '⏳ Guardando...' : '💾 Guardar para todos'),
        status && html('div', { className: 'admin-status ' + (status.type === 'ok' ? 'ok' : 'err'), style: { marginTop: 10 } }, status.msg),
      ),
    );
  }

  return html('main', { style: { paddingTop: '18px' } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, 'Administrar'),
    ),
    html('div', { className: 'admin-panel' },

      // ── Info vocab actual ──
      html('div', null,
        html('label', null, 'Vocabulario actual'),
        html('p', { className: 'admin-note', style: { marginTop: 6 } },
          totalWords + ' palabras en ' + Object.keys(vocab).filter(id => id !== 'mod-paises' && id !== 'mod-numeros').length + ' lecciones + 2 módulos especiales.'
        )
      ),

      // ── Panel admin/laoshi (según rol del perfil, no solo "hay sesión") ──
      isLaoshi
        ? html(React.Fragment, null,
            html('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--jade-light)', borderRadius: 12, padding: '10px 14px' } },
              html('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--jade-dark)' } }, (isSuper ? '👑 Superadmin: ' : isAdmin ? '🔓 Admin: ' : '🏫 Lǎoshī: ') + session.user.email),
              html('button', { className: 'secondary-btn', style: { margin: 0, padding: '6px 14px', fontSize: 13 }, onClick: handleLogout }, 'Cerrar sesión'),
            ),

            ENABLE_CUI_EXAM && html('button', {
              className: 'secondary-btn',
              style: { marginTop: 8, width: '100%', borderColor: 'var(--lacquer)', color: 'var(--lacquer)', fontWeight: 700 },
              onClick: () => setShowSimulacro(true),
            }, '模拟考试 · Simulacro de Examen Nivel III'),

            // ── Mis clases ──
            html(ClassManager, { session, isAdmin, isSuper, onReports }),

            // ── Equipo docente (admin y superadmin) ──
            isAdmin && html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),
            isAdmin && html(StaffManager, { session, isSuper }),

            // ── Papelera e historial de cambios (solo superadmin) ──
            isSuper && html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),
            isSuper && html(ContentTrash, null),

            isAdmin && html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            isAdmin && html(React.Fragment, null,
            html('div', null,
              html('label', null, '➕ Cargar lecciones desde CSV'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } },
                'El archivo puede contener ', html('strong', null, 'una o varias lecciones'),
                '. Las lecciones y nombres se detectan automáticamente. Si ya existe una lección con el mismo número, se reemplaza.'
              ),
              html('p', { className: 'admin-note', style: { fontFamily: 'monospace', background: 'var(--paper)', padding: '8px 10px', borderRadius: 8, fontSize: 12, whiteSpace: 'pre' } },
                'Lección,Nº,Pīnyīn,汉字,Tipo,Significado en español\nLección 1 — 你好 (Nǐ hǎo),1,nǐ,你,Pr.,tú\nLección 1 — 你好 (Nǐ hǎo),2,hǎo,好,A,bien / bueno'
              ),
              html('input', {
                type: 'file', accept: '.csv',
                style: { margin: '8px 0 10px', width: '100%' },
                onChange: (e) => setCsvFile(e.target.files[0] || null),
              }),
              csvFile && html('p', { className: 'admin-note', style: { margin: '0 0 8px', color: 'var(--ink-mid)' } }, '📄 ' + csvFile.name),
              html('button', {
                className: 'primary-btn',
                onClick: handleCsvUpload,
                disabled: uploading || !csvFile,
              }, uploading ? '⏳ Publicando lecciones...' : '➕ Publicar para todos'),
            ),

            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Gestión de lecciones ──
            html('div', null,
              html('label', null, '📚 Lecciones cargadas'),
              html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 } },
                Object.keys(vocab).sort().filter(id => id !== 'mod-paises' && id !== 'mod-numeros').map(id => {
                  const theme = LESSON_THEMES[id] || { name: 'Lección ' + id };
                  const count = vocab[id].length;
                  const isRenaming = renamingLesson === id;
                  const isConfirmingDelete = confirmDelete === id;
                  return html('div', {
                    key: id,
                    style: { background: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: 'var(--shadow-paper)', display: 'flex', flexDirection: 'column', gap: 6 }
                  },
                    html('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                      html('span', { className: 'hanzi-font', style: { fontSize: 22, color: 'var(--lacquer)', minWidth: 32 } }, theme.icon || id),
                      isRenaming
                        ? html('input', {
                            autoFocus: true,
                            value: renameValue,
                            onChange: e => setRenameValue(e.target.value),
                            onKeyDown: e => { if (e.key === 'Enter') handleRenameSave(id); if (e.key === 'Escape') setRenamingLesson(null); },
                            style: { flex: 1, padding: '6px 10px', borderRadius: 8, border: '2px solid var(--jade)', fontSize: 14, fontFamily: 'Nunito, sans-serif' }
                          })
                        : html('div', { style: { flex: 1 } },
                            html('div', { style: { fontWeight: 800, fontSize: 14 } }, 'Lección ' + id + ' · ' + theme.name),
                            html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 } }, count + ' palabras'),
                          ),
                      isRenaming
                        ? html(React.Fragment, null,
                            html('button', { onClick: () => handleRenameSave(id), style: { background: 'var(--jade)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 13 } }, '✓ Guardar'),
                            html('button', { onClick: () => setRenamingLesson(null), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' } }, '✕'),
                          )
                        : html(React.Fragment, null,
                            html('button', { onClick: () => handleToggleVisibility(id), title: theme.hidden ? 'Mostrar a alumnos' : 'Ocultar a alumnos', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: theme.hidden ? 0.4 : 1 } }, theme.hidden ? '🚫' : '👁️'),
                            html('button', { onClick: () => handleEditLesson(id), title: 'Editar palabras', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '📝'),
                            html('button', { onClick: () => handleRenameLesson(id), title: 'Renombrar', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '✏️'),
                            html('button', { onClick: () => setConfirmDelete(id), title: 'Quitar (va a la papelera)', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '📦'),
                          ),
                    ),
                    isConfirmingDelete && html('div', { style: { background: '#FDE4DD', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                      html('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--lacquer-dark)' } }, '¿Quitar "' + theme.name + '" y sus ' + count + ' palabras? Va a la papelera y se puede restaurar.'),
                      html('div', { style: { display: 'flex', gap: 6 } },
                        html('button', { onClick: () => handleDeleteLesson(id), style: { background: 'var(--lacquer)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 13 } }, 'Quitar'),
                        html('button', { onClick: () => setConfirmDelete(null), style: { background: 'none', border: '2px solid var(--paper-deep)', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 } }, 'Cancelar'),
                      ),
                    ),
                  );
                })
              ),
            ),

            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Módulos especiales (países y números) ──
            html('div', null,
              html('label', null, '🌍 Módulos especiales'),
              html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 } },
                ['9', '10'].filter(id => vocab[id]).map(id => {
                  const theme = LESSON_THEMES[id] || { name: 'Módulo ' + id };
                  const count = vocab[id].length;
                  const isRenaming = renamingLesson === id;
                  const isConfirmingDelete = confirmDelete === id;
                  return html('div', {
                    key: id,
                    style: { background: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: 'var(--shadow-paper)', display: 'flex', flexDirection: 'column', gap: 6 }
                  },
                    html('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                      html('span', { className: 'hanzi-font', style: { fontSize: 22, color: 'var(--lacquer)', minWidth: 32 } }, theme.icon || id),
                      isRenaming
                        ? html('input', {
                            autoFocus: true,
                            value: renameValue,
                            onChange: e => setRenameValue(e.target.value),
                            onKeyDown: e => { if (e.key === 'Enter') handleRenameSave(id); if (e.key === 'Escape') setRenamingLesson(null); },
                            style: { flex: 1, padding: '6px 10px', borderRadius: 8, border: '2px solid var(--jade)', fontSize: 14, fontFamily: 'Nunito, sans-serif' }
                          })
                        : html('div', { style: { flex: 1 } },
                            html('div', { style: { fontWeight: 800, fontSize: 14 } }, theme.name),
                            html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 } }, count + ' palabras'),
                          ),
                      isRenaming
                        ? html(React.Fragment, null,
                            html('button', { onClick: () => handleRenameSave(id), style: { background: 'var(--jade)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 13 } }, '✓ Guardar'),
                            html('button', { onClick: () => setRenamingLesson(null), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-soft)' } }, '✕'),
                          )
                        : html(React.Fragment, null,
                            html('button', { onClick: () => handleToggleVisibility(id), title: theme.hidden ? 'Mostrar a alumnos' : 'Ocultar a alumnos', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: theme.hidden ? 0.4 : 1 } }, theme.hidden ? '🚫' : '👁️'),
                            html('button', { onClick: () => handleEditLesson(id), title: 'Editar palabras', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '📝'),
                            html('button', { onClick: () => handleRenameLesson(id), title: 'Renombrar', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '✏️'),
                            html('button', { onClick: () => setConfirmDelete(id), title: 'Quitar (va a la papelera)', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 } }, '📦'),
                          ),
                    ),
                    isConfirmingDelete && html('div', { style: { background: '#FDE4DD', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                      html('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--lacquer-dark)' } }, '¿Quitar "' + theme.name + '" y sus ' + count + ' palabras? Va a la papelera y se puede restaurar.'),
                      html('div', { style: { display: 'flex', gap: 6 } },
                        html('button', { onClick: () => handleDeleteLesson(id), style: { background: 'var(--lacquer)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 13 } }, 'Quitar'),
                        html('button', { onClick: () => setConfirmDelete(null), style: { background: 'none', border: '2px solid var(--paper-deep)', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 } }, 'Cancelar'),
                      ),
                    ),
                  );
                })
              ),
            ),

            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Módulos de práctica ──
            html('div', null,
              html('label', null, '🎮 Módulos de práctica'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Activá o desactivá cada módulo para todos los alumnos.'),
              html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                [
                  { id: 'mod-frase',    icon: '🧩', name: 'Completá la frase',    editable: true },
                  { id: 'mod-orden',    icon: '🔀', name: 'Ordená la oración',    editable: true },
                  { id: 'mod-audio',    icon: '🔊', name: 'Reconocer por audio',  editable: false },
                  { id: 'mod-refuerzo', icon: '💪', name: 'Reforcemos',           editable: false },
                ].map(m => {
                  const theme = LESSON_THEMES[m.id] || {};
                  const isHidden = !!theme.hidden;
                  const isOpen = expandedMod === m.id;
                  return html('div', { key: m.id },
                    html('div', {
                      style: { background: '#fff', borderRadius: isOpen ? '12px 12px 0 0' : 12, padding: '10px 14px', boxShadow: 'var(--shadow-paper)', display: 'flex', alignItems: 'center', gap: 10, opacity: isHidden ? 0.6 : 1 }
                    },
                      html('span', { style: { fontSize: 22, minWidth: 32 } }, m.icon),
                      html('div', { style: { flex: 1, fontWeight: 700, fontSize: 14 } }, m.name),
                      m.editable && html('button', {
                        onClick: () => setExpandedMod(isOpen ? null : m.id),
                        title: isOpen ? 'Cerrar editor' : 'Editar preguntas',
                        style: { background: isOpen ? 'var(--lacquer)' : 'var(--paper-deep)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: isOpen ? '#fff' : 'var(--ink)', marginRight: 4 }
                      }, isOpen ? '▲ Editar' : '▼ Editar'),
                      html('button', {
                        onClick: () => handleToggleVisibility(m.id),
                        title: isHidden ? 'Mostrar a alumnos' : 'Ocultar a alumnos',
                        style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: isHidden ? 0.4 : 1 }
                      }, isHidden ? '🚫' : '👁️'),
                    ),
                    isOpen && html('div', {
                      style: { background: 'var(--paper)', borderRadius: '0 0 12px 12px', padding: '12px 14px', boxShadow: 'var(--shadow-paper)', borderTop: '1px solid var(--paper-deep)' }
                    },
                      html(ModuleQuestionsEditor, { modId: m.id })
                    ),
                  );
                })
              ),
            ),

            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Log de inicios de sesión ──
            html('div', null,
              html('label', null, '🕒 Registro de inicios de sesión'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Últimos 50 accesos al panel de administrador.'),
              !showLoginLog
                ? html('button', { className: 'secondary-btn', onClick: loadLoginLog }, 'Ver registro')
                : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                    loginLog.length === 0
                      ? html('p', { className: 'admin-note' }, 'Sin registros todavía.')
                      : loginLog.map((r, i) => html('div', {
                          key: i,
                          style: { background: '#fff', borderRadius: 10, padding: '8px 12px', boxShadow: 'var(--shadow-paper)', display: 'flex', justifyContent: 'space-between', fontSize: 13 }
                        },
                          html('span', { style: { fontWeight: 700 } }, r.email),
                          html('span', { style: { color: 'var(--ink-soft)' } }, new Date(r.created_at).toLocaleString('es-AR')),
                        ))
                  ),
            ),

            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Registro de alumnos (con y sin código) ──
            html('div', null,
              html('label', null, '👥 Registro de alumnos'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Todos los que entraron a la app, con código de aula o solo con su nombre: primera y última vez, visitas, sesiones de práctica y hasta qué lección llegaron.'),
              !showActivityLog
                ? html('button', { className: 'secondary-btn', onClick: loadActivityLog }, 'Ver registro')
                : (() => {
                    const fmt = (d) => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                    const q = regSearch.trim().toLowerCase();
                    const rows = activityLog.filter(r => (regFilter === 'todos' || (regFilter === 'codigo') === !!r.has_code) && (!q || String(r.name || '').toLowerCase().includes(q)));
                    const nCode = activityLog.filter(r => r.has_code).length;
                    return html('div', null,
                      html('div', { className: 'reg-toolbar' },
                        [['todos', 'Todos (' + activityLog.length + ')'], ['codigo', '🎓 Con código (' + nCode + ')'], ['libre', 'Solo nombre (' + (activityLog.length - nCode) + ')']].map(([k, label]) =>
                          html('button', { key: k, className: 'report-tab' + (regFilter === k ? ' active' : ''), onClick: () => setRegFilter(k) }, label)),
                        html('input', { value: regSearch, onChange: e => setRegSearch(e.target.value), placeholder: 'Buscar por nombre…', style: { ...cmInput, flex: '1 1 160px' } }),
                        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto', padding: '7px 12px', fontSize: 12 }, onClick: loadActivityLog }, '🔄 Actualizar'),
                      ),
                      activityError && html('div', { className: 'admin-status err' }, '❌ ' + activityError + (/function|does not exist/.test(activityError) ? ' — ¿Ejecutaste npcr_registro.sql?' : '')),
                      !activityError && rows.length === 0
                        ? html('p', { className: 'admin-note' }, activityLog.length ? 'Ningún alumno coincide con el filtro.' : 'Sin registros todavía.')
                        : html('div', { style: { overflowX: 'auto' } },
                            html('table', { className: 'rank-table' },
                              html('thead', null, html('tr', null,
                                ['Alumno', 'Aula', 'Primera vez', 'Última vez', 'Visitas', 'Sesiones', 'Prom. 7 días', 'Hasta lección'].map(h => html('th', { key: h, style: { cursor: 'default' } }, h)))),
                              html('tbody', null, rows.map(r => html('tr', { key: r.user_id, style: { cursor: 'default' } },
                                html('td', { style: { fontWeight: 800, whiteSpace: 'nowrap' } }, r.name,
                                  html('span', { className: 'reg-badge' + (r.has_code ? ' code' : '') }, r.has_code ? 'código' : 'libre')),
                                html('td', { style: { fontSize: 12, whiteSpace: 'nowrap' } }, r.has_code ? (r.class_name || '—') + (r.code ? ' · ' + r.code : '') : '—'),
                                html('td', { style: { fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap' } }, fmt(r.first_seen)),
                                html('td', { style: { fontSize: 12, whiteSpace: 'nowrap' } }, timeAgo(r.last_seen)),
                                html('td', null, r.visits),
                                html('td', null, r.sessions),
                                html('td', null, r.avg_7d == null ? '—' : html(MasteryPill, { value: r.avg_7d, small: true })),
                                html('td', null, r.max_lesson ? 'L' + r.max_lesson : '—'),
                              ))),
                            ),
                          ),
                    );
                  })(),
            ),
            html('hr', { style: { border: 'none', borderTop: '1px solid var(--paper-deep)', margin: '8px 0' } }),

            // ── Configuración del app ──
            html('div', null,
              html('label', null, '⚙️ Configuración del app'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 12px' } }, 'Editá los textos y módulos de la app sin tocar código.'),
              html(AppConfigEditor, { appConfig: appConfig || {}, onAppConfigChange }),
            ),

            ), // cierre isAdmin &&
          )

        // ── Login ──
        : html('div', null,
            html('label', null, '🔐 Acceso admin'),
            html('p', { className: 'admin-note', style: { marginBottom: 14 } }, 'Solo el administrador puede cargar vocabulario para todos los usuarios.'),
            html('form', { onSubmit: handleLogin, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              html('input', { type: 'email', placeholder: 'Email', value: email, onChange: e => setEmail(e.target.value), style: { padding: '12px 14px', borderRadius: 12, border: '2px solid var(--paper-deep)', fontSize: 15, fontFamily: 'Nunito, sans-serif' } }),
              html('input', { type: 'password', placeholder: 'Contraseña', value: password, onChange: e => setPassword(e.target.value), style: { padding: '12px 14px', borderRadius: 12, border: '2px solid var(--paper-deep)', fontSize: 15, fontFamily: 'Nunito, sans-serif' } }),
              loginStatus && html('div', { className: 'admin-status err' }, loginStatus.msg),
              html('button', {
                type: 'submit', className: 'primary-btn', style: { marginTop: 4 },
                disabled: loginBlocked,
              }, loginBlocked ? '🔒 Bloqueado — ' + loginCooldown + 's' : 'Iniciar sesión'),
            ),
          ),

      // ── Reiniciar progreso (visible para todos) ──
      html('div', { style: { borderTop: '1px solid var(--paper-deep)', paddingTop: 16, marginTop: 8 } },
        html('label', null, '🔄 Mi progreso'),
        html('p', { className: 'admin-note', style: { margin: '6px 0 12px' } },
          'Borra todo tu progreso local: puntajes, estrellas, nombre y errores guardados. No afecta a otros usuarios.'
        ),
        confirmDelete === 'reset'
          ? html('div', { style: { background: '#FDE4DD', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
              html('span', { style: { fontWeight: 800, fontSize: 14, color: 'var(--lacquer-dark)' } }, '¿Seguro que querés borrar todo tu progreso? Esta acción no se puede deshacer.'),
              html('div', { style: { display: 'flex', gap: 8 } },
                html('button', {
                  className: 'primary-btn', style: { margin: 0, background: 'var(--lacquer)' },
                  onClick: () => {
                    localStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(NAME_KEY);
                    setConfirmDelete(null);
                    setTimeout(() => window.location.reload(), 300);
                  }
                }, '🗑️ Sí, borrar todo'),
                html('button', { className: 'secondary-btn', style: { margin: 0 }, onClick: () => setConfirmDelete(null) }, 'Cancelar'),
              ),
            )
          : html('button', {
              className: 'secondary-btn',
              style: { borderColor: 'var(--lacquer)', color: 'var(--lacquer)' },
              onClick: () => setConfirmDelete('reset'),
            }, '🔄 Reiniciar mi progreso'),
      ),

      status && html('div', { className: 'admin-status ' + (status.type === 'ok' ? 'ok' : 'err') }, status.msg),
    )
  );
}

// ----------------- Prueba: resultado -----------------
function PruebaResult({ percent, total, correct, missed, onRetry, onBack, playerName }) {
  let title;
  if (percent === 100) title = (playerName ? '¡Perfecto, ' + playerName + '!' : '¡Perfecto!');
  else if (percent >= 80) title = (playerName ? '¡Muy bien, ' + playerName + '!' : '¡Muy bien!');
  else if (percent >= 60) title = 'Buen intento' + (playerName ? ', ' + playerName : '');
  else title = 'Seguí practicando' + (playerName ? ', ' + playerName : '');
  return html('main', { style: { paddingTop: '18px', paddingBottom: 40 } },
    html('div', { className: 'result-screen' },
      html('div', { className: 'result-seal hanzi-font' + (percent === 100 ? ' celebrate' : '') },
        html('div', { className: 'pct' }, percent === 100 ? '完' : percent + '%'),
        html('div', { className: 'label' }, percent === 100 ? '100%' : 'SCORE')
      ),
      html('div', { className: 'result-title' }, title),
      html('div', { className: 'result-sub' }, correct + ' de ' + total + ' correctas'),
      html('div', { className: 'result-actions' },
        html('button', { className: 'primary-btn', onClick: onRetry }, 'Volver a intentar'),
        html('button', { className: 'secondary-btn', onClick: onBack }, 'Volver al inicio'),
      ),
      missed && missed.length > 0 && html('div', { className: 'review-list', style: { textAlign: 'left', width: '100%', marginTop: 8 } },
        html('div', { className: 'review-list-title' }, 'Para repasar (' + missed.length + ')'),
        missed.map((m, i) => html('div', { key: i, className: 'review-item', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 3 } },
          html('div', { className: 'hanzi-font', style: { fontSize: 16, fontWeight: 700 } }, m.hanzi),
          html('div', { style: { fontSize: 12, color: 'var(--lacquer-dark)', fontWeight: 700 } }, m.pinyin),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 } }, m.es),
        ))
      )
    )
  );
}

// ----------------- Preguntas de juegos: 100% desde Supabase -----------------
// Los 3 juegos de abajo (Clasificadores/Diálogo/Ordenar) ya no traen su
// banco de preguntas hardcodeado: lo piden a Supabase al montar. Mientras
// llega, muestran un loader; si no hay preguntas cargadas todavía, avisan.
function GameStatusScreen({ onBack, title, msg, onRetry }) {
  return html('main', { style: { paddingTop: '18px' } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, title),
    ),
    html('div', { style: { textAlign: 'center', marginTop: 40 } },
      html('p', { className: 'admin-note' }, msg),
      onRetry && html('button', { className: 'secondary-btn', style: { marginTop: 12 }, onClick: onRetry }, '🔄 Reintentar')
    )
  );
}

function nfcRow(r) {
  if (!r || typeof r !== 'object') return r;
  const out = {};
  Object.keys(r).forEach(k => { out[k] = typeof r[k] === 'string' ? nfc(r[k]) : r[k]; });
  return out;
}

// ── Pinyin con colores de tono ────────────────────────────────────────────────
function getTone(syllable) {
  if (/[āēīōūǖ]/.test(syllable)) return 1;
  if (/[áéíóúǘ]/.test(syllable)) return 2;
  if (/[ǎěǐǒǔǚ]/.test(syllable)) return 3;
  if (/[àèìòùǜ]/.test(syllable)) return 4;
  return 0;
}
const TONE_COLORS = { 1: '#3B82F6', 2: '#16A34A', 3: '#EA580C', 4: '#C1432B', 0: '#888' };

// mono: sin colores de tono (para fondos de color, donde se pierden)
function TonedPinyin({ text, style, className, mono }) {
  if (!text) return null;
  if (mono) return html('span', { style, className }, text);
  const segments = String(text).split(/(\s+)/);
  return html('span', { style, className },
    ...segments.map((seg, i) =>
      /^\s+$/.test(seg)
        ? seg
        : html('span', { key: i, style: { color: TONE_COLORS[getTone(seg)] } }, seg)
    )
  );
}

// ── Error boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  render() {
    if (this.state.err) return html('div', { style: { padding: '48px 24px', textAlign: 'center' } },
      html('div', { style: { fontSize: 56 } }, '😕'),
      html('h2', { style: { margin: '16px 0 8px' } }, 'Algo salió mal'),
      html('p', { style: { color: '#888', marginBottom: 20 } }, 'Recargá la página para continuar.'),
      html('button', { className: 'primary-btn', onClick: () => window.location.reload() }, 'Recargar página')
    );
    return this.props.children;
  }
}

function useGameQuestions(table, select, mapRow) {
  const [state, setState] = useState({ data: null, error: false });
  const load = () => {
    setState({ data: null, error: false });
    db.from(table).select(select).eq('active', true).then(({ data, error: err }) => {
      if (err) setState({ data: null, error: true });
      else setState({ data: (data || []).map(r => mapRow(nfcRow(r))), error: false });
    });
  };
  useEffect(() => { load(); }, []);
  return [state.data, state.error, load];
}

// ----------------- Ejercicios del Libro: Discriminación auditiva -----------------
// Ejercicios reales del Libro de Ejercicios (fotos del libro físico), agrupados
// por número de ejercicio (1=sonido, 2=tono, 3=marcar tono, 4=tercer tono/tono neutro).
// El libro no imprime la clave de respuestas (se corrige con el CD + el profesor),
// así que este ejercicio no marca correcto/incorrecto: trackea avance, no precisión.
function WorkbookListeningGame({ lessonId, onBack, playerName, onFinish }) {
  const [items, setItems] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    let alive = true;
    db.from('listening_exercises').select('id,ejercicio,tipo,item_num,options')
      .eq('lesson', lessonId).order('ejercicio').order('item_num')
      .then(({ data }) => { if (alive) setItems(data || []); });
    db.from('lesson_audio').select('id,title,storage_path').eq('lesson', lessonId).order('position')
      .then(({ data }) => { if (alive) setTracks(data || []); });
    return () => { alive = false; };
  }, [lessonId]);

  if (items === null) return html(GameStatusScreen, { onBack, title: 'Discriminación auditiva', msg: '⏳ Cargando...' });
  if (items.length === 0) return html(GameStatusScreen, { onBack, title: 'Discriminación auditiva', msg: 'Todavía no hay ejercicios cargados para esta lección.' });

  const groups = {};
  items.forEach(it => {
    const key = it.ejercicio + ':' + it.tipo;
    (groups[key] = groups[key] || []).push(it);
  });

  const tipoLabel = { sonido: 'Rodeá el sonido correcto según lo que escuchás',
    tono: 'Rodeá el tono correcto según lo que escuchás',
    marcar_tono: 'Marcá el tono correcto sobre la sílaba',
    tono_neutro: 'Rodeá los tonos neutros',
    tercer_tono: 'Rodeá la variación del tercer tono' };

  const pick = (id, idx) => setAnswers(prev => ({ ...prev, [id]: idx }));
  const answeredCount = Object.keys(answers).length;
  const percent = Math.round((answeredCount / items.length) * 100);

  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, 'Discriminación auditiva'),
    ),
    tracks.length > 0 && html('div', { className: 'admin-panel', style: { marginBottom: 16 } },
      html('label', null, '🎧 Audio de la lección'),
      html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Escuchalo y marcá lo que corresponda en cada ejercicio. No se autocorrige (como en el libro): tu lǎoshī lo revisa.'),
      tracks.map(t => html('audio', { key: t.id, controls: true, preload: 'none', style: { width: '100%', marginTop: 6 },
        src: db.storage.from('lesson-audio').getPublicUrl(t.storage_path).data.publicUrl }))
    ),
    html('div', { className: 'admin-note', style: { textAlign: 'center', marginBottom: 14 } }, 'Marcado: ' + answeredCount + '/' + items.length),
    Object.keys(groups).sort().map(key => {
      const [ejercicio, tipo] = key.split(':');
      return html('div', { key, className: 'admin-panel', style: { marginBottom: 14 } },
        html('label', null, 'Ejercicio ' + ejercicio + ' · ' + (tipoLabel[tipo] || tipo)),
        html('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 } },
          groups[key].map(it => html('div', { key: it.id },
            html('div', { style: { fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 4 } }, it.item_num + ')'),
            html('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              it.options.map((opt, idx) => html('button', {
                key: idx,
                onClick: () => pick(it.id, idx),
                style: {
                  padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  border: answers[it.id] === idx ? '2px solid var(--lacquer)' : '1.5px solid var(--paper-deep)',
                  background: answers[it.id] === idx ? '#FDE4DD' : '#fff',
                  color: answers[it.id] === idx ? 'var(--lacquer-dark)' : 'var(--ink)',
                },
              }, opt))
            )
          ))
        )
      );
    }),
    html('button', {
      className: 'primary-btn', style: { width: '100%', marginTop: 8 },
      onClick: () => { if (onFinish) onFinish(percent, []); onBack(); },
    }, 'Terminar (' + percent + '% marcado)')
  );
}

// ----------------- Ejercicios del Libro: Trazo de caracteres -----------------
function StrokeCanvas() {
  const canvasRef = React.useRef(null);
  const drawing = React.useRef(false);
  const start = (e) => {
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const rect = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    ctx.beginPath();
    ctx.moveTo(p.clientX - rect.left, p.clientY - rect.top);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const rect = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = '#C1432B';
    ctx.lineTo(p.clientX - rect.left, p.clientY - rect.top);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  };
  return html('div', null,
    html('canvas', {
      ref: canvasRef, width: 280, height: 280,
      style: { width: '100%', maxWidth: 280, aspectRatio: '1', background: '#fff', borderRadius: 12, border: '2px dashed var(--paper-deep)', touchAction: 'none', display: 'block', margin: '0 auto' },
      onMouseDown: start, onMouseMove: move, onMouseUp: end, onMouseLeave: end,
      onTouchStart: start, onTouchMove: move, onTouchEnd: end,
    }),
    html('button', { className: 'secondary-btn', style: { marginTop: 8, fontSize: 13, padding: '6px 14px' }, onClick: clear }, '🧹 Borrar y reintentar')
  );
}

function WorkbookStrokeGame({ lessonId, onBack }) {
  const [chars, setChars] = useState(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    db.from('stroke_practice').select('id,hanzi,pinyin,strokes,es').eq('lesson', lessonId).order('position')
      .then(({ data }) => { if (alive) setChars((data || []).map(r => ({ ...r, hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), es: nfc(r.es) }))); });
    return () => { alive = false; };
  }, [lessonId]);

  if (chars === null) return html(GameStatusScreen, { onBack, title: 'Trazo de caracteres', msg: '⏳ Cargando...' });
  if (chars.length === 0) return html(GameStatusScreen, { onBack, title: 'Trazo de caracteres', msg: 'Todavía no hay caracteres cargados para esta lección.' });

  const c = chars[index];
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, 'Trazo de caracteres'),
      html('div', { className: 'flash-counter' }, (index + 1) + '/' + chars.length),
    ),
    html('div', { className: 'admin-panel', style: { textAlign: 'center' } },
      html('div', { className: 'hanzi-font', style: { fontSize: 64, color: 'var(--lacquer)' } }, c.hanzi),
      html('div', { style: { fontWeight: 800, fontSize: 18, marginTop: 4 } }, c.pinyin),
      html('div', { style: { fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 } }, c.es),
      html('div', { className: 'hanzi-font', style: { fontSize: 20, letterSpacing: 4, color: 'var(--jade-dark)', margin: '10px 0' } }, c.strokes),
      html(StrokeCanvas, { key: c.id }),
    ),
    html('div', { style: { display: 'flex', gap: 10, marginTop: 14 } },
      index > 0 && html('button', { className: 'secondary-btn', style: { flex: 1 }, onClick: () => setIndex(index - 1) }, '← Anterior'),
      index < chars.length - 1
        ? html('button', { className: 'primary-btn', style: { flex: 1 }, onClick: () => setIndex(index + 1) }, 'Siguiente →')
        : html('button', { className: 'primary-btn', style: { flex: 1 }, onClick: onBack }, '✓ Terminar'),
    )
  );
}

// ----------------- Prueba: Clasificadores -----------------
function ClasificadorGame(props) {
  const { tipo = 'clasificador' } = props;
  const titles = { frase: 'Completá la frase', clasificador: 'Clasificadores', modal: 'Verbos modales', tiempo: 'Expresiones de tiempo' };
  const title = titles[tipo] || 'Clasificadores';
  const [raw, setRaw] = useState(null);
  const [rawErr, setRawErr] = useState(false);
  const load = () => {
    setRaw(null); setRawErr(false);
    db.from('npcr_clasificador_questions').select('sentence,pinyin,answer,answer_pinyin,options,hint,tipo')
      .eq('active', true).eq('tipo', tipo)
      .then(({ data, error: err }) => {
        if (err) setRawErr(true);
        else setRaw((data || []).map(nfcRow));
      });
  };
  useEffect(() => { load(); }, [tipo]);
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title, msg: '❌ Error de conexión.', onRetry: load });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title, msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title, msg: 'Todavía no hay preguntas cargadas. Pedile a tu lǎoshī que las suba.' });
  // Priorizar preguntas previamente fallidas (match por answer)
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...raw.filter(q => priorMissed.has(q.sentence.replace('___', q.answer))),
    ...shuffle(raw.filter(q => !priorMissed.has(q.sentence.replace('___', q.answer)))),
  ];
  return html(ClasificadorGameBody, { ...props, title, rawQuestions: ordered });
}
function ClasificadorGameBody({ onBack, onFinish, playerName, rawQuestions, title }) {
  const questions = useMemo(() => shuffle(rawQuestions), []);
  const [index, setIndex] = useState(0);
  const [opts, setOpts] = useState(() => shuffle([...questions[0].options]));
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [errors, setErrors] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);

  const q = questions[index];
  const isCorrect = selected && selected === q.answer;
  const parts = q.sentence.split('___');
  const fullSentence = q.sentence.replace('___', q.answer);
  const fullPinyin = q.pinyin.replace('___', q.answer_pinyin || q.answer);

  const [newCorrectRef, setNewCorrectRef] = useState(0);
  const [showPinyin, setShowPinyin] = useState(false);

  const handlePick = (opt) => {
    if (selected) return;
    setSelected(opt);
    setShowPinyin(false);
    const ok = opt === q.answer;
    if (ok) playCorrect(); else playWrong();
    speak(fullSentence);
    const nc = correct + (ok ? 1 : 0);
    setNewCorrectRef(nc);
    if (ok) setCorrect(nc);
    else {
      setErrors(e => e + 1);
      setMissed(m => [...m, { hanzi: fullSentence, pinyin: fullPinyin, es: q.hint }]);
    }
  };

  const handleNext = () => {
    const next = index + 1;
    if (next >= questions.length) {
      // Use newCorrectRef (updated synchronously) to avoid stale-closure on `correct`
      const finalCorrect = newCorrectRef;
      const pct = Math.round((finalCorrect / questions.length) * 100);
      if (onFinish) onFinish(pct, missed);
      setDone(true);
    } else { setIndex(next); setOpts(shuffle([...questions[next].options])); setSelected(null); setShowPinyin(false); }
  };

  if (done) return html(PruebaResult, {
    percent: Math.round((newCorrectRef / questions.length) * 100),
    total: questions.length, correct: newCorrectRef, missed,
    onRetry: () => { setIndex(0); setOpts(shuffle([...questions[0].options])); setSelected(null); setCorrect(0); setNewCorrectRef(0); setErrors(0); setMissed([]); setDone(false); },
    onBack, playerName,
  });

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, title || 'Clasificadores'),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + questions.length),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' }, html('i', null, '✕'), 'Errores: ' + errors),
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), 'Correctas: ' + correct),
      ),
      html('div', { className: 'clas-sentence' },
        parts[0],
        html('span', { className: 'clas-blank', style: selected ? { color: isCorrect ? 'var(--jade-dark)' : 'var(--error)' } : {} }, selected || ''),
        parts[1] || ''
      ),
      !selected && html('button', {
        className: 'pinyin-toggle-btn',
        onClick: () => setShowPinyin(v => !v),
      }, showPinyin ? '🙈 Ocultar pīnyīn' : '👁 Ver pīnyīn'),
      showPinyin && !selected && html(TonedPinyin, { text: q.pinyin, className: 'clas-pinyin' }),
      html('div', { className: 'clas-hint' }, q.hint),
      selected
        ? html(React.Fragment, null,
            html('div', { style: { borderRadius: 16, padding: '18px 20px', textAlign: 'center', fontWeight: 800, marginBottom: 12,
                background: isCorrect ? 'var(--jade-light)' : '#FDE4DD',
                color: isCorrect ? 'var(--jade-dark)' : 'var(--lacquer-dark)' } },
              html('div', { style: { fontSize: 40 } }, isCorrect ? '✓' : '✗'),
              html('div', { style: { fontSize: 22, marginTop: 4 } }, isCorrect ? '¡Correcto!' : 'Incorrecto'),
              html('div', { className: 'hanzi-font', style: { fontSize: 26, marginTop: 10 } }, fullSentence),
              html(TonedPinyin, { text: fullPinyin, style: { fontSize: 14, marginTop: 4, opacity: 0.85, display: 'block' } }),
              html('div', { style: { fontSize: 13, marginTop: 2, opacity: 0.75 } }, q.hint),
            ),
            html('button', { className: 'primary-btn', onClick: handleNext },
              index + 1 >= questions.length ? 'Ver resultado' : 'Siguiente →'
            )
          )
        : html('div', { className: 'quiz-options' },
            opts.map(opt => html('button', { key: opt, className: 'quiz-option', onClick: () => handlePick(opt) }, opt))
          )
    )
  );
}

// ----------------- Prueba: Diálogo -----------------
function DialogoGame(props) {
  const [raw, rawErr, rawReload] = useGameQuestions(
    'npcr_dialogo_questions',
    'context,line_a,line_b,blank_in,answer,answer_pinyin,answer_es,options,explanation',
    r => ({ context: r.context, A: r.line_a, B: r.line_b, blankIn: r.blank_in, answer: r.answer, answerPinyin: r.answer_pinyin, answerEs: r.answer_es, options: r.options, explanation: r.explanation })
  );
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: '❌ Error de conexión.', onRetry: rawReload });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: 'Todavía no hay preguntas cargadas. Pedile a tu lǎoshī que las suba desde el panel de administrador.' });
  // Priorizar preguntas previamente fallidas
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...raw.filter(q => priorMissed.has(q.answer)),
    ...shuffle(raw.filter(q => !priorMissed.has(q.answer))),
  ];
  return html(DialogoGameBody, { ...props, rawQuestions: ordered });
}
function DialogoGameBody({ onBack, onFinish, playerName, rawQuestions }) {
  const questions = useMemo(() => shuffle(rawQuestions), []);
  const [index, setIndex] = useState(0);
  const [opts, setOpts] = useState(() => shuffle([...questions[0].options]));
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [errors, setErrors] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);

  const q = questions[index];
  const isCorrect = selected && selected === q.answer;

  const [correctRef, setCorrectRef] = useState(0);

  const handlePick = (opt) => {
    if (selected) return;
    setSelected(opt);
    const ok = opt === q.answer;
    if (ok) playCorrect(); else playWrong();
    speak(q.blankIn === 'A' ? q.A.replace('___', q.answer) : q.B.replace('___', q.answer));
    const newCorrect = correctRef + (ok ? 1 : 0);
    setCorrectRef(newCorrect);
    if (ok) setCorrect(newCorrect);
    else {
      setErrors(e => e + 1);
      const full = (q.blankIn === 'A' ? q.A : q.B).replace('___', q.answer);
      setMissed(m => [...m, { hanzi: full, pinyin: q.answerPinyin, es: q.answerEs }]);
    }
  };

  const handleNext = () => {
    const next = index + 1;
    if (next >= questions.length) {
      const pct = Math.round((correctRef / questions.length) * 100);
      if (onFinish) onFinish(pct, missed);
      setDone(true);
    } else { setIndex(next); setOpts(shuffle([...questions[next].options])); setSelected(null); }
  };

  if (done) return html(PruebaResult, {
    percent: Math.round((correctRef / questions.length) * 100),
    total: questions.length, correct: correctRef, missed,
    onRetry: () => { setIndex(0); setOpts(shuffle([...questions[0].options])); setSelected(null); setCorrect(0); setCorrectRef(0); setErrors(0); setMissed([]); setDone(false); },
    onBack, playerName,
  });

  const renderLine = (speaker, text, hasBlank) => {
    const parts = text.split('___');
    return html('div', { className: 'dialogo-line' },
      html('span', { className: 'dialogo-speaker ' + speaker.toLowerCase() }, speaker + ':'),
      hasBlank
        ? html('span', null, parts[0], html('span', { className: 'dialogo-blank' }, selected || ''), parts[1] || '')
        : text
    );
  };

  const FeedbackBox = ({ bg, color, icon, label, hanzi, pinyin, es }) =>
    html('div', { style: { borderRadius: 14, padding: '12px 16px', background: bg, color, marginBottom: 8, textAlign: 'center' } },
      html('div', { style: { fontSize: 28 } }, icon),
      html('div', { style: { fontWeight: 800, fontSize: 17, margin: '4px 0' } }, label),
      html('div', { className: 'hanzi-font', style: { fontSize: 22 } }, hanzi),
      html('div', { style: { fontSize: 13, marginTop: 2, fontWeight: 700 } }, pinyin),
      html('div', { style: { fontSize: 12, marginTop: 1, opacity: 0.8 } }, es),
    );

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Completa el diálogo'),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + questions.length),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' }, html('i', null, '✕'), 'Errores: ' + errors),
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), 'Correctas: ' + correct),
      ),
      html('div', { className: 'dialogo-context' }, q.context),
      html('div', { className: 'dialogo-card' },
        renderLine('A', q.A, q.blankIn === 'A'),
        renderLine('B', q.B, q.blankIn === 'B'),
      ),
      selected
        ? html(React.Fragment, null,
            !isCorrect && html(FeedbackBox, {
              bg: '#FDE4DD', color: 'var(--lacquer-dark)', icon: '✗', label: 'Elegiste: ' + selected,
              hanzi: selected, pinyin: '', es: 'Incorrecto',
            }),
            html(FeedbackBox, {
              bg: 'var(--jade-light)', color: 'var(--jade-dark)',
              icon: isCorrect ? '✓' : '→',
              label: isCorrect ? '¡Correcto!' : 'Correcto:',
              hanzi: q.answer, pinyin: q.answerPinyin, es: q.answerEs,
            }),
            html('div', { className: 'dialogo-explanation' }, '💡 ' + q.explanation),
            html('button', { className: 'primary-btn', onClick: handleNext },
              index + 1 >= questions.length ? 'Ver resultado' : 'Siguiente →'
            )
          )
        : html('div', { className: 'quiz-options' },
            opts.map(opt => html('button', { key: opt, className: 'quiz-option', onClick: () => handlePick(opt) }, opt))
          )
    )
  );
}

// ----------------- Prueba: Ordenar -----------------
const CIRCLE_NUMS = ['①','②','③','④','⑤','⑥','⑦','⑧'];

function OrdenGame(props) {
  const [raw, rawErr, rawReload] = useGameQuestions('npcr_orden_questions', 'words,correct,es,pinyin', r => r);
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: '❌ Error de conexión.', onRetry: rawReload });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: 'Todavía no hay preguntas cargadas. Pedile a tu lǎoshī que las suba desde el panel de administrador.' });
  // Priorizar preguntas previamente fallidas (matched por oración correcta)
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...raw.filter(q => priorMissed.has(q.correct)),
    ...shuffle(raw.filter(q => !priorMissed.has(q.correct))),
  ];
  return html(OrdenGameBody, { ...props, rawQuestions: ordered });
}
function OrdenGameBody({ onBack, onFinish, playerName, rawQuestions }) {
  const questions = useMemo(() => shuffle(rawQuestions), []);
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState([]);
  const [available, setAvailable] = useState(() => shuffle(questions[0].words).map((w, i) => ({ w, i })));
  const [checked, setChecked] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [errors, setErrors] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);

  const q = questions[index];

  const loadQ = (i) => {
    setPlaced([]);
    setAvailable(shuffle(questions[i].words).map((w, idx) => ({ w, idx })));
    setChecked(null);
  };

  const tapAvailable = (item) => {
    if (checked) return;
    setAvailable(av => av.filter(x => x !== item));
    setPlaced(pl => [...pl, item]);
  };

  const tapPlaced = (item) => {
    if (checked) return;
    setPlaced(pl => pl.filter(x => x !== item));
    setAvailable(av => [...av, item]);
  };

  const [correctRef, setCorrectRef] = useState(0);

  const handleCheck = () => {
    const answer = placed.map(x => x.w).join('');
    const isCorrect = answer === q.correct;
    if (isCorrect) playCorrect(); else playWrong();
    speak(q.correct);
    setChecked(isCorrect ? 'correct' : 'wrong');
    const newCorrect = correctRef + (isCorrect ? 1 : 0);
    setCorrectRef(newCorrect);
    if (isCorrect) setCorrect(newCorrect);
    else {
      setErrors(e => e + 1);
      setMissed(m => [...m, { hanzi: q.correct, pinyin: q.pinyin, es: q.es }]);
    }
  };

  const handleNext = () => {
    const nextIdx = index + 1;
    if (nextIdx >= questions.length) {
      const pct = Math.round((correctRef / questions.length) * 100);
      if (onFinish) onFinish(pct, missed);
      setDone(true);
    } else { setIndex(nextIdx); loadQ(nextIdx); }
  };

  if (done) return html(PruebaResult, {
    percent: Math.round((correctRef / questions.length) * 100),
    total: questions.length, correct: correctRef, missed,
    onRetry: () => { setIndex(0); setCorrect(0); setCorrectRef(0); setErrors(0); setMissed([]); setDone(false); loadQ(0); },
    onBack, playerName,
  });

  return html(React.Fragment, null,
    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Ordena la oración'),
        html('div', { className: 'flash-counter' }, (index + 1) + '/' + questions.length),
      ),
      html('div', { className: 'flash-score-row' },
        html('div', { className: 'flash-score-chip no' }, html('i', null, '✕'), 'Errores: ' + errors),
        html('div', { className: 'flash-score-chip yes' }, html('i', null, '✓'), 'Correctas: ' + correct),
      ),
      html('div', { className: 'orden-hint' },
        html('div', null, 'Toca las palabras en el orden correcto'),
        html('div', { style: { fontSize: 13, color: 'var(--lacquer-dark)', fontWeight: 700, marginTop: 4, fontStyle: 'italic' } }, '→ ' + q.es),
      ),
      html('div', { className: 'orden-answer-zone' + (checked === 'correct' ? ' correct-zone' : checked === 'wrong' ? ' wrong-zone' : '') },
        placed.length === 0
          ? html('span', { style: { color: 'var(--ink-soft)', fontSize: 13, fontWeight: 700 } }, 'Toca las palabras de abajo...')
          : placed.map(item => html('button', { key: 'p' + item.i, className: 'word-chip placed', onClick: () => tapPlaced(item) }, item.w))
      ),
      checked && html('div', { style: { borderRadius: 16, padding: '16px 20px', textAlign: 'center', fontWeight: 800, marginBottom: 10,
          background: checked === 'correct' ? 'var(--jade-light)' : '#FDE4DD',
          color: checked === 'correct' ? 'var(--jade-dark)' : 'var(--lacquer-dark)' } },
        html('div', { style: { fontSize: 36 } }, checked === 'correct' ? '✓' : '✗'),
        html('div', { style: { fontSize: 20, margin: '4px 0' } }, checked === 'correct' ? '¡Correcto!' : 'Incorrecto'),
        html('div', { className: 'hanzi-font', style: { fontSize: 22, marginTop: 8 } }, q.correct),
        html(TonedPinyin, { text: q.pinyin, style: { fontSize: 14, marginTop: 4, fontWeight: 700, display: 'block' } }),
        html('div', { style: { fontSize: 13, marginTop: 2, opacity: 0.8 } }, q.es),
      ),
      checked === 'wrong' && html('div', { className: 'orden-numbered' },
        q.words.map((w, i) => html('div', { key: i, className: 'orden-numbered-item' },
          html('div', { className: 'orden-num' }, CIRCLE_NUMS[i]),
          html('div', { className: 'word-chip', style: { cursor: 'default' } }, w)
        ))
      ),
      !checked && html('div', { className: 'orden-words' },
        available.map(item => html('button', { key: 'a' + item.i, className: 'word-chip', onClick: () => tapAvailable(item) }, item.w))
      ),
      !checked
        ? html('button', { className: 'primary-btn', onClick: handleCheck,
            style: placed.length < q.words.length ? { opacity: 0.5, pointerEvents: 'none' } : {} }, 'Comprobar')
        : html('button', { className: 'primary-btn', onClick: handleNext },
            index + 1 >= questions.length ? 'Ver resultado' : 'Siguiente →'
          )
    )
  );
}

// ═══════════════════════════════════════════════════════════
// PRÁCTICA DE ESCRITURA — HanziWriteGame
// Dificultad progresiva: 1 char → 2 chars → 3-4 → oraciones
// Fuente de datos: vocabulary (niveles 1-3) + clasificador (nivel 4)
// ═══════════════════════════════════════════════════════════

function HanziWriteGame({ vocab, onBack, onFinish, playerName, priorMissed, writeConfig, keyboardHint }) {
  const WRITE_LEVELS = (writeConfig && writeConfig.levels) ? writeConfig.levels : WRITE_LEVELS_DEFAULT;
  const WRITE_STREAK_TO_LEVEL_UP = (writeConfig && writeConfig.streak_to_level_up) ? writeConfig.streak_to_level_up : WRITE_STREAK_DEFAULT;
  const kbHint = keyboardHint || '📱 Necesitás el teclado chino (Pinyin) activado · iOS: Ajustes → General → Teclado · Android: Ajustes → Idioma';

  // Construir banco de preguntas por nivel desde vocabulary
  const buildBank = () => {
    const allWords = Object.values(vocab).flat().filter(w => w && w.hanzi);
    const unique = [...new Map(allWords.map(w => [w.hanzi, w])).values()];
    const byLevel = WRITE_LEVELS.slice(0, 3).map(({ minChars, maxChars }) =>
      shuffle(unique.filter(w => {
        const len = [...w.hanzi].length; // cuenta caracteres Unicode correctamente
        return len >= minChars && len <= maxChars;
      })).map(w => ({ type: 'vocab', prompt: w.es, pinyin: w.pinyin, answer: w.hanzi }))
    );
    return byLevel;
  };

  const [bank] = useState(buildBank);
  const [clasBankRaw, setClasBank] = useState(null);
  const [level, setLevel] = useState(0);          // 0-3
  const [streak, setStreak] = useState(0);         // aciertos seguidos en nivel actual
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState('question');  // 'question' | 'result'
  const [isCorrect, setIsCorrect] = useState(null);
  const [showPinyin, setShowPinyin] = useState(false);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalAsked, setTotalAsked] = useState(0);
  const [levelUpAnim, setLevelUpAnim] = useState(false);
  const [queueIdx, setQueueIdx] = useState(0);
  const [queue, setQueue] = useState([]);
  const inputRef = React.useRef(null);

  // Cargar clasificador para nivel 4
  useEffect(() => {
    db.from('npcr_clasificador_questions').select('sentence,pinyin,answer,answer_pinyin,hint').eq('active', true)
      .then(({ data }) => {
        if (data && data.length) {
          setClasBank(shuffle(data.map(nfcRow)).map(r => ({
            type: 'clas',
            prompt: r.hint,
            sentence: r.sentence,
            pinyin: r.pinyin.replace('___', r.answer_pinyin || r.answer),
            answer: r.answer,
            fullSentence: r.sentence.replace('___', r.answer),
          })));
        } else setClasBank([]);
      });
  }, []);

  // Construir cola de preguntas para el nivel actual
  const buildQueue = (lvl) => {
    if (lvl < 3) return [...(bank[lvl] || [])].slice(0, 20);
    return (clasBankRaw || []).slice(0, 20);
  };

  useEffect(() => {
    setQueue(buildQueue(level));
    setQueueIdx(0);
    setInput('');
    setPhase('question');
    setShowPinyin(false);
  }, [level, clasBankRaw]);

  useEffect(() => {
    if (phase === 'question' && inputRef.current) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 120);
    }
  }, [phase, queueIdx]);

  const currentQ = queue[queueIdx % Math.max(queue.length, 1)];

  const handleSubmit = () => {
    if (!currentQ || !input.trim()) return;
    const ok = input.trim() === currentQ.answer;
    setIsCorrect(ok);
    setPhase('result');
    setTotalAsked(t => t + 1);
    const sayIt = currentQ.fullSentence || currentQ.answer;
    if (ok) {
      playCorrect();
      speak(sayIt);
      setTotalCorrect(t => t + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak >= WRITE_STREAK_TO_LEVEL_UP && level < WRITE_LEVELS.length - 1) {
        setLevelUpAnim(true);
        setTimeout(() => {
          setLevelUpAnim(false);
          setLevel(l => l + 1);
          setStreak(0);
        }, 1800);
      }
    } else {
      playWrong();
      setTimeout(() => speak(sayIt), 350); // después del sonido de error: la respuesta correcta
      setStreak(0);
    }
  };

  const handleNext = () => {
    setInput('');
    setShowPinyin(false);
    setPhase('question');
    setQueueIdx(i => i + 1);
  };

  if (!currentQ || (level === 3 && clasBankRaw === null)) {
    return html(GameStatusScreen, { onBack, title: 'Práctica de escritura', msg: '⏳ Cargando...' });
  }
  if (level === 3 && clasBankRaw && clasBankRaw.length === 0) {
    return html(GameStatusScreen, { onBack, title: 'Práctica de escritura', msg: 'Todavía no hay oraciones cargadas para este nivel.' });
  }

  const lvlInfo = WRITE_LEVELS[level];
  const pct = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0;

  return html(React.Fragment, null,
    // Animación de subida de nivel
    levelUpAnim && html('div', { style: {
      position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(88,204,2,0.15)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }},
      html('div', { style: { fontSize: 64 } }, '🎉'),
      html('div', { style: { fontSize: 28, fontWeight: 800, color: 'var(--jade-dark)', marginTop: 12 } }, '¡Nivel ' + (level + 2) + '!'),
      html('div', { style: { fontSize: 16, color: 'var(--ink-soft)', marginTop: 8 } }, WRITE_LEVELS[level + 1]?.label),
    ),

    html('main', { style: { paddingTop: '18px' } },
      html('div', { className: 'header-row' },
        html('button', { className: 'back-btn', onClick: onBack }, '←'),
        html('h1', null, 'Práctica de escritura'),
        html('div', { className: 'flash-counter' }, pct + '%'),
      ),

      // Barra de nivel
      html('div', { style: { padding: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 6 } },
        html('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          html('div', { style: { fontSize: 12, fontWeight: 800, color: 'var(--lacquer-dark)' } },
            'Nivel ' + (level + 1) + ' · ' + lvlInfo.label
          ),
          html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 } },
            streak + '/' + WRITE_STREAK_TO_LEVEL_UP + ' para subir' + (level === WRITE_LEVELS.length - 1 ? ' (máx)' : '')
          ),
        ),
        // Puntos de racha
        html('div', { style: { display: 'flex', gap: 6 } },
          Array.from({ length: WRITE_STREAK_TO_LEVEL_UP }).map((_, i) =>
            html('div', { key: i, style: {
              width: 28, height: 6, borderRadius: 3,
              background: i < streak ? 'var(--jade)' : 'var(--paper-deep)',
              transition: 'background 0.3s',
            }})
          )
        ),
      ),

      // Tarjeta de pregunta
      html('div', { style: {
        background: '#fff', borderRadius: 20, padding: '28px 20px 20px',
        boxShadow: '0 2px 16px rgba(0,0,0,0.07)', marginBottom: 16, textAlign: 'center',
      }},
        // Para nivel 4: mostrar oración con blank
        currentQ.type === 'clas'
          ? html('div', { className: 'clas-sentence', style: { fontSize: 26, marginBottom: 8 } },
              currentQ.sentence.split('___')[0],
              html('span', { style: { borderBottom: '2px solid var(--lacquer)', padding: '0 16px', color: 'var(--lacquer)' } }, ' '),
              currentQ.sentence.split('___')[1] || ''
            )
          : null,

        // Hanzi visible pero no copiable (el alumno debe tipear con teclado chino)
        currentQ.type !== 'clas' && html('div', {
          className: 'hanzi-font',
          style: {
            fontSize: 64, color: 'var(--ink)', marginBottom: 8, lineHeight: 1,
            userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none',
          },
          onCopy: e => e.preventDefault(),
        }, currentQ.answer),

        // Pista en español
        html('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 } },
          currentQ.prompt
        ),

        // Botón ver pinyin (solo en fase pregunta)
        phase === 'question' && html('button', {
          className: 'pinyin-toggle-btn',
          style: { marginTop: 8 },
          onClick: () => setShowPinyin(v => !v),
        }, showPinyin ? '🙈 Ocultar pīnyīn' : '👁 Ver pīnyīn'),

        showPinyin && phase === 'question' && html(TonedPinyin, {
          text: currentQ.pinyin,
          style: { fontSize: 15, fontWeight: 700, color: 'var(--lacquer-dark)', display: 'block', marginTop: 6 },
        }),
      ),

      // Input de escritura (solo en fase pregunta)
      phase === 'question' && html('div', { style: { marginBottom: 16 } },
        html('div', { style: { fontSize: 11, fontWeight: 800, color: 'var(--ink-soft)', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' } },
          lvlInfo.hint
        ),
        html('input', {
          ref: inputRef,
          type: 'text',
          lang: 'zh',
          value: input,
          onChange: e => setInput(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') handleSubmit(); },
          placeholder: '写汉字…',
          style: {
            width: '100%', fontSize: 28, textAlign: 'center', padding: '14px 16px',
            border: '2px solid var(--paper-deep)', borderRadius: 14, outline: 'none',
            fontFamily: "'Noto Sans SC', sans-serif", background: '#fff',
            caretColor: 'var(--lacquer)',
          },
        }),
        html('button', {
          className: 'primary-btn', style: { width: '100%', marginTop: 10 },
          onClick: handleSubmit,
          disabled: !input.trim(),
        }, '确认 Confirmar'),
      ),

      // Feedback resultado
      phase === 'result' && html('div', { style: {
        borderRadius: 16, padding: '20px', textAlign: 'center', fontWeight: 800, marginBottom: 12,
        background: isCorrect ? 'var(--jade-light)' : '#FDE4DD',
        color: isCorrect ? 'var(--jade-dark)' : 'var(--lacquer-dark)',
      }},
        html('div', { style: { fontSize: 48 } }, isCorrect ? '✓' : '✗'),
        html('div', { style: { fontSize: 20, margin: '4px 0' } }, isCorrect ? '¡Correcto!' : 'Incorrecto'),
        !isCorrect && html('div', { style: { fontSize: 13, marginBottom: 6 } }, 'Escribiste: ' + input),
        html('div', { className: 'hanzi-font', style: { fontSize: 36, margin: '8px 0 4px' } }, currentQ.answer),
        html(TonedPinyin, { text: currentQ.pinyin, style: { fontSize: 16, fontWeight: 700, display: 'block', marginBottom: 4 } }),
        html('div', { style: { fontSize: 13, opacity: 0.8 } }, currentQ.prompt),
        html('button', {
          className: 'primary-btn', style: { marginTop: 16, width: '100%' },
          onClick: handleNext,
        }, levelUpAnim ? '🎉 ¡Subiste de nivel!' : 'Siguiente →'),
      ),

      // Instrucción teclado chino (primera visita)
      html('div', { style: {
        marginTop: 8, padding: '10px 14px', background: 'var(--paper-deep)', borderRadius: 10,
        fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600, textAlign: 'center', lineHeight: 1.5,
      }},
        kbHint
      ),
    )
  );
}

const root = createRoot(document.getElementById('root'));
root.render(html(ErrorBoundary, null, html(App)));