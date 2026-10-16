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
  // 6 caracteres al azar seguro (los códigos viejos de 4 siguen sirviendo)
  return base + '-' + secureRandomChars(CODE_CHARS, 6);
}
// Azar seguro del navegador (no Math.random) para códigos y contraseñas
function secureRandomChars(chars, n) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, x => chars[x % chars.length]).join('');
}
// Mensaje del límite de intentos con códigos (npcr_seguridad.sql)
const codeErrMsg = (err) => /intentos/i.test((err && err.message) || '') ? err.message : 'No se pudo verificar el código. Revisá tu conexión.';

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
// Memoria: campanita suave al encontrar una pareja (pedido del usuario solo para este juego)
function playMatchChime() {
  if (!_soundOn) return;
  try { softTone(880, 0, 0.45, 0.045); softTone(1318.5, 0.09, 0.6, 0.04); softTone(2637, 0.09, 0.3, 0.008); } catch (e) {}
}
function playLevelChime() {
  if (!_soundOn) return;
  try { [[784, 0], [988, 0.12], [1175, 0.24], [1568, 0.38]].forEach(([f, t]) => softTone(f, t, 0.7, 0.04)); } catch (e) {}
}

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

// Código que llega en el link de ingreso (…/#codigo=XXXX): se lee una vez y se borra de la barra
const LINK_CODE = (() => {
  try {
    const m = /(?:^|[#&])codigo=([A-Za-z0-9-]+)/.exec(location.hash || '');
    if (m) history.replaceState(null, '', location.pathname + location.search);
    return m ? m[1].toUpperCase() : null;
  } catch (e) { return null; }
})();

function AuthGate({ onAuthenticated, onBeforeAuth }) {
  const [name, setName] = useState('');
  const [studentCode, setStudentCode] = useState(LINK_CODE || '');
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
        setErr(stErr ? codeErrMsg(stErr) : 'Ese código no existe. Revisalo con tu lǎoshī.');
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
        // Mostrar el motivo real (ej. límite de ingresos de Supabase desde una misma red)
        const why = String((anonRes.error && anonRes.error.message) || (res.error && res.error.message) || '');
        console.error('ingreso', anonRes.error, res.error);
        setErr(/rate limit|too many|429/i.test(why)
          ? 'Muchos ingresos al mismo tiempo desde esta red (por ejemplo, el wifi del instituto). Esperá unos minutos o probá con los datos del celular.'
          : 'No se pudo entrar' + (why ? ' (' + why + ')' : '') + '. Revisá tu conexión y probá de nuevo.');
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
          value: studentCode, autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false,
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
  const modeIcon = { memoria: '🃏', match: '🔗', cards: '🀄', quiz: '✅', frases: '💬', frase: '🧩', orden: '🔀', audio: '🔊', escritura: '✍️', tonos: '🎵', dictado: '✍️', semana: '⭐', 'refuerzo-clase': '🧩', dificiles: '💪' };
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
            onClick: () => copyText(inviteMessage(row.display_name.split(' ')[0], row.code), () => appAlert({ icon: '📤', title: 'Invitación copiada', text: 'Pegala en WhatsApp o en un mail.' })) }, '📤 Copiar invitación'),
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

// Nombre legible de un tipo de práctica registrado en npcr_activity (kind/mode)
function activityName(kind, mode) {
  const extra = { daily: 'Entrenamiento diario', 'refuerzo-clase': 'Refuerzo de clase', semana: 'Palabras de la semana', dificiles: 'Mis palabras difíciles',
    escritura: 'Práctica de escritura', 'clase-orden': 'Clases · ordenar oraciones', 'clase-quiz': 'Clases · mis preguntas', 'clase-palabras': 'Clases · mis palabras', 'clase-trazos': 'Clases · trazos' };
  if (kind === 'daily') return extra.daily;
  const found = [...PLAN_LESSON_MODES, ...PLAN_GAMES].find(x => x[0] === mode);
  return extra[mode] || (found && found[1]) || mode || kind;
}
// Flecha de tendencia contra la semana anterior
function trendText(now, prev, unit) {
  if (now == null || prev == null) return 'sin datos de la semana anterior';
  const d = now - prev;
  if (d === 0) return '＝ igual que la semana anterior';
  return (d > 0 ? '▲ +' : '▼ ') + d + (unit || '') + ' vs semana anterior';
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
  const [sel, setSel] = useState(null);   // alumno resaltado: { uid, name }
  const [ins, setIns] = useState(null);   // tendencias y dificultad (npcr_class_insights)
  const [alertCfg, setAlertCfg] = useState({});
  const [mapMode, setMapMode] = useState('alumnos');
  const [compose, setCompose] = useState(null);   // { uid|null, name, text }
  const [sent, setSent] = useState(null);         // mensajes enviados
  const loadSent = () => db.rpc('npcr_class_messages', { p_class: classId }).then(({ data, error }) => setSent(error ? null : (data || [])));
  const sendMsg = async () => {
    const { data, error } = await db.rpc('npcr_class_message', { p_class: classId, p_user: compose.uid || null, p_text: compose.text });
    if (error) { setFlashMsg({ type: 'err', msg: '❌ ' + error.message + (/function|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_panel_laoshi.sql?' : '') }); return; }
    setFlashMsg({ type: 'ok', msg: '✉️ Mensaje enviado a ' + (compose.uid ? compose.name : data + ' alumnos') + '. Le aparece al abrir la app (o en menos de un minuto si la tiene abierta).' });
    setCompose(null); loadSent();
  };

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
  const loadSettings = () => db.from('npcr_class_settings').select('*').eq('class_id', classId).maybeSingle()
    .then(({ data }) => setSettings({ max_lesson: data && data.max_lesson ? String(data.max_lesson) : '', weekly_title: (data && data.weekly_title) || '', weekly_words: (data && data.weekly_words) || [],
      hsk1_enabled: !!(data && data.hsk1_enabled), hsk1_exam_date: (data && data.hsk1_exam_date) || '',
      hsk2_enabled: !!(data && data.hsk2_enabled), hsk2_exam_date: (data && data.hsk2_exam_date) || '',
      hidden_activities: (data && data.hidden_activities) || [], _hasHidden: !!data && 'hidden_activities' in data,
      shown_activities: (data && data.shown_activities) || [], _hasShown: !!data && 'shown_activities' in data }));
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await db.from('npcr_class_settings').upsert({ class_id: classId, max_lesson: next.max_lesson ? Number(next.max_lesson) : null,
      weekly_title: next.weekly_title || null, weekly_words: next.weekly_words,
      hsk1_enabled: !!next.hsk1_enabled, hsk1_exam_date: next.hsk1_exam_date || null,
      hsk2_enabled: !!next.hsk2_enabled, hsk2_exam_date: next.hsk2_exam_date || null,
      ...(next._hasHidden || (next.hidden_activities || []).length ? { hidden_activities: next.hidden_activities || [] } : {}),
      ...(next._hasShown || (next.shown_activities || []).length ? { shown_activities: next.shown_activities || [] } : {}),
      updated_at: new Date().toISOString() });
    setSavedMsg(error ? '❌ ' + error.message : '✅ Guardado');
    setTimeout(() => setSavedMsg(null), 2000);
  };

  useEffect(() => {
    if (!classId) return;
    setRows(null); setStudent(null); setErr(null);
    if (!reloadKey) setSel(null);
    Promise.all([db.rpc('npcr_class_report', { p_class: classId }), db.rpc('npcr_class_hard_words', { p_class: classId })])
      .then(([r, h]) => {
        if (r.error) { setErr(r.error.message); setRows([]); return; }
        setRows(r.data || []); setHard(h.data || []);
      });
    loadTasks();
    loadSettings();
    setIns(null);
    db.rpc('npcr_class_insights', { p_class: classId }).then(({ data, error }) => setIns(error ? { error: error.message } : data));
    db.from('npcr_app_config').select('value').eq('key', 'alertas_config').maybeSingle().then(({ data }) => setAlertCfg((data && data.value) || {}));
    loadSent();
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
    if (!await appConfirm('¿Eliminar la tarea "' + t.title + '"?')) return;
    await db.from('assignments').delete().eq('id', t.id);
    loadTasks();
  };

  const cls = (classes || []).find(c => c.id === classId);
  const active = (rows || []).filter(r => r.user_id);
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  // Alertas: los umbrales salen de npcr_app_config 'alertas_config' (editable en Configuración)
  const A = { inactivo_dias: 5, precision_min: 60, sesiones_min: 2, dificiles_min: 8, ejercicio_min: 70, palabra_grupo_pct: 50, ...alertCfg };
  const alerts = [];
  if (rows) {
    const asleep = active.filter(r => { const d = daysSince(r.last_activity || r.last_seen); return d === null || d >= A.inactivo_dias; });
    if (asleep.length >= 3) alerts.push({ tone: 'warn', text: '😴 ' + asleep.length + ' alumnos no practican hace ' + A.inactivo_dias + ' días o más: ' + asleep.map(r => r.display_name).join(', ') + '.', uids: asleep });
    else asleep.forEach(r => { const d = daysSince(r.last_activity || r.last_seen); alerts.push({ tone: 'warn', text: '😴 ' + r.display_name + (d === null ? ' no registra práctica todavía.' : ' no practica hace ' + d + ' días.'), uids: [r] }); });
    rows.filter(r => !r.user_id).forEach(r => alerts.push({ tone: 'info', text: '⏳ ' + r.display_name + ' todavía no activó su código (' + r.code + ').' }));
    active.forEach(r => {
      if (r.acc_7d != null && r.acc_7d < A.precision_min && r.sessions_7d >= A.sesiones_min) alerts.push({ tone: 'warn', text: '📉 ' + r.display_name + ' tiene precisión baja esta semana (' + r.acc_7d + '%).', uids: [r] });
      if (r.words_struggling >= A.dificiles_min) alerts.push({ tone: 'warn', text: '🧩 ' + r.display_name + ' acumula ' + r.words_struggling + ' palabras con dificultad.', uids: [r] });
    });
    (ins && ins.modes || []).filter(m => m.n >= 3 && m.acc < A.ejercicio_min).slice(0, 3).forEach(m =>
      alerts.push({ tone: 'info', text: '🎯 Al grupo le cuesta "' + activityName(m.kind, m.mode) + '": ' + m.acc + '% de aciertos en ' + m.n + ' intentos.' }));
    hard.filter(h => active.length && h.students / active.length * 100 >= A.palabra_grupo_pct).slice(0, 3).forEach(h =>
      alerts.push({ tone: 'info', text: '🔁 ' + h.hanzi + ' (' + (h.es || '') + ') la falla el ' + Math.round(h.students / active.length * 100) + '% del grupo: conviene repasarla en clase.' }));
    if (!alerts.some(a => a.text.startsWith('🔁')) && hard[0] && hard[0].students >= 2) alerts.push({ tone: 'info', text: '🎯 La palabra que más cuesta en la clase es ' + hard[0].hanzi + ' (' + (hard[0].es || '') + '): ' + hard[0].students + ' alumnos.' });
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

  const isSel = (r) => !!sel && (sel.uid ? r.user_id === sel.uid : !r.user_id && r.display_name === sel.name);
  const pick = (r) => setSel(isSel(r) ? null : { uid: r.user_id || null, name: r.display_name });
  const selRow = sel && (rows || []).find(isSel);
  // Al cambiar de pestaña, la fila del alumno resaltado queda a la vista
  useEffect(() => {
    if (!sel) return;
    const t = setTimeout(() => { const el = document.querySelector('.sel-row'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 60);
    return () => clearTimeout(t);
  }, [tab, !!sel]);

  const tabs = [['alumnos', '👥 Alumnos'], ['resumen', '📊 Resumen'], ['ranking', '🏆 Ranking'], ['mapa', '🗺️ Mapa'], ['palabras', '🧩 Palabras difíciles'], ['tareas', '📋 Tareas'],
    ...(settings && settings.hsk1_enabled ? [['hsk', '🎓 HSK 1']] : []), ...(settings && settings.hsk2_enabled ? [['hsk2', '🎓 HSK 2']] : []),
    ...(aulaShown(settings, 'clases') ? [['clases', '📚 Clases']] : []),
    ...(aulaShown(settings, 'quiz-vivo') ? [['quiz', '⚡ Quiz']] : []),
    ['bingo', '🎱 Bingo'], ['config', '⚙️ Configurar']];

  let body = null;
  if (err) body = html('div', { className: 'admin-status err' }, '❌ ' + err + (/function|does not exist/.test(err) ? ' — ¿Ejecutaste npcr_fase2.sql en Supabase?' : ''));
  else if (rows === null) body = html('p', { className: 'admin-note' }, 'Cargando análisis...');
  else if (student) body = html(StudentFile, { row: student, vocab, lessons, tasks, onBack: () => setStudent(null) });
  else if (tab === 'alumnos') {
    body = html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '👥 Alumnos de la clase'),
      html('p', { className: 'admin-note', style: { marginTop: 0 } },
        'Agregá a cada alumno con su nombre: la app le genera un código personal. Tocá el código para copiarlo, 📤 para copiar la invitación, 🔄 para darle un código nuevo y "Ver ficha" para ver su avance. Tocá un alumno para resaltarlo: queda marcado en todas las pestañas.'),
      flashMsg && html('div', { className: 'admin-status ' + (flashMsg.type === 'ok' ? 'ok' : 'err'), style: { marginBottom: 10, cursor: 'pointer' }, onClick: () => setFlashMsg(null) }, flashMsg.msg),
      html('div', { className: 'panel-actions' }, html('button', { className: 'mini-btn strong', onClick: () => setCompose({ uid: null, name: 'toda el aula', text: '' }) }, '✉️ Mensaje a toda el aula')),
      html(ClassStudents, {
        cls: { id: classId, name: cls ? cls.name : '' },
        flash: (type, msg) => setFlashMsg({ type, msg }),
        onChanged: () => setReloadKey(k => k + 1),
        onOpen: (r) => { const row = (rows || []).find(x => x.seat_id === r.id); if (row) setStudent(row); },
        isSel, onSelect: pick,
      }),
      sent && sent.length > 0 && html('details', { className: 'sent-box' },
        html('summary', null, '📨 Mensajes enviados (' + sent.length + ')'),
        html('div', { className: 'plan-edit-steps' }, sent.slice(0, 60).map((m, i) => { const r = (rows || []).find(x => x.user_id === m.user_id);
          return html('div', { key: i, className: 'plan-edit-step' },
            html('span', { style: { flex: 1, minWidth: 0 } }, html('b', null, r ? r.display_name : 'Alumno'), html('small', null, m.text + ' · ' + timeAgo(m.created_at))),
            html('span', { className: 'sent-state' + (m.done_at ? ' ok' : '') }, m.done_at ? '✓ Leído' : '○ Sin leer')); }))),
    );
  }
  else if (rows.length === 0 && tab !== 'tareas' && tab !== 'config') body = html('p', { className: 'admin-note' }, 'Esta clase todavía no tiene alumnos. Agregalos desde ⚙ Administrar → Mis clases.');
  else if (tab === 'resumen') {
    const W = ins && !ins.error ? ins.week : null, P = ins && !ins.error ? ins.prev : null;
    const maxDay = ins && ins.days ? Math.max(1, ...ins.days.map(d => d.sessions)) : 1;
    body = html('div', null,
      html('div', { className: 'panel-actions' },
        html('button', { className: 'mini-btn strong', onClick: () => setCompose({ uid: null, name: 'toda el aula', text: '' }) }, '✉️ Mensaje a toda el aula'),
        ins && ins.error && html('span', { className: 'admin-note', style: { margin: 0 } }, 'Para ver tendencias y dificultad, ejecutá npcr_panel_laoshi.sql.')),
      W && html('div', { className: 'kpi-grid' },
        html(KpiCard, { icon: '🧑‍🎓', value: W.students + '/' + active.length, label: 'practicaron estos 7 días', sub: trendText(W.students, P && P.students), tone: W.students >= (P && P.students || 0) ? 'up' : 'down' }),
        html(KpiCard, { icon: '🔁', value: W.sessions, label: 'sesiones de práctica', sub: trendText(W.sessions, P && P.sessions), tone: W.sessions >= (P && P.sessions || 0) ? 'up' : 'down' }),
        html(KpiCard, { icon: '🎯', value: W.acc == null ? '—' : W.acc + '%', label: 'aciertos promedio', sub: trendText(W.acc, P && P.acc, ' pts'), tone: (W.acc || 0) >= (P && P.acc || 0) ? 'up' : 'down' })),
      ins && ins.days && html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '📅 Práctica de los últimos 14 días'),
        html('div', { className: 'day-bars' }, ins.days.map(d => html('div', { key: d.d, className: 'day-bar', title: d.d + ': ' + d.sessions + ' sesiones · ' + d.students + ' alumnos' + (d.acc != null ? ' · ' + d.acc + '%' : '') },
          html('span', { className: 'day-n' }, d.sessions || ''),
          html('i', { style: { height: Math.round(d.sessions / maxDay * 70) + 'px' } }),
          html('span', { className: 'day-l' }, ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(d.d + 'T12:00').getDay()]))))),
      ins && ins.modes && ins.modes.length > 0 && html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🧭 Qué le cuesta más al grupo'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Aciertos promedio por tipo de ejercicio en los últimos ' + (A.dias_analisis || 30) + ' días (de menor a mayor).'),
        html('div', { className: 'mode-bars' }, ins.modes.map(m => { const c = masteryColor(m.acc); return html('div', { key: m.kind + m.mode, className: 'mode-bar' },
          html('span', { className: 'mode-bar-name' }, activityName(m.kind, m.mode)),
          html('span', { className: 'mode-bar-track' }, html('i', { style: { width: m.acc + '%', background: c.fg } })),
          html('span', { className: 'mode-bar-val', style: { color: c.fg } }, m.acc + '%'),
          html('span', { className: 'mode-bar-n' }, m.n + ' · ' + m.students + (m.students === 1 ? ' alumno' : ' alumnos'))); }))),
      html('div', { className: 'kpi-grid' },
        html(KpiCard, { icon: '👥', value: active.length + '/' + rows.length, label: 'alumnos activos' }),
        !W && html(KpiCard, { icon: '✅', value: active.filter(r => r.sessions_7d > 0).length, label: 'practicaron esta semana' }),
        html(KpiCard, { icon: '📅', value: (avg(active.map(r => r.daily_7d)) ?? 0) + '/7', label: 'entrenamientos promedio' }),
        !W && html(KpiCard, { icon: '🎯', value: avg(active.filter(r => r.acc_7d != null).map(r => r.acc_7d)) == null ? '—' : avg(active.filter(r => r.acc_7d != null).map(r => r.acc_7d)) + '%', label: 'precisión 7 días' }),
        html(KpiCard, { icon: '🧠', value: (avg(active.map(r => r.mastery)) ?? 0) + '%', label: 'dominio promedio' }),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🔔 Alertas'),
        alerts.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todo en orden por ahora. 👏')
        : html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, alerts.map((a, i) => html('div', { key: i, className: 'alert-row ' + a.tone },
            html('span', { style: { flex: 1 } }, a.text),
            a.uids && a.uids.length === 1 && html('button', { className: 'mini-btn', onClick: () => setCompose({ uid: a.uids[0].user_id, name: a.uids[0].display_name, text: '' }) }, '✉️ Escribirle')))),
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
    body = html(ScrollX, { className: 'report-card', style: { padding: 0 }, arrows: 'top' },
      html('table', { className: 'rank-table cardify' },
        html('thead', null, html('tr', null,
          html('th', null, '#'), th('display_name', 'Alumno'), th('mastery', 'Dominio', 'Promedio de las lecciones: 60% tarjetas + 40% juegos'),
          th('words_learned', 'Aprendidas', 'Palabras en caja 3+ del repaso espaciado'), th('acc_7d', 'Precisión', 'Promedio de resultados de los últimos 7 días'),
          th('sessions_7d', 'Sesiones', 'Sesiones de práctica en 7 días'), th('daily_7d', 'Entren.', 'Entrenamientos diarios en 7 días'),
          th('streak_days', 'Racha'), th('words_struggling', 'Dificult.', 'Palabras con errores repetidos'), th('last_activity', 'Última vez'))),
        html('tbody', null, sortedRows.map((r, i) => html('tr', { key: r.seat_id, onClick: () => pick(r), onDoubleClick: () => setStudent(r), className: (r.user_id ? '' : 'pending') + (isSel(r) ? ' sel-row' : '') },
          html('td', { className: 'cell-rank', 'data-l': '#', style: { fontWeight: 800, color: 'var(--ink-soft)' } }, r.user_id ? (i + 1) : '—'),
          html('td', { className: 'cell-name', style: { fontWeight: 800, whiteSpace: 'nowrap' } }, r.display_name, !r.user_id && html('span', { style: { fontSize: 10, color: 'var(--ink-soft)', fontWeight: 700 } }, ' · sin activar')),
          html('td', { 'data-l': 'Dominio' }, html(MasteryPill, { value: r.user_id ? r.mastery : null, small: true })),
          html('td', { 'data-l': 'Aprendidas' }, r.user_id ? r.words_learned : '—'),
          html('td', { 'data-l': 'Precisión' }, r.acc_7d == null ? '—' : html(MasteryPill, { value: r.acc_7d, small: true })),
          html('td', { 'data-l': 'Sesiones' }, r.user_id ? r.sessions_7d : '—'),
          html('td', { 'data-l': 'Entren.' }, r.user_id ? r.daily_7d + '/7' : '—'),
          html('td', { 'data-l': 'Racha' }, r.user_id ? '🔥 ' + r.streak_days : '—'),
          html('td', { 'data-l': 'Dificult.', style: { color: r.words_struggling >= 8 ? 'var(--lacquer)' : 'inherit', fontWeight: 700 } }, r.user_id ? r.words_struggling : '—'),
          html('td', { 'data-l': 'Última vez', style: { whiteSpace: 'nowrap', fontSize: 12 } }, r.user_id ? timeAgo(r.last_activity || r.last_seen) : '—'),
        )))),
      html('p', { className: 'admin-note', style: { padding: '8px 12px', margin: 0 } }, 'Tocá un encabezado para ordenar y un alumno para resaltarlo; su ficha se abre desde la barra de arriba.'),
    );
  } else if (tab === 'mapa' && mapMode === 'ejercicios') {
    const lsn = [...new Set((ins && ins.lessons || []).map(x => x.lesson))].sort(lessonCompare);
    const mds = [...new Set((ins && ins.lessons || []).map(x => x.mode))];
    const cellOf = (l, m) => (ins.lessons || []).find(x => x.lesson === l && x.mode === m);
    body = html('div', null,
      html('div', { className: 'reg-toolbar', style: { marginBottom: 8 } }, [['alumnos', '👥 Por alumno'], ['ejercicios', '🧭 Por tipo de ejercicio']].map(([k, l]) => html('button', { key: k, className: 'report-tab' + (mapMode === k ? ' active' : ''), onClick: () => setMapMode(k) }, l))),
      !ins || ins.error || !lsn.length ? html('p', { className: 'admin-note' }, ins && ins.error ? 'Ejecutá npcr_panel_laoshi.sql para ver este mapa.' : 'Todavía no hay práctica registrada por lección.')
      : html(ScrollX, { className: 'report-card', style: { padding: 0 }, arrows: 'top' },
        html('table', { className: 'heat-table' },
          html('thead', null, html('tr', null, html('th', null, 'Lección'), mds.map(m => html('th', { key: m }, activityName('lesson', m))))),
          html('tbody', null, lsn.map(l => html('tr', { key: l },
            html('td', { style: { fontWeight: 800, whiteSpace: 'nowrap', textAlign: 'left' } }, 'L' + l),
            mds.map(m => { const x = cellOf(l, m); const c = masteryColor(x ? x.acc : null);
              return html('td', { key: m, style: { background: x ? c.bg : 'var(--paper)', color: c.fg }, title: x ? x.n + ' intentos · ' + x.students + ' alumnos' : 'sin práctica' }, x ? x.acc : ''); }))))),
        html('p', { className: 'admin-note', style: { padding: '8px 12px', margin: 0 } }, 'Aciertos promedio (0–100) por lección y tipo de ejercicio, de todo el grupo. Pasá el mouse para ver cuántos intentos hubo.')));
  } else if (tab === 'mapa') {
    body = html('div', null,
      html('div', { className: 'reg-toolbar', style: { marginBottom: 8 } }, [['alumnos', '👥 Por alumno'], ['ejercicios', '🧭 Por tipo de ejercicio']].map(([k, l]) => html('button', { key: k, className: 'report-tab' + (mapMode === k ? ' active' : ''), onClick: () => setMapMode(k) }, l))),
      html(ScrollX, { className: 'report-card', style: { padding: 0 }, arrows: 'top' },
      html('table', { className: 'heat-table' },
        html('thead', null, html('tr', null, html('th', null, 'Alumno'), lessons.map(l => html('th', { key: l }, 'L' + l)))),
        html('tbody', null, active.map(r => html('tr', { key: r.seat_id, onClick: () => pick(r), onDoubleClick: () => setStudent(r), className: isSel(r) ? 'sel-row' : '' },
          html('td', { style: { fontWeight: 800, whiteSpace: 'nowrap', textAlign: 'left' } }, r.display_name),
          lessons.map(l => { const v = (r.lessons || {})[l]; const c = masteryColor(v); return html('td', { key: l, style: { background: c.bg, color: c.fg } }, v ? v : ''); }),
        )))),
      html('p', { className: 'admin-note', style: { padding: '8px 12px', margin: 0 } },
        'Dominio por lección (0–100). ', html('span', { style: { color: '#9A2E1C', fontWeight: 800 } }, 'Rojo < 40'), ' · ',
        html('span', { style: { color: '#8A5A00', fontWeight: 800 } }, 'ámbar < 70'), ' · ', html('span', { style: { color: '#2F6B12', fontWeight: 800 } }, 'verde ≥ 70'), '. Solo alumnos activos.'),
    ));
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

  if (!err && rows !== null && !student && tab === 'hsk') body = html(HskClassReport, { key: 'hsk1', classId, level: 1, isSel, onSelect: pick });
  if (!err && rows !== null && !student && tab === 'hsk2') body = html(HskClassReport, { key: 'hsk2', classId, level: 2, isSel, onSelect: pick });
  if (!err && rows !== null && !student && tab === 'quiz') body = html(QuizHost, { key: classId, classId });
  if (!err && rows !== null && !student && tab === 'clases') body = html(ClassPlans, { key: classId, classId, lessons, students: rows, vocab });
  if (!err && rows !== null && !student && tab === 'bingo') body = html(BingoHost, { key: classId, classId, className: cls ? cls.name : 'Clase', lessons, maxLesson: settings && settings.max_lesson ? Number(settings.max_lesson) : null });

  if (!err && rows !== null && !student && tab === 'config') {
    const ww = settings.weekly_words || [];
    const has = (l, h) => ww.some(x => x.lesson === l && x.hanzi === h);
    const toggle = (l, h) => saveSettings({ weekly_words: has(l, h) ? ww.filter(x => !(x.lesson === l && x.hanzi === h)) : [...ww, { lesson: l, hanzi: h }] });
    body = html('div', null,
      savedMsg && html('div', { className: 'admin-status ' + (savedMsg.startsWith('✅') ? 'ok' : 'err'), style: { marginBottom: 10 } }, savedMsg),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🔒 Avance del grupo'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Los alumnos ven con candado las lecciones posteriores, y todas las actividades del aula usan solo las habilitadas: entrenamiento diario, tonos, dictado, Completá la frase, Ordená la oración, clasificadores, verbos modales, expresiones de tiempo, audio, escritura y Trazos.'),
        html('select', { value: settings.max_lesson, onChange: e => saveSettings({ max_lesson: e.target.value }), style: { ...cmInput, width: '100%', fontWeight: 700 } },
          html('option', { value: '' }, 'Todas las lecciones habilitadas'),
          lessons.map(l => html('option', { key: l, value: l }, 'Habilitado hasta la lección ' + l))),
      ),
      html('div', { className: 'report-card' },
        html('div', { className: 'report-h' }, '🎒 Actividades de Mi aula'),
        html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Elegí qué actividades ven los alumnos de esta clase. Las Tareas se ven siempre; el HSK se habilita abajo.'),
        html('div', { className: 'aula-toggles' }, AULA_TOGGLES.map(a => {
          const on = aulaVisible(settings, a);
          return html('label', { key: a.id, className: 'aula-toggle' + (on ? ' on' : '') },
            html('input', { type: 'checkbox', checked: on, onChange: e => {
              if (a.optIn) {
                const cur = settings.shown_activities || [];
                saveSettings({ shown_activities: e.target.checked ? [...cur.filter(x => x !== a.id), a.id] : cur.filter(x => x !== a.id), _hasShown: true });
              } else {
                const cur = settings.hidden_activities || [];
                saveSettings({ hidden_activities: e.target.checked ? cur.filter(x => x !== a.id) : [...cur, a.id], _hasHidden: true });
              }
            } }),
            html(AulaIcon, { name: a.icon, tone: on ? a.tone : 'blue', size: 30 }),
            html('span', null, a.title));
        })),
      ),
      [1, 2].map(n => {
        const on = 'hsk' + n + '_enabled', date = 'hsk' + n + '_exam_date';
        return html('div', { key: n, className: 'report-card' },
          html('div', { className: 'report-h' }, '🎓 Preparación HSK ' + n),
          html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Sección aparte para preparar el examen HSK ' + n + ' (no cambia nada de NPCR). Los alumnos de esta clase la abren desde Mi aula.'
            + (n > 1 ? ' Los ejercicios también usan las palabras de los niveles anteriores.' : '')),
          html('label', { className: 'mode-check' + (settings[on] ? ' on' : ''), style: { marginRight: 10 } },
            html('input', { type: 'checkbox', checked: !!settings[on], onChange: e => saveSettings({ [on]: e.target.checked }) }),
            settings[on] ? 'Habilitado para esta clase' : 'Habilitar para esta clase'),
          settings[on] && html('label', { style: { fontSize: 12, fontWeight: 700, color: 'var(--ink-mid)', display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 8 } },
            'Fecha del examen',
            html('input', { type: 'date', value: settings[date] || '', onChange: e => saveSettings({ [date]: e.target.value }), style: { ...cmInput, width: 'auto' } })),
        );
      }),
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

  const selBar = sel && !student && tab !== 'bingo' && tab !== 'config' && tab !== 'tareas' && tab !== 'palabras' && tab !== 'clases' && tab !== 'quiz' && html('div', { className: 'sel-bar' },
    html('span', { className: 'sel-dot' }, (sel.name || '?').trim().charAt(0).toUpperCase()),
    html('div', { className: 'sel-info' },
      html('b', null, sel.name),
      html('small', null, !selRow || !selRow.user_id ? 'Sin activar todavía'
        : 'Dominio ' + (selRow.mastery || 0) + '% · ' + (selRow.sessions_7d || 0) + ' sesiones en 7 días · ' + (selRow.last_activity || selRow.last_seen ? 'última vez ' + timeAgo(selRow.last_activity || selRow.last_seen) : 'sin actividad'))),
    selRow && selRow.user_id && html('button', { className: 'mini-btn', onClick: () => setStudent(selRow) }, '📄 Ver ficha'),
    selRow && selRow.user_id && html('button', { className: 'mini-btn', onClick: () => setCompose({ uid: selRow.user_id, name: selRow.display_name, text: '' }) }, '✉️ Mensaje'),
    html('button', { className: 'sel-x', title: 'Dejar de resaltar', onClick: () => setSel(null) }, '✕'));

  return html('main', { className: (tab === 'bingo' || tab === 'quiz') && !student ? '' : 'wide', style: { paddingTop: 18, paddingBottom: 40 } },
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
      classId && selBar,
      flashMsg && tab !== 'alumnos' && !student && html('div', { className: 'admin-status ' + (flashMsg.type === 'ok' ? 'ok' : 'err'), style: { marginBottom: 10, cursor: 'pointer' }, onClick: () => setFlashMsg(null) }, flashMsg.msg),
      compose && html('div', { className: 'name-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) setCompose(null); } },
        html('div', { className: 'name-modal', style: { textAlign: 'left' } },
          html('h2', { className: 'name-modal-title' }, '✉️ Mensaje para ' + compose.name),
          html('p', { className: 'name-modal-sub' }, compose.uid ? 'Le aparece solo a este alumno, al abrir la app.' : 'Le aparece a cada alumno del aula, al abrir la app.'),
          html('textarea', { value: compose.text, rows: 4, maxLength: 400, autoFocus: true, placeholder: 'Ej: Mañana repasamos la lección 6. ¡Hagan el entrenamiento diario!', onChange: e => setCompose({ ...compose, text: e.target.value }), style: { ...cmInput, width: '100%', resize: 'vertical', fontFamily: 'inherit' } }),
          html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', textAlign: 'right' } }, compose.text.length + '/400'),
          html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
            html('button', { className: 'primary-btn', style: { margin: 0 }, disabled: compose.text.trim().length < 2, onClick: sendMsg }, 'Enviar'),
            html('button', { className: 'secondary-btn', style: { margin: 0 }, onClick: () => setCompose(null) }, 'Cancelar')))),
      classId && body,
    ),
  );
}

// ═════════════════ Clases armadas por el lǎoshī (módulo de Mi aula, opt-in) ═════════════════
// Cada clase es una lista de pasos: actividades de la app, explicaciones, listas de palabras
// propias, preguntas propias, oraciones para ordenar y trazos. Se puede guardar en una
// biblioteca compartida del equipo docente.
// Módulo aparte: abre los juegos dentro de su propia pantalla y anota el avance en
// npcr_plan_progress (npcr_clases_plan.sql), sin cambiar cómo funciona el resto.
const PLAN_LESSON_MODES = [['match', 'Emparejar'], ['cards', 'Tarjetas'], ['quiz', 'Opción múltiple'], ['memoria', 'Memoria'], ['frases', 'Frases clave']];
const PLAN_WORD_MODES = [['cards', 'Tarjetas'], ['match', 'Emparejar'], ['quiz', 'Opción múltiple'], ['memoria', 'Memoria']];
const PLAN_GAMES = [['frase', 'Completá la frase'], ['orden', 'Ordená la oración'], ['audio', 'Reconocer por audio'], ['dialogo', 'Diálogos'],
  ['modal', 'Verbos modales'], ['tiempo', 'Expresiones de tiempo'], ['clas', 'Clasificadores'], ['zhe', 'Zhè shì shénme?'], ['tonos', 'Tonos'], ['dictado', 'Dictado 听写']];
const PLAN_KIND_ICON = { lesson: '📖', game: '🎮', texto: '📝', words: '🔤', quiz: '❓', orden: '🔀', trazos: '✍️' };
// Juegos de oraciones a los que el lǎoshī puede sumar preguntas propias (solo para esa clase)
const PLAN_CLAS_TIPOS = { frase: 'frase', clas: 'clasificador', modal: 'modal', tiempo: 'tiempo' };
const PLAN_CLAS_TITLES = { frase: 'Completá la frase', clasificador: 'Clasificadores', modal: 'Verbos modales', tiempo: 'Expresiones de tiempo' };
// Hanzi con modelo de trazos de una lista de palabras (sin repetir)
const planTrazoChars = (vocab, list) => {
  const seen = new Set(), out = [];
  planWordsOf(vocab, list).forEach(w => [...String(w.hanzi || '')].forEach(c => { if (!seen.has(c) && NPCR_MEDIA.svg[c]) { seen.add(c); out.push({ c, w }); } }));
  return out;
};
const planModeName = (list, m) => (list.find(x => x[0] === m) || [])[1] || m;
const planWordsOf = (vocab, list) => (list || []).map(x => { const w = (vocab[x.lesson] || []).find(v => v.hanzi === x.hanzi); return w ? { ...w, _lesson: x.lesson } : null; }).filter(Boolean);
function planStepLabel(s) {
  if (s.kind === 'lesson') return 'Lección ' + s.lesson + ' · ' + planModeName(PLAN_LESSON_MODES, s.mode);
  if (s.kind === 'game') return planModeName(PLAN_GAMES, s.game) + ((s.extra || []).length ? (s.only ? ' · solo ' : ' · +') + s.extra.length + (s.extra.length === 1 ? ' pregunta propia' : ' preguntas propias') : '');
  if (s.kind === 'trazos') return (s.title || (s.words || []).slice(0, 4).map(w => w.hanzi).join(' ') + ((s.words || []).length > 4 ? '…' : '')) + ' · trazos';
  if (s.kind === 'words') return (s.title || (s.words || []).slice(0, 4).map(w => w.hanzi).join(' ') + ((s.words || []).length > 4 ? '…' : '')) + ' · ' + planModeName(PLAN_WORD_MODES, s.mode);
  const n = (s.items || []).length;
  if (s.kind === 'quiz') return (s.title || 'Preguntas') + ' · ' + n + (n === 1 ? ' pregunta' : ' preguntas');
  if (s.kind === 'orden') return (s.title || 'Ordená las oraciones') + ' · ' + n + (n === 1 ? ' oración' : ' oraciones');
  return s.title || 'Explicación';
}
const planNewId = () => secureRandomChars('abcdefghijklmnopqrstuvwxyz0123456789', 8);

// ── Juegos propios del módulo: preguntas de opción múltiple y oraciones para ordenar ──
function PlanResult({ title, percent, wrong, onAgain, onBack }) {
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, title)),
    html('div', { style: { padding: '0 16px', textAlign: 'center' } },
      html('div', { className: 'plan-score' + (percent >= 70 ? ' ok' : '') }, percent + '%'),
      html('div', { style: { fontWeight: 800, margin: '6px 0 14px' } }, percent >= 70 ? '¡Muy bien! Paso hecho ✓' : 'Necesitás 70% para completar el paso. ¡Probá de nuevo!'),
      wrong.length > 0 && html('div', { className: 'plan-wrong' }, html('b', null, 'Para repasar:'), wrong.map((w, i) => html('div', { key: i }, w))),
      html('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 } },
        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: onAgain }, '↻ Otra vez'),
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: onBack }, 'Volver a la clase'))));
}
function PlanQuizGame({ title, items, onBack, onFinish }) {
  const build = () => shuffle(items).map(it => ({ ...it, opts: shuffle([it.ok, ...(it.bad || []).filter(Boolean)]) }));
  const [list, setList] = useState(build);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState(null);
  const [wrong, setWrong] = useState([]);
  const [done, setDone] = useState(null);
  const q = list[i];
  const choose = (o) => { if (pick !== null) return; setPick(o); if (o === q.ok) playCorrect(); else { playWrong(); setWrong(w => [...w, q.q + ' → ' + q.ok]); } };
  const next = () => {
    if (i + 1 < list.length) { setI(i + 1); setPick(null); return; }
    const p = Math.round((list.length - wrong.length) / list.length * 100);
    setDone(p); onFinish(p, wrong);
  };
  if (done !== null) return html(PlanResult, { title, percent: done, wrong, onBack, onAgain: () => { setList(build()); setI(0); setPick(null); setWrong([]); setDone(null); } });
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', { style: { flex: 1 } }, title),
      html('span', { className: 'plan-count' }, (i + 1) + '/' + list.length)),
    html('div', { style: { padding: '0 16px' } },
      html('div', { className: 'plan-q hanzi-font' }, q.q),
      q.img && html('img', { className: 'plan-q-img', src: q.img, alt: '' }),
      html('div', { className: 'plan-opts' }, q.opts.map((o, k) => html('button', { key: k,
        className: 'plan-opt hanzi-font' + (pick !== null && o === q.ok ? ' ok' : '') + (pick === o && o !== q.ok ? ' bad' : ''), onClick: () => choose(o) }, o))),
      pick !== null && html('button', { className: 'primary-btn', style: { marginTop: 14 }, onClick: next }, i + 1 < list.length ? 'Siguiente →' : 'Ver resultado')));
}
function PlanOrderGame({ title, items, onBack, onFinish }) {
  const tok = (zh) => zh.trim().split(/\s+/);
  const build = () => shuffle(items).map(it => ({ ...it, pool: shuffle(tok(it.zh).map((t, k) => ({ t, k }))) }));
  const [list, setList] = useState(build);
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState([]);
  const [checked, setChecked] = useState(null);
  const [wrong, setWrong] = useState([]);
  const [done, setDone] = useState(null);
  const q = list[i];
  const answer = tok(q.zh).join('');
  const check = () => {
    const ok = chosen.map(c => c.t).join('') === answer;
    setChecked(ok);
    if (ok) playCorrect(); else { playWrong(); setWrong(w => [...w, tok(q.zh).join(' ') + (q.es ? ' · ' + q.es : '')]); }
  };
  const next = () => {
    if (i + 1 < list.length) { setI(i + 1); setChosen([]); setChecked(null); return; }
    const p = Math.round((list.length - wrong.length) / list.length * 100);
    setDone(p); onFinish(p, wrong);
  };
  if (done !== null) return html(PlanResult, { title, percent: done, wrong, onBack, onAgain: () => { setList(build()); setI(0); setChosen([]); setChecked(null); setWrong([]); setDone(null); } });
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', { style: { flex: 1 } }, title),
      html('span', { className: 'plan-count' }, (i + 1) + '/' + list.length)),
    html('div', { style: { padding: '0 16px' } },
      q.es && html('div', { className: 'plan-order-es' }, q.es),
      html('div', { className: 'plan-order-line' + (checked === true ? ' ok' : checked === false ? ' bad' : '') },
        chosen.length === 0 ? html('span', { className: 'plan-order-ph' }, 'Tocá las palabras en orden') :
        chosen.map((c, k) => html('button', { key: c.k, className: 'plan-chip hanzi-font', disabled: checked !== null, onClick: () => setChosen(chosen.filter(x => x.k !== c.k)) }, c.t))),
      html('div', { className: 'plan-order-pool' }, q.pool.filter(c => !chosen.some(x => x.k === c.k)).map(c =>
        html('button', { key: c.k, className: 'plan-chip hanzi-font', disabled: checked !== null, onClick: () => setChosen([...chosen, c]) }, c.t))),
      checked === false && html('div', { className: 'plan-order-fix' }, 'Era: ', html('b', { className: 'hanzi-font' }, tok(q.zh).join(' '))),
      checked === null
        ? html('button', { className: 'primary-btn', style: { marginTop: 14 }, disabled: chosen.length !== q.pool.length, onClick: check }, 'Comprobar')
        : html('button', { className: 'primary-btn', style: { marginTop: 14 }, onClick: next }, i + 1 < list.length ? 'Siguiente →' : 'Ver resultado')));
}

// Juego de oraciones (Completá la frase, Clasificadores…) con las preguntas de siempre más las
// propias de esta clase, o solo las propias. Las propias no se agregan al banco general.
function PlanClasGame(props) {
  const { tipo, extra, only } = props;
  const title = PLAN_CLAS_TITLES[tipo] || 'Preguntas';
  const own = (extra || []).map(q => ({ sentence: q.sentence, pinyin: q.pinyin || '', answer: q.answer, answer_pinyin: q.answer_pinyin || null,
    options: [q.answer, ...(q.wrong || [])], hint: q.hint || '', tipo }));
  const [raw, setRaw] = useState(only ? own : null);
  const [rawErr, setRawErr] = useState(false);
  const load = () => {
    if (only) return;
    setRaw(null); setRawErr(false);
    db.from('npcr_clasificador_questions').select('sentence,pinyin,answer,answer_pinyin,options,hint,tipo').eq('active', true).eq('tipo', tipo)
      .then(({ data, error }) => { if (error) setRawErr(true); else setRaw([...(data || []).map(nfcRow), ...own]); });
  };
  useEffect(() => { load(); }, []);
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title, msg: '❌ Error de conexión.', onRetry: load });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title, msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title, msg: 'Esta actividad todavía no tiene preguntas.' });
  return html(ClasificadorGameBody, { ...props, title, rawQuestions: shuffle(raw) });
}

// Trazos de los hanzi que eligió el lǎoshī, uno detrás de otro
function PlanTrazos({ title, chars, vocab, onBack, onFinish }) {
  const [info, setInfo] = useState({});
  const [done, setDone] = useState(new Set());
  const [i, setI] = useState(0);
  const [end, setEnd] = useState(false);
  useEffect(() => {
    db.from('npcr_hanzi_info').select('hanzi,pinyin,es').eq('hidden', false).then(({ data }) => {
      const m = {}; (data || []).forEach(r => { m[r.hanzi] = r; }); setInfo(m);
    });
  }, []);
  if (!chars.length) return html(GameStatusScreen, { onBack, title: '✍️ Trazos', msg: 'Estas palabras no tienen modelo de trazos.' });
  if (end) return html(PlanResult, { title: '✍️ ' + title, percent: 100, wrong: [], onBack, onAgain: () => { setDone(new Set()); setI(0); setEnd(false); } });
  const item = chars[i];
  const wordOf = (c, w) => (w && w.hanzi === c) ? w : (Object.values(vocab).flat().find(x => x.hanzi === c) || null);
  const finishAll = (set) => { if (set.size === chars.length) { onFinish(100); setEnd(true); return true; } return false; };
  return html(TrazoPractice, { key: item.c + i, ch: item.c, word: wordOf(item.c, item.w), inWord: wordOf(item.c, item.w) ? null : (String(item.w.hanzi).includes(item.c) ? item.w : null),
    title: title + ' · ' + (i + 1) + '/' + chars.length, info: info[item.c] || null,
    path: chars.map(x => ({ c: x.c, done: done.has(x.c), py: info[x.c] && info[x.c].pinyin })), onJump: (k) => setI(k),
    onBack,
    onComplete: () => setDone(prev => new Set([...prev, item.c])),
    onDone: () => {
      const set = new Set([...done, item.c]);
      if (finishAll(set)) return;
      const nx = chars.findIndex((x, k) => k > i && !set.has(x.c));
      setI(nx >= 0 ? nx : chars.findIndex(x => !set.has(x.c)));
    } });
}

// ── Lǎoshī: armar, publicar y seguir las clases del aula ──
function ClassPlans({ classId, lessons, students, vocab }) {
  const [plans, setPlans] = useState(null);
  const [report, setReport] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null);       // clase que se está armando
  const [view, setView] = useState(null);       // id de la clase cuyo avance se mira
  const [lib, setLib] = useState(null);         // biblioteca abierta (lista)
  const [copyFor, setCopyFor] = useState(null); // clase a duplicar
  const [classes, setClasses] = useState([]);
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };

  const loadReport = () => db.rpc('npcr_plan_report', { p_class: classId }).then(({ data }) => setReport(data || []));
  const load = () => {
    db.from('npcr_class_plans').select('*').eq('class_id', classId).order('position').order('created_at').then(({ data, error }) => {
      if (error) { setErr(error.message); setPlans([]); return; }
      setPlans(data || []);
    });
    loadReport();
  };
  useEffect(() => { load(); db.from('classes').select('id,name,archived').order('created_at', { ascending: false }).then(({ data }) => setClasses((data || []).filter(c => !c.archived))); }, [classId]);

  const active = (students || []).filter(r => r.user_id);
  const stOf = (pid, uid, sid) => report.find(x => x.plan_id === pid && x.student_id === uid && x.step_id === sid);
  const doneOf = (p, uid) => p.steps.filter(s => (stOf(p.id, uid, s.id) || {}).done).length;
  const finished = (p) => p.steps.length ? active.filter(r => doneOf(p, r.user_id) === p.steps.length).length : 0;

  const save = async () => {
    const e = edit;
    if (!e.title.trim()) { flash('err', 'Ponele un título a la clase.'); return; }
    if (!e.steps.length) { flash('err', 'Agregá al menos un paso.'); return; }
    const row = { title: e.title.trim(), description: e.description.trim() || null, steps: e.steps, updated_at: new Date().toISOString() };
    const { error } = e.id
      ? await db.from('npcr_class_plans').update(row).eq('id', e.id)
      : await db.from('npcr_class_plans').insert({ ...row, class_id: classId, published: false, position: (plans || []).length });
    if (error) { flash('err', '❌ ' + error.message); return; }
    setEdit(null); load();
    flash('ok', e.id ? '✅ Clase guardada.' : '✅ Clase creada como borrador. Publicala cuando quieras que la vean los alumnos.');
  };
  const update = async (p, patch, ok) => {
    const { error } = await db.from('npcr_class_plans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { flash('err', '❌ ' + error.message); return false; }
    load(); if (ok) flash('ok', ok); return true;
  };
  const remove = async (p) => {
    if (!await appConfirm('¿Eliminar la clase "' + p.title + '"?\n\nSe borra también el avance de los alumnos en esta clase.')) return;
    const { error } = await db.from('npcr_class_plans').delete().eq('id', p.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    load(); flash('ok', '🗑 Clase eliminada.');
  };
  const move = async (i, d) => {
    const list = [...plans]; const j = i + d; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPlans(list);
    await Promise.all(list.map((p, k) => db.from('npcr_class_plans').update({ position: k }).eq('id', p.id)));
  };
  const copyTo = async (src, target, suffix) => {
    const { error } = await db.from('npcr_class_plans').insert({ class_id: target, title: src.title + (suffix || ''), description: src.description || null,
      steps: src.steps.map(s => ({ ...s, id: planNewId() })), published: false, position: target === classId ? (plans || []).length : 999 });
    if (error) { flash('err', '❌ ' + error.message); return false; }
    if (target === classId) load();
    return true;
  };
  const duplicate = async (p, target) => {
    setCopyFor(null);
    if (await copyTo(p, target, target === classId ? ' (copia)' : ''))
      flash('ok', '⧉ Copia creada como borrador' + (target === classId ? '.' : ' en "' + ((classes.find(c => c.id === target) || {}).name || 'la otra aula') + '".'));
  };
  const toLibrary = async (p) => {
    const { data: { user } } = await db.auth.getUser();
    const { data: me } = await db.from('profiles').select('name').eq('id', user.id).maybeSingle();
    const { error } = await db.from('npcr_plan_library').insert({ title: p.title, description: p.description || null, steps: p.steps, author: (me && me.name) || user.email || null, created_by: user.id });
    if (error) { flash('err', '❌ ' + error.message + (/relation|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_clases_plan.sql actualizado?' : '')); return; }
    flash('ok', '📤 "' + p.title + '" quedó en la biblioteca: cualquier lǎoshī la puede usar.');
  };


  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err + (/relation|does not exist/.test(err) ? ' — ¿Ejecutaste npcr_clases_plan.sql?' : ''));
  if (!plans) return html('p', { className: 'admin-note' }, 'Cargando clases…');
  if (edit) return html(PlanEditor, { edit, setEdit, lessons, vocab, onSave: save, onCancel: () => setEdit(null), msg });
  if (lib) return html(PlanLibrary, { onBack: () => setLib(null), onUse: async (it) => { if (await copyTo(it, classId, '')) { setLib(null); flash('ok', '📥 "' + it.title + '" se agregó a esta aula como borrador.'); } } });


  const viewing = view && plans.find(p => p.id === view);
  if (viewing) return html('div', { className: 'report-card' },
    html('div', { className: 'plan-head' }, html('button', { className: 'mini-btn', onClick: () => setView(null) }, '← Clases'), html('b', null, '📊 ' + viewing.title)),
    active.length === 0 ? html('p', { className: 'admin-note' }, 'Todavía no hay alumnos activos en esta aula.')
    : html(ScrollX, { arrows: 'top' }, html('table', { className: 'heat-table plan-table' },
        html('thead', null, html('tr', null, html('th', null, 'Alumno'), viewing.steps.map((s, i) => html('th', { key: s.id, title: planStepLabel(s) }, (i + 1) + '. ' + PLAN_KIND_ICON[s.kind])), html('th', null, 'Total'))),
        html('tbody', null, active.map(r => html('tr', { key: r.user_id },
          html('td', { style: { textAlign: 'left', whiteSpace: 'nowrap' } }, r.display_name),
          viewing.steps.map(s => {
            const x = stOf(viewing.id, r.user_id, s.id);
            const c = !x ? { bg: 'var(--paper)', fg: 'var(--ink-soft)' } : x.done ? { bg: 'var(--jade-light)', fg: 'var(--jade-dark)' } : { bg: 'var(--gold-light)', fg: 'var(--gold-dark)' };
            return html('td', { key: s.id, style: { background: c.bg, color: c.fg }, title: planStepLabel(s) + (x ? ' · ' + x.percent + '% · ' + x.attempts + (x.attempts === 1 ? ' intento' : ' intentos') : ' · sin hacer') }, x ? (x.done ? '✓' : x.percent + '%') : '·');
          }),
          html('td', { style: { fontWeight: 900 } }, doneOf(viewing, r.user_id) + '/' + viewing.steps.length)))))),
    html('div', { className: 'plan-legend' }, viewing.steps.map((s, i) => html('span', { key: s.id }, (i + 1) + '. ' + PLAN_KIND_ICON[s.kind] + ' ' + planStepLabel(s)))),
    html('p', { className: 'admin-note', style: { margin: '8px 0 0' } }, '✓ hecho (70% o más) · % mejor resultado hasta ahora · · todavía no lo hizo.'));

  return html('div', null,
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 10 } }, msg.text),
    html('div', { className: 'report-card' },
      html('div', { className: 'plan-head' }, html('div', { className: 'report-h', style: { margin: 0, flex: 1 } }, '📚 Clases del aula'),
        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto', padding: '8px 12px' }, onClick: () => setLib(true) }, '📚 Biblioteca'),
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto', padding: '8px 14px' }, onClick: () => setEdit({ title: '', description: '', steps: [] }) }, '+ Nueva clase')),
      html('p', { className: 'admin-note', style: { margin: '6px 0 0' } }, 'Armá una clase con pasos: actividades del libro y de la app, explicaciones, tus propias listas de palabras, preguntas y oraciones. Publicala y cada alumno la hace a su ritmo; acá ves cómo le va a cada uno.')),
    plans.length === 0 ? html('p', { className: 'admin-note' }, 'Todavía no hay clases armadas en esta aula. Creá una nueva o traé una de la 📚 Biblioteca.')
    : html('div', { className: 'plan-list' }, plans.map((p, i) => html('div', { key: p.id, className: 'plan-card' + (p.published ? '' : ' draft') },
        html('div', { className: 'plan-card-top' },
          html('div', { style: { flex: 1, minWidth: 0 } },
            html('div', { className: 'plan-card-title' }, p.title),
            html('div', { className: 'plan-card-sub' }, p.steps.length + (p.steps.length === 1 ? ' paso' : ' pasos') + ' · ' + (p.published ? finished(p) + '/' + active.length + ' alumnos la completaron' : 'borrador: los alumnos todavía no la ven'))),
          html('span', { className: 'plan-badge' + (p.published ? ' on' : '') }, p.published ? 'Publicada' : 'Borrador')),
        p.description && html('div', { className: 'plan-card-desc' }, p.description),
        html('div', { className: 'plan-steps-mini' }, p.steps.map((s, k) => html('span', { key: s.id }, (k + 1) + '. ' + PLAN_KIND_ICON[s.kind] + ' ' + planStepLabel(s)))),
        copyFor === p.id && html('div', { className: 'plan-copy' }, 'Duplicar en: ',
          html('select', { defaultValue: '', onChange: e => e.target.value && duplicate(p, e.target.value), style: { ...cmInput, flex: '1 1 160px' } },
            html('option', { value: '' }, 'Elegí el aula…'),
            classes.map(c => html('option', { key: c.id, value: c.id }, c.id === classId ? c.name + ' (esta aula)' : c.name))),
          html('button', { className: 'mini-btn', onClick: () => setCopyFor(null) }, 'Cancelar')),
        html('div', { className: 'plan-actions' },
          html('button', { className: 'mini-btn' + (p.published ? '' : ' strong'), onClick: () => update(p, { published: !p.published }, p.published ? 'La clase volvió a borrador: los alumnos ya no la ven.' : '📢 Clase publicada: ya la ven los alumnos en Mi aula.') }, p.published ? '🙈 Despublicar' : '📢 Publicar'),
          html('button', { className: 'mini-btn', onClick: () => setEdit({ id: p.id, title: p.title, description: p.description || '', steps: p.steps }) }, '✏️ Editar'),
          html('button', { className: 'mini-btn', onClick: () => setView(p.id) }, '📊 Avance'),
          html('button', { className: 'mini-btn', onClick: () => setCopyFor(p.id) }, '⧉ Duplicar'),
          html('button', { className: 'mini-btn', onClick: () => toLibrary(p) }, '📤 A la biblioteca'),
          html('button', { className: 'mini-btn', disabled: i === 0, onClick: () => move(i, -1), title: 'Subir' }, '↑'),
          html('button', { className: 'mini-btn', disabled: i === plans.length - 1, onClick: () => move(i, 1), title: 'Bajar' }, '↓'),
          html('button', { className: 'mini-btn danger', onClick: () => remove(p) }, '🗑'))))),
  );
}

// Biblioteca compartida: clases que guardó cualquier lǎoshī, para traerlas al aula
function PlanLibrary({ onBack, onUse }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [me, setMe] = useState(null);
  const [q, setQ] = useState('');
  const load = () => db.from('npcr_plan_library').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
    if (error) { setErr(error.message); setItems([]); return; } setItems(data || []);
  });
  useEffect(() => { load(); db.auth.getUser().then(({ data }) => setMe(data && data.user ? data.user.id : null)); }, []);
  const remove = async (it) => {
    if (!await appConfirm('¿Sacar "' + it.title + '" de la biblioteca?\n\nLas aulas que ya la usaron conservan su copia.')) return;
    const { error } = await db.from('npcr_plan_library').delete().eq('id', it.id);
    if (error) { setErr(error.message); return; } load();
  };
  const list = (items || []).filter(it => !q.trim() || (it.title + ' ' + (it.description || '') + ' ' + (it.author || '')).toLowerCase().includes(q.trim().toLowerCase()));
  return html('div', { className: 'report-card' },
    html('div', { className: 'plan-head' }, html('button', { className: 'mini-btn', onClick: onBack }, '← Clases'), html('b', { style: { flex: 1 } }, '📚 Biblioteca de clases'),
      html('input', { value: q, onChange: e => setQ(e.target.value), placeholder: 'Buscar…', style: { ...cmInput, flex: '0 1 200px' } })),
    html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Clases que guardó el equipo docente con "📤 A la biblioteca". "Usar en esta aula" trae una copia como borrador, para adaptarla sin cambiar la original.'),
    err && html('div', { className: 'admin-status err' }, '❌ ' + err + (/relation|does not exist/.test(err) ? ' — ¿Ejecutaste npcr_clases_plan.sql actualizado?' : '')),
    !items ? html('p', { className: 'admin-note' }, 'Cargando…')
    : list.length === 0 ? html('p', { className: 'admin-note' }, items.length ? 'Ninguna clase coincide con la búsqueda.' : 'La biblioteca todavía está vacía.')
    : html('div', { className: 'plan-list' }, list.map(it => html('div', { key: it.id, className: 'plan-card' },
        html('div', { className: 'plan-card-title' }, it.title),
        html('div', { className: 'plan-card-sub' }, it.steps.length + ' pasos' + (it.author ? ' · de ' + it.author : '') + ' · ' + new Date(it.created_at).toLocaleDateString('es-AR')),
        it.description && html('div', { className: 'plan-card-desc' }, it.description),
        html('div', { className: 'plan-steps-mini' }, it.steps.map((s, k) => html('span', { key: k }, (k + 1) + '. ' + PLAN_KIND_ICON[s.kind] + ' ' + planStepLabel(s)))),
        html('div', { className: 'plan-actions' },
          html('button', { className: 'mini-btn strong', onClick: () => onUse(it) }, '📥 Usar en esta aula'),
          it.created_by === me && html('button', { className: 'mini-btn danger', onClick: () => remove(it) }, '🗑 Sacar'))))));
}

// Lo que se proyecta del paso actual (explicación, palabras, preguntas…)
function PlanStepShow({ s, vocab, big }) {
  if (s.kind === 'texto') return html('div', { className: 'plan-text' + (big ? ' big' : '') }, s.text);
  if (s.kind === 'trazos') return html('div', { className: 'plan-show-words' }, planTrazoChars(vocab, s.words).map(x => html('div', { key: x.c, className: 'plan-show-word' },
    html('div', { className: 'hanzi-font', style: { fontSize: 46 } }, x.c))));
  if (s.kind === 'words') return html('div', { className: 'plan-show-words' }, planWordsOf(vocab, s.words).map(w => html('div', { key: w._lesson + w.hanzi, className: 'plan-show-word' },
    html('div', { className: 'hanzi-font' }, w.hanzi), html(TonedPinyin, { text: w.pinyin }), html('small', null, w.es))));
  if (s.kind === 'quiz') return html('div', { className: 'plan-show-list' }, (s.items || []).map((it, k) => html('div', { key: k }, (k + 1) + '. ', html('span', { className: 'hanzi-font' }, it.q))));
  if (s.kind === 'orden') return html('div', { className: 'plan-show-list' }, (s.items || []).map((it, k) => html('div', { key: k }, (k + 1) + '. ' + (it.es || '…'))));
  return html('div', { className: 'plan-show-note' }, PLAN_KIND_ICON[s.kind] + ' Los alumnos hacen esta actividad en su celular.');
}

function PlanEditor({ edit, setEdit, lessons, vocab, onSave, onCancel, msg }) {
  const [adding, setAdding] = useState(null);   // tipo de paso que se está agregando
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState(null);
  const [editingId, setEditingId] = useState(null);   // paso que se está corrigiendo
  const steps = edit.steps;
  const setSteps = (s) => setEdit(e => ({ ...e, steps: s }));
  const moveStep = (i, d) => { const j = i + d; if (j < 0 || j >= steps.length) return; const s = [...steps]; [s[i], s[j]] = [s[j], s[i]]; setSteps(s); };
  const qBlank = { qs: '', qpy: '', qa: '', qapy: '', w1: '', w2: '', w3: '', qh: '' };
  const start = (kind) => {
    setErr(null); setAdding(kind); setEditingId(null);
    setDraft(kind === 'lesson' ? { lesson: lessons[0], modes: ['cards'] } : kind === 'game' ? { game: 'frase', extra: [], only: false, ...qBlank }
      : kind === 'words' ? { title: '', mode: 'cards', words: [], pick: lessons[0] }
      : kind === 'trazos' ? { title: '', words: [], pick: lessons[0] }
      : kind === 'quiz' ? { title: '', items: [], q: '', ok: '', b1: '', b2: '', b3: '' }
      : kind === 'orden' ? { title: '', items: [], zh: '', es: '' } : { title: '', text: '' });
  };
  // Abre un paso ya agregado para corregirlo (sus pasos siguen guardando el avance: el id no cambia)
  const editStep = (st) => {
    setErr(null); setEditingId(st.id); setAdding(st.kind);
    setDraft(st.kind === 'lesson' ? { lesson: st.lesson, modes: [st.mode] }
      : st.kind === 'game' ? { game: st.game, extra: st.extra || [], only: !!st.only, ...qBlank }
      : st.kind === 'words' ? { title: st.title || '', mode: st.mode, words: st.words || [], pick: (st.words && st.words[0] && st.words[0].lesson) || lessons[0] }
      : st.kind === 'trazos' ? { title: st.title || '', words: st.words || [], pick: (st.words && st.words[0] && st.words[0].lesson) || lessons[0] }
      : st.kind === 'quiz' || st.kind === 'orden' ? { title: st.title || '', items: st.items || [], q: '', ok: '', b1: '', b2: '', b3: '', zh: '', es: '' }
      : { title: st.title || '', text: st.text || '' });
  };
  const addStep = () => {
    const d = draft;
    let made;
    if (adding === 'lesson') { if (!d.modes.length) return setErr('Marcá al menos una actividad.'); made = d.modes.map(m => ({ kind: 'lesson', lesson: d.lesson, mode: m })); }
    else if (adding === 'game') {
      if (d.only && !(d.extra || []).length) return setErr('Para usar solo tus preguntas, agregá al menos una.');
      made = [{ kind: 'game', game: d.game, ...(PLAN_CLAS_TIPOS[d.game] && (d.extra || []).length ? { extra: d.extra, only: !!d.only } : {}) }];
    }
    else if (adding === 'words') {
      if (d.words.length < (d.mode === 'cards' ? 1 : 4)) return setErr(d.mode === 'cards' ? 'Elegí al menos una palabra.' : 'Para este juego hacen falta al menos 4 palabras.');
      made = [{ kind: 'words', title: d.title.trim() || null, mode: d.mode, words: d.words }];
    }
    else if (adding === 'trazos') {
      if (!planTrazoChars(vocab, d.words).length) return setErr('Elegí al menos una palabra con hanzi para dibujar.');
      made = [{ kind: 'trazos', title: d.title.trim() || null, words: d.words }];
    }
    else if (adding === 'quiz') { if (!d.items.length) return setErr('Agregá al menos una pregunta.'); made = [{ kind: 'quiz', title: d.title.trim() || 'Preguntas', items: d.items }]; }
    else if (adding === 'orden') { if (!d.items.length) return setErr('Agregá al menos una oración.'); made = [{ kind: 'orden', title: d.title.trim() || 'Ordená las oraciones', items: d.items }]; }
    else { if (!d.title.trim() || !d.text.trim()) return setErr('Completá el título y el texto.'); made = [{ kind: 'texto', title: d.title.trim(), text: d.text.trim() }]; }
    if (editingId) {
      const k = steps.findIndex(x => x.id === editingId);
      setSteps([...steps.slice(0, k), { ...made[0], id: editingId }, ...made.slice(1).map(x => ({ ...x, id: planNewId() })), ...steps.slice(k + 1)]);
    } else setSteps([...steps, ...made.map(x => ({ ...x, id: planNewId() }))]);
    setAdding(null); setEditingId(null); setErr(null);
  };
  const addOwnQ = () => {
    const d = draft;
    const wrong = [d.w1, d.w2, d.w3].map(x => (x || '').trim()).filter(Boolean);
    if (!d.qs.includes('___')) return setErr('La oración tiene que tener ___ (tres guiones bajos) donde va la respuesta.');
    if (!d.qa.trim() || !wrong.length) return setErr('Poné la respuesta correcta y al menos una opción incorrecta.');
    setErr(null);
    setDraft({ ...d, ...qBlank, extra: [...(d.extra || []), { sentence: d.qs.trim(), pinyin: d.qpy.trim() || null, answer: d.qa.trim(), answer_pinyin: d.qapy.trim() || null, wrong, hint: d.qh.trim() || null }] });
  };
  const inp = (key, ph, extra) => html('input', { value: draft[key] || '', placeholder: ph, maxLength: 200, onChange: e => setDraft({ ...draft, [key]: e.target.value }), style: { ...cmInput, width: '100%', ...(extra || {}) } });
  const hasW = (l, h) => draft.words.some(x => x.lesson === l && x.hanzi === h);
  const togW = (l, h) => setDraft({ ...draft, words: hasW(l, h) ? draft.words.filter(x => !(x.lesson === l && x.hanzi === h)) : [...draft.words, { lesson: l, hanzi: h }] });

  return html('div', { className: 'report-card' },
    html('div', { className: 'plan-head' }, html('button', { className: 'mini-btn', onClick: onCancel }, '← Volver'), html('b', null, edit.id ? '✏️ Editar clase' : '➕ Nueva clase')),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { margin: '8px 0' } }, msg.text),
    html('input', { value: edit.title, maxLength: 120, placeholder: 'Título (ej: Clase 12 · La comida)', onChange: e => setEdit({ ...edit, title: e.target.value }), style: { ...cmInput, width: '100%', margin: '10px 0 8px', fontWeight: 700 } }),
    html('textarea', { value: edit.description, maxLength: 600, rows: 2, placeholder: 'Descripción o consigna para los alumnos (opcional)', onChange: e => setEdit({ ...edit, description: e.target.value }), style: { ...cmInput, width: '100%', resize: 'vertical', fontFamily: 'inherit' } }),
    html('div', { className: 'report-h', style: { margin: '14px 0 6px' } }, 'Pasos de la clase'),
    steps.length === 0 ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todavía no hay pasos. Agregá el primero abajo.')
    : html('div', { className: 'plan-edit-steps' }, steps.map((s, i) => html('div', { key: s.id, className: 'plan-edit-step' },
        html('span', { className: 'plan-num' }, i + 1),
        html('span', { style: { flex: 1, minWidth: 0 } }, PLAN_KIND_ICON[s.kind] + ' ' + planStepLabel(s), s.kind === 'texto' && html('small', null, s.text.slice(0, 80) + (s.text.length > 80 ? '…' : ''))),
        html('button', { className: 'mini-btn', title: 'Editar este paso', disabled: !!adding, onClick: () => editStep(s) }, '✏️'),
        html('button', { className: 'mini-btn', disabled: i === 0, onClick: () => moveStep(i, -1) }, '↑'),
        html('button', { className: 'mini-btn', disabled: i === steps.length - 1, onClick: () => moveStep(i, 1) }, '↓'),
        html('button', { className: 'mini-btn danger', onClick: () => setSteps(steps.filter(x => x.id !== s.id)) }, '✕')))),
    !adding && html('div', { className: 'plan-add-btns' },
      html('button', { className: 'secondary-btn', onClick: () => start('lesson') }, '📖 Lección del libro'),
      html('button', { className: 'secondary-btn', onClick: () => start('game') }, '🎮 Actividad de la app'),
      html('button', { className: 'secondary-btn', onClick: () => start('words') }, '🔤 Mis palabras'),
      html('button', { className: 'secondary-btn', onClick: () => start('quiz') }, '❓ Mis preguntas'),
      html('button', { className: 'secondary-btn', onClick: () => start('orden') }, '🔀 Ordenar oraciones'),
      html('button', { className: 'secondary-btn', onClick: () => start('trazos') }, '✍️ Trazos'),
      html('button', { className: 'secondary-btn', onClick: () => start('texto') }, '📝 Explicación')),
    adding && html('div', { className: 'plan-add' },
      html('div', { className: 'report-h', style: { margin: '0 0 8px' } }, (editingId ? '✏️ Editar paso · ' : '') + { lesson: '📖 Lección del libro', game: '🎮 Actividad de la app', words: '🔤 Mis palabras', quiz: '❓ Mis preguntas', orden: '🔀 Ordenar oraciones', trazos: '✍️ Trazos', texto: '📝 Explicación' }[adding]),
      adding === 'lesson' && html(React.Fragment, null,
        html('select', { value: draft.lesson, onChange: e => setDraft({ ...draft, lesson: e.target.value }), style: { ...cmInput, width: '100%', marginBottom: 8 } },
          lessons.map(l => html('option', { key: l, value: l }, (LESSON_THEMES[l] && LESSON_THEMES[l].name ? 'L' + l + ' · ' + LESSON_THEMES[l].name : 'Lección ' + l)))),
        html('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, PLAN_LESSON_MODES.map(([m, label]) => html('label', { key: m, className: 'mode-check' + (draft.modes.includes(m) ? ' on' : '') },
          html('input', { type: 'checkbox', checked: draft.modes.includes(m), onChange: () => setDraft({ ...draft, modes: draft.modes.includes(m) ? draft.modes.filter(x => x !== m) : [...draft.modes, m] }) }), label))),
        html('p', { className: 'admin-note', style: { margin: '6px 0 0' } }, 'Cada actividad marcada se agrega como un paso. Frases clave solo funciona en lecciones que tienen frases.')),
      adding === 'game' && html(React.Fragment, null,
        html('select', { value: draft.game, onChange: e => setDraft({ ...draft, game: e.target.value }), style: { ...cmInput, width: '100%' } },
          PLAN_GAMES.map(([g, label]) => html('option', { key: g, value: g }, label))),
        PLAN_CLAS_TIPOS[draft.game] && html('div', { className: 'plan-own' },
          html('div', { className: 'plan-own-h' }, '➕ Preguntas propias para esta clase (opcional)'),
          html('p', { className: 'admin-note', style: { margin: '0 0 6px' } }, 'Se suman a las preguntas de siempre solo en esta clase; no cambian el juego general.'),
          (draft.extra || []).length > 0 && html('div', { className: 'plan-edit-steps', style: { marginBottom: 8 } }, draft.extra.map((q, k) => html('div', { key: k, className: 'plan-edit-step' },
            html('span', { style: { flex: 1, minWidth: 0 } }, (k + 1) + '. ', html('span', { className: 'hanzi-font' }, q.sentence.replace('___', '【' + q.answer + '】')),
              html('small', null, '✕ ' + q.wrong.join(' · ') + (q.hint ? ' · pista: ' + q.hint : ''))),
            html('button', { className: 'mini-btn danger', onClick: () => setDraft({ ...draft, extra: draft.extra.filter((_, j) => j !== k) }) }, '✕')))),
          html('div', { className: 'plan-q-form' },
            inp('qs', 'Oración con ___ donde va la respuesta (ej: 我买三___书。)', { fontFamily: 'Noto Sans SC, sans-serif' }),
            html('div', { className: 'plan-q-bad' }, inp('qa', '✓ Respuesta (ej: 本)', { borderColor: 'var(--jade)', fontFamily: 'Noto Sans SC, sans-serif' }), inp('qpy', 'Pinyin de la oración (opcional)'), inp('qapy', 'Pinyin de la respuesta (opcional)')),
            html('div', { className: 'plan-q-bad' }, inp('w1', '✕ Incorrecta 1'), inp('w2', '✕ Incorrecta 2'), inp('w3', '✕ Incorrecta 3')),
            inp('qh', 'Pista o traducción (opcional, ej: Compro tres libros.)'),
            html('button', { className: 'mini-btn strong', style: { alignSelf: 'flex-start' }, onClick: addOwnQ }, '+ Agregar pregunta propia')),
          (draft.extra || []).length > 0 && html('label', { className: 'mode-check' + (draft.only ? ' on' : ''), style: { marginTop: 8, display: 'inline-flex', gap: 6, alignItems: 'center' } },
            html('input', { type: 'checkbox', checked: !!draft.only, onChange: e => setDraft({ ...draft, only: e.target.checked }) }),
            'Usar solo mis preguntas (sin las de siempre)'))),
      (adding === 'words' || adding === 'trazos') && html(React.Fragment, null,
        inp('title', adding === 'trazos' ? 'Título (opcional, ej: Hanzi de la comida)' : 'Título (opcional, ej: Comidas y bebidas)', { marginBottom: 8 }),
        adding === 'words' && html('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' } },
          html('span', { style: { fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)' } }, 'Juego:'),
          PLAN_WORD_MODES.map(([m, label]) => html('button', { key: m, className: 'report-tab' + (draft.mode === m ? ' active' : ''), onClick: () => setDraft({ ...draft, mode: m }) }, label))),
        draft.words.length > 0 && html('div', { className: 'word-pick-selected' },
          draft.words.map(x => html('button', { key: x.lesson + x.hanzi, className: 'word-pick on', onClick: () => togW(x.lesson, x.hanzi), title: 'Quitar' }, x.hanzi + ' ✕'))),
        html('select', { value: draft.pick, onChange: e => setDraft({ ...draft, pick: e.target.value }), style: { ...cmInput, width: '100%', margin: '8px 0' } },
          lessons.map(l => html('option', { key: l, value: l }, 'Palabras de la lección ' + l))),
        html('div', { className: 'word-pick-grid' }, (vocab[draft.pick] || []).map(w => html('button', { key: w.hanzi, className: 'word-pick' + (hasW(draft.pick, w.hanzi) ? ' on' : ''), onClick: () => togW(draft.pick, w.hanzi), title: w.pinyin + ' · ' + w.es },
          html('span', { className: 'hanzi-font' }, w.hanzi), html('small', null, (w.es || '').slice(0, 14))))),
        html('p', { className: 'admin-note', style: { margin: '6px 0 0' } }, adding === 'trazos'
          ? draft.words.length + ' palabras elegidas → ' + planTrazoChars(vocab, draft.words).length + ' hanzi para dibujar (los que se repiten van una sola vez).'
          : draft.words.length + ' elegidas. Podés mezclar palabras de distintas lecciones; se usan con su audio del libro.')),
      adding === 'quiz' && html(React.Fragment, null,
        inp('title', 'Título del paso (ej: ¿Qué pedimos?)', { marginBottom: 8 }),
        draft.items.length > 0 && html('div', { className: 'plan-edit-steps', style: { marginBottom: 8 } }, draft.items.map((it, k) => html('div', { key: k, className: 'plan-edit-step' },
          html('span', { style: { flex: 1, minWidth: 0 } }, (k + 1) + '. ', it.img && '📷 ', html('span', { className: 'hanzi-font' }, it.q), html('small', null, '✓ ' + it.ok + ' · ✕ ' + it.bad.join(' · '))),
          html('button', { className: 'mini-btn danger', onClick: () => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== k) }) }, '✕')))),
        html('div', { className: 'plan-q-form' },
          inp('q', 'Pregunta (ej: 你喝什么？ o ¿Cómo se dice "té"?)'),
          html('div', { className: 'quiz-ed-photo' }, draft.img
            ? html(React.Fragment, null, html('img', { src: draft.img, alt: '' }), html('button', { className: 'mini-btn danger', onClick: () => setDraft({ ...draft, img: null }) }, 'Quitar foto'))
            : html('label', { className: 'mini-btn', style: { cursor: 'pointer' } }, draft.upl ? 'Subiendo…' : '📷 Agregar foto (opcional)',
                html('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
                  setDraft(x => ({ ...x, upl: true }));
                  uploadNpcrPhoto(f, 'clases').then(url => setDraft(x => ({ ...x, img: url, upl: false })), er => { setDraft(x => ({ ...x, upl: false })); setErr('❌ ' + er.message); }); } }))),
          inp('ok', '✓ Respuesta correcta', { borderColor: 'var(--jade)' }),
          html('div', { className: 'plan-q-bad' }, inp('b1', '✕ Incorrecta 1'), inp('b2', '✕ Incorrecta 2'), inp('b3', '✕ Incorrecta 3')),
          html('button', { className: 'mini-btn strong', style: { alignSelf: 'flex-start' }, onClick: () => {
            const bad = [draft.b1, draft.b2, draft.b3].map(x => (x || '').trim()).filter(Boolean);
            if ((!draft.q.trim() && !draft.img) || !draft.ok.trim() || !bad.length) return setErr('Cada pregunta necesita el texto o una foto, la respuesta correcta y al menos una incorrecta.');
            setErr(null); setDraft({ ...draft, items: [...draft.items, { q: draft.q.trim(), ok: draft.ok.trim(), bad, ...(draft.img ? { img: draft.img } : {}) }], q: '', ok: '', b1: '', b2: '', b3: '', img: null });
          } }, '+ Agregar pregunta'))),
      adding === 'orden' && html(React.Fragment, null,
        inp('title', 'Título del paso (opcional)', { marginBottom: 8 }),
        draft.items.length > 0 && html('div', { className: 'plan-edit-steps', style: { marginBottom: 8 } }, draft.items.map((it, k) => html('div', { key: k, className: 'plan-edit-step' },
          html('span', { style: { flex: 1, minWidth: 0 } }, (k + 1) + '. ', html('span', { className: 'hanzi-font' }, it.zh), it.es && html('small', null, it.es)),
          html('button', { className: 'mini-btn danger', onClick: () => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== k) }) }, '✕')))),
        html('div', { className: 'plan-q-form' },
          inp('zh', 'Oración con las palabras separadas por espacios (ej: 我 要 一杯 茶)', { fontFamily: 'Noto Sans SC, sans-serif' }),
          inp('es', 'Traducción (se muestra como pista, opcional)'),
          html('button', { className: 'mini-btn strong', style: { alignSelf: 'flex-start' }, onClick: () => {
            const parts = (draft.zh || '').trim().split(/\s+/).filter(Boolean);
            if (parts.length < 2) return setErr('Separá la oración en al menos 2 partes con espacios: así se arman las fichas para ordenar.');
            setErr(null); setDraft({ ...draft, items: [...draft.items, { zh: parts.join(' '), es: (draft.es || '').trim() || null }], zh: '', es: '' });
          } }, '+ Agregar oración'))),
      adding === 'texto' && html(React.Fragment, null,
        inp('title', 'Título (ej: Cómo se usa 的)', { marginBottom: 8 }),
        html('textarea', { value: draft.text, maxLength: 2000, rows: 5, placeholder: 'Texto de la explicación. Podés escribir en chino y en español.', onChange: e => setDraft({ ...draft, text: e.target.value }), style: { ...cmInput, width: '100%', resize: 'vertical', fontFamily: 'inherit' } })),
      err && html('div', { className: 'admin-status err', style: { marginTop: 8 } }, err),
      html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: addStep }, editingId ? 'Guardar paso' : 'Agregar paso a la clase'),
        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => { setAdding(null); setEditingId(null); setErr(null); } }, 'Cancelar'))),
    html('div', { style: { display: 'flex', gap: 8, marginTop: 16, borderTop: '1px solid var(--paper-deep)', paddingTop: 12 } },
      html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: onSave }, edit.id ? '💾 Guardar cambios' : '💾 Guardar clase'),
      html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: onCancel }, 'Cancelar')));
}

// ── Alumno: las clases publicadas de su aula, paso a paso ──
function PlanModule({ classId, preview, onBack, vocab, sentences, cardState, onRecordCard, lessons, openLessons, appConfig, playerName, onLessonResult, onLog }) {
  const [plans, setPlans] = useState(null);
  const [prog, setProg] = useState([]);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [run, setRun] = useState(null);         // paso que se está haciendo
  const [runN, setRunN] = useState(0);
  const loadPlans = () => db.from('npcr_class_plans').select('*').eq('class_id', classId).eq('published', true).order('position').order('created_at').then(({ data, error }) => {
    if (error) { setErr(error.message); setPlans([]); return; }
    setPlans(data || []);
  });
  useEffect(() => {
    loadPlans();
    db.from('npcr_plan_progress').select('plan_id,step_id,percent,done').then(({ data }) => setProg(data || []));
  }, [classId]);
  useEffect(() => stopAudio, []);

  const stOf = (pid, sid) => prog.find(x => x.plan_id === pid && x.step_id === sid);
  const nDone = (p) => p.steps.filter(s => (stOf(p.id, s.id) || {}).done).length;
  const record = (p, s, percent) => {
    const v = Math.round(percent || 0);
    setProg(list => {
      const cur = list.find(x => x.plan_id === p.id && x.step_id === s.id);
      const nx = { plan_id: p.id, step_id: s.id, percent: Math.max(v, cur ? cur.percent : 0), done: (cur && cur.done) || v >= 70 };
      return cur ? list.map(x => x === cur ? nx : x) : [...list, nx];
    });
    if (!preview) db.rpc('npcr_plan_step', { p_plan: p.id, p_step: s.id, p_percent: v }).then(() => {});
  };

  if (err) return html(GameStatusScreen, { onBack, title: '📚 Clases', msg: '❌ ' + err + ' (¿ejecutaste npcr_clases_plan.sql?)' });
  if (!plans) return html(GameStatusScreen, { onBack, title: '📚 Clases', msg: '⏳ Cargando clases…' });
  const plan = openId && plans.find(p => p.id === openId);

  // Un paso en curso: se abre el juego de siempre, dentro de este módulo
  if (plan && run) {
    const s = run;
    const back = () => { stopAudio(); setRun(null); };
    const finish = (percent) => record(plan, s, percent);
    const key = 'plan-' + s.id + '-' + runN;
    const wrap = (el) => el;
    if (s.kind === 'texto') return wrap(html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: back }, '←'), html('h1', null, '📝 ' + s.title)),
      html('div', { style: { padding: '0 16px' } },
        html(PlanStepShow, { s, vocab }),
        html('button', { className: 'primary-btn', style: { marginTop: 16 }, onClick: () => { record(plan, s, 100); back(); } }, '✓ Listo, lo leí'))));
    if (s.kind === 'lesson') return wrap(html(PlayScreen, { key, vocab, sentences, lessonId: s.lesson, mode: s.mode, cardState, onRecordCard,
      onBack: back, onHome: back, onFinish: (percent, missed) => { onLessonResult(s.lesson, s.mode, percent, missed); finish(percent); },
      nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {} }));
    if (s.kind === 'words') {
      const words = planWordsOf(vocab, s.words);
      const title = s.title || 'Palabras de la clase';
      const onFin = (percent, missed, total) => { onLog('prueba', null, 'clase-palabras', percent, total == null ? words.length : total, (missed || []).length); finish(percent); };
      const common = { key, lessonId: 'plan', onBack: back, onHome: back, onFinish: onFin, nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {} };
      if (s.mode === 'cards') return wrap(html(FlashcardGame, { ...common, words: [], cardState, onRecordCard, deckBuilder: () => shuffle(words), title: '🔤 ' + title,
        emptyTitle: 'Sin palabras', emptySub: 'Esta lista no tiene palabras.' }));
      if (s.mode === 'match') return wrap(html(MatchGame, { ...common, words }));
      if (s.mode === 'quiz') return wrap(html(QuizGame, { ...common, words }));
      return wrap(html(MemoryGame, { ...common, words }));
    }
    if (s.kind === 'trazos') return wrap(html(PlanTrazos, { key, title: s.title || 'Trazos', chars: planTrazoChars(vocab, s.words), vocab, onBack: back,
      onFinish: (percent) => { onLog('prueba', null, 'clase-trazos', percent, null, 0); finish(percent); } }));
    if (s.kind === 'quiz' || s.kind === 'orden') {
      const G = s.kind === 'quiz' ? PlanQuizGame : PlanOrderGame;
      return wrap(html(G, { key, title: s.title, items: s.items || [], onBack: back,
        onFinish: (percent, wrong) => { onLog('prueba', null, 'clase-' + s.kind, percent, (s.items || []).length, (wrong || []).length); finish(percent); } }));
    }
    const gp = { key, onBack: back, playerName, priorMissed: [],
      onFinish: (percent, missed, total) => { onLog('prueba', null, s.game, percent, total == null ? null : total, (missed || []).length); finish(percent); } };
    const allWords = lessons.filter(id => !String(id).startsWith('mod-')).flatMap(id => vocab[id] || []);
    if (PLAN_CLAS_TIPOS[s.game] && (s.extra || []).length) return wrap(html(PlanClasGame, { ...gp, tipo: PLAN_CLAS_TIPOS[s.game], extra: s.extra, only: !!s.only }));
    if (s.game === 'frase') return wrap(html(ClasificadorGame, { ...gp, tipo: 'frase' }));
    if (s.game === 'clas') return wrap(html(ClasificadorGame, { ...gp, tipo: 'clasificador' }));
    if (s.game === 'modal') return wrap(html(ClasificadorGame, { ...gp, tipo: 'modal' }));
    if (s.game === 'tiempo') return wrap(html(ClasificadorGame, { ...gp, tipo: 'tiempo' }));
    if (s.game === 'dialogo') return wrap(html(DialogoGame, gp));
    if (s.game === 'orden') return wrap(html(OrdenGame, gp));
    if (s.game === 'zhe') return wrap(html(ZheGame, { ...gp, zheConfig: appConfig.zhe_config }));
    if (s.game === 'audio') return wrap(html(AudioGame, { ...gp, allWords }));
    if (s.game === 'tonos') return wrap(html(ToneGame, { ...gp, vocab, lessons: openLessons }));
    if (s.game === 'dictado') return wrap(html(DictationGame, { ...gp, vocab, lessons: openLessons }));
    return html(GameStatusScreen, { onBack: back, title: '📚 Clases', msg: 'Esta actividad no está disponible.' });
  }

  // Una clase abierta: el camino de pasos
  if (plan) {
    const n = nDone(plan);
    const next = plan.steps.find(s => !(stOf(plan.id, s.id) || {}).done);
    return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: () => setOpenId(null) }, '←'),
        html('div', { style: { flex: 1, minWidth: 0 } }, html('h1', null, plan.title),
          html('div', { style: { fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700, marginTop: 2 } }, n + ' de ' + plan.steps.length + ' pasos hechos'))),
      html('div', { style: { padding: '0 16px' } },
        plan.description && html('div', { className: 'plan-desc' }, plan.description),
        html('div', { className: 'plan-bar' }, html('i', { style: { width: (plan.steps.length ? n / plan.steps.length * 100 : 0) + '%' } })),
        n === plan.steps.length && plan.steps.length > 0 && html('div', { className: 'plan-win' }, '🎉 ¡Terminaste esta clase! Podés repetir cualquier paso para mejorar.'),
        html('div', { className: 'plan-path' }, plan.steps.map((s, i) => {
          const st = stOf(plan.id, s.id);
          return html('button', { key: s.id, className: 'plan-step' + (st && st.done ? ' done' : '') + (next && next.id === s.id ? ' next' : ''), onClick: () => { setRun(s); setRunN(k => k + 1); } },
            html('span', { className: 'plan-num' }, st && st.done ? '✓' : i + 1),
            html('span', { className: 'plan-step-main' },
              html('span', { className: 'plan-step-title' }, PLAN_KIND_ICON[s.kind] + ' ' + planStepLabel(s)),
              html('span', { className: 'plan-step-sub' }, (st ? (st.done ? '¡Hecho! · ' + st.percent + '%' : 'Mejor resultado: ' + st.percent + '% · necesitás 70%') : next && next.id === s.id ? 'Seguí por acá' : 'Sin hacer'))),
            html('span', { className: 'plan-go' }, '→'));
        })),
        preview && html('p', { className: 'admin-note', style: { marginTop: 12 } }, '👁 Vista de profe: podés probar los pasos, pero tu avance no se guarda.')));
  }

  // Lista de clases
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, '📚 Clases')),
    html('div', { style: { padding: '0 16px' } },
      plans.length === 0 ? html('p', { className: 'admin-note' }, 'Tu lǎoshī todavía no publicó clases. Cuando lo haga, van a aparecer acá.')
      : html('div', { className: 'plan-list' }, plans.map(p => {
          const n = nDone(p);
          return html('div', { key: p.id, className: 'plan-card student' + (n === p.steps.length && n ? ' complete' : ''), onClick: () => setOpenId(p.id) },
            html('div', { className: 'plan-card-title' }, (n === p.steps.length && n ? '✅ ' : '📚 ') + p.title),
            p.description && html('div', { className: 'plan-card-desc' }, p.description),
            html('div', { className: 'plan-bar' }, html('i', { style: { width: (p.steps.length ? n / p.steps.length * 100 : 0) + '%' } })),
            html('div', { className: 'plan-card-sub' }, n + ' de ' + p.steps.length + ' pasos' + (n === 0 ? ' · ¡Empezá!' : n < p.steps.length ? ' · Seguí' : ' · ¡Completa!')));
        }))));
}

// ═════════════════ Quiz en vivo (tipo Kahoot) — módulo de Mi aula, opt-in ═════════════════
// El lǎoshī proyecta la pregunta; los alumnos responden en el celular contra reloj.
// Las respuestas correctas y los puntos viven en el servidor (npcr_quiz_vivo.sql).
const QUIZ_COLORS = [
  { bg: '#E21B3C', shape: '▲' }, { bg: '#1368CE', shape: '◆' }, { bg: '#D89E00', shape: '●' }, { bg: '#26890C', shape: '■' }];
const QUIZ_TIMES = [10, 20, 30, 60];

// Sonidos del quiz (sintetizados, sin voces): se apagan con el mismo 🔔 de la app
function qTone(freq, start, dur, vol, type) {
  if (!_soundOn) return;
  try {
    const ctx = _fxCtx || (_fxCtx = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + start, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type || 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(t); osc.stop(t + dur + 0.02);
  } catch (e) {}
}
const quizFx = {
  tick: () => qTone(1200, 0, 0.06, 0.03, 'square'),
  tickUrgent: () => { qTone(1500, 0, 0.08, 0.05, 'square'); qTone(1500, 0.12, 0.06, 0.03, 'square'); },
  pop: () => { qTone(660, 0, 0.08, 0.05, 'triangle'); qTone(990, 0.05, 0.1, 0.04, 'triangle'); },
  join: () => { qTone(523, 0, 0.12, 0.04, 'triangle'); qTone(784, 0.08, 0.18, 0.04, 'triangle'); },
  start: () => [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36]].forEach(([f, t]) => qTone(f, t, 0.25, 0.05, 'triangle')),
  timeUp: () => { qTone(330, 0, 0.35, 0.06, 'sawtooth'); qTone(247, 0.18, 0.5, 0.05, 'sawtooth'); },
  correct: () => [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, t]) => qTone(f, t, 0.35, 0.05, 'triangle')),
  wrong: () => { qTone(311, 0, 0.25, 0.06, 'sawtooth'); qTone(233, 0.2, 0.45, 0.06, 'sawtooth'); },
  reveal: () => { qTone(880, 0, 0.15, 0.04, 'triangle'); qTone(1175, 0.1, 0.3, 0.04, 'triangle'); },
  fanfare: () => [[523, 0], [523, 0.15], [523, 0.3], [698, 0.45], [880, 0.75], [784, 1.0], [1047, 1.3]].forEach(([f, t]) => qTone(f, t, 0.4, 0.05, 'triangle')),
  lobby: (k) => { const notes = [262, 330, 392, 330, 294, 349, 440, 349]; qTone(notes[k % 8], 0, 0.3, 0.025, 'triangle'); if (k % 4 === 0) qTone(131, 0, 0.5, 0.03, 'sine'); },
};

async function uploadNpcrPhoto(file, folder) {
  const blob = await shrinkPhoto(file, 1000);
  const path = folder + '/' + Date.now() + '-' + secureRandomChars('abcdefghijklmnopqrstuvwxyz0123456789', 6) + '.jpg';
  const { error } = await db.storage.from('npcr-fotos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message + (/bucket|not found|security/i.test(error.message) ? ' — ¿Ejecutaste npcr_zhe_admin.sql y npcr_quiz_vivo.sql?' : ''));
  return db.storage.from('npcr-fotos').getPublicUrl(path).data.publicUrl;
}

// Estado de la partida con consulta periódica; el reloj se corrige con la hora del servidor
function useQuizState(gameId, everyMs) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const off = React.useRef(0);
  const refresh = () => gameId && db.rpc('npcr_quiz_state', { p_game: gameId }).then(({ data, error }) => {
    if (error) { setErr(error.message); return; }
    if (data && data.now) off.current = Date.parse(data.now) - Date.now();
    setErr(null); setSt(data);
  });
  useEffect(() => { if (!gameId) return; refresh(); const t = setInterval(refresh, everyMs); return () => clearInterval(t); }, [gameId, everyMs]);
  const left = () => {
    if (!st || st.status !== 'question' || !st.current || !st.q_started_at) return 0;
    return Math.max(0, st.current.time * 1000 - (Date.now() + off.current - Date.parse(st.q_started_at)));
  };
  return { st, err, refresh, left };
}
// Re-render frecuente para que el reloj se mueva suave
function useTicker(on, ms) {
  const [, setN] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => setN(n => n + 1), ms); return () => clearInterval(t); }, [on, ms]);
}

function QuizConfetti() {
  return html('div', { className: 'quiz-confetti' }, Array.from({ length: 24 }, (_, i) =>
    html('i', { key: i, style: { '--i': i, '--x': (i * 37 % 100) + '%', '--c': QUIZ_COLORS[i % 4].bg } })));
}
function QuizTimer({ left, total, big }) {
  const sec = Math.ceil(left / 1000), frac = total ? left / (total * 1000) : 0;
  return html('div', { className: 'quiz-timer' + (big ? ' big' : '') + (sec <= 5 ? ' urgent' : '') },
    html('svg', { viewBox: '0 0 44 44' },
      html('circle', { cx: 22, cy: 22, r: 19, className: 'quiz-timer-bg' }),
      html('circle', { cx: 22, cy: 22, r: 19, className: 'quiz-timer-fg', style: { strokeDasharray: 119.4, strokeDashoffset: 119.4 * (1 - frac) } })),
    html('span', null, sec));
}

// ── Aviso en Mi aula cuando el lǎoshī abre un quiz (solo si el módulo está activo) ──
function QuizInvite({ classId, enabled, onJoin }) {
  const [g, setG] = useState(null);
  useEffect(() => {
    if (!enabled || !classId) { setG(null); return; }
    const look = () => db.rpc('npcr_quiz_active', { p_class: classId }).then(({ data }) => setG(data && data[0] ? data[0] : null));
    look(); const t = setInterval(look, 8000); return () => clearInterval(t);
  }, [classId, enabled]);
  if (!g) return null;
  return html('button', { className: 'quiz-invite', onClick: onJoin },
    html('span', { className: 'quiz-invite-icon' }, '⚡'),
    html('span', { style: { flex: 1, textAlign: 'left' } },
      html('div', { className: 'quiz-invite-title' }, g.status === 'lobby' ? '¡Tu lǎoshī abrió un Quiz en vivo!' : '¡Quiz en vivo en juego!'),
      html('div', { className: 'quiz-invite-sub' }, g.title + ' · tocá para entrar')),
    html('span', { className: 'quiz-invite-go' }, 'Entrar →'));
}

// ── Lǎoshī: cuestionarios (compartidos con el equipo) y partida proyectada ──
function QuizHost({ classId }) {
  const [sets, setSets] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };
  const load = () => db.from('npcr_quiz_sets').select('*').order('updated_at', { ascending: false }).then(({ data, error }) => {
    if (error) { setErr(error.message); setSets([]); return; } setSets(data || []);
  });
  useEffect(() => {
    load();
    db.auth.getUser().then(({ data }) => setMe(data && data.user ? data.user.id : null));
    db.rpc('npcr_quiz_active', { p_class: classId }).then(({ data }) => { if (data && data[0]) setGameId(data[0].id); });
  }, [classId]);

  const save = async () => {
    const e = edit;
    if (!e.title.trim()) return flash('err', 'Ponele un título al cuestionario.');
    if (!e.questions.length) return flash('err', 'Agregá al menos una pregunta.');
    let error;
    if (e.id) ({ error } = await db.from('npcr_quiz_sets').update({ title: e.title.trim(), questions: e.questions, updated_at: new Date().toISOString() }).eq('id', e.id));
    else {
      const { data: { user } } = await db.auth.getUser();
      const { data: pr } = await db.from('profiles').select('name').eq('id', user.id).maybeSingle();
      ({ error } = await db.from('npcr_quiz_sets').insert({ title: e.title.trim(), questions: e.questions, author: (pr && pr.name) || user.email || null, created_by: user.id }));
    }
    if (error) return flash('err', '❌ ' + error.message);
    setEdit(null); load(); flash('ok', '✅ Cuestionario guardado. Ya lo puede usar cualquier lǎoshī.');
  };
  const play = async (s) => {
    setBusy(true);
    const { data, error } = await db.rpc('npcr_quiz_create', { p_class: classId, p_set: s.id });
    setBusy(false);
    if (error) return flash('err', '❌ ' + error.message + (/function|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_quiz_vivo.sql?' : ''));
    setGameId(data);
  };
  const remove = async (s) => {
    if (!await appConfirm('¿Eliminar el cuestionario "' + s.title + '"?')) return;
    const { error } = await db.from('npcr_quiz_sets').delete().eq('id', s.id);
    if (error) return flash('err', '❌ ' + error.message); load();
  };

  if (gameId) return html(QuizHostGame, { gameId, onClose: () => { setGameId(null); load(); } });
  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err + (/relation|does not exist/.test(err) ? ' — ¿Ejecutaste npcr_quiz_vivo.sql?' : ''));
  if (!sets) return html('p', { className: 'admin-note' }, 'Cargando cuestionarios…');
  if (edit) return html(QuizEditor, { edit, setEdit, onSave: save, onCancel: () => setEdit(null), msg, flash });
  return html('div', null,
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 10 } }, msg.text),
    html('div', { className: 'report-card' },
      html('div', { className: 'plan-head' }, html('div', { className: 'report-h', style: { margin: 0, flex: 1 } }, '⚡ Quiz en vivo'),
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto', padding: '8px 14px' }, onClick: () => setEdit({ title: '', questions: [] }) }, '+ Nuevo cuestionario')),
      html('p', { className: 'admin-note', style: { margin: '6px 0 0' } }, 'Proyectá la pantalla del aula: cada pregunta aparece en grande con su reloj, y los alumnos responden desde el celular (Mi aula → ⚡ Quiz en vivo). Suman puntos por acertar y por rapidez, con rachas, ranking y podio. Los cuestionarios se comparten con todo el equipo docente.')),
    sets.length === 0 ? html('p', { className: 'admin-note' }, 'Todavía no hay cuestionarios. Creá el primero.')
    : html('div', { className: 'plan-list' }, sets.map(s => html('div', { key: s.id, className: 'plan-card' },
        html('div', { className: 'plan-card-title' }, '⚡ ' + s.title),
        html('div', { className: 'plan-card-sub' }, s.questions.length + (s.questions.length === 1 ? ' pregunta' : ' preguntas') + (s.author ? ' · de ' + s.author : '') + (s.questions.some(q => q.img) ? ' · 📷 con fotos' : '')),
        html('div', { className: 'plan-steps-mini' }, s.questions.slice(0, 6).map((q, k) => html('span', { key: k }, (k + 1) + '. ' + String(q.q || '📷').slice(0, 28))), s.questions.length > 6 && html('span', null, '…')),
        html('div', { className: 'plan-actions' },
          html('button', { className: 'mini-btn strong', disabled: busy, onClick: () => play(s) }, '▶ Jugar en esta aula'),
          (s.created_by === me) && html('button', { className: 'mini-btn', onClick: () => setEdit({ id: s.id, title: s.title, questions: s.questions }) }, '✏️ Editar'),
          html('button', { className: 'mini-btn', onClick: () => setEdit({ title: s.title + ' (copia)', questions: s.questions }) }, '⧉ Duplicar'),
          (s.created_by === me) && html('button', { className: 'mini-btn danger', onClick: () => remove(s) }, '🗑'))))));
}

function QuizEditor({ edit, setEdit, onSave, onCancel, msg, flash }) {
  const blank = { q: '', img: null, options: ['', '', '', ''], correct: 0, time: 20 };
  const [d, setD] = useState(blank);
  const [k, setK] = useState(null);        // índice que se está corrigiendo
  const [up, setUp] = useState(false);
  const qs = edit.questions;
  const setQs = (list) => setEdit(e => ({ ...e, questions: list }));
  const photo = async (file) => {
    if (!file) return; setUp(true);
    try { const url = await uploadNpcrPhoto(file, 'quiz'); setD(x => ({ ...x, img: url })); } catch (e) { flash('err', '❌ ' + e.message); }
    setUp(false);
  };
  const addQ = () => {
    const opts = d.options.map(o => o.trim());
    const filled = opts.filter(Boolean);
    if (!d.q.trim() && !d.img) return flash('err', 'Escribí la pregunta o poné una foto.');
    if (filled.length < 2) return flash('err', 'Hacen falta al menos 2 opciones.');
    if (!opts[d.correct]) return flash('err', 'Marcá cuál es la respuesta correcta (el círculo ✓ de una opción completa).');
    const options = [], map = {};
    opts.forEach((o, i) => { if (o) { map[i] = options.length; options.push(o); } });
    const q = { q: d.q.trim(), img: d.img || null, options, correct: map[d.correct], time: d.time };
    setQs(k === null ? [...qs, q] : qs.map((x, i) => i === k ? q : x));
    setD({ ...blank, time: d.time }); setK(null);
  };
  const editQ = (i) => { const q = qs[i]; const o = [...q.options, '', '', '', ''].slice(0, 4); setD({ q: q.q, img: q.img, options: o, correct: q.correct, time: q.time || 20 }); setK(i); };
  const move = (i, dd) => { const j = i + dd; if (j < 0 || j >= qs.length) return; const l = [...qs]; [l[i], l[j]] = [l[j], l[i]]; setQs(l); };
  return html('div', { className: 'report-card' },
    html('div', { className: 'plan-head' }, html('button', { className: 'mini-btn', onClick: onCancel }, '← Volver'), html('b', null, edit.id ? '✏️ Editar cuestionario' : '➕ Nuevo cuestionario')),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { margin: '8px 0' } }, msg.text),
    html('input', { value: edit.title, maxLength: 120, placeholder: 'Título (ej: Repaso lección 6 · Comidas)', onChange: e => setEdit({ ...edit, title: e.target.value }), style: { ...cmInput, width: '100%', margin: '10px 0', fontWeight: 700 } }),
    qs.length > 0 && html('div', { className: 'plan-edit-steps' }, qs.map((q, i) => html('div', { key: i, className: 'plan-edit-step' + (k === i ? ' editing' : '') },
      html('span', { className: 'plan-num' }, i + 1),
      q.img && html('img', { src: q.img, alt: '', className: 'quiz-thumb' }),
      html('span', { style: { flex: 1, minWidth: 0 } }, html('span', { className: 'hanzi-font' }, q.q || '📷 (solo foto)'),
        html('small', null, q.options.map((o, j) => (j === q.correct ? '✓ ' : '') + o).join(' · ') + ' · ⏱ ' + (q.time || 20) + ' s')),
      html('button', { className: 'mini-btn', onClick: () => editQ(i) }, '✏️'),
      html('button', { className: 'mini-btn', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
      html('button', { className: 'mini-btn', disabled: i === qs.length - 1, onClick: () => move(i, 1) }, '↓'),
      html('button', { className: 'mini-btn danger', onClick: () => { setQs(qs.filter((_, j) => j !== i)); if (k === i) { setK(null); setD(blank); } } }, '✕')))),
    html('div', { className: 'plan-add' },
      html('div', { className: 'report-h', style: { margin: '0 0 8px' } }, k === null ? '➕ Pregunta ' + (qs.length + 1) : '✏️ Editando la pregunta ' + (k + 1)),
      html('input', { value: d.q, maxLength: 160, placeholder: 'Pregunta (ej: 这是什么？ · ¿Cómo se dice "té"?)', onChange: e => setD({ ...d, q: e.target.value }), style: { ...cmInput, width: '100%', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 16 } }),
      html('div', { className: 'quiz-ed-photo' },
        d.img ? html(React.Fragment, null, html('img', { src: d.img, alt: '' }), html('button', { className: 'mini-btn danger', onClick: () => setD({ ...d, img: null }) }, 'Quitar foto'))
        : html('label', { className: 'mini-btn', style: { cursor: 'pointer' } }, up ? 'Subiendo…' : '📷 Agregar foto (opcional)',
            html('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: e => { photo(e.target.files[0]); e.target.value = ''; } }))),
      html('div', { className: 'quiz-ed-opts' }, d.options.map((o, i) => html('div', { key: i, className: 'quiz-ed-opt', style: { '--c': QUIZ_COLORS[i].bg } },
        html('span', { className: 'quiz-ed-shape' }, QUIZ_COLORS[i].shape),
        html('input', { value: o, maxLength: 60, placeholder: 'Opción ' + (i + 1) + (i > 1 ? ' (opcional)' : ''), onChange: e => setD({ ...d, options: d.options.map((x, j) => j === i ? e.target.value : x) }) }),
        html('button', { className: 'quiz-ed-ok' + (d.correct === i ? ' on' : ''), title: 'Marcar como correcta', onClick: () => setD({ ...d, correct: i }) }, '✓')))),
      html('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 } },
        html('span', { style: { fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)' } }, '⏱ Tiempo:'),
        QUIZ_TIMES.map(t => html('button', { key: t, className: 'report-tab' + (d.time === t ? ' active' : ''), onClick: () => setD({ ...d, time: t }) }, t + ' s'))),
      html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, disabled: up, onClick: addQ }, k === null ? 'Agregar pregunta' : 'Guardar pregunta'),
        k !== null && html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => { setK(null); setD(blank); } }, 'Cancelar'))),
    html('div', { style: { display: 'flex', gap: 8, marginTop: 16, borderTop: '1px solid var(--paper-deep)', paddingTop: 12 } },
      html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: onSave }, '💾 Guardar cuestionario'),
      html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: onCancel }, 'Cancelar')));
}

// Pantalla para proyectar
function QuizHostGame({ gameId, onClose }) {
  const { st, err, refresh, left } = useQuizState(gameId, 1000);
  const [board, setBoard] = useState(false);
  const [busy, setBusy] = useState(false);
  const revealed = React.useRef(-1);
  const lastSec = React.useRef(null);
  const prevNames = React.useRef(0);
  const prevStatus = React.useRef(null);
  const live = st && st.status === 'question';
  useTicker(live, 200);
  const ms = left();
  const call = async (fn) => { setBusy(true); const { error } = await db.rpc(fn, { p_game: gameId }); setBusy(false); if (error) appAlert({ icon: '❌', title: 'No se pudo', text: error.message }); refresh(); };

  // Sonidos y pasos automáticos
  useEffect(() => {
    if (!st) return;
    if (st.status === 'lobby' && (st.names || []).length > prevNames.current) quizFx.join();
    prevNames.current = (st.names || []).length;
    if (st.status !== prevStatus.current) {
      if (st.status === 'question') { quizFx.start(); setBoard(false); }
      if (st.status === 'reveal') quizFx.reveal();
      if (st.status === 'end') quizFx.fanfare();
      prevStatus.current = st.status;
    }
  });
  useEffect(() => {   // música de espera mientras entran
    if (!st || st.status !== 'lobby') return;
    let k = 0; const t = setInterval(() => quizFx.lobby(k++), 320); return () => clearInterval(t);
  }, [st && st.status]);
  useEffect(() => {   // reloj: tic-tac y al terminar (o cuando respondieron todos) se muestra la respuesta
    if (!live) return;
    const sec = Math.ceil(ms / 1000);
    if (sec !== lastSec.current) { lastSec.current = sec; if (sec > 0 && sec <= 5) quizFx.tickUrgent(); else if (sec > 5 && sec % 2 === 0) quizFx.tick(); }
    const all = st.players > 0 && st.answered >= st.players;
    if ((ms <= 0 || all) && revealed.current !== st.q_index) {
      revealed.current = st.q_index;
      if (ms <= 0) quizFx.timeUp();
      call('npcr_quiz_reveal');
    }
  });

  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err);
  if (!st) return html('p', { className: 'admin-note' }, 'Abriendo el quiz…');
  const cur = st.current, rv = st.reveal;
  const top = html('div', { className: 'quiz-host-top' },
    html('b', { style: { flex: 1, minWidth: 0 } }, '⚡ ' + st.title),
    st.q_index >= 0 && st.status !== 'end' && html('span', { className: 'quiz-pill' }, 'Pregunta ' + (st.q_index + 1) + ' de ' + st.q_count),
    html(SoundToggle, null),
    st.status !== 'end' && html('button', { className: 'mini-btn danger', onClick: async () => (await appConfirm('¿Terminar el quiz ahora?')) && call('npcr_quiz_end') }, '⏹ Terminar'),
    st.status === 'end' && html('button', { className: 'mini-btn', onClick: onClose }, '← Cuestionarios'));

  if (st.status === 'lobby') return html('div', { className: 'quiz-host' }, top,
    html('div', { className: 'quiz-lobby' },
      html('div', { className: 'quiz-lobby-title' }, st.title),
      html('div', { className: 'quiz-lobby-how' }, '📱 Entrá desde ', html('b', null, 'Mi aula → ⚡ Quiz en vivo')),
      html('div', { className: 'quiz-lobby-count' }, html('b', null, st.players), st.players === 1 ? ' jugador' : ' jugadores'),
      html('div', { className: 'quiz-names' }, (st.names || []).map((n, i) => html('span', { key: n + i, className: 'quiz-name', style: { '--c': QUIZ_COLORS[i % 4].bg } }, n))),
      html('button', { className: 'quiz-big-btn', disabled: busy || !st.players, onClick: () => call('npcr_quiz_next') }, st.players ? '▶ Empezar' : 'Esperando jugadores…')));

  if (st.status === 'question' || (st.status === 'reveal' && !board)) {
    const isRv = st.status === 'reveal';
    const max = isRv ? Math.max(1, ...rv.counts) : 1;
    return html('div', { className: 'quiz-host' }, top,
      html('div', { key: 'q' + st.q_index, className: 'quiz-q-card' },
        html('div', { className: 'quiz-q-text hanzi-font' }, cur ? cur.q : ''),
        html('div', { className: 'quiz-q-mid' },
          !isRv && html(QuizTimer, { left: ms, total: cur.time, big: true }),
          cur && cur.img ? html('img', { className: 'quiz-q-img', src: cur.img, alt: '' }) : html('div', { className: 'quiz-q-noimg' }),
          !isRv ? html('div', { className: 'quiz-answered' }, html('b', null, st.answered), html('span', null, 'respuestas'))
            : html('div', { className: 'quiz-answered' }, html('b', null, rv.counts.reduce((a, b) => a + b, 0)), html('span', null, 'respuestas')))),
      isRv && html('div', { className: 'quiz-bars' }, cur.options.map((o, i) => html('div', { key: i, className: 'quiz-bar' + (i === rv.correct ? ' ok' : ' no'), style: { '--c': QUIZ_COLORS[i].bg } },
        html('span', { className: 'quiz-bar-n' }, rv.counts[i] || 0),
        html('i', { style: { height: (8 + (rv.counts[i] || 0) / max * 110) + 'px' } }),
        html('span', { className: 'quiz-bar-s' }, QUIZ_COLORS[i].shape, i === rv.correct ? ' ✓' : '')))),
      html('div', { className: 'quiz-opts host' }, (cur ? cur.options : []).map((o, i) => html('div', { key: i,
        className: 'quiz-opt' + (isRv ? (i === rv.correct ? ' ok' : ' dim') : ''), style: { '--c': QUIZ_COLORS[i].bg } },
        html('span', { className: 'quiz-shape' }, QUIZ_COLORS[i].shape), html('span', { className: 'quiz-opt-t hanzi-font' }, o), isRv && i === rv.correct && html('span', { className: 'quiz-ok-mark' }, '✓')))),
      html('div', { className: 'quiz-host-nav' },
        !isRv ? html('button', { className: 'quiz-big-btn alt', disabled: busy, onClick: () => { revealed.current = st.q_index; call('npcr_quiz_reveal'); } }, 'Mostrar respuesta')
        : html('button', { className: 'quiz-big-btn', onClick: () => setBoard(true) }, '🏆 Ver ranking')));
  }

  if (st.status === 'reveal' && board) {
    const b = (st.board || []).slice(0, 5);
    const last = st.q_index + 1 >= st.q_count;
    return html('div', { className: 'quiz-host' }, top,
      html('div', { className: 'quiz-board-title' }, '🏆 Ranking'),
      html('div', { className: 'quiz-board' }, b.map((p, i) => html('div', { key: p.name, className: 'quiz-board-row', style: { '--i': i } },
        html('span', { className: 'quiz-board-pos' }, i + 1),
        html('span', { className: 'quiz-board-name' }, p.name, p.streak >= 2 && html('span', { className: 'quiz-streak' }, '🔥 ' + p.streak)),
        p.gain > 0 && html('span', { className: 'quiz-gain' }, '+' + p.gain),
        html('span', { className: 'quiz-board-score' }, p.score)))),
      html('div', { className: 'quiz-host-nav' },
        html('button', { className: 'quiz-big-btn', disabled: busy, onClick: () => call('npcr_quiz_next') }, last ? '🏁 Ver podio' : 'Siguiente pregunta ▶')));
  }

  // Podio final
  const b = st.board || [];
  const pod = [b[1], b[0], b[2]];
  return html('div', { className: 'quiz-host' }, top, html(QuizConfetti),
    html('div', { className: 'quiz-board-title' }, '🎉 ¡Terminó el quiz!'),
    html('div', { className: 'quiz-podium' }, pod.map((p, i) => p ? html('div', { key: i, className: 'quiz-pod p' + [2, 1, 3][i], style: { '--d': [0.6, 1.2, 0][i] + 's' } },
      html('div', { className: 'quiz-pod-name' }, p.name), html('div', { className: 'quiz-pod-score' }, p.score + ' pts'),
      html('div', { className: 'quiz-pod-block' }, ['🥈', '🥇', '🥉'][i])) : html('div', { key: i }))),
    b.length > 3 && html('div', { className: 'quiz-board small' }, b.slice(3).map((p, i) => html('div', { key: p.name, className: 'quiz-board-row' },
      html('span', { className: 'quiz-board-pos' }, i + 4), html('span', { className: 'quiz-board-name' }, p.name), html('span', { className: 'quiz-board-score' }, p.score)))),
    html('div', { className: 'quiz-host-nav' }, html('button', { className: 'quiz-big-btn', onClick: onClose }, 'Listo')));
}

// ── Alumno: responde desde el celular ──
function QuizPlayer({ classId, onBack }) {
  const [gameId, setGameId] = useState(null);
  const [joinErr, setJoinErr] = useState(null);
  const [looking, setLooking] = useState(true);
  useEffect(() => {
    if (gameId) return;
    const look = () => db.rpc('npcr_quiz_active', { p_class: classId }).then(async ({ data, error }) => {
      setLooking(false);
      if (error) { setJoinErr(error.message); return; }
      const g = data && data[0]; if (!g) return;
      const j = await db.rpc('npcr_quiz_join', { p_game: g.id });
      if (j.error) setJoinErr(j.error.message); else { setJoinErr(null); setGameId(g.id); quizFx.join(); }
    });
    look(); const t = setInterval(look, 3000); return () => clearInterval(t);
  }, [gameId, classId]);
  if (!gameId) return html('main', { className: 'quiz-main', style: { paddingTop: 18 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, '⚡ Quiz en vivo')),
    html('div', { className: 'quiz-wait' },
      html('div', { className: 'quiz-wait-icon' }, '⚡'),
      html('b', null, looking ? 'Buscando…' : 'Todavía no hay un quiz abierto'),
      html('span', null, joinErr ? '❌ ' + joinErr : 'Cuando tu lǎoshī lo abra, entrás solo. Dejá esta pantalla abierta.')));
  return html(QuizPlayerGame, { gameId, onBack });
}

function QuizPlayerGame({ gameId, onBack }) {
  const { st, err, refresh, left } = useQuizState(gameId, 1200);
  const [sent, setSent] = useState(null);       // { q, choice }
  const prev = React.useRef(null);
  const lastSec = React.useRef(null);
  const live = st && st.status === 'question';
  useTicker(live, 200);
  const ms = left();
  useEffect(() => {
    if (!st) return;
    const key = st.status + st.q_index;
    if (key !== prev.current) {
      if (st.status === 'reveal' && st.me) { const l = st.me.last; if (l && l.correct) quizFx.correct(); else quizFx.wrong(); }
      if (st.status === 'question') quizFx.start();
      if (st.status === 'end') quizFx.fanfare();
      prev.current = key;
    }
  });
  useEffect(() => { if (!live) return; const sec = Math.ceil(ms / 1000); if (sec !== lastSec.current) { lastSec.current = sec; if (sec > 0 && sec <= 3 && !(st.me && st.me.answered)) quizFx.tick(); } });
  const answer = async (i) => {
    if (sent && sent.q === st.q_index) return;
    setSent({ q: st.q_index, choice: i }); quizFx.pop();
    const { error } = await db.rpc('npcr_quiz_answer', { p_game: gameId, p_choice: i });
    if (error) setSent(null);
    refresh();
  };
  if (err) return html(GameStatusScreen, { onBack, title: '⚡ Quiz en vivo', msg: '❌ ' + err });
  if (!st) return html(GameStatusScreen, { onBack, title: '⚡ Quiz en vivo', msg: '⏳ Entrando…' });
  const me = st.me || {};
  const head = html('div', { className: 'quiz-p-head' },
    html('button', { className: 'back-btn', onClick: onBack }, '←'),
    html('span', { className: 'quiz-p-name' }, me.name || ''),
    st.q_index >= 0 && st.status !== 'end' && html('span', { className: 'quiz-pill' }, (st.q_index + 1) + '/' + st.q_count),
    html('span', { className: 'quiz-p-score' }, (me.score || 0) + ' pts'));
  const wrapCls = 'quiz-main quiz-p';

  if (st.status === 'lobby') return html('main', { className: wrapCls }, head,
    html('div', { className: 'quiz-wait' }, html('div', { className: 'quiz-wait-icon bounce' }, '🎮'),
      html('b', null, '¡Estás adentro!'), html('span', null, 'Buscá tu nombre en la pantalla del aula. Ya empieza…')));

  if (st.status === 'question') {
    const cur = st.current;
    const done = me.answered || (sent && sent.q === st.q_index);
    if (done) return html('main', { className: wrapCls }, head,
      html('div', { className: 'quiz-wait' }, html('div', { className: 'quiz-spinner' }),
        html('b', null, '¡Respuesta enviada!'), html('span', null, 'Esperá a que se termine el tiempo…')));
    return html('main', { className: wrapCls }, head,
      html('div', { className: 'quiz-p-bar' }, html('i', { style: { width: (cur.time ? ms / (cur.time * 1000) * 100 : 0) + '%' } })),
      html('div', { className: 'quiz-p-q hanzi-font' }, cur.q),
      cur.img && html('img', { className: 'quiz-p-img', src: cur.img, alt: '' }),
      html('div', { className: 'quiz-opts' + (cur.options.length <= 2 ? ' two' : '') }, cur.options.map((o, i) => html('button', { key: i, className: 'quiz-opt btn', style: { '--c': QUIZ_COLORS[i].bg }, onClick: () => answer(i) },
        html('span', { className: 'quiz-shape' }, QUIZ_COLORS[i].shape), html('span', { className: 'quiz-opt-t hanzi-font' }, o)))));
  }

  if (st.status === 'reveal') {
    const l = me.last, cur = st.current;
    const ok = l && l.correct;
    return html('main', { className: wrapCls + (ok ? ' good' : ' bad') }, head,
      html('div', { className: 'quiz-result' },
        html('div', { className: 'quiz-result-icon' }, ok ? '✓' : l ? '✕' : '⏱'),
        html('div', { className: 'quiz-result-t' }, ok ? '¡Correcto!' : l ? 'Incorrecto' : '¡Se acabó el tiempo!'),
        ok && html('div', { className: 'quiz-result-pts' }, '+' + l.points),
        ok && me.streak >= 2 && html('div', { className: 'quiz-result-streak' }, '🔥 Racha de ' + me.streak),
        !ok && cur && st.reveal && html('div', { className: 'quiz-result-ans' }, 'Era: ', html('b', { className: 'hanzi-font' }, cur.options[st.reveal.correct])),
        me.rank && html('div', { className: 'quiz-result-rank' }, 'Vas ' + me.rank + '° de ' + st.players)));
  }

  // Fin
  const medal = me.rank === 1 ? '🥇' : me.rank === 2 ? '🥈' : me.rank === 3 ? '🥉' : '🎉';
  return html('main', { className: wrapCls }, head, me.rank && me.rank <= 3 && html(QuizConfetti),
    html('div', { className: 'quiz-wait' }, html('div', { className: 'quiz-wait-icon bounce' }, medal),
      html('b', null, me.rank ? 'Terminaste ' + me.rank + '° de ' + st.players : '¡Terminó el quiz!'),
      html('span', null, (me.score || 0) + ' puntos'),
      html('button', { className: 'primary-btn', style: { marginTop: 14, width: 'auto' }, onClick: onBack }, 'Volver al aula')));
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
  const linkCodeUsed = React.useRef(false);

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
  const [bingoGame, setBingoGame] = useState(null);
  const [codeNotice, setCodeNotice] = useState(null); // { type: 'ok'|'err', msg }

  const [classSettings, setClassSettings] = useState(null);
  const isStaffUser = !!(profile && ['laoshi', 'admin', 'superadmin'].includes(profile.role));
  // Bingo en vivo: partida abierta en la clase del alumno (tiempo real + consulta de respaldo)
  const myClassId = myClasses && myClasses.length ? myClasses[0].class_id : null;
  const refreshBingo = () => {
    if (!myClassId) return;
    db.from('bingo_games').select('id,status,created_at').eq('class_id', myClassId).order('created_at', { ascending: false }).limit(5)
      .then(({ data, error }) => setBingoGame((!error && (data || []).find(g => g.status !== 'finished')) || null));
  };
  useLiveRefresh('bingo_games', myClassId ? 'class_id=eq.' + myClassId : null, refreshBingo, 15000);
  useEffect(() => { if (screen.name === 'home' || screen.name === 'clase') refreshBingo(); }, [screen.name]);
  const hsk1Allowed = isStaffUser || !!(classSettings && classSettings.hsk1_enabled);
  const hsk2Allowed = isStaffUser || !!(classSettings && classSettings.hsk2_enabled);
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

  const loadMyClasses = () => Promise.all([db.rpc('npcr_my_classes'), db.rpc('my_assignments'), db.rpc('npcr_my_class_settings'), db.rpc('npcr_my_class_hard_words'), db.rpc('npcr_my_hidden_activities'), db.rpc('npcr_my_shown_activities')])
    .then(([cRes, aRes, sRes, hRes, hidRes, shRes]) => {
      const list = cRes.error ? [] : (cRes.data || []);
      if (!list.length && staffRef.current) return loadStaffPreview(previewClassId);
      setMyClasses(list);
      setAssignments(aRes.error ? [] : (aRes.data || []));
      setClassSettings(!list.length || sRes.error ? null : (sRes.data && sRes.data[0] ? { ...sRes.data[0], hidden_activities: hidRes.error ? [] : (hidRes.data || []), shown_activities: shRes.error ? [] : (shRes.data || []) } : null));
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
    if (stErr) return { ok: false, msg: codeErrMsg(stErr) };
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
    if (clErr) { console.error('npcr_claim_code', clErr); return { ok: false, msg: /intentos/i.test(clErr.message || '') ? clErr.message : 'No se pudo activar el código (' + (clErr.message || clErr.code || 'error') + ').' }; }
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
    // Código escrito al entrar, o el del link de ingreso si ya había una sesión abierta
    const pendingCode = pendingAuthRef.current.code || (!linkCodeUsed.current && LINK_CODE) || null;
    pendingAuthRef.current.code = null;
    linkCodeUsed.current = true;
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

  const lessons = Object.keys(vocab).sort(lessonCompare);

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
  // Invitado = sin aula ni código y no es del equipo docente. Su límite sale de npcr_app_config.
  const isGuest = !isStaffUser && myClasses !== null && !(myClasses && myClasses.length);
  const guestMax = appConfig.guest_max_lesson != null && !isNaN(Number(appConfig.guest_max_lesson)) ? Number(appConfig.guest_max_lesson) : null;
  const guestLimited = isGuest && guestMax != null;
  const guestText = appConfig.guest_lock_text || 'Pedile un código de alumno a tu lǎoshī para poder acceder a este contenido.';
  const [guestLock, setGuestLock] = useState(false);
  useEffect(() => { if (!guestLimited) setGuestLock(false); }, [guestLimited]);
  const maxLesson = guestLimited ? guestMax : (classSettings && classSettings.max_lesson ? Number(classSettings.max_lesson) : null);
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
        if (guestLimited && (isLocked(id) || !vocab[id])) { setGuestLock(true); return; }
        if (isLocked(id)) { appAlert({ icon: '🔒', title: '¡Esta llega pronto!', text: 'Tu lǎoshī habilitó hasta la lección ' + maxLesson + '. Cuando la habilite, se abre sola.' }); return; }
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
      guestLimited, onGuestLock: () => setGuestLock(true),
      dailyCount: dailyDeckSize, dailyDone: dailyDoneDay === todayLocal(),
      onOpenClass: () => setScreen({ name: 'clase' }),
      onTraining: () => setScreen({ name: 'entrenamiento' }),
      onProgress: () => setScreen({ name: 'progreso' }),
      classSettings, hardCount: classHard.length,
      onActivity: (id) => setScreen(AULA_GAMES[id] ? { name: 'prueba', game: AULA_GAMES[id], from: 'clase' } : { name: id }),
      staffClasses, onPreviewClass: choosePreviewClass,
      bingoGame, onBingo: () => bingoGame && setScreen({ name: 'bingo', gameId: bingoGame.id }),
    });
  } else if (screen.name === 'quiz-vivo' && aulaShown(classSettings, 'quiz-vivo') && myClasses && myClasses.length) {
    content = html(QuizPlayer, { key: myClasses[0].class_id, classId: myClasses[0].class_id, onBack: () => setScreen({ name: 'clase' }) });
  } else if (screen.name === 'clases' && aulaShown(classSettings, 'clases') && myClasses && myClasses.length) {
    content = html(PlanModule, { key: myClasses[0].class_id, classId: myClasses[0].class_id, preview: !!myClasses[0].preview,
      vocab, sentences, cardState, onRecordCard: recordCard, lessons, openLessons, appConfig, playerName,
      onLessonResult: updateLessonResult, onLog: logActivity,
      onBack: () => setScreen({ name: 'clase' }) });
  } else if (screen.name === 'trazos' && aulaShown(classSettings, 'trazos')) {
    content = html(TrazosGame, { vocab, lessons, studentId, maxLesson: classSettings && classSettings.max_lesson ? Number(classSettings.max_lesson) : null,
      onBack: () => setScreen({ name: myClasses && myClasses.length ? 'clase' : 'home' }) });
  } else if (screen.name === 'bingo' && screen.gameId) {
    content = html(BingoPlayer, { key: screen.gameId, gameId: screen.gameId, onBack: () => setScreen({ name: myClasses && myClasses.length ? 'clase' : 'home' }) });
  } else if ((screen.name === 'hsk1' && hsk1Allowed) || (screen.name === 'hsk2' && hsk2Allowed)) {
    const t = screen.name;
    content = html(HskScreen, {
      key: t, level: t === 'hsk2' ? 2 : 1, studentId, appConfig,
      preview: !!(myClasses && myClasses[0] && myClasses[0].preview),
      examDate: (classSettings && classSettings[t + '_exam_date']) || appConfig[t + '_exam_date'] || null,
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
      onActivity: (id) => setScreen(AULA_GAMES[id] ? { name: 'prueba', game: AULA_GAMES[id], from: 'clase' } : { name: id }),
      onTarget: (l, m) => setScreen({ name: 'play', lessonId: l, mode: m, from: 'clase' }),
      bingoGame, onBingo: () => bingoGame && setScreen({ name: 'bingo', gameId: bingoGame.id }),
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
      guestLimited, onGuestLock: () => setGuestLock(true),
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
  } else if (screen.name === 'prueba' && guestLimited) {
    content = html(GameStatusScreen, { onBack: () => setScreen({ name: 'home' }), title: '🔒 Contenido para alumnos', msg: guestText });
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
      maxLesson: isStaffUser ? null : maxLesson,   // el equipo docente ve todo, como en las lecciones
    };
    if (screen.game === 'frase') content = html(ClasificadorGame, { ...gameProps, tipo: 'frase' });
    else if (screen.game === 'clas') content = html(ClasificadorGame, { ...gameProps, tipo: 'clasificador' });
    else if (screen.game === 'modal') content = html(ClasificadorGame, { ...gameProps, tipo: 'modal' });
    else if (screen.game === 'tiempo') content = html(ClasificadorGame, { ...gameProps, tipo: 'tiempo' });
    else if (screen.game === 'dialogo') content = html(DialogoGame, gameProps);
    else if (screen.game === 'zhe') content = html(ZheGame, { ...gameProps, zheConfig: appConfig.zhe_config });
    else if (screen.game === 'orden') content = html(OrdenGame, gameProps);
    else if (screen.game === 'audio') {
      const allWords = openLessons.flatMap(id => vocab[id] || []);
      content = html(AudioGame, { ...gameProps, allWords });
    }
    else if (screen.game === 'escritura') {
      const allVocab = {};
      openLessons.forEach(id => { allVocab[id] = vocab[id] || []; });
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

  const topbar = html('div', { className: 'topbar' },
    html('div', { className: 'brand' },
      html('div', { className: 'brand-mark hanzi-font', style: { cursor: 'default', userSelect: 'none' } }, '说'),
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
  const navIsPractica = screen.name === 'practica' || (screen.name === 'prueba' && screen.from !== 'clase');
  const navIsAdmin = screen.name === 'admin' || screen.name === 'reports';
  const navIsClase = ['clase', 'entrenamiento', 'refuerzo-clase', 'semana', 'tonos', 'dictado', 'bingo', 'trazos'].includes(screen.name) || (screen.name === 'prueba' && screen.from === 'clase');
  const navIsProgreso = screen.name === 'progreso' || screen.name === 'dificiles';

  const sidebar = html('aside', { className: 'sidebar' },
    html('div', { className: 'sidebar-brand' },
      html('div', { className: 'brand-mark hanzi-font', style: { cursor: 'default', userSelect: 'none' } }, '说'),
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

  return html('div', { className: 'app-shell' }, sidebar, html('div', { className: 'app' }, topbar, content), needsName && html(NameRequired, { onSave: saveName }),
    html(AppDialogs),
    guestLock && guestLimited && html(GuestLockModal, { text: guestText, onClose: () => setGuestLock(false), myClasses, onActivateCode: activateStudentCode }),
    !needsName && studentId && html(UserNotices, { studentId, currentName: profile && profile.name, onName: (name) => setProfile(p => ({ ...(p || {}), name })) }));
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

function PracticaHub({ modulesList, pruebaProgress, onBack, onPrueba, guestLimited, onGuestLock }) {
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
          return html('button', { key: g.id, className: 'prueba-card' + (guestLimited ? ' guest-locked' : ''), onClick: () => guestLimited ? onGuestLock() : onPrueba(g.id) },
            html('div', { className: 'prueba-icon ' + g.cls }, g.icon),
            html('div', { style: { flex: 1 } },
              html('div', { className: 'mode-title' }, g.title),
              html('div', { className: 'mode-sub' }, guestLimited ? '🔒 Solo alumnos con código' : best > 0 ? '⭐ Mejor: ' + best + '%' : g.sub),
            ),
            guestLimited ? html('div', { style: { fontSize: 20 } }, '🔒') : hasStar && html('div', { style: { fontSize: 20 } }, '⭐'),
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
  clock:    ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  chat:     ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
  tag:      ['M3 12V4h8l10 10-8 8L3 12Z', 'M7.5 7.5h.01'],
  award:    ['M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M8.2 13.9 7 22l5-3 5 3-1.2-8.1'],
  photo:    ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 9.5h.01'],
  users:    ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  zap:      ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'],
  book:     ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'],
  login:    ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l5-5-5-5', 'M15 12H3'],
  trash:    ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'],
  gear:     ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
};
// Actividades de "Mi aula" que abren un juego de preguntas (npcr_clasificador_questions por tipo)
const AULA_GAMES = { 'aula-modal': 'modal', 'aula-tiempo': 'tiempo', 'aula-clas': 'clas', 'aula-zhe': 'zhe' };
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

// Actividades que el profe puede activar/desactivar por clase (Tareas y HSK van aparte)
const AULA_TRAINING = { id: 'entrenamiento', icon: 'target', tone: 'red', title: 'Entrenamiento diario' };
const aulaHidden = (settings, id) => !!(settings && (settings.hidden_activities || []).includes(id));
const aulaShown = (settings, id) => !!(settings && (settings.shown_activities || []).includes(id));
// Las actividades de siempre se ven salvo que el profe las oculte; las nuevas (optIn)
// arrancan desactivadas y se ven solo si el profe o un admin las habilita.
const aulaVisible = (settings, a) => a.id.startsWith('hsk') || (a.optIn ? aulaShown(settings, a.id) : !aulaHidden(settings, a.id));
function aulaActivities(settings, hardCount) {
  return aulaActivitiesAll(settings, hardCount).filter(a => aulaVisible(settings, a));
}
function aulaActivitiesAll(settings, hardCount) {
  const weekly = (settings && settings.weekly_words) || [];
  const hskAct = (n) => {
    if (!settings || !settings['hsk' + n + '_enabled']) return null;
    const d = settings['hsk' + n + '_exam_date'] ? hsk1Days(settings['hsk' + n + '_exam_date']) : null;
    return { id: 'hsk' + n, icon: 'award', tone: n === 1 ? 'red' : 'gold', title: 'Preparación HSK ' + n,
      sub: d !== null && d >= 0 ? (d === 0 ? '¡Hoy es el examen!' : 'Faltan ' + d + ' día' + (d === 1 ? '' : 's') + ' para el examen') : 'Estudio, prácticas y simulacro' };
  };
  return [
    hskAct(1), hskAct(2),
    { id: 'clases', icon: 'book', tone: 'red', title: 'Clases', sub: 'Las clases que armó tu lǎoshī, paso a paso', optIn: true },
    { id: 'quiz-vivo', icon: 'zap', tone: 'gold', title: 'Quiz en vivo', sub: 'Respondé desde el celular, ¡como un juego!', optIn: true },
    { id: 'refuerzo-clase', icon: 'layers', tone: 'purple', title: 'Refuerzo de clase', sub: hardCount ? hardCount + ' palabras que le cuestan al grupo' : 'Todavía sin datos del grupo', disabled: !hardCount },
    weekly.length > 0 && { id: 'semana', icon: 'star', tone: 'gold', title: (settings && settings.weekly_title) || 'Palabras de la semana', sub: weekly.length + (weekly.length === 1 ? ' palabra elegida' : ' palabras elegidas') + ' por tu lǎoshī' },
    { id: 'tonos', icon: 'music', tone: 'green', title: 'Tonos', sub: 'Escuchá y elegí el tono' },
    { id: 'dictado', icon: 'pencil', tone: 'red', title: 'Dictado 听写', sub: 'Escuchá y escribí en chino' },
    { id: 'aula-modal', icon: 'chat', tone: 'blue', title: 'Verbos modales', sub: 'Distinguí 会, 能, 可以 y 应该' },
    { id: 'aula-tiempo', icon: 'clock', tone: 'gold', title: 'Expresiones de tiempo', sub: 'La hora: 点, 分, 刻, 差 y 半' },
    { id: 'aula-clas', icon: 'tag', tone: 'purple', title: 'Clasificadores', sub: 'Elegí 个, 本, 张, 斤 correctamente' },
    { id: 'aula-zhe', icon: 'photo', tone: 'green', title: 'Zhè shì shénme?', sub: 'Mirá la foto y elegí el hanzi, contra reloj' },
    { id: 'trazos', icon: 'pencil', tone: 'purple', title: 'Trazos', sub: 'Dibujá cada hanzi con el dedo, lección por lección', optIn: true },
    { id: 'progreso', icon: 'chart', tone: 'blue', title: 'Mi progreso', sub: 'Fuertes y a reforzar' },
  ].filter(Boolean);
}
const AULA_TOGGLES = [AULA_TRAINING, ...aulaActivitiesAll({ weekly_words: [{}] }, 1).filter(a => !a.id.startsWith('hsk'))
  .map(a => a.id === 'semana' ? { ...a, title: 'Palabras de la semana' } : a)];

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
      !aulaHidden(settings, 'entrenamiento') && html('button', { className: 'class-action' + (dailyDone ? ' done' : ''), onClick: onTraining },
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

function ClassHome({ cls, dailyCount, dailyDone, assignments, settings, hardCount, onTraining, onProgress, onActivity, onTarget, onBack, bingoGame, onBingo }) {
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
      html(BingoInvite, { game: bingoGame, onJoin: onBingo }),
      html(QuizInvite, { classId: cls.class_id, enabled: aulaShown(settings, 'quiz-vivo'), onJoin: () => onActivity('quiz-vivo') }),
      !aulaHidden(settings, 'entrenamiento') && html('h2', { className: 'section-title' }, 'Hoy'),
      !aulaHidden(settings, 'entrenamiento') && html('button', { className: 'class-training-card' + (dailyDone ? ' done' : ''), onClick: onTraining },
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
      const ok = await appConfirm('El código de ' + res.info.display_name + ' ya está activado en otra cuenta.\n\n' +
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
        value: code, placeholder: 'MARTA-K7P2', autoFocus: true, autoComplete: 'off', spellCheck: false,
        onChange: e => setCode(e.target.value.toUpperCase()),
        style: { flex: 1, padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--paper-deep)', fontSize: 15, fontWeight: 800, letterSpacing: 1.5, minWidth: 0 },
      }),
      html('button', { className: 'primary-btn', type: 'submit', disabled: busy || !normalizeCode(code), style: { margin: 0, padding: '9px 16px', width: 'auto' } }, busy ? '…' : 'Activar'),
      html('button', { type: 'button', className: 'secondary-btn', onClick: () => { setOpen(false); setStatus(null); }, style: { margin: 0, padding: '9px 12px', width: 'auto' } }, '✕'),
    ),
    msg,
  );
}

// Avisos personales que manda la consola a una sola cuenta (npcr_avisos.sql).
// "Pedir nombre": ventana para escribir (o confirmar) el nombre, que se guarda en la base.
function UserNotices({ studentId, currentName, onName }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!studentId) return;
    const look = () => db.rpc('npcr_my_notices').then(({ data, error }) => { if (!error) setList(data || []); });
    look(); const t = setInterval(look, 60000); return () => clearInterval(t);
  }, [studentId]);
  const n = list[0];
  useEffect(() => { if (n && n.kind === 'ask_name') { setName(validStudentName(currentName) ? currentName : ''); setErr(''); } }, [n && n.id]);
  if (!n) return null;
  const done = async (e) => {
    if (e) e.preventDefault();
    if (n.kind === 'ask_name' && !validStudentName(name)) { setErr('Escribí tu nombre real (al menos 2 letras).'); return; }
    setBusy(true);
    const { error } = await db.rpc('npcr_notice_done', { p_id: n.id, p_name: n.kind === 'ask_name' ? name.trim() : null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (n.kind === 'ask_name') onName(name.trim());
    setList(l => l.slice(1));
  };
  return html('div', { className: 'name-modal-overlay' },
    html('div', { className: 'name-modal' },
      html('div', { className: 'name-modal-hanzi hanzi-font' }, n.kind === 'ask_name' ? '你好！' : '📩'),
      n.kind === 'ask_name'
        ? html(React.Fragment, null,
            html('h2', { className: 'name-modal-title' }, '¿Cómo te llamás?'),
            html('p', { className: 'name-modal-sub' }, n.text || 'Tu lǎoshī necesita saber quién sos. Escribí tu nombre y apellido para seguir.'),
            html('form', { onSubmit: done },
              html('input', { className: 'name-modal-input', value: name, autoFocus: true, maxLength: 40, placeholder: 'Nombre y apellido', onChange: e => { setName(e.target.value); setErr(''); } }),
              err && html('div', { className: 'admin-status err', style: { marginTop: 8 } }, err),
              html('button', { type: 'submit', className: 'primary-btn', style: { width: '100%', marginTop: 12 }, disabled: busy }, busy ? 'Guardando…' : 'Continuar')))
        : html(React.Fragment, null,
            html('h2', { className: 'name-modal-title' }, 'Mensaje de tu lǎoshī'),
            html('p', { className: 'name-modal-sub', style: { whiteSpace: 'pre-wrap' } }, n.text || ''),
            err && html('div', { className: 'admin-status err', style: { marginTop: 8 } }, err),
            html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 12 }, disabled: busy, onClick: () => done() }, 'Entendido'))));
}

// Invitados (sin aula ni código): contenido bloqueado. El texto viene de la configuración.
// ── Ventanas propias de la app (reemplazan los carteles del navegador) ──
// appAlert(texto | { icon, title, text }) y appConfirm(...) → Promise; las muestra <AppDialogs/>.
let _dialogPush = null;
function appDialog(kind, opts) {
  const o = typeof opts === 'string' ? { text: opts } : (opts || {});
  if (!_dialogPush) return Promise.resolve(kind === 'confirm' ? window.confirm(o.text) : (window.alert(o.text), true));
  return new Promise(resolve => _dialogPush({ ...o, kind, resolve }));
}
const appAlert = (o) => appDialog('alert', o);
const appConfirm = (o) => appDialog('confirm', o);
function AppDialogs() {
  const [list, setList] = useState([]);
  useEffect(() => { _dialogPush = (d) => setList(l => [...l, { ...d, id: Math.random() }]); return () => { _dialogPush = null; }; }, []);
  const d = list[0];
  useEffect(() => {
    if (!d) return;
    const key = (e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  if (!d) return null;
  const close = (v) => { d.resolve(d.kind === 'confirm' ? v : true); setList(l => l.slice(1)); };
  // Título y texto: si el mensaje trae un párrafo aparte, la primera línea es el título
  const parts = String(d.text || '').split('\n\n');
  const title = d.title || (parts.length > 1 ? parts[0] : null);
  const body = d.title ? d.text : (parts.length > 1 ? parts.slice(1).join('\n\n') : parts[0]);
  const danger = d.danger != null ? d.danger : (d.kind === 'confirm' && /eliminar|borrar|definitiv|sacar|quitar|terminar|revertir/i.test(d.text || ''));
  const icon = d.icon || (d.kind === 'alert' ? '💬' : danger ? '⚠️' : '❓');
  return html('div', { className: 'name-modal-overlay app-dialog-ov', onClick: (e) => { if (e.target === e.currentTarget) close(false); } },
    html('div', { key: d.id, className: 'name-modal app-dialog' + (danger ? ' danger' : '') },
      html('div', { className: 'app-dialog-icon' }, icon),
      title && html('h2', { className: 'name-modal-title' }, title.replace(/^⚠️\s*/, '')),
      body && html('p', { className: 'app-dialog-text' }, body),
      html('div', { className: 'app-dialog-btns' },
        d.kind === 'confirm' && html('button', { className: 'secondary-btn', onClick: () => close(false) }, d.cancel || 'Cancelar'),
        html('button', { className: 'primary-btn' + (danger ? ' danger' : ''), autoFocus: true, onClick: () => close(true) }, d.ok || (d.kind === 'confirm' ? (danger ? 'Sí, continuar' : 'Aceptar') : 'Entendido')))));
}

function GuestLockModal({ text, onClose, myClasses, onActivateCode }) {
  return html('div', { className: 'name-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
    html('div', { className: 'name-modal guest-lock' },
      html('div', { className: 'guest-lock-icon' }, '🔒'),
      html('h2', { className: 'name-modal-title' }, 'Contenido para alumnos'),
      html('p', { className: 'name-modal-sub' }, text),
      html(StudentCodeCard, { myClasses, onActivateCode, notice: null, onDismissNotice: () => {} }),
      html('button', { className: 'secondary-btn', style: { width: '100%', marginTop: 10 }, onClick: onClose }, 'Cerrar')));
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

function Home({ vocab, lessons, progress, totalWords, totalStars, onSelectLesson, onAdmin, onPrueba, pruebaProgress, onDownload, onRefuerzo, playerName, onChangeName, streak, assignments, myClasses, onActivateCode, codeNotice, onDismissNotice, modulesList, dailyCount, dailyDone, onOpenClass, onTraining, onProgress, maxLesson, classSettings, hardCount, onActivity, staffClasses, onPreviewClass, bingoGame, onBingo, guestLimited, onGuestLock }) {
  // Invitados: la base no les manda las lecciones bloqueadas, pero se muestran con candado (desde los temas)
  const gridIds = guestLimited
    ? [...new Set([...lessons, ...Object.keys(LESSON_THEMES).filter(k => /^\d+(\.\d+)?$/.test(k))])].sort(lessonCompare)
    : lessons;
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

      myClasses && myClasses.length > 0 && html(BingoInvite, { game: bingoGame, onJoin: onBingo }),
      myClasses && myClasses.length > 0 && html(QuizInvite, { classId: myClasses[0].class_id, enabled: aulaShown(classSettings, 'quiz-vivo'), onJoin: () => onActivity('quiz-vivo') }),
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
        gridIds.filter(id => id !== 'mod-paises' && id !== 'mod-numeros' && !LESSON_THEMES[id]?.hidden).map(id => {
          const words = vocab[id] || [];
          const theme = LESSON_THEMES[id] || { name: 'Lección ' + id, icon: words[0]?.hanzi?.[0] || '汉' };
          const lp = progress.lessons[id] || {};
          const best = Math.round(((lp.match || 0) + (lp.cards || 0) + (lp.quiz || 0)) / 3);
          const stars = [lp.match || 0, lp.cards || 0, lp.quiz || 0].filter(v => v >= 80).length;
          const locked = (maxLesson != null && parseFloat(id) > maxLesson) || (guestLimited && !vocab[id]);
          return html('button', {
            key: id,
            className: 'lesson-card' + (locked ? ' locked' : ''),
            onClick: () => onSelectLesson(id),
          },
            locked && html('div', { className: 'lock-badge' }, '🔒'),
            !locked && stars > 0 && html('div', { className: 'seal hanzi-font' }, stars === 3 ? '✓' : stars),
            html('div', { className: 'hanzi-big hanzi-font' }, theme.icon),
            html('div', { className: 'lesson-name' }, 'Lección ' + id),
            html('div', { className: 'lesson-meta' }, theme.name + ' · ' + (guestLimited && locked ? '🔒 Solo alumnos' : words.length + ' palabras')),
            html('div', { className: 'progress-track' },
              html('div', { className: 'progress-fill', style: { width: best + '%' } })
            ),
          );
        })
      ),

      // ── Módulos especiales ──
      (vocab['mod-paises'] || guestLimited) && !LESSON_THEMES['mod-paises']?.hidden && html(React.Fragment, null,
        html('h2', { className: 'section-title' }, 'Aprende los países'),
        html('button', {
          style: {
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', marginBottom: 14,
            background: '#fff', border: '2px solid var(--paper-deep)', borderRadius: 'var(--radius)',
            padding: '14px 18px', cursor: 'pointer', textAlign: 'left',
            boxShadow: 'var(--shadow-paper)',
          },
          className: !vocab['mod-paises'] ? 'guest-locked' : undefined,
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

      (vocab['mod-numeros'] || guestLimited) && !LESSON_THEMES['mod-numeros']?.hidden && html(React.Fragment, null,
        html('h2', { className: 'section-title' }, 'Aprende los números'),
        html('button', {
          style: {
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', marginBottom: 14,
            background: '#fff', border: '2px solid var(--paper-deep)', borderRadius: 'var(--radius)',
            padding: '14px 18px', cursor: 'pointer', textAlign: 'left',
            boxShadow: 'var(--shadow-paper)',
          },
          className: !vocab['mod-numeros'] ? 'guest-locked' : undefined,
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
          return html('button', { key: g.id, className: 'prueba-card' + (guestLimited ? ' guest-locked' : ''), onClick: () => guestLimited ? onGuestLock() : onPrueba(g.id) },
            html('div', { className: 'prueba-icon ' + g.cls }, g.icon),
            html('div', { style: { flex: 1 } },
              html('div', { className: 'mode-title' }, g.title),
              html('div', { className: 'mode-sub' }, guestLimited ? '🔒 Solo alumnos con código' : best > 0 ? '⭐ Mejor: ' + best + '%' : g.sub),
            ),
            guestLimited ? html('div', { style: { fontSize: 20 } }, '🔒') : hasStar && html('div', { style: { fontSize: 20 } }, '⭐'),
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
  if ((vocab[lessonId] || []).length >= 4) modes.push({ id: 'memoria', emoji: '🃏', title: 'Memoria', sub: 'Encontrá las parejas: hanzi y su significado', cls: 'match', best: lp.memoria });
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
  if (mode === 'memoria') return html(MemoryGame, { words, lessonId, onBack, onHome, onFinish });
  return null;
}

// ----------------- Memoria -----------------
// Tarjetas boca abajo: hay que encontrar cada hanzi con su tarjeta de pinyin y significado.
// 3 niveles por lección (4, 6 y 8 parejas, o las que tenga la lección). Estrellas según intentos.
const MEMORY_LEVELS = [4, 6, 8];
const MEM_STRIP_H = 48;   // alto fijo de la franja de abajo (px)
function memoryStars(tries, pairs) {
  if (tries <= Math.ceil(pairs * 1.5)) return 3;
  if (tries <= Math.ceil(pairs * 2.2)) return 2;
  return 1;
}
function buildMemoryRound(words, level) {
  const pairs = Math.min(MEMORY_LEVELS[level - 1], words.length);
  const picked = shuffle(words.slice()).slice(0, pairs);
  const cards = [];
  picked.forEach((w, i) => cards.push({ p: i, k: 'han' }, { p: i, k: 'def' }));
  return { words: picked, cards: shuffle(cards) };
}

function MemoryGame({ words, lessonId, onBack, onHome, onFinish }) {
  const [level, setLevel] = useState(1);
  const [round, setRound] = useState(() => buildMemoryRound(words, 1));
  const [up, setUp] = useState([]);        // índices boca arriba (máx. 2)
  const [done, setDone] = useState([]);    // parejas encontradas
  const [miss, setMiss] = useState([]);
  const [tries, setTries] = useState(0);
  const [last, setLast] = useState(null);
  const [start, setStart] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [end, setEnd] = useState(null);
  const lock = React.useRef(false);
  const stageRef = React.useRef(null);
  const learnRef = React.useRef(null);
  const lastDims = React.useRef(null);
  const [fit, setFit] = useState(null);   // { cw, cols, gap }: carta más grande que entra sin deslizar
  const pairs = round.words.length;

  // Elige columnas y tamaño de carta para que el tablero entre entero en la pantalla
  const fitBoard = () => {
    const el = stageRef.current;
    if (!el) return;
    const W = el.clientWidth;
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    // Debajo del tablero va la franja de aprendizaje, de alto FIJO (no depende del texto)
    const below = MEM_STRIP_H + 22;
    const vh = window.innerHeight;
    lastDims.current = { w: window.innerWidth, h: vh };
    const H = Math.max(150, vh - top - below - 4);
    const n = round.cards.length;
    const gap = Math.max(5, Math.min(10, Math.round(Math.min(W, H) / 60)));
    // Proporción flexible: de cuadrada (1) a alargada (1.45), para llenar ancho y alto
    let best = { cw: 0, ch: 0, cols: 4, score: 0 };
    for (let cols = 2; cols <= n; cols++) {
      if (n % cols) continue;                     // siempre filas completas: el tablero queda parejo
      const rows = n / cols;
      const wMax = Math.min((W - gap * (cols - 1)) / cols, 200);
      const hMax = Math.min((H - gap * (rows - 1)) / rows, 270);
      const cw = Math.min(wMax, hMax);            // no más ancha que alta
      const ch = Math.min(hMax, cw * 1.45);       // ni más alargada que 1.45
      const score = cw * ch;
      if (score > best.score) best = { cw, ch, cols, score };
    }
    setFit({ cw: Math.floor(best.cw), ch: Math.floor(best.ch), cols: best.cols, gap });
  };
  // Marca la página mientras se juega (en celulares se esconde la barra superior).
  // Va ANTES de medir, para que el cálculo use el espacio real.
  React.useLayoutEffect(() => { document.body.classList.add('mem-playing'); return () => document.body.classList.remove('mem-playing'); }, []);
  // El tablero se calcula una vez por nivel y queda fijo: no se mueve con el contenido
  // ni con la barra del navegador del celular; solo si cambia de verdad la pantalla.
  React.useLayoutEffect(fitBoard, [round]);
  useEffect(() => {
    const onResize = () => {
      const d = lastDims.current || { w: 0, h: 0 };
      if (Math.abs(window.innerWidth - d.w) > 2 || Math.abs(window.innerHeight - d.h) > 160) fitBoard();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  });
  const maxLevel = MEMORY_LEVELS.filter((n, i) => i === 0 || MEMORY_LEVELS[i - 1] < words.length).length;

  useEffect(() => { if (!start || end) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [start, end]);

  const newRound = (lv) => {
    setLevel(lv); setRound(buildMemoryRound(words, lv));
    setUp([]); setDone([]); setMiss([]); setTries(0); setLast(null); setStart(null); setEnd(null); lock.current = false;
  };
  const tap = (i) => {
    const c = round.cards[i];
    if (lock.current || end || done.includes(c.p) || up.includes(i)) return;
    if (!start) setStart(Date.now());
    if (c.k === 'han') { const h = round.words[c.p].hanzi; if (hasRealAudio(h)) speak(h); }
    const nu = [...up, i];
    setUp(nu);
    if (nu.length < 2) return;
    const t = tries + 1; setTries(t);
    const [a, b] = nu.map(j => round.cards[j]);
    if (a.p === b.p) {
      const nd = [...done, a.p];
      setDone(nd); setLast(a.p); setUp([]);
      playMatchChime();
      if (nd.length === pairs) {
        setTimeout(playLevelChime, 450);
        const fin = Date.now(); setEnd(fin); setNow(fin);
        const stars = memoryStars(t, pairs);
        onFinish && onFinish(Math.round(stars / 3 * 100), [], pairs);
      }
    } else {
      lock.current = true; setMiss(nu); playWrong();
      setTimeout(() => { setMiss([]); setUp([]); lock.current = false; }, 1000);
    }
  };

  const secs = Math.floor(((end || now) - (start || now)) / 1000);
  const time = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  const stars = end ? memoryStars(tries, pairs) : 0;
  const lw = last !== null ? round.words[last] : null;
  const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z';

  return html('main', { className: 'mem-main', style: { paddingTop: 12 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, '🃏 Memoria'),
      html('button', { className: 'back-btn', onClick: onHome, title: 'Ir al inicio' }, '⌂'),
    ),
    html('div', { className: 'mem-wrap' },
      html('div', { className: 'mem-hud' },
        html('span', { className: 'mem-pill level' }, 'Nivel ', html('b', null, level), ' / ' + maxLevel),
        html('span', { className: 'mem-pill' }, 'Parejas ', html('b', null, done.length + '/' + pairs)),
        html('span', { className: 'mem-pill' }, 'Intentos ', html('b', null, tries)),
        html('span', { className: 'mem-pill' }, '⏱ ', html('b', null, time)),
      ),
      html('div', { className: 'mem-stage', ref: stageRef }, html('div', { className: 'mem-board', style: fit
        ? { gridTemplateColumns: 'repeat(' + fit.cols + ', ' + fit.cw + 'px)', gap: fit.gap, '--cw': fit.cw + 'px', '--ch': fit.ch + 'px' }
        : { visibility: 'hidden' } },
        round.cards.map((c, i) => {
          const w = round.words[c.p];
          const isDone = done.includes(c.p), isUp = up.includes(i);
          const n = Math.min([...w.hanzi].length, 3);
          return html('button', { key: i, type: 'button', onClick: () => tap(i), disabled: isDone,
            className: 'mem-card' + (isUp || isDone ? ' up' : '') + (isDone ? ' done' : '') + (miss.includes(i) ? ' miss' : ''),
            'aria-label': isUp || isDone ? (c.k === 'han' ? w.hanzi : w.pinyin + ', ' + w.es) : 'Tarjeta ' + (i + 1) + ', boca abajo' },
            html('span', { className: 'mem-inner' },
              html('span', { className: 'mem-face mem-back' }, html('span', { className: 'mem-frame' },
                html('span', { className: 'mem-corner tl hanzi-font' }, '说'),
                html('span', { className: 'mem-medal hanzi-font' }, '说'),
                html('span', { className: 'mem-corner br hanzi-font' }, '说'))),
              html('span', { className: 'mem-face mem-front' }, html('span', { className: 'mem-frame' },
                c.k === 'han'
                  ? html('span', { className: 'mem-han hanzi-font n' + n }, w.hanzi)
                  : html(React.Fragment, null, html(TonedPinyin, { text: w.pinyin, className: 'mem-py' }), html('span', { className: 'mem-es' }, w.es))))));
        }))),
      html('div', { className: 'mem-learn' + (lw ? '' : ' empty'), ref: learnRef },
        lw ? html(React.Fragment, null, html('span', { className: 'hanzi-font mem-learn-h' }, lw.hanzi), html(TonedPinyin, { text: lw.pinyin, className: 'mem-learn-py' }), html('span', { className: 'mem-learn-es' }, lw.es))
          : 'Encontrá cada hanzi con su significado'),
    ),
    end && html('div', { className: 'mem-panel' },
      html('div', { className: 'mem-panel-box' },
        html('div', { className: 'mem-panel-title hanzi-font' }, stars === 3 ? '太好了！' : stars === 2 ? '很好！' : '不错！'),
        html('div', { className: 'mem-stars' }, [1, 2, 3].map(k => html('svg', { key: k, viewBox: '0 0 24 24', className: k <= stars ? 'on' : 'off' }, html('path', { d: STAR })))),
        html('p', null, 'Nivel ' + level + ' completado · ' + tries + ' intentos · ' + time),
        html('div', { className: 'result-actions' },
          level < maxLevel && html('button', { className: 'primary-btn', onClick: () => newRound(level + 1) }, 'Siguiente nivel'),
          html('button', { className: level < maxLevel ? 'secondary-btn' : 'primary-btn', onClick: () => newRound(level) }, 'Repetir nivel'),
          level >= maxLevel && html('button', { className: 'secondary-btn', onClick: onBack }, 'Volver a la lección'),
        ),
      ),
    ),
  );
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

// ═════════════════ HSK 1 y HSK 2 (preparación del examen) ═════════════════
// Módulo aparte: contenido en hsk<n>_words / hsk<n>_items y progreso en
// hsk<n>_card_state / hsk<n>_results. Lo ven el equipo docente y las clases
// con ese nivel habilitado. El mismo motor sirve para los dos niveles; cada
// nivel define sus 8 partes en npcr_app_config (hsk<n>_exam).

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

function HskScreen({ level, studentId, appConfig, examDate, onHome, preview }) {
  const lv = hskLevel(level, appConfig['hsk' + level + '_exam']);
  const T = 'hsk' + level;
  useEffect(() => stopAudio, []);   // al salir del HSK no sigue sonando nada
  const [words, setWords] = useState(null);
  const [wmAll, setWmAll] = useState({});
  const [bank, setBank] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ name: 'home' });   // home | study | extra | all | list | section | exam | numeros | preguntas | pares | cuaderno
  const [cardState, setCardState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('npcr-' + T + '-' + studentId)) || {}; } catch (e) { return {}; }
  });
  const dailyNew = Number(appConfig[T + '_daily_new']) || 10;

  useEffect(() => { try { localStorage.setItem('npcr-' + T + '-' + studentId, JSON.stringify(cardState)); } catch (e) {} }, [cardState]);
  useEffect(() => {
    Promise.all([
      db.from(T + '_words').select('id,hanzi,pinyin,es,audio,sentence,s_pinyin,s_es,s_audio,image').eq('hidden', false).order('id'),
      db.from(T + '_card_state').select('card_key,box,due_at,reviews,lapses,updated_at,first_seen').eq('student_id', studentId),
      db.from(T + '_items').select('kind,data').eq('hidden', false).order('id'),
      db.from(T + '_results').select('kind,score,total,listening,reading,detail,created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(300),
      // Los niveles anteriores también entran en el examen: sus palabras dan pinyin y audio a los ejercicios
      ...(lv ? lv.includes : []).map(t => db.from(t + '_words').select('id,hanzi,pinyin,es,audio,sentence,s_pinyin,s_es,s_audio,image').eq('hidden', false)),
    ]).then(([w, st, it, rs, ...prev]) => {
      if (w.error) { setError(w.error.message); setWords([]); return; }
      const norm = (rows) => (rows || []).map(r => ({ ...r, hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), sentence: nfc(r.sentence), _lesson: T }));
      const list = norm(w.data);
      const older = prev.flatMap(r => r.error ? [] : norm(r.data));
      [...older, ...list].forEach(r => {
        const k = r.hanzi.replace(MEDIA_PUNCT_RE, '');
        if (r.audio) EXTRA_AUDIO[k] = r.audio;
        if (r.s_audio) EXTRA_AUDIO[r.sentence.replace(MEDIA_PUNCT_RE, '')] = r.s_audio;
      });
      const all = {}; [...older, ...list].forEach(r => { all[r.hanzi] = r; });
      setWmAll(all);
      setWords(list);
      // Cada foto muestra la imagen de su palabra (la ruta viene de la base)
      const imgOf = {}; list.forEach(r => { if (r.image) imgOf[r.id] = r.image; });
      const b = { foto: [], escucha4: [], qa: [], leer4: [], par: [], juicio: [] };
      (it.data || []).forEach(r => { if (b[r.kind]) b[r.kind].push(r.kind === 'foto' ? { ...r.data, src: imgOf[r.data.img] } : r.data); });
      b.foto = b.foto.filter(f => f.src);
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

  const keyOf = (w) => cardKey(T, false, w.hanzi);
  const recordCard = (key, kind) => setCardState(prev => {
    const st = { ...srsNext(prev[key], kind, Date.now()), first_seen: (prev[key] && prev[key].first_seen) || new Date().toISOString() };
    const { first_seen, ...row } = st;
    db.from(T + '_card_state').upsert({ student_id: studentId, card_key: key, ...row }).then(() => {});
    return { ...prev, [key]: st };
  });
  // Guarda un resultado (práctica, simulacro, tarjetas) y lo suma a la lista local
  const pendingKey = 'npcr-' + T + '-pending-' + studentId;
  const [saveErr, setSaveErr] = useState(null);
  const readPending = () => { try { return JSON.parse(localStorage.getItem(pendingKey)) || []; } catch (e) { return []; } };
  const writePending = (list) => { try { localStorage.setItem(pendingKey, JSON.stringify(list)); } catch (e) {} };
  const sendResult = (row) => db.from(T + '_results').insert(row).then(({ error }) => {
    if (!error) return true;
    writePending([...readPending().filter(r => JSON.stringify(r) !== JSON.stringify(row)), row]);
    setSaveErr(error.message);
    return false;
  }, (e) => { writePending([...readPending(), row]); setSaveErr(String(e && e.message || e)); return false; });
  // Reintenta lo que no se pudo guardar antes (sin conexión, sesión vencida…)
  const flushPending = async () => {
    const list = readPending();
    if (!list.length) return;
    writePending([]);
    let ok = true;
    for (const row of list) ok = (await sendResult(row)) && ok;
    if (ok) setSaveErr(null);
  };
  useEffect(() => { flushPending(); }, []);
  const saveResult = (row) => {
    if (!row.total) return;
    const full = { listening: null, reading: null, detail: {}, ...row, created_at: new Date().toISOString() };
    setResults(prev => [full, ...prev]);
    sendResult(row);
  };

  const back = () => setView({ name: 'home' });
  if (!lv) return html(GameStatusScreen, { onBack: onHome, title: '🎓', msg: 'Falta la configuración del examen (' + T + '_exam en la configuración de la app).' });
  if (!words) return html('main', { style: { paddingTop: 18 } }, html('p', { className: 'admin-note', style: { textAlign: 'center' } }, 'Cargando ' + lv.name + '…'));
  if (error || !words.length) return html(GameStatusScreen, { onBack: onHome, title: '🎓 ' + lv.name, msg: error ? 'No se pudo cargar el ' + lv.name + ': ' + error : 'El ' + lv.name + ' todavía no está habilitado para tu clase.' });

  const wm = { ...wmAll }; words.forEach(w => { wm[w.hanzi] = w; });
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
    words, sentenceMode: false, lessonId: T, cardState, onRecordCard: recordCard,
    onBack: back, onHome: back, nextAction: null, savedResult: null, onSaveResult: () => {}, onClearResult: () => {},
    onFinish: (percent, reviewWords, total) => saveResult({ kind: 'tarjetas', score: Math.round(percent * total / 100), total,
      detail: { missed: (reviewWords || []).map(w => ({ t: w.hanzi, py: w.pinyin, es: w.es })) } }),
    deckBuilder, title, emptyTitle: '¡Listo por hoy!', emptySub, clozeFor,
  });
  const ctx = { bank, wm, lv, onBack: back, onSave: saveResult };

  if (view.name === 'study') return game('🎓 ' + lv.name + ' · Hoy', () => [...shuffle(byBox(due).slice(0, 40)), ...fresh.slice(0, newLeft)],
    'Ya hiciste el estudio de hoy. Mañana te esperan las palabras para repasar y ' + dailyNew + ' nuevas.');
  if (view.name === 'extra') return game('🎓 ' + lv.name + ' · Adelantar', () => fresh.slice(0, dailyNew), 'Ya viste las ' + words.length + ' palabras. ¡Ahora a repasar!');
  if (view.name === 'all') return game('🎓 ' + lv.name + ' · Repaso general', () => shuffle(seen), 'Todavía no estudiaste ninguna palabra.');
  if (view.name === 'errores') return game('🎓 ' + lv.name + ' · Mis errores', () => shuffle(view.words.filter(w => words.includes(w))), 'No hay palabras para repasar.');
  if (view.name === 'list') return html(Hsk1WordList, { words, cardState, keyOf, onBack: back });
  if (view.name === 'section') return html(HskSectionPractice, { ...ctx, kind: view.kind, key: view.kind + (view.n || 0), onAgain: () => setView({ name: 'section', kind: view.kind, n: (view.n || 0) + 1 }) });
  if (view.name === 'exam') return html(HskExam, { ...ctx, key: 'exam' + (view.n || 0), onAgain: () => setView({ name: 'exam', n: (view.n || 0) + 1 }) });
  if (view.name === 'numeros') return html(HskDrill, { ...ctx, kind: 'numeros', key: 'n' + (view.n || 0), onAgain: () => setView({ name: 'numeros', n: (view.n || 0) + 1 }) });
  if (view.name === 'preguntas') return html(HskDrill, { ...ctx, kind: 'preguntas', key: 'p' + (view.n || 0), onAgain: () => setView({ name: 'preguntas', n: (view.n || 0) + 1 }) });
  if (view.name === 'pares') return html(HskDrill, { ...ctx, kind: 'pares', key: 'c' + (view.n || 0), onAgain: () => setView({ name: 'pares', n: (view.n || 0) + 1 }) });
  if (view.name === 'cuaderno') return html(HskNotebook, { results, wm: Object.fromEntries(words.map(w => [w.hanzi, w])), onBack: back, onReview: (list) => setView({ name: 'errores', words: list }) });

  const pct = Math.round(seen.length / words.length * 100);
  const lastOf = (kind) => results.find(r => r.kind === kind);
  const sims = results.filter(r => r.kind === 'simulacro');
  const bestSim = sims.reduce((m, r) => Math.max(m, r.score), 0);
  const sectionCard = (k) => {
    const meta = lv.sections[k]; const last = lastOf(k);
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
      html('h1', null, '🎓 ' + lv.name),
    ),
    html('div', { className: 'hsk-wrap' },
      saveErr && html('div', { className: 'admin-status err', style: { marginBottom: 10 } },
        '⚠️ No se pudo guardar tu último resultado (' + saveErr + '). Quedó guardado en este dispositivo y se vuelve a enviar solo. ',
        html('button', { className: 'mini-btn', onClick: flushPending }, 'Reintentar ahora')),
      preview && html('p', { className: 'admin-note', style: { margin: '0 0 10px', textAlign: 'center' } },
        'Vista de profe: lo que hagas acá se guarda en tu cuenta y no aparece en el reporte de la clase.'),
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
        fresh.length === 0 ? '¡Ya viste las ' + words.length + ' palabras! Ahora repasá todos los días y hacé simulacros.'
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
          html(AulaIcon, { name: 'chart', tone: 'purple', size: 36 }), html('span', null, 'Las ' + words.length + ' palabras')),
      ),

      html('div', { className: 'hsk-block-title' }, 'Simulacro del examen'),
      html('button', { className: 'hsk-exam-card', onClick: () => setView({ name: 'exam' }) },
        html('div', { className: 'hsk-exam-seal hanzi-font' }, '考'),
        html('div', { style: { flex: 1, textAlign: 'left' } },
          html('div', { className: 'hsk-main-title' }, 'Simulacro completo'),
          html('div', { className: 'hsk-exam-sub' }, lv.examTotal + ' preguntas · con reloj · nota sobre 200 (se aprueba con 120)'),
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
        html('p', null, lv.about),
      ),
    ),
  );
}

// ── Las 8 partes del examen ──
const HSK_ORDER = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
// La estructura de cada nivel (partes, títulos, cantidad de preguntas, tiempos y textos)
// está en npcr_app_config, clave hsk<n>_exam. Acá solo queda el motor que arma los ejercicios.
function hskLevel(n, cfg) {
  if (!cfg || !cfg.sections || !cfg.count || !cfg.time_sec) return null;
  return { includes: [], logic: {}, ...cfg, n, t: 'hsk' + n, exam: cfg.count, time: cfg.time_sec, examTotal: cfg.total };
}
const hskImg = (f) => f.src;
const LETTERS = 'ABCDEF';

// Fotos de temas distintos (así ninguna foto "distractora" también es correcta)
function hskPickFotos(fotos, n, excludeScenes) {
  const used = new Set(excludeScenes || []); const out = [];
  for (const f of shuffle(fotos)) { if (used.has(f.scene)) continue; used.add(f.scene); out.push(f); if (out.length === n) break; }
  return out;
}
// Tipo de pregunta de una frase (para no ofrecer dos respuestas que sirvan)
function hskQGroup(q) {
  const keys = [['为什么', 'porque'], ['多长时间', 'duracion'], ['还是', 'eleccion'], ['几点', 'hora'], ['什么时候', 'hora'], ['星期几', 'dia'], ['几月', 'fecha'], ['几号', 'fecha'], ['多大', 'edad'], ['几岁', 'edad'],
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
function buildHskSection(kind, bank, wm, lv, count) {
  const n = count || 5;
  const fotos = bank.foto;
  kind = (lv && lv.logic[kind]) || kind;
  // Frase grabada del material para cada foto (la foto de esa palabra ilustra esa frase)
  const byId = {}; Object.values(wm).forEach(w => { byId[w.id] = w; });
  const voiced = fotos.filter(f => byId[f.img] && byId[f.img].s_audio && hasRealAudio(byId[f.img].sentence));
  const sent = (f) => { const w = byId[f.img]; return { t: w.sentence, py: w.s_pinyin, es: w.s_es }; };
  if (kind === 'L1frase') {
    return { type: 'single', items: hskPickFotos(voiced, n).map(f => {
      const truth = Math.random() < 0.5;
      const shown = truth ? f : hskPickFotos(voiced, 1, [f.scene])[0];
      return { q: 'tf', img: hskImg(f), say: sent(shown).t, answer: truth,
        reveal: { ...sent(shown), note: truth ? null : 'En la foto: ' + f.text + ' (' + f.es + ')' }, missed: sent(shown) };
    }) };
  }
  if (kind === 'juicio') {
    return { type: 'single', items: shuffle(bank.juicio).slice(0, n).map(it => ({
      q: 'tf', passage: { t: it.t, py: it.py }, stmt: { t: it.st, py: it.spy }, answer: it.ans,
      reveal: { t: '★ ' + it.st, py: it.spy, es: it.ses + (it.ans ? ' ✓' : ' ✗'), note: it.es }, missed: { t: it.t, py: it.py, es: it.es },
    })) };
  }
  if (kind === 'L1' || kind === 'R1') {
    return { type: 'single', items: hskPickFotos(fotos, n).map(f => {
      const truth = Math.random() < 0.5;
      const shown = truth ? f.word : hskPickFotos(fotos, 1, [f.scene])[0].word;
      const info = wordInfo(wm, shown);
      return { q: 'tf', img: hskImg(f), say: kind === 'L1' ? shown : null, show: kind === 'R1' ? info : null, answer: truth,
        reveal: { ...info, note: truth ? null : 'En la foto: ' + f.word + ' (' + wordInfo(wm, f.word).py + ') · ' + wordInfo(wm, f.word).es }, missed: info };
    }) };
  }
  if (kind === 'L2') {
    return { type: 'single', items: hskPickFotos(voiced, n).map(f => ({
      q: 'img', say: sent(f).t, options: shuffle([f, ...hskPickFotos(fotos, 2, [f.scene])]).map(o => ({ img: hskImg(o), ok: o === f })),
      reveal: sent(f), missed: sent(f),
    })) };
  }
  if (kind === 'L4') {
    const pool = Object.values(wm).filter(w => w.s_audio && hasRealAudio(w.sentence));
    return { type: 'single', items: shuffle(pool).slice(0, n).map(w => {
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
// Audios con pausas (repetición, encadenados): las esperas pendientes se cancelan con stopAudio()
let _audioTimers = [];
function audioLater(fn, ms) { const t = setTimeout(() => { _audioTimers = _audioTimers.filter(x => x !== t); fn(); }, ms); _audioTimers.push(t); }
// Corta TODO lo que esté sonando o por sonar (al pasar de pregunta o salir)
function stopAudio() {
  _speakToken++;
  _audioTimers.forEach(clearTimeout); _audioTimers = [];
  if (_npcrAudio) { _npcrAudio.pause(); _npcrAudio = null; }
}
// Encadena grabaciones de palabras sueltas (ej. 三 + 点) para números, horas y precios
function speakChain(tokens, onEnd) {
  stopAudio();
  const list = tokens.filter(hasRealAudio);
  const step = (k) => { if (k >= list.length) { onEnd && onEnd(); return; } speak(list[k], () => audioLater(() => step(k + 1), 60)); };
  step(0);
}
// Audio "como en el examen": suena dos veces
function speakTwice(text) { stopAudio(); speakReal(text, () => audioLater(() => speakReal(text), 900)); }

function HskSectionHead({ kind, lv, onBack, right, exam }) {
  const meta = lv.sections[kind];
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
  // Al pasar de pregunta (o salir) se corta el audio anterior, también la segunda repetición
  useEffect(() => {
    if (!it || !it.say) return stopAudio;
    audioLater(() => speakTwice(it.say), 300);
    return stopAudio;
  }, [i]);

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
      it.img && html('img', { className: 'hsk-tf-img', src: it.img, alt: '' }),
      it.passage && html('div', { className: 'hsk-passage' }, html(TonedPinyin, { text: it.passage.py, className: 'hsk-py' }), html('div', { className: 'hanzi-font' }, it.passage.t)),
      it.stmt && html('div', { className: 'hsk-stmt' }, html(TonedPinyin, { text: it.stmt.py, className: 'hsk-py' }), html('div', { className: 'hanzi-font' }, '★ ' + it.stmt.t)),
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
  useEffect(() => stopAudio, []);
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
const hskSectionSize = (sec) => sec ? (sec.type === 'single' ? sec.items.length : sec.left.length) : 0;
function HskSectionPractice({ kind, bank, wm, lv, onBack, onSave, onAgain }) {
  const [section] = useState(() => buildHskSection(kind, bank, wm, lv));
  const [res, setRes] = useState(null);
  const total = hskSectionSize(section);
  if (!total) return html(GameStatusScreen, { onBack, title: lv.sections[kind].title, msg: 'Falta contenido para esta parte.' });
  const done = (r) => { setRes(r); onSave({ kind, score: r.ok, total, detail: { missed: r.missed } }); };
  if (res) return html(HskResult, { title: lv.sections[kind].title, ok: res.ok, total, missed: res.missed, onAgain, onBack });
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html(HskSectionHead, { kind, lv, onBack }),
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
function HskExam({ bank, wm, lv, onBack, onSave, onAgain }) {
  const HSK_TIME = lv.time;
  const [sections] = useState(() => { const o = {}; HSK_ORDER.forEach(k => { o[k] = buildHskSection(k, bank, wm, lv, lv.exam[k]); }); return o; });
  const size = (k) => hskSectionSize(sections[k]);
  const nL = ['L1', 'L2', 'L3', 'L4'].reduce((s, k) => s + size(k), 0);
  const nR = ['R1', 'R2', 'R3', 'R4'].reduce((s, k) => s + size(k), 0);
  // Cada fase vale 100 puntos (como en el examen real)
  const pts = (all, keys, n) => n ? Math.round(keys.reduce((s, k) => s + ((all[k] || {}).ok || 0), 0) * 100 / n) : 0;
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
    const L = pts(all, ['L1', 'L2', 'L3', 'L4'], nL);
    const R = pts(all, ['R1', 'R2', 'R3', 'R4'], nR);
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
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, '考 Simulacro ' + lv.name)),
    html('div', { className: 'hsk-wrap' },
      html('div', { className: 'hsk-exam-info' },
        html('p', null, html('b', null, '听力 Comprensión auditiva'), ' · ' + lv.intro[0]),
        html('p', null, html('b', null, '阅读 Lectura'), ' · ' + lv.intro[1]),
        html('p', null, 'No hay corrección hasta el final y no se puede volver atrás. Comprensión auditiva y lectura valen 100 puntos cada una: 200 en total, se aprueba con 120.'),
        html('p', { style: { color: 'var(--ink-soft)' } }, 'Buscá un lugar tranquilo y usá auriculares.'),
      ),
      html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 14 }, onClick: () => { setStage('run'); setLeft(HSK_TIME.L); } }, 'Empezar'),
    ));

  if (stage === 'result') {
    const L = pts(scores, ['L1', 'L2', 'L3', 'L4'], nL);
    const R = pts(scores, ['R1', 'R2', 'R3', 'R4'], nR);
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
          const ok = (scores[k] || {}).ok || 0; const p = size(k) ? ok / size(k) : 0;
          return html('div', { key: k, className: 'hsk-sec static' },
            html('span', { className: 'hsk-sec-tag ' + (k[0] === 'L' ? 'listen' : 'read') }, lv.sections[k].short),
            html('span', { className: 'hsk-sec-title' }, lv.sections[k].title),
            html('span', { className: 'hsk-sec-pct ' + (p >= 0.8 ? 'ok' : p >= 0.6 ? 'mid' : 'low') }, ok + '/' + size(k)));
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
    html(HskSectionHead, { kind, lv, exam: true, right: html('div', { className: 'hsk-timer' + (left <= 60 ? ' low' : '') }, '⏱ ' + mm) }),
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

function HskDrill({ kind, bank, wm, lv, onBack, onSave, onAgain }) {
  const TITLES = { numeros: 'Números, horas y precios', preguntas: 'Palabras para preguntar', pares: 'Palabras que se confunden' };
  const INSTR = { numeros: 'Escuchá y elegí lo que oíste. Ojo con 四 sì (4) y 十 shí (10).', preguntas: 'Leé la pregunta y elegí la respuesta que tiene sentido.', pares: 'Elegí la palabra que va en el hueco.' };
  const [qs] = useState(() => {
    if (kind === 'numeros') return Array.from({ length: 10 }, buildNumberQ);
    if (kind === 'preguntas') return shuffle(bank.qa).slice(0, 10).map(it => {
      const others = hskPickDistinct(bank.qa.filter(x => hskQGroup(x.q) !== hskQGroup(it.q)), 2, x => hskQGroup(x.q));
      return { zh: it.q, py: it.qpy, es: it.es, options: shuffle([it, ...others]).map(x => ({ h: x.a, py: x.apy, ok: x === it })) };
    });
    return shuffle(bank.par).slice(0, 10).map(it => ({ zh: it.s, py: it.py, es: it.es, tip: it.tip, full: it.s.replace('＿', it.ans), options: it.opts.map((o, k) => ({ h: o, py: (it.opy && it.opy[k]) || wordInfo(wm, o).py, ok: o === it.ans })) }));
  });
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [ok, setOk] = useState(0);
  const [missed, setMissed] = useState([]);
  const [done, setDone] = useState(false);
  const q = qs[i];
  const listen = kind === 'numeros';
  useEffect(() => {
    if (done || !listen) return stopAudio;
    audioLater(() => speakChain(q.tokens), 300);
    return stopAudio;
  }, [i, done]);

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
      html('h1', null, 'Las ' + words.length + ' palabras'),
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

// Reporte HSK de la clase (para el profe)
function HskClassReport({ classId, level, isSel, onSelect }) {
  const T = 'hsk' + level;
  const [lv, setLv] = useState(null);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [nWords, setNWords] = useState(null);
  useEffect(() => {
    setRows(null);
    db.rpc(T + '_class_report', { p_class: classId }).then(({ data, error }) => { if (error) setErr(error.message); setRows(data || []); });
    db.from(T + '_words').select('id', { count: 'exact', head: true }).eq('hidden', false).then(({ count }) => setNWords(count || null));
    db.from('npcr_app_config').select('value').eq('key', T + '_exam').maybeSingle().then(({ data }) => {
      const l = hskLevel(level, data && data.value);
      if (l) setLv(l); else setErr('Falta la configuración ' + T + '_exam');
    });
  }, [classId]);
  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err + ' (¿ejecutaste npcr_' + T + '.sql?)');
  if (!rows || !lv) return html('p', { className: 'admin-note' }, 'Cargando…');
  const active = rows.filter(r => r.user_id);
  const withSim = active.filter(r => r.last_sim !== null);
  const passing = withSim.filter(r => r.last_sim >= 120).length;
  const cell = (v) => v === undefined || v === null ? html('td', { className: 'hsk-cell none' }, '—')
    : html('td', { className: 'hsk-cell ' + (v >= 80 ? 'ok' : v >= 60 ? 'mid' : 'low') }, v + '%');
  const cellL = (k, v) => { const c = cell(v); return React.cloneElement(c, { 'data-l': lv.sections[k].short }); };
  return html('div', null,
    html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🎓 Preparación ' + lv.name),
      html('p', { className: 'admin-note', style: { margin: 0 } },
        withSim.length ? passing + ' de ' + withSim.length + ' alumnos aprobarían según su último simulacro (120/200).' : 'Todavía nadie hizo un simulacro.'),
    ),
    html(ScrollX, { arrows: 'top' },
      html('table', { className: 'rank-table hsk-report cardify' },
        html('thead', null, html('tr', null,
          html('th', null, 'Alumno'), html('th', null, 'Palabras'), html('th', null, 'Último simulacro'), html('th', null, 'Mejor'),
          HSK_ORDER.map(k => html('th', { key: k, title: lv.sections[k].title + ' · ' + lv.sections[k].sub }, lv.sections[k].short)), html('th', null, 'Prácticas'))),
        html('tbody', null, rows.map((r, k) => html('tr', { key: k, style: r.user_id ? null : { opacity: 0.45 },
            className: isSel && isSel(r) ? 'sel-row' : '', onClick: onSelect ? () => onSelect(r) : undefined },
          html('td', { className: 'cell-name', style: { fontWeight: 700 } }, r.display_name),
          html('td', { 'data-l': 'Palabras' }, r.words_seen + (nWords ? '/' + nWords : ''), html('div', { style: { fontSize: 11, color: 'var(--ink-soft)' } }, r.words_learned + ' aprendidas')),
          html('td', { 'data-l': 'Último simulacro' }, r.last_sim === null ? '—' : html('span', { className: 'hsk-sim ' + (r.last_sim >= 120 ? 'pass' : 'fail') }, r.last_sim),
            r.last_sim !== null && html('div', { style: { fontSize: 11, color: 'var(--ink-soft)' } }, 'E ' + (r.last_listening || 0) + ' · L ' + (r.last_reading || 0))),
          html('td', { 'data-l': 'Mejor' }, r.best_sim === null ? '—' : r.best_sim),
          HSK_ORDER.map(k => html(React.Fragment, { key: k }, cellL(k, (r.sections || {})[k]))),
          html('td', { 'data-l': 'Prácticas' }, r.practices)))),
      )),
  );
}

// ═════════════════ Bingo de hanzi 宾果 (juego en vivo de la clase) ═════════════════
// Partida en bingo_games, cartones en bingo_cards; todo se valida en el servidor
// (npcr_bingo.sql). Tiempo real con Supabase Realtime + consulta periódica de respaldo.
function useLiveRefresh(table, filter, refresh, everyMs) {
  useEffect(() => {
    if (!filter) return;
    refresh();
    const t = setInterval(refresh, everyMs);
    let ch = null;
    if (db.channel) {
      try {
        ch = db.channel('live-' + table + '-' + filter + '-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => refresh())
          .subscribe();
      } catch (e) { ch = null; }
    }
    return () => { clearInterval(t); if (ch && db.removeChannel) db.removeChannel(ch); };
  }, [filter]);
}
const bingoItem = (game, h) => (game.pool || []).find(x => x.h === h) || { h, p: '', e: '' };
function bingoLines(n) {
  const L = [];
  for (let i = 0; i < n; i++) { L.push([...Array(n)].map((_, j) => i * n + j)); L.push([...Array(n)].map((_, j) => j * n + i)); }
  L.push([...Array(n)].map((_, j) => j * n + j)); L.push([...Array(n)].map((_, j) => j * n + (n - 1 - j)));
  return L;
}
const MEDALS = ['🥇', '🥈', '🥉'];
const bingoHasAudio = (game, h) => game && game.mode === 'numeros' ? [...h].every(hasRealAudio) : hasRealAudio(h);
// Números: suena solo si están TODAS las grabaciones de sus dígitos (nunca un número a medias)
const bingoSay = (game, h) => { if (!bingoHasAudio(game, h)) return; if (game && game.mode === 'numeros') speakChain([...h]); else speak(h); };
// Grabaciones originales de 一…十 (material HSK 1) para decir los números
let _digitAudioLoaded = false;
function loadDigitAudio() {
  if (_digitAudioLoaded) return;
  _digitAudioLoaded = true;
  db.from('hsk1_words').select('hanzi,audio').in('hanzi', ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '零'])
    .then(({ data }) => (data || []).forEach(r => { if (r.audio && !NPCR_MEDIA.audio[r.hanzi]) EXTRA_AUDIO[r.hanzi] = r.audio; }));
}

const PRIZE_NAMES = { terno: 'Terno', linea: 'Línea', bingo: '¡Bingo!' };
// Premios que se festejan con un aviso grande en todas las pantallas
const PRIZE_POPUP = ['linea', 'bingo'];
// Cola de avisos grandes: se muestran de a uno y cada uno se cierra solo a los pocos segundos
function usePrizePopups() {
  const [queue, setQueue] = useState([]);
  const [sec, setSec] = useState(null);
  useEffect(() => {
    db.from('npcr_app_config').select('value').eq('key', 'bingo_prize_sec').maybeSingle()
      .then(({ data }) => setSec(Number(data && data.value) || null));
  }, []);
  const current = queue[0] || null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue(q => q.slice(1)), (sec || 4) * 1000);
    return () => clearTimeout(t);
  }, [current && current.id]);
  const push = (items) => items.length && setQueue(q => [...q, ...items]);
  const close = () => setQueue(q => q.slice(1));
  return { current, push, close, sec: sec || 4 };
}
function BingoPrizePopup({ prize, mine, sec, onClose }) {
  if (!prize) return null;
  const big = (prize.kind || 'bingo') === 'bingo';
  return html('div', { key: prize.id, className: 'bingo-prize-overlay', onClick: onClose, style: { '--sec': sec + 's' } },
    html('div', { className: 'bingo-prize-card' + (big ? ' big' : '') },
      html('div', { className: 'bingo-confetti' }, ['🎉', '✨', '🎊', '⭐', '🎉', '✨', '🎊', '⭐'].map((c, i) => html('span', { key: i, style: { '--i': i } }, c))),
      html('div', { className: 'bingo-prize-icon' }, big ? '🏆' : '🎉'),
      html('div', { className: 'bingo-prize-kind' }, PRIZE_NAMES[prize.kind || 'bingo']),
      html('div', { className: 'bingo-prize-who' }, mine ? '¡Lo cantaste vos!' : html(React.Fragment, null, html('b', null, prize.name), ' cantó ' + PRIZE_NAMES[prize.kind || 'bingo'])),
      html('div', { className: 'bingo-prize-pts' }, '+' + (prize.points || 0) + ' puntos'),
      html('i', { className: 'bingo-prize-bar' })));
}
// Puntos por jugador sumando sus premios (los calcula y guarda el servidor)
function bingoScores(winners) {
  const by = {};
  (winners || []).forEach(w => {
    const e = by[w.user_id] || (by[w.user_id] = { user_id: w.user_id, name: w.name, points: 0, prizes: [] });
    e.points += Number(w.points) || 0; e.prizes.push(w.kind || 'bingo');
  });
  return Object.values(by).sort((a, b) => b.points - a.points);
}
function BingoWinners({ winners, me }) {
  const ranking = bingoScores(winners);
  if (!ranking.length) return null;
  return html('div', { className: 'bingo-winners' },
    ranking.map((r, k) => html('div', { key: r.user_id, className: 'bingo-winner' + (r.user_id === me ? ' me' : '') },
      html('span', { className: 'bingo-rank' }, MEDALS[k] || (k + 1) + '°'),
      html('span', { className: 'bingo-wname' }, r.name),
      html('span', { className: 'bingo-badges' }, ['terno', 'linea', 'bingo'].filter(x => r.prizes.includes(x)).map(x => html('span', { key: x, className: 'bingo-badge ' + x }, PRIZE_NAMES[x]))),
      html('span', { className: 'bingo-pts' }, r.points + ' pts'))));
}
// Último premio cantado (aviso en pantalla)
function BingoLastPrize({ winners }) {
  const w = (winners || [])[(winners || []).length - 1];
  if (!w) return null;
  return html('div', { className: 'bingo-lastprize' }, '🎉 ', html('b', null, w.name), ' cantó ', html('b', null, PRIZE_NAMES[w.kind || 'bingo']),
    ' · +' + (w.points || 0) + ' pts');
}

// Lista de jugadores con su estado: 🟢 conectado · ⚪ salió (hace cuánto)
function BingoPlayerList({ players, compact }) {
  if (!players.length) return html('div', { className: 'bingo-sub' }, 'Todavía no se unió nadie');
  const ago = (s) => s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h';
  return html('div', { className: 'bingo-plist' + (compact ? ' compact' : '') }, players.map(p => html('div', { key: p.student_id, className: 'bingo-prow' + (p.online === false ? ' away' : '') },
    html('span', { className: 'bingo-dot' + (p.online === false ? ' off' : '') }),
    html('span', { className: 'bingo-pname' }, p.name),
    html('span', { className: 'bingo-pinfo' }, p.online === false ? 'salió ' + ago(p.seconds_away || 0) : (p.marked || 0) + ' marcada' + (p.marked === 1 ? '' : 's')))));
}

// ── Historial de partidas terminadas de la clase ──
function BingoHistory({ classId, refreshKey }) {
  const [games, setGames] = useState(null);
  const [open, setOpen] = useState(null);
  const [players, setPlayers] = useState({});
  useEffect(() => {
    db.from('bingo_games').select('*').eq('class_id', classId).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setGames((data || []).filter(g => g.status === 'finished').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))));
  }, [classId, refreshKey]);
  const toggle = (g) => {
    setOpen(open === g.id ? null : g.id);
    if (!players[g.id]) db.rpc('bingo_players', { p_game: g.id }).then(({ data }) => setPlayers(p => ({ ...p, [g.id]: data || [] })));
  };
  if (!games || !games.length) return null;
  const when = (iso) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return html('div', { className: 'report-card' },
    html('div', { className: 'report-h' }, '📜 Partidas anteriores'),
    games.map(g => {
      const isOpen = open === g.id;
      const ranking = bingoScores(g.winners);
      const ps = players[g.id];
      return html('div', { key: g.id, className: 'bingo-hist' + (isOpen ? ' open' : '') },
        html('button', { className: 'bingo-hist-head', onClick: () => toggle(g) },
          html('span', { className: 'bingo-hist-date' }, when(g.created_at)),
          html('span', { className: 'bingo-hist-meta' }, (g.mode === 'numeros' ? 'Números' : 'Hanzi' + ((g.lessons || []).length ? ' · L' + (g.lessons || []).slice().sort(lessonCompare).join(', L') : ''))
            + ' · ' + g.size + '×' + g.size + ' · ' + (g.called || []).length + ' fichas'),
          html('span', { className: 'bingo-hist-win' }, ranking.length ? '🥇 ' + ranking[0].name + ' · ' + ranking[0].points + ' pts' : 'Sin premios'),
          html('span', { className: 'bingo-hist-arrow' }, isOpen ? '▲' : '▼')),
        isOpen && html('div', { className: 'bingo-hist-body' },
          html('div', { className: 'bingo-hist-sec' }, '🏆 Puntos finales'),
          ranking.length ? html(BingoWinners, { winners: g.winners }) : html('div', { className: 'bingo-sub' }, 'Nadie cantó premios.'),
          (g.winners || []).length > 0 && html(React.Fragment, null,
            html('div', { className: 'bingo-hist-sec' }, '🎉 Premios en orden'),
            (g.winners || []).map((w, k) => html('div', { key: k, className: 'bingo-hist-prize' },
              html('b', null, w.name), ' · ' + PRIZE_NAMES[w.kind || 'bingo'] + ' · +' + (w.points || 0) + ' pts',
              w.at && html('span', { className: 'bingo-sub' }, ' · ' + new Date(w.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }))))),
          html('div', { className: 'bingo-hist-sec' }, '👥 Jugaron' + (ps ? ' (' + ps.length + ')' : '')),
          html('div', { className: 'bingo-sub' }, ps ? (ps.length ? ps.map(p => p.name).join(', ') : 'Nadie se unió') : 'Cargando…'),
          html('div', { className: 'bingo-hist-sec' }, '🎱 Fichas en el orden en que salieron'),
          html('div', { className: 'bingo-called' }, (g.called || []).map((h, k) => {
            const it = bingoItem(g, h);
            return html('span', { key: k, className: 'bingo-chip hanzi-font', title: (it.p || '') + ' · ' + (it.e || '') },
              html('small', null, (k + 1) + '. '), g.mode === 'numeros' ? it.e + ' ' + h : h);
          }))));
    }));
}

// ── Pantalla del lǎoshī: crear, sala de espera, cantar fichas ──
function BingoHost({ classId, className, lessons, maxLesson }) {
  const [game, setGame] = useState(undefined);   // undefined = cargando, null = no hay partida activa
  const [players, setPlayers] = useState([]);
  const [pick, setPick] = useState(() => lessons.filter(l => !isNaN(parseFloat(l)) && (!maxLesson || parseFloat(l) <= maxLesson)));
  const [size, setSize] = useState(4);
  const [mode, setMode] = useState('hanzi');
  const [maxNum, setMaxNum] = useState(50);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const readReveal = () => { try { return localStorage.getItem('npcr-bingo-reveal') !== '0'; } catch (e) { return true; } };
  const [reveal, setRevealState] = useState(readReveal);
  const setReveal = (v) => { setRevealState(v); try { localStorage.setItem('npcr-bingo-reveal', v ? '1' : '0'); } catch (e) {} };
  const boxRef = React.useRef(null);
  const lastCalled = React.useRef(null);
  // Avisos de premios cantados (terno, línea, bingo) para quien dirige
  const [toasts, setToasts] = useState([]);
  const seenPrizes = React.useRef({ game: null, count: 0 });
  const popups = usePrizePopups();

  const loadGame = () => db.from('bingo_games').select('*').eq('class_id', classId).order('created_at', { ascending: false }).limit(5)
    .then(({ data, error }) => {
      if (error) { setErr(error.message + (/relation|does not exist/.test(error.message) ? ' — ¿ejecutaste npcr_bingo.sql?' : '')); setGame(null); return; }
      const g = (data || []).find(x => x.status !== 'finished') || (data || [])[0] || null;
      setGame(g);
    });
  const loadPlayers = (gid) => db.rpc('bingo_players', { p_game: gid }).then(({ data, error }) => {
    if (!error) { setPlayers(data || []); return; }
    // Sin la versión nueva del SQL: lista simple (sin estado de conexión)
    db.from('bingo_cards').select('student_id,name,marks,joined_at').eq('game_id', gid)
      .then(({ data: d }) => setPlayers((d || []).map(c => ({ ...c, marked: (c.marks || []).length, online: null }))));
  });
  useLiveRefresh('bingo_games', 'class_id=eq.' + classId, loadGame, 5000);
  const gid = game && game.status !== 'finished' ? game.id : null;
  useLiveRefresh('bingo_cards', gid ? 'game_id=eq.' + gid : null, () => gid && loadPlayers(gid), 4000);

  // Al salir una ficha nueva: suena el audio original (si existe) y se oculta el hanzi
  const called = (game && game.called) || [];
  const current = called.length ? bingoItem(game, called[called.length - 1]) : null;
  // Solo suena una ficha NUEVA de la partida en curso: al abrir la pestaña (o con una
  // partida ya terminada) no se repite la última ficha.
  useEffect(() => {
    if (!game) return;
    const prev = lastCalled.current;
    lastCalled.current = { id: game.id, n: called.length };
    if (!prev || prev.id !== game.id || called.length <= prev.n || game.status === 'finished' || !current) return;
    bingoSay(game, current.h);
  }, [game && game.id, called.length]);
  useEffect(() => { if (game && game.mode === 'numeros') loadDigitAudio(); }, [game && game.mode]);
  const prizeCount = game && game.winners ? game.winners.length : 0;
  useEffect(() => {
    if (!game) return;
    const seen = seenPrizes.current;
    if (seen.game !== game.id) { seenPrizes.current = { game: game.id, count: prizeCount }; return; }   // al abrir: no repetir avisos viejos
    if (prizeCount > seen.count) {
      const nuevos = game.winners.slice(seen.count).map((w, k) => ({ ...w, id: game.id + ':' + (seen.count + k) }));
      seen.count = prizeCount;
      playLevelChime();
      popups.push(nuevos.filter(t => PRIZE_POPUP.includes(t.kind || 'bingo')));
      const chicos = nuevos.filter(t => !PRIZE_POPUP.includes(t.kind || 'bingo'));
      setToasts(ts => [...ts, ...chicos]);
      chicos.forEach(t => setTimeout(() => setToasts(ts => ts.filter(x => x.id !== t.id)), 9000));
    }
  }, [game && game.id, prizeCount]);

  const run = async (fn, args) => {
    setBusy(true); setErr(null);
    const { data, error } = await db.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return null; }
    loadGame();
    return data;
  };
  const [showHanzi, setShowHanzi] = useState(false);
  const [hintSent, setHintSent] = useState(false);
  const create = async () => {
    const id = await run('bingo_create', { p_class: classId, p_lessons: mode === 'hanzi' ? pick : [], p_size: size, p_mode: mode, p_max: maxNum });
    if (id && showHanzi) run('bingo_set_show', { p_game: id, p_on: true });
  };
  const sendHint = async () => {
    const h = await run('bingo_hint', { p_game: game.id });
    if (h) { setHintSent(true); setTimeout(() => setHintSent(false), 2500); }
  };
  const toggleLesson = (l) => setPick(p => p.includes(l) ? p.filter(x => x !== l) : [...p, l].sort(lessonCompare));
  const fullscreen = () => { const el = boxRef.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); };

  if (game === undefined) return html('p', { className: 'admin-note' }, 'Cargando…');
  const active = game && game.status !== 'finished';

  if (!active) return html('div', null,
    err && html('div', { className: 'admin-status err', style: { marginBottom: 10 } }, '❌ ' + err),

    html('div', { className: 'report-card' },
      html('div', { className: 'report-h' }, '🎱 Nueva partida de Bingo 宾果'),
      html('p', { className: 'admin-note', style: { marginTop: 0 } }, 'Cada alumno recibe un cartón distinto. Vos sacás las fichas y ellos las buscan en su cartón. Se unen desde "Mi aula".'),
      html('p', { className: 'admin-note' }, 'Premios (uno de cada uno por partida, para el primero que lo canta bien): Terno · 3 seguidas · 10 pts — Línea · fila, columna o diagonal · 20 pts — ¡Bingo! · cartón lleno · 50 pts. Con el Bingo termina la partida.'),
      html('div', { className: 'admin-note', style: { fontWeight: 800, marginBottom: 6 } }, 'Jugar con'),
      html('div', { className: 'bingo-lessons' },
        [['hanzi', '汉字 Hanzi de las lecciones'], ['numeros', '一二三 Números en chino']].map(([m, t]) => html('button', { key: m, type: 'button',
          className: 'mode-check' + (mode === m ? ' on' : ''), onClick: () => setMode(m) }, t))),
      mode === 'hanzi' ? html(React.Fragment, null,
        html('div', { className: 'admin-note', style: { fontWeight: 800, margin: '12px 0 6px', display: 'flex', alignItems: 'center', gap: 8 } }, 'Lecciones',
          html('button', { type: 'button', className: 'mini-btn', onClick: () => setPick(lessons.filter(l => !isNaN(parseFloat(l))).sort(lessonCompare)) }, 'Todas'),
          html('button', { type: 'button', className: 'mini-btn', onClick: () => setPick([]) }, 'Ninguna')),
        html('div', { className: 'bingo-lessons' }, lessons.filter(l => !isNaN(parseFloat(l))).map(l => html('button', { key: l, type: 'button',
          className: 'mode-check' + (pick.includes(l) ? ' on' : ''), onClick: () => toggleLesson(l) }, 'L' + l))))
      : html(React.Fragment, null,
        html('div', { className: 'admin-note', style: { fontWeight: 800, margin: '12px 0 6px' } }, 'Números'),
        html('div', { className: 'bingo-lessons' }, [30, 50, 99].map(n => html('button', { key: n, type: 'button',
          className: 'mode-check' + (maxNum === n ? ' on' : ''), onClick: () => setMaxNum(n) }, 'Del 1 al ' + n))),
        html('p', { className: 'admin-note' }, 'Vos ves el número en cifras (27) y suena en chino; los alumnos buscan 二十七 en su cartón.')),
      html('div', { className: 'admin-note', style: { fontWeight: 800, margin: '12px 0 6px' } }, 'Cartón'),
      html('div', { className: 'bingo-lessons' },
        [[3, '3 × 3 · rápido'], [4, '4 × 4 · clásico']].map(([n, t]) => html('button', { key: n, type: 'button', className: 'mode-check' + (size === n ? ' on' : ''), onClick: () => setSize(n) }, t))),
      html('div', { className: 'admin-note', style: { fontWeight: 800, margin: '12px 0 6px' } }, 'Ayuda para los alumnos'),
      html('label', { className: 'mode-check' + (showHanzi ? ' on' : ''), style: { display: 'inline-flex', gap: 8, alignItems: 'center' } },
        html('input', { type: 'checkbox', checked: showHanzi, onChange: e => setShowHanzi(e.target.checked) }),
        mode === 'numeros' ? 'Mostrarles el número en chino de cada ficha' : 'Mostrarles el hanzi de cada ficha (además del pinyin y el significado)'),
      html('p', { className: 'admin-note', style: { margin: '6px 0 0' } }, 'Si no lo activás, durante el juego tenés el botón 💡 Pista para mostrarlo unos segundos. También se puede cambiar en plena partida.'),
      html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 14 }, disabled: busy || (mode === 'hanzi' && !pick.length), onClick: create }, busy ? 'Creando…' : 'Crear partida'),
    ),
    html(BingoHistory, { classId, refreshKey: game ? game.id + game.status : '' }));

  const winners = game.winners || [];
  return html('div', { ref: boxRef, className: 'bingo-host' },
    html(BingoPrizePopup, { prize: popups.current, sec: popups.sec, onClose: popups.close }),
    toasts.length > 0 && html('div', { className: 'bingo-toasts' }, toasts.map(t => html('div', { key: t.id, className: 'bingo-toast ' + (t.kind || 'bingo') },
      html('span', { className: 'bingo-toast-icon' }, t.kind === 'bingo' ? '🏆' : '🎉'),
      html('span', { className: 'bingo-toast-txt' }, html('b', null, t.name), ' cantó ', html('b', null, PRIZE_NAMES[t.kind || 'bingo']),
        html('small', null, '+' + (t.points || 0) + ' pts')),
      html('button', { className: 'bingo-toast-x', onClick: () => setToasts(ts => ts.filter(x => x.id !== t.id)), title: 'Cerrar' }, '✕')))),
    err && html('div', { className: 'admin-status err', style: { marginBottom: 10 } }, '❌ ' + err),
    html('div', { className: 'bingo-host-head' },
      html('div', null,
        html('div', { className: 'bingo-title' }, '🎱 Bingo 宾果 · ' + className),
        html('div', { className: 'bingo-sub' }, (game.mode === 'numeros' ? 'Números en chino · ' : 'Hanzi · ') + (game.status === 'lobby' ? 'Sala de espera' : 'Ficha ' + called.length + ' de ' + game.pool.length + ' · cartón ' + game.size + '×' + game.size))),
      html('div', { style: { display: 'flex', gap: 6 } },
        html('button', { className: 'mini-btn', onClick: fullscreen }, '⛶ Pantalla grande'),
        html('button', { className: 'mini-btn', onClick: async () => { if (await appConfirm('¿Terminar la partida?')) run('bingo_end', { p_game: game.id }); } }, 'Terminar'))),

    game.status === 'lobby' && html('div', { className: 'bingo-lobby' },
      html('div', { className: 'bingo-big-n' }, players.filter(p => p.online !== false).length),
      html('div', { className: 'bingo-sub' }, players.filter(p => p.online !== false).length === 1 ? 'alumno conectado' : 'alumnos conectados'),
      html(BingoPlayerList, { players }),
      html('p', { className: 'admin-note' }, 'Los alumnos entran desde "Mi aula" → 🎱 Unirme al Bingo.'),
      html('button', { className: 'primary-btn', style: { minWidth: 220 }, disabled: busy, onClick: () => run('bingo_start', { p_game: game.id }) }, '▶ Empezar')),

    game.status === 'playing' && html('div', { className: 'bingo-stage' },
      html('div', { className: 'bingo-call' },
        current ? html(React.Fragment, null,
          html('div', { className: 'bingo-call-n' }, 'Ficha ' + called.length),
          game.mode === 'numeros' && html('div', { className: 'bingo-call-num' }, current.e),
          html('div', { className: 'bingo-call-h hanzi-font' + (reveal ? '' : ' hidden') + (game.mode === 'numeros' ? ' small' : '') }, reveal ? current.h : '？'),
          html(TonedPinyin, { text: current.p, className: 'bingo-call-py' }),
          game.mode !== 'numeros' && html('div', { className: 'bingo-call-es' }, current.e),
          html('div', { className: 'bingo-call-btns' },
            bingoHasAudio(game, current.h) && html('button', { className: 'mini-btn', onClick: () => bingoSay(game, current.h) }, '🔊 Repetir'),
            html('button', { className: 'mini-btn', onClick: () => setReveal(!reveal) }, reveal ? 'Ocultar hanzi (para proyectar)' : 'Mostrar hanzi'),
            !game.show_hanzi && html('button', { className: 'mini-btn bingo-hint-btn', disabled: busy, onClick: sendHint, title: 'Muestra esta ficha en grande en las pantallas de los alumnos por unos segundos' },
              hintSent ? '✓ Pista enviada' : '💡 Pista: mostrar ' + (game.mode === 'numeros' ? 'el número en chino' : 'el hanzi')),
            html('button', { className: 'mini-btn', disabled: busy, onClick: () => run('bingo_set_show', { p_game: game.id, p_on: !game.show_hanzi }) },
              game.show_hanzi ? '👁 Alumnos ven el hanzi · ocultar' : '👁 Que los alumnos vean el hanzi')))
          : html('div', { className: 'bingo-sub', style: { padding: 30 } }, 'Sacá la primera ficha'),
        html('button', { className: 'primary-btn bingo-next', disabled: busy || called.length >= game.pool.length, onClick: () => run('bingo_call', { p_game: game.id }) },
          called.length >= game.pool.length ? 'Ya salieron todas' : busy ? '…' : 'Sacar ficha →')),
      html('div', { className: 'bingo-side' },
        html('div', { className: 'report-h' }, '🏆 Puntos'),
        html(BingoLastPrize, { winners }),
        winners.length ? html(BingoWinners, { winners }) : html('div', { className: 'bingo-sub' }, 'Todavía nadie cantó terno, línea ni bingo'),
        html('div', { className: 'report-h', style: { marginTop: 12 } }, '👥 Jugadores · ' + players.filter(p => p.online !== false).length + ' conectados de ' + players.length),
        html(BingoPlayerList, { players, compact: true }),
        html('div', { className: 'report-h', style: { marginTop: 12 } }, 'Ya salieron'),
        html('div', { className: 'bingo-called' }, called.slice(0, -1).reverse().map(h => html('span', { key: h, className: 'bingo-chip hanzi-font', title: bingoItem(game, h).p + ' · ' + bingoItem(game, h).e }, h))))),
  );
}

// ── Pantalla del alumno: cartón, marcar y cantar bingo ──
function BingoPlayer({ gameId, onBack }) {
  const [hint, setHint] = useState(null);           // { h, key } mientras se ve la pista
  const hintSeen = React.useRef(null);               // última pista ya mostrada (null = recién entró)
  const [hintSec, setHintSec] = useState(null);
  useEffect(() => {
    db.from('npcr_app_config').select('value').eq('key', 'bingo_hint_sec').maybeSingle()
      .then(({ data }) => setHintSec(Number(data && data.value) || null));
  }, []);
  const [game, setGame] = useState(null);
  const [card, setCard] = useState(null);
  const [marks, setMarks] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const lastWin = React.useRef(0);
  const popups = usePrizePopups();

  useEffect(() => {
    db.rpc('bingo_join', { p_game: gameId }).then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      const c = Array.isArray(data) ? data[0] : data;
      setCard(c); setMarks((c && c.marks) || []);
    });
  }, [gameId]);
  const loadGame = () => db.from('bingo_games').select('*').eq('id', gameId).maybeSingle()
    .then(({ data }) => { if (data) setGame(data); });
  // Señal de "sigo conectado" para que el lǎoshī vea quién está jugando
  useEffect(() => {
    const ping = (leaving) => db.rpc('bingo_ping', { p_game: gameId, p_leaving: !!leaving }).then(() => {});
    const t = setInterval(() => { if (!document.hidden) ping(false); }, 10000);
    const onVis = () => ping(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); ping(true); };
  }, [gameId]);
  useLiveRefresh('bingo_games', 'id=eq.' + gameId, loadGame, 3000);

  // Aviso cuando alguien canta bingo
  const winners = (game && game.winners) || [];
  const firstWinLoad = React.useRef(true);
  useEffect(() => {
    if (!game) return;
    if (firstWinLoad.current) { firstWinLoad.current = false; lastWin.current = winners.length; return; }   // al entrar no se repiten avisos viejos
    if (winners.length > lastWin.current) {
      const nuevos = winners.slice(lastWin.current).map((w, k) => ({ ...w, id: gameId + ':' + (lastWin.current + k) }));
      lastWin.current = winners.length;
      playLevelChime();
      popups.push(nuevos.filter(w => PRIZE_POPUP.includes(w.kind || 'bingo')));
    }
  }, [game && game.id, winners.length]);
  // Pista del lǎoshī: aparece en grande unos segundos y se va (al entrar no se repite una vieja)
  useEffect(() => {
    if (!game) return;
    const n = game.hint_n || 0;
    if (hintSeen.current === null) { hintSeen.current = n; return; }
    if (n > hintSeen.current && game.hint_h) {
      hintSeen.current = n;
      setHint({ h: game.hint_h, key: n });
      const t = setTimeout(() => setHint(x => (x && x.key === n ? null : x)), (hintSec || 5) * 1000);
      return () => clearTimeout(t);
    }
  }, [game && game.hint_n]);

  if (err) return html(GameStatusScreen, { onBack, title: '🎱 Bingo', msg: err });
  if (!game || !card) return html('main', { style: { paddingTop: 18 } }, html('p', { className: 'admin-note', style: { textAlign: 'center' } }, 'Entrando al Bingo…'));

  const n = game.size;
  const cells = card.cells || [];
  const called = game.called || [];
  const current = called.length ? bingoItem(game, called[called.length - 1]) : null;
  const lines = bingoLines(n);
  const ready = {
    terno: n >= 4 && lines.some(L => L.slice(0, -2).some((_, k) => [L[k], L[k + 1], L[k + 2]].every(i => marks.includes(i)))),
    linea: lines.some(L => L.every(i => marks.includes(i))),
    bingo: marks.length === n * n,
  };
  const mine = winners.filter(w => w.user_id === card.student_id);
  const myPoints = mine.reduce((a, w) => a + (Number(w.points) || 0), 0);
  const claimed = (k) => mine.some(w => (w.kind || 'bingo') === k);
  const takenBy = (k) => { const w = winners.find(x => (x.kind || 'bingo') === k); return w && w.user_id !== card.student_id ? w.name : null; };

  const toggle = (i) => {
    if (game.status !== 'playing') return;
    const next = marks.includes(i) ? marks.filter(x => x !== i) : [...marks, i];
    setMarks(next); setMsg(null);
    db.rpc('bingo_mark', { p_game: gameId, p_marks: next }).then(() => {});
  };
  const claim = async (kind) => {
    const { data, error } = await db.rpc('bingo_claim', { p_game: gameId, p_kind: kind });
    if (error) { setMsg({ type: 'err', text: error.message }); return; }
    const name = PRIZE_NAMES[kind].replace(/[¡!]/g, '');
    if (data.ok) { playLevelChime(); setMsg({ type: 'ok', text: '¡' + name + '! +' + (data.points || 0) + ' puntos' }); loadGame(); }
    else if (data.taken) { playWrong(); setMsg({ type: 'err', text: data.msg }); loadGame(); }
    else { playWrong(); setMsg({ type: 'err', text: (data.wrong && data.wrong.length) ? 'Falso ' + name.toLowerCase() + ': ' + data.wrong.join('、') + ' todavía no ' + (data.wrong.length === 1 ? 'salió' : 'salieron') + '.' : data.msg }); }
  };

  return html('main', { className: 'bingo-main', style: { paddingTop: 12 } },
    html(BingoPrizePopup, { prize: popups.current, sec: popups.sec, onClose: popups.close, mine: !!(popups.current && card && popups.current.user_id === card.student_id) }),
    hint && html('div', { key: 'hint' + hint.key, className: 'bingo-hint-overlay', onClick: () => setHint(null), style: { '--sec': (hintSec || 5) + 's' } },
      html('div', { className: 'bingo-hint-card' },
        html('small', null, '💡 Pista de tu lǎoshī'),
        html('div', { className: 'hanzi-font bingo-hint-h', style: { fontSize: 'min(200px, ' + Math.floor(74 / Math.max(1, [...hint.h].length)) + 'vw)' } }, hint.h),
        html('i', { className: 'bingo-hint-bar' }))),
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, '🎱 Bingo 宾果'),
    ),
    html('div', { className: 'bingo-wrap' },
      game.status === 'lobby' && html('div', { className: 'bingo-banner' }, '⏳ Esperando que tu lǎoshī empiece… Mientras, mirá tu cartón.'),
      game.status === 'playing' && html('div', { className: 'bingo-last' },
        current ? html(React.Fragment, null,
          html('span', { className: 'bingo-last-n' }, 'Ficha ' + called.length),
          game.mode === 'numeros'
            ? html('span', { className: 'bingo-last-txt' }, html('span', { className: 'bingo-last-num' }, current.e), html('span', { className: 'bingo-last-es' }, 'Buscalo en chino en tu cartón'))
            : html(React.Fragment, null,
                game.show_hanzi && html('span', { className: 'bingo-last-h hanzi-font' }, current.h),
                html('span', { className: 'bingo-last-txt' }, html(TonedPinyin, { text: current.p, className: 'bingo-last-py' }), html('span', { className: 'bingo-last-es' }, current.e))),
          game.mode === 'numeros' && game.show_hanzi && html('span', { className: 'bingo-last-h hanzi-font' }, current.h),
          game.mode !== 'numeros' && hasRealAudio(current.h) && html('button', { className: 'mini-btn', onClick: () => speak(current.h) }, '🔊'))
          : html('span', { className: 'bingo-sub' }, 'Todavía no salió ninguna ficha')),
      game.status === 'finished' && html('div', { className: 'bingo-banner' }, '🏁 La partida terminó · salieron ' + called.length + ' fichas' + (winners.length ? '' : ' · nadie cantó premios')),
      html('div', { className: 'bingo-card', style: { gridTemplateColumns: 'repeat(' + n + ', 1fr)' } },
        cells.map((h, i) => html('button', { key: i, type: 'button', onClick: () => toggle(i),
          className: 'bingo-cell' + (marks.includes(i) ? ' marked' : '') + (n === 3 ? ' big' : '') },
          html('span', { className: 'hanzi-font len' + Math.min([...h].length, 4) }, h),
          marks.includes(i) && html('span', { className: 'bingo-stamp' })))),
      msg && html('div', { className: 'admin-status ' + (msg.type === 'ok' ? 'ok' : 'err'), style: { marginTop: 10, textAlign: 'center' } }, msg.text),
      game.status === 'playing' && html('div', { className: 'bingo-claims' + (n < 4 ? ' two' : '') },
        ['terno', 'linea', 'bingo'].filter(k => k !== 'terno' || n >= 4).map(k => html('button', { key: k, type: 'button',
          className: 'bingo-claim ' + k + (claimed(k) ? ' done' : '') + (takenBy(k) ? ' taken' : ''), disabled: claimed(k) || !!takenBy(k) || !ready[k], onClick: () => claim(k) },
          html('span', { className: 'bingo-claim-t' }, claimed(k) ? '✓ ' + PRIZE_NAMES[k] : takenBy(k) ? PRIZE_NAMES[k] : 'Cantar ' + PRIZE_NAMES[k]),
          html('span', { className: 'bingo-claim-s' }, takenBy(k) ? 'lo ganó ' + takenBy(k) : k === 'terno' ? '3 seguidas · 10 pts' : k === 'linea' ? 'fila, columna o diagonal · 20 pts' : 'cartón lleno · 50 pts')))),
      html('div', { className: 'bingo-mypts' }, 'Tus puntos: ', html('b', null, myPoints)),
      html(BingoLastPrize, { winners }),
      winners.length > 0 && html('div', { className: 'report-card', style: { marginTop: 10 } }, html('div', { className: 'report-h' }, '🏆 Puntos'), html(BingoWinners, { winners, me: card.student_id })),
    ));
}

// Aviso en "Mi aula" cuando hay una partida abierta
function BingoInvite({ game, onJoin }) {
  if (!game || game.status === 'finished') return null;
  return html('button', { className: 'bingo-invite', onClick: onJoin },
    html('span', { className: 'bingo-invite-icon' }, '🎱'),
    html('span', { style: { flex: 1, textAlign: 'left' } },
      html('div', { className: 'bingo-invite-title' }, game.status === 'lobby' ? '¡Tu lǎoshī abrió un Bingo!' : '¡Bingo en juego!'),
      html('div', { className: 'bingo-invite-sub' }, 'Tocá para unirte con tu cartón')),
    html('span', { className: 'bingo-invite-go' }, 'Unirme →'));
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

// Orden de lecciones: numérico (1, 2, … 14) y después los módulos con nombre
function lessonCompare(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  if (!isNaN(na)) return -1;
  if (!isNaN(nb)) return 1;
  return String(a).localeCompare(String(b));
}

function supabaseRowsToVocab(rows) {
  const vocab = {};
  rows.forEach(r => {
    if (!vocab[r.lesson]) vocab[r.lesson] = [];
    vocab[r.lesson].push({ hanzi: nfc(r.hanzi), pinyin: nfc(r.pinyin), es: nfc(r.es) });
  });
  return vocab;
}

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
  const [lessonFilter, setLessonFilter] = useState('');      // '' = todas
  const [counts, setCounts] = useState({});
  const lessonOpts = Object.keys(LESSON_THEMES).filter(l => /^\d+(\.\d+)?$/.test(l)).sort(lessonCompare);

  const loadRows = () => {
    let q = db.from(cfg.table).select('*').eq('active', true);
    if (cfg.hasTipo && activeTipo) q = q.eq('tipo', activeTipo);
    q.order('id', { ascending: true }).then(({ data }) => {
      const all = (data || []).map(nfcRow);
      const c = {}; all.forEach(r => { const k = r.lesson == null ? '' : String(r.lesson); c[k] = (c[k] || 0) + 1; }); setCounts(c);
      const byLesson = (a, b) => (parseFloat(a.lesson) || 999) - (parseFloat(b.lesson) || 999) || a.id - b.id;
      setRows(all.filter(r => !lessonFilter || String(r.lesson) === lessonFilter).sort(byLesson));
    });
  };

  useEffect(() => { setRows(null); loadRows(); }, [activeTipo, lessonFilter]);
  const moveRow = async (row, lesson) => {
    const { error } = await db.from(cfg.table).update({ lesson }).eq('id', row.id);
    if (error) { flash('❌ Error: ' + error.message); return; }
    flash('↪ Pregunta movida a la lección ' + lesson); loadRows();
  };

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
    out.lesson = draft.lesson || lessonFilter || lessonOpts[0] || '1';
    return out;
  };

  const startEdit = (row) => {
    const draft = {};
    cfg.fields.forEach(f => {
      draft[f.key] = f.type === 'options' ? arrToDisplay(row[f.key]) : (row[f.key] || '');
    });
    draft.lesson = row.lesson == null ? '' : String(row.lesson);
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
      html('div', null,
        html('div', { style: { fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3, fontWeight: 700 } }, 'Lección del libro'),
        html('select', { value: draft.lesson || lessonFilter || lessonOpts[0] || '1', onChange: e => setDraft(d => ({ ...d, lesson: e.target.value })),
          style: { padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-deep)', fontSize: 13, background: '#fff' } },
          lessonOpts.map(l => html('option', { key: l, value: l }, 'Lección ' + l)))),
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

    // Filtro por lección del libro
    html('div', { className: 'qed-lessons' },
      html('button', { className: 'report-tab' + (!lessonFilter ? ' active' : ''), onClick: () => { setLessonFilter(''); setEditId(null); setAddMode(false); } }, 'Todas las lecciones'),
      lessonOpts.map(l => html('button', { key: l, className: 'report-tab' + (lessonFilter === l ? ' active' : ''), onClick: () => { setLessonFilter(l); setEditId(null); setAddMode(false); } }, 'Lección ' + l)),
      counts[''] > 0 && html('button', { className: 'report-tab' + (lessonFilter === '' && false ? ' active' : ''), title: 'Preguntas sin lección asignada', onClick: () => flash('Hay ' + counts[''] + ' preguntas sin lección: abrilas en "Todas" y asignales una.') }, '⚠️ Hay preguntas sin lección')),

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
                          html('span', { className: 'qed-lesson-tag', style: row.lesson == null ? { background: 'var(--gold-light)', color: 'var(--gold-dark)' } : null }, row.lesson == null ? 'Sin lección' : 'L' + row.lesson),
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
                        html('select', { className: 'qed-move', value: '', title: 'Mover a otra lección', onChange: e => e.target.value && moveRow(row, e.target.value) },
                          html('option', { value: '' }, '↪ Lección'),
                          lessonOpts.filter(l => String(row.lesson) !== l).map(l => html('option', { key: l, value: l }, 'a L' + l))),
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
// ── Configuración → Otros ajustes: todo lo de npcr_app_config que no tiene pantalla propia ──
// Números, textos, sí/no y grupos de valores se editan con su campo; lo complejo, como JSON.
const CONFIG_OWN_EDITOR = ['brand_frames', 'brand_anim_interval', 'modules_list', 'write_game_config', 'keyboard_hint_text'];
const prettyKey = (k) => String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
function GenericConfigEditor({ onAppConfigChange }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});     // key → valor en edición (texto para JSON)
  const [msg, setMsg] = useState(null);
  const load = () => db.from('npcr_app_config').select('key,value,label').order('key').then(({ data }) => setRows((data || []).filter(r => !CONFIG_OWN_EDITOR.includes(r.key))));
  useEffect(() => { load(); }, []);
  const kindOf = (v) => typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'text'
    : (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => ['number', 'string', 'boolean'].includes(typeof x))) ? 'flat' : 'json';
  const save = async (r, value) => {
    const { error } = await db.from('npcr_app_config').upsert({ key: r.key, value, label: r.label || r.key });
    if (error) { setMsg({ type: 'err', text: '❌ ' + error.message }); return; }
    setMsg({ type: 'ok', text: '✅ ' + (r.label || r.key) + ' guardado.' }); setTimeout(() => setMsg(null), 3000);
    setDraft(d => { const n = { ...d }; delete n[r.key]; return n; });
    if (onAppConfigChange) onAppConfigChange(r.key, value);
    load();
  };
  if (!rows) return html('p', { className: 'admin-note' }, 'Cargando…');
  return html('div', null,
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 8 } }, msg.text),
    html('div', { className: 'cfg-list' }, rows.map(r => {
      const k = kindOf(r.value);
      const cur = r.key in draft ? draft[r.key] : (k === 'json' ? JSON.stringify(r.value, null, 2) : r.value);
      const set = (v) => setDraft(d => ({ ...d, [r.key]: v }));
      const changed = r.key in draft;
      let field;
      if (k === 'num') field = html('input', { type: 'number', value: cur, onChange: e => set(e.target.value === '' ? '' : Number(e.target.value)), style: { ...cmInput, width: 120, flex: 'none' } });
      else if (k === 'bool') field = html('label', { className: 'mode-check' + (cur ? ' on' : '') }, html('input', { type: 'checkbox', checked: !!cur, onChange: e => set(e.target.checked) }), cur ? 'Sí' : 'No');
      else if (k === 'text') field = html('textarea', { value: cur, rows: String(cur).length > 60 ? 3 : 1, onChange: e => set(e.target.value), style: { ...cmInput, width: '100%', resize: 'vertical', fontFamily: 'inherit' } });
      else if (k === 'flat') field = html('div', { className: 'cfg-flat' }, Object.entries(cur).map(([sk, sv]) => html('label', { key: sk, className: 'cfg-sub' },
        html('span', null, prettyKey(sk)),
        typeof sv === 'boolean' ? html('input', { type: 'checkbox', checked: sv, onChange: e => set({ ...cur, [sk]: e.target.checked }) })
        : html('input', { type: typeof sv === 'number' ? 'number' : 'text', value: sv, onChange: e => set({ ...cur, [sk]: typeof sv === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }), style: { ...cmInput, width: typeof sv === 'number' ? 90 : '100%', flex: typeof sv === 'number' ? 'none' : 1 } }))));
      else field = html('textarea', { value: cur, rows: Math.min(14, String(cur).split('\n').length), spellCheck: false, onChange: e => set(e.target.value), style: { ...cmInput, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 } });
      const doSave = () => {
        if (k === 'json') { try { save(r, JSON.parse(cur)); } catch (e) { setMsg({ type: 'err', text: '❌ ' + (r.label || r.key) + ': el formato no es válido (' + e.message + ').' }); } return; }
        if (k === 'num' && (cur === '' || isNaN(cur))) { setMsg({ type: 'err', text: '❌ Escribí un número.' }); return; }
        save(r, cur);
      };
      return html('div', { key: r.key, className: 'cfg-row' + (changed ? ' changed' : '') },
        html('div', { className: 'cfg-head' }, html('b', null, r.label || prettyKey(r.key)), html('code', null, r.key)),
        field,
        changed && html('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
          html('button', { className: 'mini-btn strong', onClick: doSave }, 'Guardar'),
          html('button', { className: 'mini-btn', onClick: () => setDraft(d => { const n = { ...d }; delete n[r.key]; return n; }) }, 'Descartar')));
    })));
}

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
    '\n\nEntrá directo con este link (ya trae tu código):\n' + url + '#codigo=' + code +
    '\n\nO entrá a ' + url + ' y escribí el código.\n\nCon ese código entrás desde cualquier celular o compu y tu progreso queda guardado. 加油！';
}
// Link directo de ingreso de un alumno (lo que va después de # no viaja a ningún servidor)
const studentLink = (code) => location.origin + location.pathname + '#codigo=' + code;

function copyText(text, onDone) {
  const done = () => onDone && onDone();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
  else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); }
}

function ClassStudents({ cls, onCount, flash, onOpen, onChanged, isSel, onSelect }) {
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
    if (!await appConfirm('¿Sacar a ' + r.display_name + ' de "' + cls.name + '"?\n\nNo pierde su progreso; solo deja de estar en esta clase' +
      (r.kind === 'seat' ? ' y su código deja de funcionar.' : '.'))) return;
    const { error } = r.kind === 'seat'
      ? await db.rpc('npcr_remove_student', { p_seat: r.id })
      : await db.rpc('npcr_remove_member', { p_class: cls.id, p_student: r.user_id });
    if (error) { flash('err', '❌ ' + error.message); return; }
    load();
    onChanged && onChanged();
  };

  const regenerate = async (r) => {
    if (!await appConfirm('¿Generar un código nuevo para ' + r.display_name + '?\n\nEl código anterior (' + r.code + ') deja de funcionar. Su progreso no cambia.')) return;
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
            const on = !!(isSel && isSel(r));
            return html('div', { key: r.kind + r.id, className: 'stu-row' + (on ? ' sel-row' : ''), onClick: onSelect ? (e) => { if (!e.target.closest('button, .stu-code, .stu-file')) onSelect(r); } : undefined,
                style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderRadius: 12, padding: '10px 12px', cursor: onSelect ? 'pointer' : 'default' } },
              html('div', { style: { width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14,
                background: active ? 'var(--jade-light)' : 'var(--paper-deep)', color: active ? 'var(--jade-dark)' : 'var(--ink-soft)' } },
                (r.display_name || '?').trim().charAt(0).toUpperCase()),
              html('div', { style: { flex: '1 1 150px', minWidth: 0 } },
                html('div', { style: { fontWeight: 800, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.display_name),
                html('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginTop: 2 } },
                  !active ? '⏳ Sin activar todavía'
                  : '✅ Activo · ' + (p && p.last_seen ? 'entró ' + timeAgo(p.last_seen) : 'sin actividad') + (p && p.streak_days ? ' · 🔥 ' + p.streak_days : '')
                    + (r.kind === 'loose' ? ' · sin código' : '')),
                onOpen && r.kind === 'seat' && html('div', { className: 'stu-file', title: 'Ver ficha del alumno', onClick: () => onOpen(r), style: { display: 'inline-block', fontSize: 11, fontWeight: 800, color: 'var(--gold-dark)', marginTop: 2, cursor: 'pointer' } }, 'Ver ficha →'),
              ),
              html('div', { style: { display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' } },
              r.kind === 'seat' && html('span', {
                className: 'stu-code', title: 'Tocá para copiar el código',
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
    const code = secureRandomChars(CODE_CHARS, 6);
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
    if (value && !await appConfirm('¿Archivar el aula "' + c.name + '"?\n\nDeja de aparecer en tu lista. Sus alumnos y su progreso se conservan, y la podés restaurar cuando quieras.')) return;
    const { error } = await db.from('classes').update({ archived: value }).eq('id', c.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    flash('ok', value ? '📦 Aula "' + c.name + '" archivada.' : '↩️ Aula "' + c.name + '" restaurada.');
    load();
  };

  // Eliminar definitivo: solo superadmin (y solo desde Archivadas)
  const removeForever = async (c) => {
    const n = (counts[c.id] || {}).total || 0;
    if (!await appConfirm('⚠️ ¿ELIMINAR DEFINITIVAMENTE el aula "' + c.name + '"?\n\n' +
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
  return secureRandomChars('abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789', 12);
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
    if (!await appConfirm(msg)) return;
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
    setWords((w || []).slice().sort((x, y) => lessonCompare(x.lesson, y.lesson) || x.id - y.id));
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
    if (!await appConfirm('⚠️ ¿Borrar DEFINITIVAMENTE ' + ids.length + ' palabra(s)?\n\nQuedan en el historial: si te arrepentís, podés recuperarlas desde ahí.')) return;
    const { error } = await db.from('npcr_vocabulary').delete().in('id', ids);
    done(error ? '❌ ' + error.message : '🗑 Borradas definitivamente.');
  };
  const restoreQ = async (q) => { const { error } = await db.from(q.table).update({ active: true }).eq('id', q.row.id); done(error ? '❌ ' + error.message : '↩️ Pregunta restaurada.'); };
  const purgeQ = async (q) => {
    if (!await appConfirm('⚠️ ¿Borrar DEFINITIVAMENTE esta pregunta?')) return;
    const { error } = await db.from(q.table).delete().eq('id', q.row.id); done(error ? '❌ ' + error.message : '🗑 Borrada definitivamente.');
  };
  const revert = async (h) => {
    if (!await appConfirm('¿Revertir este cambio?\n\n' + historySummary(h) + '\n\nEl registro vuelve a como estaba antes.')) return;
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
    tab === 'historial' && html(ScrollX, { arrows: 'top' },
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

// ── Consola → Contenido: fotos del juego 这是什么？ (solo admin; la base también lo exige) ──
// Achica la foto antes de subirla (lado mayor 1000 px, JPEG) para no gastar espacio.
function shrinkPhoto(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo leer la foto')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El archivo no es una foto válida')); };
    img.src = url;
  });
}
async function uploadZhePhoto(file) {
  const blob = await shrinkPhoto(file, 1000);
  const path = 'zhe/' + Date.now() + '-' + secureRandomChars('abcdefghijklmnopqrstuvwxyz0123456789', 6) + '.jpg';
  const { error } = await db.storage.from('npcr-fotos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return db.storage.from('npcr-fotos').getPublicUrl(path).data.publicUrl;
}
// Busca la palabra en toda la base (libro NPCR, HSK 1 y HSK 2) para traer pinyin, significado
// y la grabación original. Si aparece en varias, se queda con la que tiene audio.
async function findBaseWord(hanzi) {
  let first = null;
  const { data: v } = await db.from('npcr_vocabulary').select('hanzi,pinyin,es').eq('hanzi', hanzi).limit(1);
  if (v && v[0]) {
    const w = { ...v[0], audio: (NPCR_MEDIA.audio || {})[hanzi] || null, source: 'el libro NPCR' };
    if (w.audio) return w; first = w;
  }
  for (const [t, name] of [['hsk1_words', 'HSK 1'], ['hsk2_words', 'HSK 2']]) {
    const { data } = await db.from(t).select('hanzi,pinyin,es,audio').eq('hanzi', hanzi).limit(1);
    if (data && data[0]) { const w = { ...data[0], source: name }; if (w.audio) return w; first = first || w; }
  }
  return first;
}

// ── Consola → Contenido: camino de Trazos (solo admin; la base también lo exige) ──
function TrazosAdmin({ vocab }) {
  const lessons = Object.keys(vocab);
  const [cfg, setCfg] = useState(null);
  const [info, setInfo] = useState({});
  const [lesson, setLesson] = useState(null);
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null);     // { c, pinyin, es }
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };
  const load = () => Promise.all([db.from('npcr_trazos_admin').select('*'), db.from('npcr_hanzi_info').select('hanzi,pinyin,es')])
    .then(([c, h]) => {
      if (c.error) { setMsg({ type: 'err', text: '❌ ' + c.error.message + (/relation|does not exist/.test(c.error.message) ? ' — ¿Ejecutaste npcr_trazos_admin.sql?' : '') }); setCfg([]); }
      else setCfg(c.data || []);
      const m = {}; (h.data || []).forEach(r => { m[r.hanzi] = r; }); setInfo(m);
    });
  useEffect(() => { load(); }, []);
  if (!cfg) return html('p', { className: 'admin-note' }, 'Cargando trazos…');
  const path = trazosPath(vocab, lessons, cfg, true);
  const cur = path.find(p => p.lesson === lesson) || path[0];
  if (!cur) return html('p', { className: 'admin-note' }, 'No hay lecciones con hanzi para dibujar.');
  const confOf = (c) => cfg.find(r => r.hanzi === c) || { hanzi: c };
  const save = async (rows, ok) => {
    const { error } = await db.from('npcr_trazos_admin').upsert(rows.map(r => ({ ...r, updated_at: new Date().toISOString() })));
    if (error) { flash('err', '❌ ' + error.message); return false; }
    await load(); if (ok) flash('ok', ok); return true;
  };
  const visible = cur.chars;
  const order = (i, d) => {
    const j = i + d; if (j < 0 || j >= visible.length) return;
    const list = [...visible]; [list[i], list[j]] = [list[j], list[i]];
    save(list.map((x, n) => ({ ...confOf(x.c), position: n })));
  };
  const addChar = async () => {
    const c = [...add.trim()][0];
    if (!c) return;
    if (!NPCR_MEDIA.svg[c]) return flash('err', 'No hay modelo de trazos para ' + c + ' (solo se pueden usar los hanzi del libro).');
    const where = path.find(p => p.chars.some(x => x.c === c));
    if (where && where.lesson === cur.lesson) return flash('err', c + ' ya está en esta lección.');
    if (await save([{ ...confOf(c), lesson: cur.lesson, hidden: false, position: visible.length }], '✍️ ' + c + ' agregado a la lección ' + cur.lesson + (where ? ' (antes estaba en la ' + where.lesson + ')' : '') + '.')) setAdd('');
  };
  const saveInfo = async () => {
    const { c, pinyin, es } = edit;
    if (!pinyin.trim() || !es.trim()) return flash('err', 'Completá el pinyin y el significado.');
    const { error } = await db.from('npcr_hanzi_info').upsert({ hanzi: c, pinyin: pinyin.trim(), es: es.trim() });
    if (error) return flash('err', '❌ ' + error.message);
    setEdit(null); load(); flash('ok', '✅ ' + c + ' actualizado.');
  };
  return html('div', null,
    html('p', { className: 'admin-note', style: { margin: '0 0 8px' } }, 'El camino se arma solo con los hanzi nuevos de cada lección. Acá podés ocultar hanzi (por ejemplo, de nombres), pasarlos a otra lección, agregar otros del libro, ordenarlos y corregir el pinyin y el significado que ven los alumnos.'),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 8 } }, msg.text),
    html('div', { className: 'reg-toolbar', style: { marginBottom: 10 } }, path.map(p => html('button', { key: p.lesson, className: 'report-tab' + (p.lesson === cur.lesson ? ' active' : ''), onClick: () => { setLesson(p.lesson); setEdit(null); } },
      'Lección ' + p.lesson))),
    html('div', { className: 'tza-grid' }, visible.map((x, i) => {
      const inf = info[x.c] || {};
      return html('div', { key: x.c, className: 'tza-card' + (x.hidden ? ' off' : '') },
        html('div', { className: 'tza-top' },
          html('span', { className: 'tza-h hanzi-font' }, x.c),
          html('span', { className: 'tza-n' }, i + 1),
          x.hidden && html('span', { className: 'tza-tag' }, 'Oculto'),
          x.moved && html('span', { className: 'tza-tag blue' }, 'Venía de L' + x.from),
          x.added && html('span', { className: 'tza-tag blue' }, 'Agregado')),
        edit && edit.c === x.c
          ? html('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              html('input', { value: edit.pinyin, placeholder: 'Pinyin', onChange: e => setEdit({ ...edit, pinyin: e.target.value }), style: { ...cmInput, width: '100%', padding: '6px 8px' } }),
              html('input', { value: edit.es, placeholder: 'Significado', onChange: e => setEdit({ ...edit, es: e.target.value }), style: { ...cmInput, width: '100%', padding: '6px 8px' } }),
              html('div', { style: { display: 'flex', gap: 4 } },
                html('button', { className: 'mini-btn strong', onClick: saveInfo }, 'Guardar'), html('button', { className: 'mini-btn', onClick: () => setEdit(null) }, 'Cancelar')))
          : html('div', { className: 'tza-info' }, inf.pinyin ? html(TonedPinyin, { text: inf.pinyin }) : html('i', null, 'sin pinyin'), html('small', null, inf.es || (x.w ? 'en ' + x.w.hanzi : ''))),
        html('div', { className: 'tza-actions' },
          html('button', { className: 'mini-btn', title: 'Subir', disabled: i === 0, onClick: () => order(i, -1) }, '↑'),
          html('button', { className: 'mini-btn', title: 'Bajar', disabled: i === visible.length - 1, onClick: () => order(i, 1) }, '↓'),
          html('button', { className: 'mini-btn', onClick: () => save([{ ...confOf(x.c), hidden: !x.hidden }], x.hidden ? '👁 ' + x.c + ' vuelve a Trazos.' : '🚫 ' + x.c + ' ya no aparece en Trazos.') }, x.hidden ? '👁 Mostrar' : '🚫 Ocultar'),
          html('button', { className: 'mini-btn', title: 'Editar pinyin y significado', onClick: () => setEdit({ c: x.c, pinyin: inf.pinyin || '', es: inf.es || '' }) }, '✏️'),
          html('select', { className: 'mini-btn', value: '', title: 'Pasar a otra lección', onChange: e => e.target.value && save([{ ...confOf(x.c), lesson: e.target.value, position: null }], '↪ ' + x.c + ' pasó a la lección ' + e.target.value + '.') },
            html('option', { value: '' }, '↪ Mover'),
            path.filter(p => p.lesson !== cur.lesson).map(p => html('option', { key: p.lesson, value: p.lesson }, 'a L' + p.lesson)))));
    })),
    html('div', { className: 'tza-add' },
      html('input', { value: add, maxLength: 2, placeholder: 'Hanzi', onChange: e => setAdd(e.target.value), style: { ...cmInput, width: 80, flex: 'none', fontSize: 20, textAlign: 'center', fontFamily: 'Noto Sans SC, sans-serif' } }),
      html('button', { className: 'mini-btn strong', onClick: addChar }, '+ Agregar a la lección ' + cur.lesson),
      html('span', { className: 'admin-note', style: { margin: 0 } }, 'Solo hanzi del libro (tienen modelo de trazos).')));
}

// ── Consola → Contenido: frases del libro (frases clave y frases de contexto) ──
function SentencesAdmin({ vocab }) {
  const lessons = Object.keys(vocab).filter(l => /^\d+(\.\d+)?$/.test(l)).sort(lessonCompare);
  const [lesson, setLesson] = useState(lessons[0] || '1');
  const [kind, setKind] = useState('clave');      // 'clave' (npcr_sentences) | 'ctx' (npcr_context_sentences)
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);          // fila en edición (o { _new: true })
  const [msg, setMsg] = useState(null);
  const table = kind === 'clave' ? 'npcr_sentences' : 'npcr_context_sentences';
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };
  const load = () => {
    setRows(null);
    db.from(table).select(kind === 'clave' ? 'id,lesson,hanzi,pinyin,es,hidden' : 'id,lesson,word,hanzi,pinyin,es,hidden').eq('lesson', lesson).order('id')
      .then(({ data, error }) => { if (error) { flash('err', '❌ ' + error.message); setRows([]); } else setRows(data || []); });
  };
  useEffect(() => { setEdit(null); load(); }, [lesson, kind]);
  const save = async () => {
    const e = edit;
    if (!e.hanzi.trim() || !e.pinyin.trim() || !e.es.trim() || (kind === 'ctx' && !e.word)) return flash('err', 'Completá todos los campos.');
    const row = { hanzi: e.hanzi.trim(), pinyin: e.pinyin.trim(), es: e.es.trim(), ...(kind === 'ctx' ? { word: e.word } : {}) };
    const { error } = e._new ? await db.from(table).insert({ ...row, lesson }) : await db.from(table).update(row).eq('id', e.id);
    if (error) return flash('err', '❌ ' + error.message);
    setEdit(null); load(); flash('ok', e._new ? '✅ Frase agregada.' : '✅ Frase guardada.');
  };
  const toggle = async (r) => {
    const { error } = await db.from(table).update({ hidden: !r.hidden }).eq('id', r.id);
    if (error) return flash('err', '❌ ' + error.message);
    load(); flash('ok', r.hidden ? '👁 La frase vuelve a aparecer.' : '🚫 La frase ya no aparece en la app.');
  };
  const words = (vocab[lesson] || []).map(w => w.hanzi);
  const inp = (k, ph, extra) => html('input', { value: edit[k] || '', placeholder: ph, onChange: e => setEdit({ ...edit, [k]: e.target.value }), style: { ...cmInput, width: '100%', ...(extra || {}) } });
  const form = edit && html('div', { className: 'plan-add', style: { marginBottom: 10 } },
    html('div', { className: 'report-h', style: { margin: '0 0 8px' } }, edit._new ? '➕ Frase nueva · lección ' + lesson : '✏️ Editar frase'),
    !edit._new && hasRealAudio(edit._orig) && html('div', { className: 'admin-status', style: { marginBottom: 8, background: 'var(--gold-light)' } }, '🔊 Esta frase tiene audio del libro. Si cambiás el texto en chino, deja de sonar (el pinyin y la traducción se pueden corregir sin problema).'),
    html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      kind === 'ctx' && html('select', { value: edit.word || '', onChange: e => setEdit({ ...edit, word: e.target.value }), style: { ...cmInput, width: '100%' } },
        html('option', { value: '' }, 'Palabra que se completa…'), words.map(w => html('option', { key: w, value: w }, w))),
      inp('hanzi', 'Frase en chino (ej: 我喝茶。)', { fontFamily: 'Noto Sans SC, sans-serif', fontSize: 16 }),
      inp('pinyin', 'Pinyin (ej: Wǒ hē chá.)'),
      inp('es', 'Traducción (ej: Tomo té.)')),
    html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
      html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: save }, 'Guardar'),
      html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => setEdit(null) }, 'Cancelar')));
  return html('div', null,
    html('p', { className: 'admin-note', style: { margin: '0 0 8px' } }, 'Frases clave: las del libro (tarjetas de frases, Ordená y Completá). Frases de contexto: las que aparecen en las tarjetas para completar con la palabra. Ocultá las que no sirvan, corregilas o agregá nuevas.'),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 8 } }, msg.text),
    html('div', { className: 'reg-toolbar', style: { marginBottom: 8 } },
      [['clave', '💬 Frases clave'], ['ctx', '🧩 Frases de contexto']].map(([k, l]) => html('button', { key: k, className: 'report-tab' + (kind === k ? ' active' : ''), onClick: () => setKind(k) }, l)),
      html('select', { value: lesson, onChange: e => setLesson(e.target.value), style: { ...cmInput, flex: '0 0 auto' } }, lessons.map(l => html('option', { key: l, value: l }, 'Lección ' + l))),
      !edit && html('button', { className: 'primary-btn', style: { margin: '0 0 0 auto', width: 'auto', padding: '8px 14px' }, onClick: () => setEdit({ _new: true, hanzi: '', pinyin: '', es: '', word: '' }) }, '+ Frase nueva')),
    form,
    !rows ? html('p', { className: 'admin-note' }, 'Cargando…')
    : rows.length === 0 ? html('p', { className: 'admin-note' }, 'No hay frases en esta lección.')
    : html('div', { className: 'plan-edit-steps' }, rows.map(r => html('div', { key: r.id, className: 'plan-edit-step' + (r.hidden ? ' txt-off' : '') },
        html('span', { style: { flex: 1, minWidth: 0 } },
          kind === 'ctx' && html('span', { className: 'txt-word hanzi-font' }, r.word),
          html('span', { className: 'hanzi-font', style: { fontSize: 16 } }, r.hanzi),
          html('small', null, r.pinyin + ' · ' + r.es + (hasRealAudio(r.hanzi) ? ' · 🔊 audio del libro' : '') + (r.hidden ? ' · 🚫 oculta' : ''))),
        html('button', { className: 'mini-btn', onClick: () => setEdit({ ...r, _orig: r.hanzi }) }, '✏️'),
        html('button', { className: 'mini-btn', onClick: () => toggle(r) }, r.hidden ? '👁 Mostrar' : '🚫 Ocultar')))));
}

// ── Consola → Contenido: frase del día (cartel "Lectura del día" del inicio) ──
function FrasesDiaAdmin() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };
  const load = () => db.from('frases_del_dia').select('*').order('id').then(({ data, error }) => { if (error) { flash('err', '❌ ' + error.message); setRows([]); } else setRows(data || []); });
  useEffect(() => { load(); }, []);
  const save = async () => {
    const e = edit;
    if (!e.zh.trim() || !e.py.trim() || !e.es.trim()) return flash('err', 'Completá la frase, el pinyin y la traducción.');
    const row = { zh: e.zh.trim(), py: e.py.trim(), es: e.es.trim() };
    const { error } = e._new ? await db.from('frases_del_dia').insert({ ...row, active: true }) : await db.from('frases_del_dia').update(row).eq('id', e.id);
    if (error) return flash('err', '❌ ' + error.message);
    setEdit(null); load(); flash('ok', '✅ Guardada.');
  };
  const toggle = async (r) => { const { error } = await db.from('frases_del_dia').update({ active: !r.active }).eq('id', r.id); if (error) flash('err', '❌ ' + error.message); load(); };
  const del = async (r) => { if (!await appConfirm('¿Eliminar "' + r.zh + '"?')) return; const { error } = await db.from('frases_del_dia').delete().eq('id', r.id); if (error) flash('err', '❌ ' + error.message); load(); };
  const inp = (k, ph, extra) => html('input', { value: edit[k] || '', placeholder: ph, onChange: e => setEdit({ ...edit, [k]: e.target.value }), style: { ...cmInput, width: '100%', ...(extra || {}) } });
  if (!rows) return html('p', { className: 'admin-note' }, 'Cargando…');
  const on = rows.filter(r => r.active).length;
  return html('div', null,
    html('p', { className: 'admin-note', style: { margin: '0 0 8px' } }, 'Cada día el inicio muestra una de las frases activas (' + on + ' de ' + rows.length + '), en rotación. Apagá las que no quieras usar o agregá nuevas.'),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 8 } }, msg.text),
    edit && html('div', { className: 'plan-add', style: { marginBottom: 10 } },
      html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        inp('zh', 'Frase en chino (ej: 今天天气很好！)', { fontFamily: 'Noto Sans SC, sans-serif', fontSize: 16 }), inp('py', 'Pinyin'), inp('es', 'Traducción')),
      html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, onClick: save }, 'Guardar'),
        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => setEdit(null) }, 'Cancelar'))),
    !edit && html('button', { className: 'secondary-btn', style: { marginBottom: 8 }, onClick: () => setEdit({ _new: true, zh: '', py: '', es: '' }) }, '+ Frase nueva'),
    html('div', { className: 'plan-edit-steps' }, rows.map(r => html('div', { key: r.id, className: 'plan-edit-step' + (r.active ? '' : ' txt-off') },
      html('span', { style: { flex: 1, minWidth: 0 } }, html('span', { className: 'hanzi-font', style: { fontSize: 16 } }, r.zh), html('small', null, r.py + ' · ' + r.es + (r.active ? '' : ' · apagada'))),
      html('button', { className: 'mini-btn', onClick: () => setEdit({ ...r }) }, '✏️'),
      html('button', { className: 'mini-btn', onClick: () => toggle(r) }, r.active ? '🚫 Apagar' : '👁 Activar'),
      html('button', { className: 'mini-btn danger', onClick: () => del(r) }, '🗑')))));
}

function ZheAdmin({ isSuper }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);           // id de la foto que se está guardando
  const [edit, setEdit] = useState(null);           // { id, hanzi, pinyin, es, es_s }
  const [filter, setFilter] = useState('todas');
  const [add, setAdd] = useState(null);             // formulario de foto nueva
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 3500); };

  const load = () => db.from('npcr_zhe_items').select('*').order('id').then(({ data, error }) => {
    if (error) { setErr(error.message); setItems([]); return; }
    setItems(data || []);
  });
  useEffect(() => { load(); }, []);

  const save = async (it, patch, okText) => {
    setBusy(it.id);
    const { error } = await db.from('npcr_zhe_items').update(patch).eq('id', it.id);
    setBusy(null);
    if (error) { flash('err', '❌ ' + error.message); return false; }
    setItems(list => list.map(x => x.id === it.id ? { ...x, ...patch } : x));
    if (okText) flash('ok', okText);
    return true;
  };
  const replacePhoto = async (it, file) => {
    if (!file) return;
    setBusy(it.id);
    try {
      const url = await uploadZhePhoto(file);
      await save(it, { image: url, ...(it.image_orig ? {} : { image_orig: it.image }) }, '📷 Foto de ' + it.hanzi + ' cambiada.');
    } catch (e) { setBusy(null); flash('err', '❌ ' + e.message + (/bucket|not found/i.test(e.message) ? ' — ¿Ejecutaste npcr_zhe_admin.sql?' : '')); }
  };
  const remove = async (it) => {
    if (!await appConfirm('¿Eliminar la foto de ' + it.hanzi + ' (' + it.es + ') del juego?\n\nSi solo querés que no aparezca, usá "Ocultar".')) return;
    const { error } = await db.from('npcr_zhe_items').delete().eq('id', it.id);
    if (error) { flash('err', '❌ ' + error.message); return; }
    setItems(list => list.filter(x => x.id !== it.id));
    flash('ok', '🗑 Foto eliminada (queda en Papelera e historial).');
  };

  const startAdd = () => setAdd({ hanzi: '', pinyin: '', es: '', es_s: '', audio: null, file: null, preview: null, found: null });
  const lookup = async () => {
    const h = (add.hanzi || '').trim(); if (!h) return;
    const w = await findBaseWord(h);
    setAdd(a => ({ ...a, found: w ? 'si' : 'no', audio: w ? w.audio : null, source: w ? w.source : null,
      pinyin: a.pinyin || (w ? w.pinyin : ''), es: a.es || (w ? w.es : '') }));
  };
  const saveAdd = async () => {
    const a = add;
    if (!a.hanzi.trim() || !a.pinyin.trim() || !a.es.trim() || !a.es_s.trim() || !a.file) { flash('err', 'Completá la palabra, el pinyin, el significado, la frase y la foto.'); return; }
    setBusy('new');
    try {
      const url = await uploadZhePhoto(a.file);
      const id = Math.max(0, ...items.map(x => x.id)) + 1;
      const row = { id, hanzi: a.hanzi.trim(), pinyin: a.pinyin.trim(), es: a.es.trim(), es_s: a.es_s.trim(), image: url, image_orig: url, audio: a.audio || null, hidden: false };
      const { error } = await db.from('npcr_zhe_items').insert(row);
      if (error) throw new Error(error.message);
      setItems(list => [...list, row]); setAdd(null);
      flash('ok', '✅ Foto de ' + row.hanzi + ' agregada al juego.');
    } catch (e) { flash('err', '❌ ' + e.message); }
    setBusy(null);
  };

  if (err) return html('div', { className: 'admin-status err' }, '❌ ' + err + ' (¿ejecutaste npcr_zhe.sql?)');
  if (!items) return html('p', { className: 'admin-note' }, 'Cargando fotos…');
  const visible = items.filter(x => !x.hidden).length;
  const list = items.filter(x => filter === 'todas' || (filter === 'ocultas') === !!x.hidden);
  const inp = (val, on, ph, extra) => html('input', { value: val, placeholder: ph, onChange: e => on(e.target.value), style: { ...cmInput, width: '100%', ...(extra || {}) } });

  return html('div', null,
    html('div', { className: 'reg-toolbar', style: { marginBottom: 10 } },
      [['todas', 'Todas (' + items.length + ')'], ['visibles', '👁 En el juego (' + visible + ')'], ['ocultas', '🚫 Ocultas (' + (items.length - visible) + ')']].map(([k, label]) =>
        html('button', { key: k, className: 'report-tab' + (filter === k ? ' active' : ''), onClick: () => setFilter(k) }, label)),
      !add && html('button', { className: 'primary-btn', style: { margin: '0 0 0 auto', width: 'auto', padding: '8px 14px' }, onClick: startAdd }, '+ Foto nueva'),
    ),
    visible < 4 && html('div', { className: 'admin-status err', style: { marginBottom: 10 } }, 'El juego necesita al menos 4 fotos visibles para funcionar.'),
    msg && html('div', { className: 'admin-status ' + msg.type, style: { marginBottom: 10 } }, msg.text),

    add && html('div', { className: 'zadm-add' },
      html('div', { className: 'report-h', style: { marginBottom: 8 } }, '➕ Foto nueva'),
      html('div', { className: 'zadm-add-grid' },
        html('label', { className: 'zadm-drop' + (add.preview ? ' has' : '') },
          add.preview ? html('img', { src: add.preview, alt: '' }) : html('span', null, '📷', html('br'), 'Elegir foto'),
          html('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: e => { const f = e.target.files[0]; if (f) setAdd(a => ({ ...a, file: f, preview: URL.createObjectURL(f) })); } })),
        html('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          html('div', { style: { display: 'flex', gap: 6 } },
            inp(add.hanzi, v => setAdd(a => ({ ...a, hanzi: v, found: null, audio: null })), 'Hanzi (ej: 眼睛)', { fontSize: 18, fontFamily: 'Noto Sans SC, sans-serif' }),
            html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto', padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap' }, onClick: lookup, disabled: !add.hanzi.trim() }, '🔎 Buscar en la base')),
          add.found && html('div', { className: 'admin-note', style: { margin: 0 } }, add.found === 'si'
            ? (add.audio ? '✅ Está en la base (' + add.source + '): se usa su grabación original.' : '✅ Está en la base (' + add.source + '), pero sin grabación.')
            : 'No está en la base: se puede agregar igual, pero sin audio.'),
          inp(add.pinyin, v => setAdd(a => ({ ...a, pinyin: v })), 'Pinyin (ej: yǎnjing)'),
          inp(add.es, v => setAdd(a => ({ ...a, es: v })), 'Significado (ej: ojos)'),
          inp(add.es_s, v => setAdd(a => ({ ...a, es_s: v })), 'Frase de la corrección (ej: Son ojos.)'),
        )),
      html('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
        html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, disabled: busy === 'new', onClick: saveAdd }, busy === 'new' ? 'Subiendo…' : 'Agregar al juego'),
        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => setAdd(null) }, 'Cancelar'))),

    html('div', { className: 'zadm-grid' }, list.map(it => {
      const editing = edit && edit.id === it.id;
      const changed = it.image_orig && it.image_orig !== it.image;
      return html('div', { key: it.id, className: 'zadm-card' + (it.hidden ? ' off' : '') },
        html('div', { className: 'zadm-photo' }, html('img', { src: it.image, alt: it.es, loading: 'lazy' }),
          it.hidden && html('span', { className: 'zadm-tag' }, '🚫 Oculta'),
          changed && !it.hidden && html('span', { className: 'zadm-tag new' }, 'Foto cambiada'),
          busy === it.id && html('span', { className: 'zadm-busy' }, 'Guardando…')),
        editing
          ? html('div', { className: 'zadm-body' },
              inp(edit.hanzi, v => setEdit(e => ({ ...e, hanzi: v })), 'Hanzi'),
              inp(edit.pinyin, v => setEdit(e => ({ ...e, pinyin: v })), 'Pinyin'),
              inp(edit.es, v => setEdit(e => ({ ...e, es: v })), 'Significado'),
              inp(edit.es_s, v => setEdit(e => ({ ...e, es_s: v })), 'Frase de la corrección'),
              html('div', { style: { display: 'flex', gap: 6 } },
                html('button', { className: 'mini-btn', style: { background: 'var(--jade)', color: '#fff', borderColor: 'var(--jade)' },
                  onClick: async () => { const { id, ...patch } = edit; if (Object.values(patch).some(v => !String(v).trim())) { flash('err', 'No puede quedar ningún campo vacío.'); return; } if (await save(it, patch, '✅ Guardado.')) setEdit(null); } }, 'Guardar'),
                html('button', { className: 'mini-btn', onClick: () => setEdit(null) }, 'Cancelar')))
          : html('div', { className: 'zadm-body' },
              html('div', { className: 'zadm-h' }, html('span', { className: 'hanzi-font' }, it.hanzi), html(TonedPinyin, { text: it.pinyin, className: 'zadm-py' })),
              html('div', { className: 'zadm-es' }, it.es, ' · ', html('i', null, it.es_s)),
              html('div', { className: 'zadm-meta' }, it.audio ? '🔊 con audio del libro' : '🔇 sin audio')),
        !editing && html('div', { className: 'zadm-actions' },
          html('button', { className: 'mini-btn', disabled: busy === it.id, onClick: () => save(it, { hidden: !it.hidden }, it.hidden ? '👁 ' + it.hanzi + ' vuelve al juego.' : '🚫 ' + it.hanzi + ' ya no aparece en el juego.') }, it.hidden ? '👁 Mostrar' : '🚫 Ocultar'),
          html('label', { className: 'mini-btn', style: { display: 'inline-flex', alignItems: 'center' } }, '📷 Cambiar foto',
            html('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: e => { replacePhoto(it, e.target.files[0]); e.target.value = ''; } })),
          changed && html('button', { className: 'mini-btn', disabled: busy === it.id, onClick: () => save(it, { image: it.image_orig }, '↩ Volvió la foto original de ' + it.hanzi + '.') }, '↩ Foto original'),
          html('button', { className: 'mini-btn', onClick: () => setEdit({ id: it.id, hanzi: it.hanzi, pinyin: it.pinyin, es: it.es, es_s: it.es_s }) }, '✏️ Textos'),
          isSuper && html('button', { className: 'mini-btn danger', onClick: () => remove(it) }, '🗑')));
    })),
  );
}

function AdminPanel({ vocab, onBack, onVocabUpdate, onReports, appConfig, onAppConfigChange }) {
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
  // Consola por secciones: accesos directos arriba y una sola sección a la vez
  const [adminTab, setAdminTabRaw] = useState(() => { try { return localStorage.getItem('npcr-admin-tab') || 'aulas'; } catch (e) { return 'aulas'; } });
  const setAdminTab = (t) => { setAdminTabRaw(t); try { localStorage.setItem('npcr-admin-tab', t); } catch (e) {} };
  const adminTabs = [
    { id: 'aulas', icon: 'cap', tone: 'red', title: 'Aulas', sub: 'Clases, alumnos y reportes' },
    isAdmin && { id: 'equipo', icon: 'users', tone: 'blue', title: 'Equipo', sub: 'Equipo docente: lǎoshī y administradores' },
    isAdmin && { id: 'alumnos', icon: 'chart', tone: 'green', title: 'Alumnos', sub: 'Registro y estadísticas' },
    isAdmin && { id: 'ingresos', icon: 'login', tone: 'gold', title: 'Ingresos', sub: 'Accesos a la consola' },
    isAdmin && { id: 'contenido', icon: 'book', tone: 'purple', title: 'Contenido', sub: 'Lecciones y módulos' },
    isSuper && { id: 'papelera', icon: 'trash', tone: 'red', title: 'Papelera', sub: 'E historial de cambios' },
    isAdmin && { id: 'config', icon: 'gear', tone: 'blue', title: 'Configuración', sub: 'Textos y módulos de la app' },
  ].filter(Boolean);
  const tab = adminTabs.some(t => t.id === adminTab) ? adminTab : 'aulas';
  const showTab = (t) => tab === t;


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
    // IP y dispositivo de cada conexión: solo el superadmin (la base también lo exige)
    loadNotices();
    if (isSuper) db.rpc('npcr_presence_ips_all').then(({ data, error }) => {
      if (error) { setIpErr(error.message); setIpRows([]); } else { setIpErr(null); setIpRows(data || []); }
    });
    setShowActivityLog(true);
  };
  const [ipRows, setIpRows] = useState(null);
  const [ipErr, setIpErr] = useState(null);
  const [notices, setNotices] = useState({});   // avisos "pedir nombre" que todavía no respondieron
  const loadNotices = () => db.rpc('npcr_pending_notices').then(({ data, error }) => {
    if (error) return; const m = {}; (data || []).forEach(n => { if (n.kind === 'ask_name') m[n.user_id] = n.created_at; }); setNotices(m);
  });
  const askName = async (r) => {
    const { error } = await db.rpc('npcr_send_notice', { p_user: r.user_id, p_kind: 'ask_name', p_text: null });
    if (error) { setMergeMsg({ type: 'err', msg: '❌ ' + error.message + (/function|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_avisos.sql?' : '') }); return; }
    setNotices(m => ({ ...m, [r.user_id]: new Date().toISOString() }));
    setMergeMsg({ type: 'ok', msg: '✉️ Listo: a esa persona le va a aparecer una ventana para escribir su nombre (al abrir la app, o en menos de un minuto si la tiene abierta).' });
  };
  const [activityError, setActivityError] = useState(null);
  const [regFilter, setRegFilter] = useState('todos'); // todos | codigo | libre
  const [regSearch, setRegSearch] = useState('');
  const [regSel, setRegSel] = useState(null);   // alumno resaltado en el registro
  // Pasar el progreso de un invitado a un alumno con código (npcr_merge_accounts)
  const [mergeFrom, setMergeFrom] = useState(null);
  const [mergeTo, setMergeTo] = useState('');
  const [mergeMsg, setMergeMsg] = useState(null);
  // Al elegir un invitado, la ventanita (que está arriba de la tabla) se trae a la vista
  useEffect(() => {
    if (!mergeFrom) return;
    const t = setTimeout(() => { const el = document.querySelector('.merge-box'); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
    return () => clearTimeout(t);
  }, [mergeFrom]);
  const doMerge = async () => {
    const to = activityLog.find(x => x.user_id === mergeTo);
    if (!mergeFrom || !to) return;
    if (!await appConfirm('¿Pasar todo el progreso de "' + (mergeFrom.name || 'Sin nombre') + '" (invitado) a ' + to.name + ' (' + (to.code || 'con código') + ')?' + String.fromCharCode(10, 10) + 'Lo que exista en las dos cuentas se combina quedándose con lo mejor. El invitado deja de aparecer en el registro. No se puede deshacer.')) return;
    const { data, error } = await db.rpc('npcr_merge_accounts', { p_from: mergeFrom.user_id, p_to: to.user_id });
    if (error) { setMergeMsg({ type: 'err', msg: '❌ ' + error.message + (/function|does not exist/.test(error.message) ? ' — ¿Ejecutaste npcr_unir_cuentas.sql?' : '') }); return; }
    const d = data || {};
    setMergeMsg({ type: 'ok', msg: '✅ Listo: ' + to.name + ' recibió ' + (d.lecciones || 0) + ' resultados de lecciones, ' + (d.tarjetas || 0) + ' tarjetas y ' + (d.sesiones || 0) + ' sesiones. Que cierre y vuelva a abrir la app para verlo.' });
    setMergeFrom(null); setMergeTo('');
    loadActivityLog();
  };
  // Al entrar a Alumnos o Ingresos, el registro se carga solo
  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'alumnos' && !showActivityLog) loadActivityLog();
    if (tab === 'ingresos' && !showLoginLog) loadLoginLog();
  }, [tab, isAdmin]);

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

  return html('main', { className: ['aulas', 'equipo', 'alumnos', 'ingresos'].includes(tab) ? 'wide' : '', style: { paddingTop: '18px' } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, 'Administrar'),
    ),
    html('div', { className: 'admin-panel' },

      // ── Panel admin/laoshi (según rol del perfil, no solo "hay sesión") ──
      isLaoshi
        ? html(React.Fragment, null,
            html('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--jade-light)', borderRadius: 12, padding: '10px 14px' } },
              html('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--jade-dark)' } }, (isSuper ? '👑 Superadmin: ' : isAdmin ? '🔓 Admin: ' : '🏫 Lǎoshī: ') + session.user.email),
              html('button', { className: 'secondary-btn', style: { margin: 0, padding: '6px 14px', fontSize: 13 }, onClick: handleLogout }, 'Cerrar sesión'),
            ),

            // ── Accesos directos ──
            adminTabs.length > 1 && html(ScrollX, null, html('nav', { className: 'admin-nav' }, adminTabs.map(t => html('button', { key: t.id, type: 'button',
              className: 'admin-nav-btn' + (tab === t.id ? ' on' : ''), title: t.sub, onClick: () => setAdminTab(t.id) },
              html(AulaIcon, { name: t.icon, tone: t.tone, size: 34 }),
              html('span', { className: 'admin-nav-txt' }, t.title))))),


            // ── Aulas ──
            showTab('aulas') && html(ClassManager, { session, isAdmin, isSuper, onReports }),

            // ── Equipo docente (admin y superadmin) ──
            isAdmin && showTab('equipo') && html(StaffManager, { session, isSuper }),

            // ── Papelera e historial de cambios (solo superadmin) ──
            isSuper && showTab('papelera') && html(ContentTrash, null),

            // ── Contenido: lecciones, módulos especiales y módulos de práctica ──
            isAdmin && showTab('contenido') && html(React.Fragment, null,
            html('p', { className: 'admin-note', style: { margin: 0 } },
              totalWords + ' palabras en ' + Object.keys(vocab).filter(id => id !== 'mod-paises' && id !== 'mod-numeros').length + ' lecciones.'),
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
                Object.keys(vocab).sort(lessonCompare).filter(id => id !== 'mod-paises' && id !== 'mod-numeros').map(id => {
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
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Activá o desactivá cada módulo para todos los alumnos y editá su contenido. En "Zhè shì shénme?" podés ocultar, cambiar o agregar fotos (se achican solas; si la palabra ya está en la base se usa su grabación original).'),
              html('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                [
                  { id: 'mod-frase',    icon: '🧩', name: 'Completá la frase',    editable: true },
                  { id: 'mod-orden',    icon: '🔀', name: 'Ordená la oración',    editable: true },
                  { id: 'mod-audio',    icon: '🔊', name: 'Reconocer por audio',  editable: false },
                  { id: 'mod-refuerzo', icon: '💪', name: 'Reforcemos',           editable: false },
                  { id: 'aula-zhe',     icon: '📷', name: 'Zhè shì shénme? (这是什么？)', editable: true, aula: true },
                  { id: 'aula-trazos',  icon: '✍️', name: 'Trazos', editable: true, aula: true, sub: 'Camino de hanzi de Mi aula · cada clase lo activa en su ⚙️ Configurar' },
                  { id: 'txt-frases',   icon: '💬', name: 'Frases del libro', editable: true, aula: true, sub: 'Frases clave y frases de contexto de cada lección', comp: 'frases' },
                  { id: 'txt-dia',      icon: '☀️', name: 'Frase del día', editable: true, aula: true, sub: 'El cartel "Lectura del día" del inicio', comp: 'dia' },
                ].map(m => {
                  const theme = LESSON_THEMES[m.id] || {};
                  const isHidden = !!theme.hidden;
                  const isOpen = expandedMod === m.id;
                  return html('div', { key: m.id },
                    html('div', {
                      style: { background: '#fff', borderRadius: isOpen ? '12px 12px 0 0' : 12, padding: '10px 14px', boxShadow: 'var(--shadow-paper)', display: 'flex', alignItems: 'center', gap: 10, opacity: isHidden ? 0.6 : 1 }
                    },
                      html('span', { style: { fontSize: 22, minWidth: 32 } }, m.icon),
                      html('div', { style: { flex: 1, fontWeight: 700, fontSize: 14 } }, m.name,
                        m.aula && html('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)' } }, m.sub || 'Fotos del juego de Mi aula · cada clase lo activa en su ⚙️ Configurar')),
                      m.editable && html('button', {
                        onClick: () => setExpandedMod(isOpen ? null : m.id),
                        title: isOpen ? 'Cerrar editor' : (m.aula ? 'Editar fotos' : 'Editar preguntas'),
                        style: { background: isOpen ? 'var(--lacquer)' : 'var(--paper-deep)', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: isOpen ? '#fff' : 'var(--ink)', marginRight: 4 }
                      }, isOpen ? '▲ Editar' : '▼ Editar'),
                      !m.aula && html('button', {
                        onClick: () => handleToggleVisibility(m.id),
                        title: isHidden ? 'Mostrar a alumnos' : 'Ocultar a alumnos',
                        style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: isHidden ? 0.4 : 1 }
                      }, isHidden ? '🚫' : '👁️'),
                    ),
                    isOpen && html('div', {
                      style: { background: 'var(--paper)', borderRadius: '0 0 12px 12px', padding: '12px 14px', boxShadow: 'var(--shadow-paper)', borderTop: '1px solid var(--paper-deep)' }
                    },
                      m.comp === 'frases' ? html(SentencesAdmin, { vocab }) : m.comp === 'dia' ? html(FrasesDiaAdmin)
                      : m.id === 'aula-trazos' ? html(TrazosAdmin, { vocab }) : m.aula ? html(ZheAdmin, { isSuper }) : html(ModuleQuestionsEditor, { modId: m.id })
                    ),
                  );
                })
              ),
            ),

            ), // cierre contenido

            // ── Registro de ingresos a la consola ──
            isAdmin && showTab('ingresos') && html('div', null,
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


            // ── Registro de alumnos (con y sin código) ──
            isAdmin && showTab('alumnos') && html('div', null,
              html('label', null, '👥 Registro de alumnos'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Todos los que entraron a la app, con código de aula o solo con su nombre: primera y última vez, visitas, sesiones de práctica y hasta qué lección llegaron. Tocá un alumno para resaltarlo' + (isSuper ? ' y ver desde dónde se conectó.' : '.')),
              !showActivityLog
                ? html('button', { className: 'secondary-btn', onClick: loadActivityLog }, 'Ver registro')
                : (() => {
                    const fmt = (d) => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                    const q = regSearch.trim().toLowerCase();
                    const rows = activityLog.filter(r => (regFilter === 'todos' || (regFilter === 'codigo') === !!r.has_code) && (!q || String(r.name || '').toLowerCase().includes(q)));
                    const nCode = activityLog.filter(r => r.has_code).length;
                    // Conexiones por cuenta y por IP (solo superadmin)
                    const ipsOf = {}, usersOfIp = {};
                    (isSuper && ipRows ? ipRows : []).forEach(x => {
                      (ipsOf[x.user_id] = ipsOf[x.user_id] || []).push(x);
                      (usersOfIp[x.ip] = usersOfIp[x.ip] || new Set()).add(x.user_id);
                    });
                    const nameOf = (id) => { const a = activityLog.find(x => x.user_id === id); return a ? (a.name || 'Sin nombre') : 'alguien del equipo docente'; };
                    const selReg = regSel && activityLog.find(x => x.user_id === regSel);
                    const ipPanel = isSuper && selReg && html('div', { className: 'ip-panel' },
                      html('div', { className: 'ip-panel-h' }, '🌐 Conexiones de ', html('b', null, selReg.name || 'Sin nombre'),
                        html('button', { className: 'sel-x', title: 'Cerrar', onClick: () => setRegSel(null) }, '✕')),
                      ipErr ? html('div', { className: 'admin-status err' }, '❌ ' + ipErr + (/function|does not exist/.test(ipErr) ? ' — ¿Ejecutaste npcr_ips.sql?' : ''))
                      : !(ipsOf[selReg.user_id] || []).length ? html('p', { className: 'admin-note', style: { margin: 0 } }, 'Todavía no hay conexiones registradas: se anotan desde que se corrió npcr_ips.sql, la próxima vez que esta cuenta abra la app.')
                      : html('div', { className: 'ip-list' }, ipsOf[selReg.user_id].map(x => {
                          const others = [...(usersOfIp[x.ip] || [])].filter(u => u !== selReg.user_id);
                          return html('div', { key: x.ip + x.device, className: 'ip-item' },
                            html('div', { className: 'ip-main' }, html('code', null, x.ip), html('span', null, x.device)),
                            html('div', { className: 'ip-sub' }, 'Primera vez ' + fmt(x.first_seen) + ' · última ' + timeAgo(x.last_seen) + ' · ' + x.hits + (x.hits === 1 ? ' visita' : ' visitas')),
                            others.length > 0 && html('div', { className: 'ip-same' }, '👥 Misma IP que: ' + others.map(nameOf).join(', ')));
                        })),
                      html('p', { className: 'admin-note', style: { margin: '8px 0 0', fontSize: 11 } }, 'Solo lo ve el superadmin. La misma IP suele ser la misma casa, escuela o red del celular; no identifica a una persona con certeza. Se guarda 90 días.'));
                    return html('div', null,
                      html('div', { className: 'reg-toolbar' },
                        [['todos', 'Todos (' + activityLog.length + ')'], ['codigo', '🎓 Con código (' + nCode + ')'], ['libre', 'Solo nombre (' + (activityLog.length - nCode) + ')']].map(([k, label]) =>
                          html('button', { key: k, className: 'report-tab' + (regFilter === k ? ' active' : ''), onClick: () => setRegFilter(k) }, label)),
                        html('input', { value: regSearch, onChange: e => setRegSearch(e.target.value), placeholder: 'Buscar por nombre…', style: { ...cmInput, flex: '1 1 160px' } }),
                        html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto', padding: '7px 12px', fontSize: 12 }, onClick: loadActivityLog }, '🔄 Actualizar'),
                      ),
                      mergeMsg && html('div', { className: 'admin-status ' + (mergeMsg.type === 'ok' ? 'ok' : 'err'), style: { marginBottom: 8 } }, mergeMsg.msg),
                      mergeFrom && html('div', { className: 'merge-box' },
                        html('div', null, '↪ Pasar el progreso de ', html('b', null, mergeFrom.name || 'Sin nombre'), ' (invitado · ' + mergeFrom.sessions + ' sesiones · ' + mergeFrom.visits + ' visitas) a:'),
                        html('select', { value: mergeTo, onChange: e => setMergeTo(e.target.value), style: { ...cmInput, width: '100%', marginTop: 8 } },
                          html('option', { value: '' }, 'Elegí el alumno con código…'),
                          activityLog.filter(x => x.has_code).sort((a, b) => String(a.name).localeCompare(String(b.name)))
                            .map(x => html('option', { key: x.user_id, value: x.user_id }, x.name + ' · ' + (x.class_name || '') + (x.code ? ' · ' + x.code : '')))),
                        html('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                          html('button', { className: 'primary-btn', style: { margin: 0, width: 'auto' }, disabled: !mergeTo, onClick: doMerge }, 'Pasar progreso'),
                          html('button', { className: 'secondary-btn', style: { margin: 0, width: 'auto' }, onClick: () => { setMergeFrom(null); setMergeTo(''); } }, 'Cancelar'))),
                      ipPanel,
                      activityError && html('div', { className: 'admin-status err' }, '❌ ' + activityError + (/function|does not exist/.test(activityError) ? ' — ¿Ejecutaste npcr_registro.sql?' : '')),
                      !activityError && rows.length === 0
                        ? html('p', { className: 'admin-note' }, activityLog.length ? 'Ningún alumno coincide con el filtro.' : 'Sin registros todavía.')
                        : html(ScrollX, { arrows: 'top' },
                            html('table', { className: 'rank-table cardify' },
                              html('thead', null, html('tr', null,
                                ['Alumno', 'Aula', 'Primera vez', 'Última vez', 'Visitas', 'Sesiones', 'Prom. 7 días', 'Hasta lección', ...(isSuper ? ['Conexión'] : [])].map(h => html('th', { key: h, style: { cursor: 'default' } }, h)))),
                              html('tbody', null, rows.map(r => html('tr', { key: r.user_id, className: regSel === r.user_id ? 'sel-row' : '',
                                  onClick: (e) => { if (!e.target.closest('button')) setRegSel(regSel === r.user_id ? null : r.user_id); } },
                                html('td', { className: 'cell-name', style: { fontWeight: 800, whiteSpace: 'nowrap' } },
                                  r.name || html('span', { style: { fontWeight: 600, fontStyle: 'italic', color: 'var(--ink-soft)' }, title: 'Abrió la app pero no escribió su nombre' }, 'Sin nombre'),
                                  html('span', { className: 'reg-badge' + (r.has_code ? ' code' : '') }, r.has_code ? 'código' : 'libre')),
                                html('td', { 'data-l': 'Aula', className: 'cell-wide', style: { fontSize: 12, whiteSpace: 'nowrap' } }, r.has_code ? (r.class_name || '—') + (r.code ? ' · ' + r.code : '')
                                  : html('span', { style: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' } },
                                      html('button', { className: 'mini-btn', title: 'Pasar el progreso de este invitado a un alumno con código', onClick: () => { setMergeFrom(r); setMergeTo(''); setMergeMsg(null); } }, '↪ Pasar a un alumno'),
                                      notices[r.user_id]
                                        ? html('span', { className: 'mini-btn', style: { cursor: 'default', background: 'var(--gold-light)' }, title: 'Enviado ' + timeAgo(notices[r.user_id]) + '. Desaparece cuando lo responda.' }, '✉️ Nombre pedido')
                                        : html('button', { className: 'mini-btn', title: 'Le aparece una ventana para que escriba su nombre', onClick: () => askName(r) }, '✉️ Pedir nombre'))),
                                html('td', { 'data-l': 'Primera vez', className: 'cell-wide', style: { fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap' } }, fmt(r.first_seen)),
                                html('td', { 'data-l': 'Última vez', style: { fontSize: 12, whiteSpace: 'nowrap' } }, timeAgo(r.last_seen)),
                                html('td', { 'data-l': 'Visitas' }, r.visits),
                                html('td', { 'data-l': 'Sesiones' }, r.sessions),
                                html('td', { 'data-l': 'Prom. 7 días' }, r.avg_7d == null ? '—' : html(MasteryPill, { value: r.avg_7d, small: true })),
                                html('td', { 'data-l': 'Hasta lección' }, r.max_lesson ? 'L' + r.max_lesson : '—'),
                                isSuper && html('td', { 'data-l': 'Conexión', className: 'cell-wide', style: { fontSize: 12, whiteSpace: 'nowrap' } }, (() => {
                                  const l = ipsOf[r.user_id];
                                  if (!l || !l.length) return '—';
                                  return html(React.Fragment, null, html('code', { className: 'ip-code' }, l[0].ip), ' ', html('span', { style: { color: 'var(--ink-soft)' } }, l[0].device.split(' · ')[0]),
                                    l.length > 1 && html('span', { className: 'ip-more' }, ' +' + (l.length - 1)));
                                })()),
                              ))),
                            ),
                          ),
                    );
                  })(),
            ),

            // ── Configuración del app ──
            isAdmin && showTab('config') && html('div', null,
              html('label', null, '⚙️ Configuración del app'),
              html('p', { className: 'admin-note', style: { margin: '6px 0 12px' } }, 'Editá los textos y módulos de la app sin tocar código.'),
              html(AppConfigEditor, { appConfig: appConfig || {}, onAppConfigChange }),
              html('details', { className: 'cfg-more' },
                html('summary', null, '🧩 Otros ajustes (alertas, juegos, invitados, exámenes…)'),
                html('p', { className: 'admin-note', style: { margin: '6px 0 10px' } }, 'Todos los demás valores de la app. Cambiá lo que necesites y tocá Guardar en ese ajuste: se aplica para todos.'),
                html(GenericConfigEditor, { onAppConfigChange })),
            ),
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
// Contenido más ancho que la pantalla (tablas, pestañas): barra visible, sombra en el borde
// y flechas ‹ › para ver lo que queda afuera. Las flechas solo aparecen si hay más.
function ScrollX({ children, className, style, innerStyle, arrows }) {
  const ref = React.useRef(null);
  const [st, setSt] = useState({ l: false, r: false });
  const update = () => {
    const el = ref.current; if (!el) return;
    const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 8;
    setSt(prev => prev.l === l && prev.r === r ? prev : { l, r });
  };
  // Se mide al montar, al cambiar de tamaño (ventana o contenido) y al desplazar.
  // No en cada render: mostrar u ocultar una flecha no debe volver a disparar la medición.
  React.useLayoutEffect(() => { update(); }, []);
  useEffect(() => {
    window.addEventListener('resize', update);
    let ro = null;
    if (window.ResizeObserver && ref.current) { ro = new ResizeObserver(update); ro.observe(ref.current); if (ref.current.firstElementChild) ro.observe(ref.current.firstElementChild); }
    return () => { window.removeEventListener('resize', update); if (ro) ro.disconnect(); };
  }, []);
  const go = (d) => { const el = ref.current; if (el) el.scrollBy({ left: d * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' }); };
  return html('div', { className: 'scrollx' + (st.l ? ' more-l' : '') + (st.r ? ' more-r' : '') + (arrows === 'top' ? ' arrows-top' : '') + (className ? ' ' + className : ''), style },
    html('div', { ref, className: 'scrollx-in', style: innerStyle, onScroll: update }, children),
    st.l && html('button', { type: 'button', className: 'scrollx-btn l', onClick: () => go(-1), 'aria-label': 'Ver más a la izquierda' }, '‹'),
    st.r && html('button', { type: 'button', className: 'scrollx-btn r', onClick: () => go(1), 'aria-label': 'Ver más a la derecha' }, '›'));
}

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
// Colores pedidos por el lǎoshī: 1° rojo · 2° verde · 3° azul · 4° violeta · neutro gris
const TONE_COLORS = { 1: '#D62828', 2: '#16A34A', 3: '#2563EB', 4: '#8B3FD9', 0: '#8A8A8A' };

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
// Preguntas dentro del tope de lección del aula ("habilitado hasta la lección N")
const lessonAllowed = (l, max) => { if (max == null) return true; const n = parseFloat(l); return isNaN(n) || n <= max; };
function withinLessons(raw, max) {
  const list = raw.filter(q => lessonAllowed(q.lesson, max));
  const firsts = raw.map(q => parseFloat(q.lesson)).filter(n => !isNaN(n));
  return { list, firstLesson: firsts.length ? Math.min(...firsts) : null };
}
const lockedByLessonMsg = (first, max) => '🔒 Esta actividad empieza en la lección ' + first + '. Tu aula está habilitada hasta la lección ' + max + ': cuando tu lǎoshī la habilite, aparece acá.';

function ClasificadorGame(props) {
  const { tipo = 'clasificador' } = props;
  const titles = { frase: 'Completá la frase', clasificador: 'Clasificadores', modal: 'Verbos modales', tiempo: 'Expresiones de tiempo' };
  const title = titles[tipo] || 'Clasificadores';
  const [raw, setRaw] = useState(null);
  const [rawErr, setRawErr] = useState(false);
  const load = () => {
    setRaw(null); setRawErr(false);
    db.from('npcr_clasificador_questions').select('sentence,pinyin,answer,answer_pinyin,options,hint,tipo,lesson')
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
  const lim = withinLessons(raw, props.maxLesson);
  if (!lim.list.length) return html(GameStatusScreen, { onBack: props.onBack, title, msg: lockedByLessonMsg(lim.firstLesson, props.maxLesson) });
  // Priorizar preguntas previamente fallidas (match por answer)
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...lim.list.filter(q => priorMissed.has(q.sentence.replace('___', q.answer))),
    ...shuffle(lim.list.filter(q => !priorMissed.has(q.sentence.replace('___', q.answer)))),
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
  // La pista no puede regalar la respuesta: antes de responder se ocultan las partes que la nombran
  const hintBefore = String(q.hint || '').split(/\s+[—–-]\s+/).filter(p => !p.includes(q.answer)).join(' — ');
  // Opciones cortas (una palabra) → cuadrícula de 2×2 con botones grandes
  const shortOpts = opts.length === 4 && opts.every(o => String(o).length <= 6);

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
      html('div', { className: 'clas-hint' }, selected ? '' : hintBefore),
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
        : html('div', { className: 'quiz-options' + (shortOpts ? ' grid2' : '') },
            opts.map(opt => html('button', { key: opt, className: 'quiz-option' + (shortOpts ? ' hanzi-font' : ''), onClick: () => handlePick(opt) }, opt))
          )
    )
  );
}

// ═════════════ Trazos (Mi aula): dibujar cada hanzi con el dedo, lección por lección ═════════════
// Usa los modelos de trazos que ya publica la app (NPCR_MEDIA.svg): de cada uno se toma
// la forma de cada trazo (para pintarlo prolijo) y su recorrido (para corregir orden,
// dirección y forma de lo que se dibuja). Progreso en npcr_trazos_done.
const _trazoCache = {};
function loadTrazos(ch) {
  if (_trazoCache[ch]) return _trazoCache[ch];
  _trazoCache[ch] = fetch(NPCR_MEDIA.svg[ch]).then(r => r.text()).then(txt => {
    const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
    const outlines = [...doc.querySelectorAll('clipPath path')].map(p => p.getAttribute('d'));
    const medians = [...doc.querySelectorAll('path[clip-path]')].map(p =>
      (p.getAttribute('d').match(/-?\d+(\.\d+)?/g) || []).map(Number).reduce((a, v, i, arr) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), []));
    if (!outlines.length || outlines.length !== medians.length) throw new Error('modelo incompleto');
    return { outlines, medians };
  });
  _trazoCache[ch].catch(() => { delete _trazoCache[ch]; });
  return _trazoCache[ch];
}
const tzDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const tzLen = (pts) => pts.reduce((s, p, i) => i ? s + tzDist(pts[i - 1], p) : 0, 0);
function tzResample(pts, n) {
  const total = tzLen(pts);
  if (pts.length < 2 || !total) return Array.from({ length: n }, () => pts[0]);
  const out = []; let seg = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = total * k / (n - 1);
    while (seg < pts.length - 2 && acc + tzDist(pts[seg], pts[seg + 1]) < target) { acc += tzDist(pts[seg], pts[seg + 1]); seg++; }
    const d = tzDist(pts[seg], pts[seg + 1]) || 1, t = Math.min(1, Math.max(0, (target - acc) / d));
    out.push([pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t]);
  }
  return out;
}
// ¿El trazo dibujado coincide con el del modelo? (empieza cerca, va en la dirección
// correcta, sigue la forma y tiene un largo parecido). lenient > 1 = más tolerante.
function tzMatch(user, median, lenient) {
  if (user.length < 2) return false;
  const L = lenient || 1;
  const lu = tzLen(user), lm = tzLen(median);
  if (lm < 90) {           // trazo muy corto (punto)
    const c = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    return tzDist(c(user), c(median)) < 170 * L && lu < 420;
  }
  const U = tzResample(user, 16), M = tzResample(median, 16);
  const avg = U.reduce((s, p, i) => s + tzDist(p, M[i]), 0) / U.length;
  const du = [U[15][0] - U[0][0], U[15][1] - U[0][1]], dm = [M[15][0] - M[0][0], M[15][1] - M[0][1]];
  const dirOk = du[0] * dm[0] + du[1] * dm[1] > 0;
  const ratio = lu / lm;
  return dirOk && ratio > 0.35 && ratio < 2.6 && avg < 150 * L && tzDist(U[0], M[0]) < 230 * L && tzDist(U[15], M[15]) < 260 * L;
}
const tzPathD = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + Math.round(p[0]) + ' ' + Math.round(p[1])).join(' ');

// Lienzo de un hanzi: muestra los trazos según el paso y recibe lo que se dibuja
function TrazoBoard({ data, mode, filled, current, hint, size, onStroke, animate, shake, run }) {
  const gRef = React.useRef(null);
  const [drawing, setDrawing] = useState(null);
  const uid = React.useRef('tz' + Math.random().toString(36).slice(2, 8)).current;
  const toChar = (e) => {
    const g = gRef.current; if (!g) return null;
    const m = g.getScreenCTM(); if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const canDraw = mode !== 'watch' && current < data.outlines.length;
  const down = (e) => { if (!canDraw) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = toChar(e); if (p) setDrawing([p]); };
  const move = (e) => { if (!drawing) return; const p = toChar(e); if (p && tzDist(p, drawing[drawing.length - 1]) > 6) setDrawing(d => [...d, p]); };
  const up = () => { if (!drawing) return; const pts = drawing; setDrawing(null); onStroke(pts); };
  const n = data.outlines.length;
  const showGuide = mode === 'trace' || mode === 'complete';
  const med = data.medians[current];
  // Flecha del trazo que toca (solo al calcar)
  const arrow = mode === 'trace' && med && med.length > 1 ? (() => {
    const a = med[0], b = med[Math.min(med.length - 1, Math.max(1, Math.floor(med.length / 2)))];
    return { a, b };
  })() : null;
  const COLORS = ['#C1432B', '#D97706', '#16A34A', '#2563EB', '#8B3FD9', '#DB2777', '#0891B2', '#65A30D'];
  return html('svg', { className: 'tz-board' + (shake ? ' shake' : ''), viewBox: '0 0 1024 1024', width: size, height: size,
      onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, style: { touchAction: 'none' } },
    html('defs', null,
      data.outlines.map((d, i) => html('clipPath', { key: i, id: uid + 'c' + i }, html('path', { d }))),
      html('marker', { id: uid + 'arr', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
        html('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#2563EB' }))),
    // Cuadrícula 田字格
    html('rect', { x: 8, y: 8, width: 1008, height: 1008, rx: 24, fill: '#fff', stroke: '#E8C9B8', strokeWidth: 6 }),
    html('g', { stroke: '#F0D5C6', strokeWidth: 4, strokeDasharray: '18 14' },
      html('line', { x1: 512, y1: 8, x2: 512, y2: 1016 }), html('line', { x1: 8, y1: 512, x2: 1016, y2: 512 }),
      html('line', { x1: 8, y1: 8, x2: 1016, y2: 1016 }), html('line', { x1: 1016, y1: 8, x2: 8, y2: 1016 })),
    html('g', { ref: gRef, transform: 'scale(1, -1) translate(0, -900)' },
      // Guía gris: al calcar y completar se ven todos los trazos del hanzi
      showGuide && data.outlines.map((d, i) => html('path', { key: 'g' + i, d, fill: mode === 'complete' ? '#EFEAE4' : '#E2DCD5' })),
      // Trazo que toca, más marcado (solo al calcar)
      mode === 'trace' && current < n && html('path', { d: data.outlines[current], fill: '#C9D8F5' }),
      // Trazos ya hechos, pintados prolijos
      data.outlines.map((d, i) => filled[i] && html('path', { key: 'f' + i, d, fill: mode === 'watch' ? '#3a3a3a' : COLORS[i % COLORS.length], className: 'tz-fill' })),
      // Animación (mirar / pista): el recorrido se dibuja recortado por la forma del trazo
      (animate || []).map(({ i, delay }) => {
        const m = data.medians[i]; const len = Math.ceil(tzLen(m)) + 20;
        return html('path', { key: 'a' + i + '-' + delay + '-' + (run || 0), d: tzPathD(m), clipPath: 'url(#' + uid + 'c' + i + ')', fill: 'none', stroke: '#C1432B', strokeWidth: 150, strokeLinecap: 'round',
          strokeDasharray: len, strokeDashoffset: len, className: 'tz-anim', style: { '--len': len, animationDelay: delay + 's' } });
      }),
      // Pista: el trazo que toca parpadea
      hint && current < n && html('path', { d: data.outlines[current], className: 'tz-hint', fill: '#F59E0B' }),
      // Punto de inicio y flecha
      arrow && html('g', null,
        html('line', { x1: arrow.a[0], y1: arrow.a[1], x2: arrow.b[0], y2: arrow.b[1], stroke: '#2563EB', strokeWidth: 16, strokeLinecap: 'round', markerEnd: 'url(#' + uid + 'arr)', opacity: 0.85 }),
        html('circle', { cx: arrow.a[0], cy: arrow.a[1], r: 34, fill: '#2563EB', className: 'tz-start' })),
      // Lo que se está dibujando
      drawing && drawing.length > 1 && html('path', { d: tzPathD(drawing), fill: 'none', stroke: '#1F2937', strokeWidth: 44, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.55 }),
    ));
}

// Practicar un hanzi: Mirar → Calcar → Completar → De memoria (hasta el 100 %)
function TrazoPractice({ ch, word, inWord, info, onDone, onComplete, onBack, title, path, onJump }) {
  const [tip, holdProps] = useHoldTip();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [stage, setStage] = useState(0);          // 0 mirar · 1 calcar · 2 completar · 3 memoria · 4 listo
  const [current, setCurrent] = useState(0);
  const [filled, setFilled] = useState([]);
  const [misses, setMisses] = useState(0);
  const [hint, setHint] = useState(false);
  const [shake, setShake] = useState(false);
  const [animate, setAnimate] = useState([]);
  const [run, setRun] = useState(0);
  const [msg, setMsg] = useState(null);
  const [size, setSize] = useState(300);
  const wrapRef = React.useRef(null);
  const boxRef = React.useRef(null);
  const belowRef = React.useRef(null);
  useEffect(() => { loadTrazos(ch).then(setData, e => setErr(String(e.message || e))); }, [ch]);
  useEffect(() => stopAudio, []);
  // Tamaño del cuadro: lo más grande posible sin deslizar
  const fit = () => {
    const el = wrapRef.current, box = boxRef.current, below = belowRef.current; if (!el || !box || !below) return;
    const top = box.getBoundingClientRect().top + window.scrollY;
    const h = window.innerHeight - top - below.getBoundingClientRect().height - 20;
    setSize(Math.max(200, Math.min(el.clientWidth, h, 560)));
  };
  React.useLayoutEffect(fit, [data]);
  useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, []);

  const n = data ? data.outlines.length : 0;
  const keep = Math.ceil(n / 2);                  // en "Completar", trazos que ya vienen hechos
  const startStage = (s) => {
    setStage(s); setMisses(0); setHint(false); setMsg(null);
    if (s === 0) { setFilled([]); setCurrent(0); setRun(r => r + 1); setAnimate(data.outlines.map((_, i) => ({ i, delay: 0.25 + i * 0.75 }))); stopAudio(); audioLater(() => speakReal(ch), 200); }
    if (s === 1) { setFilled([]); setCurrent(0); setAnimate([]); }
    if (s === 2) { setFilled(data.outlines.map((_, i) => i < keep)); setCurrent(keep); setAnimate([]); }
    if (s === 3) { setFilled([]); setCurrent(0); setAnimate([]); }
  };
  useEffect(() => { if (data) startStage(0); }, [data]);

  if (err) return html(GameStatusScreen, { onBack, title: title || 'Trazos', msg: 'No se pudo cargar el modelo de ' + ch + '.' });
  if (!data) return html(GameStatusScreen, { onBack, title: title || 'Trazos', msg: '⏳ Cargando ' + ch + '…' });

  // Avance total: mirar (1) + calcar (n) + completar (n-keep) + memoria (n)
  const totalSteps = 1 + n + (n - keep) + n;
  const doneSteps = stage === 0 ? 0 : stage === 1 ? 1 + current : stage === 2 ? 1 + n + (current - keep) : stage === 3 ? 1 + n + (n - keep) + current : totalSteps;
  const pct = Math.round(doneSteps / totalSteps * 100);

  const onStroke = (pts) => {
    if (stage === 0 || stage === 4 || current >= n) return;
    const lenient = stage === 1 ? 1.25 : stage === 2 ? 1.1 : 1;
    if (tzMatch(pts, data.medians[current], lenient)) {
      const f = filled.slice(); f[current] = true; setFilled(f);
      setMisses(0); setHint(false); setMsg(null);
      const next = current + 1;
      setCurrent(next);
      if (next >= n) {
        playCorrect();
        if (stage < 3) setTimeout(() => startStage(stage + 1), 650);
        else { setStage(4); playLevelChime(); audioLater(() => speakReal(ch), 250); setAnimate([]); onComplete && onComplete(); }
      }
    } else {
      playWrong(); setShake(true); setTimeout(() => setShake(false), 350);
      // ¿Dibujó otro trazo del hanzi? → avisar del orden
      const other = data.medians.findIndex((m, i) => i !== current && !filled[i] && tzMatch(pts, m, 1));
      setMsg(other > current ? 'Ese trazo va después: seguí el orden.' : 'Probá de nuevo: fijate dónde empieza y hacia dónde va.');
      const m = misses + 1; setMisses(m);
      if (m >= 2) setHint(true);
    }
  };

  const STAGES = ['Mirá', 'Calcá', 'Completá', 'De memoria'];
  const INSTR = ['Mirá el orden de los trazos.', 'Repasá cada trazo desde el punto azul, siguiendo la flecha.', 'Dibujá los trazos que faltan.', 'Dibujá el hanzi completo, en orden.'];
  return html('main', { className: 'tz-main', style: { paddingTop: 14, paddingBottom: 8 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', null, title || 'Trazos'),
      html('div', { className: 'flash-counter' }, pct + '%')),
    html('div', { className: 'tz-wrap', ref: wrapRef },
      html('div', { className: 'tz-bar' }, html('i', { style: { width: pct + '%' } })),
      html('div', { className: 'tz-steps' }, STAGES.map((s, i) => html('span', { key: s, className: i < stage ? 'done' : i === stage ? 'now' : '' }, s))),
      path && html(ScrollX, { className: 'tz-path-wrap' }, html('div', { className: 'tz-path' }, path.map((x, i) => html('button', { key: x.c, type: 'button',
        className: 'tz-path-c hanzi-font' + (x.c === ch ? ' now' : '') + (x.done ? ' done' : ''), ...holdProps('P' + x.c, () => x.c !== ch && onJump && onJump(i)) },
        x.c, x.done && html('i', null, '✓'))))),
      tip && path && (() => { const x = path.find(y => 'P' + y.c === tip); return x && x.py ? html('div', { className: 'tz-path-tip' }, html('span', { className: 'hanzi-font' }, x.c), ' ', html(TonedPinyin, { text: x.py })) : null; })(),
      html('div', { className: 'tz-word' },
        html('span', { className: 'hanzi-font tz-ch' }, ch),
        (info || word) && html('span', null, html(TonedPinyin, { text: (info || word).pinyin, className: 'tz-py' }), html('small', null, (info || word).es))),
      html('div', { className: 'tz-board-box', ref: boxRef, style: { height: size } },
        stage === 4 && (info || word || inWord) && html('div', { className: 'tz-info', style: { width: size } },
          html('span', { className: 'tz-info-ch hanzi-font' }, ch),
          info
            ? html('span', { className: 'tz-info-txt' }, html(TonedPinyin, { text: info.pinyin, className: 'tz-info-py' }), html('span', null, info.es))
            : word
            ? html('span', { className: 'tz-info-txt' }, html(TonedPinyin, { text: word.pinyin, className: 'tz-info-py' }), html('span', null, word.es))
            : html('span', { className: 'tz-info-txt' }, html('small', null, 'en'), html('b', { className: 'hanzi-font' }, inWord.hanzi),
                html(TonedPinyin, { text: inWord.pinyin, className: 'tz-info-py' }), html('span', null, inWord.es))),
        html(TrazoBoard, { data, size, filled, current, hint, shake, animate, run, onStroke,
          mode: stage === 0 ? 'watch' : stage === 1 ? 'trace' : stage === 2 ? 'complete' : stage === 3 ? 'memory' : 'watch' })),
      html('div', { ref: belowRef, className: 'tz-below' },
      html('div', { className: 'tz-msg' + (stage === 4 ? ' ok' : msg ? ' bad' : '') },
        stage === 4 ? '¡Muy bien! Dibujaste ' + ch + ' completo.' : msg || INSTR[stage]),
      html('div', { className: 'tz-btns' },
        stage === 0 && html(React.Fragment, null,
          html('button', { className: 'secondary-btn', onClick: () => startStage(0) }, '↻ Ver de nuevo'),
          html('button', { className: 'primary-btn', onClick: () => startStage(1) }, 'Empezar →')),
        (stage === 1 || stage === 2 || stage === 3) && html('button', { className: 'secondary-btn', onClick: () => { setHint(true); setMisses(2); } }, '💡 Pista'),
        stage === 4 && html('button', { className: 'primary-btn', onClick: onDone }, 'Siguiente →'))),
    ));
}

// Camino del 1 al 14: cada lección se desbloquea al completar todos los hanzi de la anterior
// Mantener apretado (o pasar el mouse) muestra el pinyin; un toque corto abre el hanzi
function useHoldTip() {
  const [tip, setTip] = useState(null);
  const timer = React.useRef(null);
  const held = React.useRef(false);
  const props = (key, onTap) => ({
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') setTip(key); },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') setTip(t => (t === key ? null : t)); },
    onPointerDown: (e) => { if (e.pointerType === 'mouse') return; held.current = false; clearTimeout(timer.current);
      timer.current = setTimeout(() => { held.current = true; setTip(key); }, 320); },
    onPointerUp: (e) => { if (e.pointerType === 'mouse') return; clearTimeout(timer.current); if (held.current) setTimeout(() => setTip(t => (t === key ? null : t)), 1200); },
    onPointerCancel: () => { clearTimeout(timer.current); setTip(null); },
    onContextMenu: (e) => e.preventDefault(),
    onClick: () => { if (held.current) { held.current = false; return; } onTap && onTap(); },
  });
  return [tip, props];
}

// Camino de Trazos: cada hanzi la primera vez que aparece en una lección (con modelo de trazos),
// corregido por el admin (npcr_trazos_admin): ocultar, mover de lección, agregar y ordenar.
// withHidden: para la consola (muestra también los ocultos, marcados).
function trazosPath(vocab, lessons, cfg, withHidden) {
  const conf = {}; (cfg || []).forEach(r => { conf[r.hanzi] = r; });
  const wordWith = (c) => { for (const l of Object.keys(vocab)) { const w = (vocab[l] || []).find(x => String(x.hanzi || '').includes(c)); if (w) return w; } return null; };
  const ls = lessons.filter(l => /^\d+$/.test(l)).sort(lessonCompare);
  const by = {}; ls.forEach(l => { by[l] = []; });
  const seen = new Set(); let k = 0;
  ls.forEach(l => (vocab[l] || []).forEach(w => [...String(w.hanzi || '')].forEach(c => {
    if (seen.has(c) || !NPCR_MEDIA.svg[c]) return;
    seen.add(c);
    const r = conf[c] || {};
    const to = r.lesson && by[r.lesson] ? r.lesson : l;
    by[to].push({ c, w, k: k++, hidden: !!r.hidden, moved: to !== l, from: l, pos: r.position }); })));
  // Agregados por el admin que no salían solos
  Object.values(conf).forEach(r => {
    if (seen.has(r.hanzi) || !r.lesson || !by[r.lesson] || !NPCR_MEDIA.svg[r.hanzi]) return;
    by[r.lesson].push({ c: r.hanzi, w: wordWith(r.hanzi), k: k++, hidden: !!r.hidden, added: true, pos: r.position });
  });
  return ls.map(l => ({ lesson: l, chars: by[l]
    .filter(x => withHidden || !x.hidden)
    .sort((a, b) => (a.pos == null ? 1e6 + a.k : a.pos) - (b.pos == null ? 1e6 + b.k : b.pos)) }))
    .filter(x => withHidden || x.chars.length);
}

function TrazosGame({ vocab, lessons, studentId, maxLesson, onBack }) {
  const [info, setInfo] = useState({});
  const [tip, holdProps] = useHoldTip();
  useEffect(() => {
    db.from('npcr_hanzi_info').select('hanzi,pinyin,es').eq('hidden', false).then(({ data }) => {
      const m = {}; (data || []).forEach(r => { m[r.hanzi] = r; }); setInfo(m);
    });
  }, []);
  const [done, setDone] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('npcr-trazos-' + studentId)) || []); } catch (e) { return new Set(); } });
  const [view, setView] = useState({ name: 'map' });
  useEffect(() => {
    db.from('npcr_trazos_done').select('hanzi').eq('student_id', studentId).then(({ data }) => {
      if (data) setDone(prev => { const s = new Set(prev); data.forEach(r => s.add(r.hanzi)); return s; });
    });
  }, []);
  useEffect(() => { try { localStorage.setItem('npcr-trazos-' + studentId, JSON.stringify([...done])); } catch (e) {} }, [done]);
  const [cfg, setCfg] = useState([]);
  useEffect(() => { db.from('npcr_trazos_admin').select('*').then(({ data, error }) => { if (!error) setCfg(data || []); }); }, []);

  // Hanzi de cada lección (con los cambios que haya hecho el admin)
  // Solo las lecciones que habilita el aula ("habilitado hasta la lección N")
  const path = useMemo(() => trazosPath(vocab, lessons, cfg, false).filter(p => !maxLesson || parseFloat(p.lesson) <= maxLesson), [vocab, lessons, cfg, maxLesson]);
  const wordOf = (c, w) => (w && w.hanzi === c) ? w : (Object.values(vocab).flat().find(x => x.hanzi === c) || null);
  const inWordOf = (c, w) => (w && w.hanzi !== c && String(w.hanzi).includes(c)) ? w : null;
  const lessonDone = (p) => p.chars.every(x => done.has(x.c));
  const unlocked = (k) => k === 0 || lessonDone(path[k - 1]);
  const allDone = path.length > 0 && path.every(lessonDone);

  const markDone = (c) => {
    setDone(prev => new Set([...prev, c]));
    db.from('npcr_trazos_done').upsert({ student_id: studentId, hanzi: c }, { onConflict: 'student_id,hanzi', ignoreDuplicates: true }).then(() => {});
  };

  if (view.name === 'practice') {
    const p = path[view.k]; const item = p.chars[view.i];
    const nextIdx = p.chars.findIndex((x, i) => i > view.i && !done.has(x.c));
    return html(TrazoPractice, { key: item.c, ch: item.c, word: wordOf(item.c, item.w), inWord: wordOf(item.c, item.w) ? null : inWordOf(item.c, item.w), title: 'Lección ' + p.lesson + ' · ' + (view.i + 1) + '/' + p.chars.length,
      path: p.chars.map(x => ({ c: x.c, done: done.has(x.c), py: info[x.c] && info[x.c].pinyin })), onJump: (i) => setView({ name: 'practice', k: view.k, i }),
      info: info[item.c] || null,
      onBack: () => setView({ name: 'lesson', k: view.k }),
      onComplete: () => markDone(item.c),     // se guarda apenas termina, aunque no toque "Siguiente"
      onDone: () => {
        const firstLeft = nextIdx >= 0 ? nextIdx : p.chars.findIndex(x => x.c !== item.c && !done.has(x.c));
        setView(firstLeft >= 0 ? { name: 'practice', k: view.k, i: firstLeft } : { name: 'lesson', k: view.k, justDone: true });
      } });
  }
  if (view.name === 'lesson') {
    const p = path[view.k];
    const finished = lessonDone(p);
    return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
      html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: () => setView({ name: 'map' }) }, '←'),
        html('h1', null, 'Trazos · Lección ' + p.lesson)),
      html('div', { className: 'tz-wrap' },
        finished && html('div', { className: 'tz-banner' }, view.justDone ? '🎉 ¡Completaste la lección ' + p.lesson + '!' : '✓ Lección completa', view.k + 1 < path.length && unlocked(view.k + 1) && html('button', { className: 'mini-btn', onClick: () => setView({ name: 'lesson', k: view.k + 1 }) }, 'Ir a la lección ' + path[view.k + 1].lesson + ' →')),
        html('div', { className: 'tz-chars' }, p.chars.map((x, i) => html('button', { key: x.c, className: 'tz-char hanzi-font' + (done.has(x.c) ? ' done' : ''),
          ...holdProps('L' + x.c, () => setView({ name: 'practice', k: view.k, i })) },
          x.c, done.has(x.c) && html('span', { className: 'tz-check' }, '✓'),
          tip === 'L' + x.c && info[x.c] && html(TonedPinyin, { text: info[x.c].pinyin, className: 'tz-tip' })))),
        !finished && html('button', { className: 'primary-btn', style: { width: '100%', marginTop: 14 },
          onClick: () => setView({ name: 'practice', k: view.k, i: Math.max(0, p.chars.findIndex(x => !done.has(x.c))) }) }, 'Seguir practicando →')));
  }
  // Mapa de lecciones
  return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', null, '✍️ Trazos')),
    html('div', { className: 'tz-wrap' },
      allDone
        ? html('div', { className: 'tz-win' }, html('div', { className: 'tz-win-big' }, '🏆'), html('b', null, maxLesson ? '¡Completaste las lecciones habilitadas!' : '¡Ganaste!'),
            html('span', null, 'Dibujaste los ' + path.reduce((s, p) => s + p.chars.length, 0) + ' hanzi de ' + (path.length === 1 ? 'la lección 1' : 'las ' + path.length + ' lecciones') + '.'
              + (maxLesson ? ' Cuando tu lǎoshī habilite más lecciones, aparecen acá.' : '')))
        : html('p', { className: 'zhe-intro' }, 'Dibujá cada hanzi con el dedo, en el orden correcto. Completá una lección para desbloquear la siguiente, hasta la lección ' + (path.length ? path[path.length - 1].lesson : '') + '.'),
      html('div', { className: 'tz-map' }, path.map((p, k) => {
        const n = p.chars.filter(x => done.has(x.c)).length;
        const open = unlocked(k), full = n === p.chars.length;
        return html('button', { key: p.lesson, className: 'tz-node' + (full ? ' full' : open ? ' open' : ' locked'), disabled: !open, onClick: () => setView({ name: 'lesson', k }) },
          html('span', { className: 'tz-node-n' }, full ? '✓' : open ? p.lesson : '🔒'),
          html('span', { className: 'tz-node-t' }, 'Lección ' + p.lesson),
          html('span', { className: 'tz-node-s' }, open || full ? n + '/' + p.chars.length + ' hanzi' : 'Completá la lección ' + path[k - 1].lesson),
          html('span', { className: 'tz-node-bar' }, html('i', { style: { width: Math.round(n / p.chars.length * 100) + '%' } })));
      }))));
}

// ═════════════ 这是什么？ (Mi aula): mirá la foto y elegí el hanzi, contra reloj ═════════════
// Fotos y palabras en npcr_zhe_items; rondas y velocidades en npcr_app_config 'zhe_config'.
function ZheGame({ onBack, onFinish, zheConfig }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [speed, setSpeed] = useState(null);       // segundos por foto (null = pantalla de inicio)
  const [game, setGame] = useState(null);         // { list, i, opts, picked, score, ok, streak, best, missed }
  const [left, setLeft] = useState(0);            // milisegundos que quedan
  const [done, setDone] = useState(false);
  const [n, setN] = useState(0);                  // para "Otra vez"
  // Alto de la foto: lo que queda de pantalla debajo del encabezado, para que foto,
  // frase y las 4 opciones entren sin deslizar. Se calcula una vez por tamaño de pantalla
  // (no cambia al responder, así nada se mueve).
  const photoRef = React.useRef(null);
  const belowRef = React.useRef(null);
  const [photoH, setPhotoH] = useState(null);
  const [belowH, setBelowH] = useState(null);
  const dims = React.useRef(null);
  const fitPhoto = () => {
    const ph = photoRef.current, below = belowRef.current;
    if (!ph || !below) return;
    dims.current = { w: window.innerWidth, h: window.innerHeight };
    const top = ph.getBoundingClientRect().top + window.scrollY;
    below.style.minHeight = '';            // medir el alto natural (frase + 4 opciones)
    ph.style.height = '';
    const bh = below.getBoundingClientRect().height;
    const free = window.innerHeight - top - bh - 18;
    setBelowH(Math.ceil(bh));
    setPhotoH(Math.max(120, Math.min(460, Math.floor(free))));
  };
  React.useLayoutEffect(() => {
    if (!game || game.picked) return;
    const d = dims.current;
    if (photoH === null || !d || d.w !== window.innerWidth || Math.abs(d.h - window.innerHeight) > 120) fitPhoto();
  });
  useEffect(() => {
    const onResize = () => {
      const d = dims.current;
      if (!d || d.w !== window.innerWidth || Math.abs(d.h - window.innerHeight) > 120) { setPhotoH(null); setBelowH(null); }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);
  useEffect(() => {
    db.from('npcr_zhe_items').select('*').eq('hidden', false).order('id').then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      (data || []).forEach(r => { if (r.audio) EXTRA_AUDIO[r.hanzi.replace(MEDIA_PUNCT_RE, '')] = r.audio; });
      setItems(data || []);
    });
  }, []);
  useEffect(() => stopAudio, []);

  const cfg = zheConfig && zheConfig.rounds && Array.isArray(zheConfig.speeds) ? zheConfig : null;
  const q = game && game.list[game.i];
  const answered = !!(game && game.picked);

  // Reloj: corre mientras no se respondió
  useEffect(() => {
    if (!game || answered || done) return;
    if (left <= 0) { finishTurn(null); return; }
    const t = setTimeout(() => setLeft(l => l - 100), 100);
    return () => clearTimeout(t);
  }, [left, game && game.i, answered, done]);

  if (err) return html(GameStatusScreen, { onBack, title: '这是什么？', msg: '❌ ' + err + ' (¿ejecutaste npcr_zhe.sql?)' });
  if (!items) return html(GameStatusScreen, { onBack, title: '这是什么？', msg: '⏳ Cargando fotos...' });
  if (!cfg) return html(GameStatusScreen, { onBack, title: '这是什么？', msg: 'Falta la configuración del juego (zhe_config en la configuración de la app).' });
  if (items.length < 4) return html(GameStatusScreen, { onBack, title: '这是什么？', msg: 'Todavía no hay fotos cargadas para este juego.' });

  const optionsFor = (it) => shuffle([it, ...shuffle(items.filter(x => x.hanzi !== it.hanzi)).slice(0, 3)]);
  const start = (sec) => {
    const list = shuffle(items).slice(0, Math.min(cfg.rounds, items.length));
    setSpeed(sec);
    setGame({ list, i: 0, opts: optionsFor(list[0]), picked: null, score: 0, ok: 0, streak: 0, best: 0, missed: [] });
    setLeft(sec * 1000); setDone(false); setN(x => x + 1);
  };
  function finishTurn(pick) {
    if (!game || game.picked) return;
    const good = pick && pick.hanzi === q.hanzi;
    const pts = good ? 100 + Math.round(Math.max(0, left) / 100) : 0;
    const streak = good ? game.streak + 1 : 0;
    if (good) playLevelChime(); else playWrong();
    audioLater(() => speakReal(q.hanzi), good ? 350 : 500);
    setGame({ ...game, picked: pick || { timeout: true }, score: game.score + pts, ok: game.ok + (good ? 1 : 0), streak, best: Math.max(game.best, streak),
      missed: good ? game.missed : [...game.missed, { hanzi: q.hanzi, pinyin: q.pinyin, es: q.es }] });
  }
  const next = () => {
    stopAudio();
    if (game.i + 1 >= game.list.length) {
      setDone(true);
      onFinish && onFinish(Math.round(game.ok / game.list.length * 100), game.missed);
      return;
    }
    const i = game.i + 1;
    setGame({ ...game, i, opts: optionsFor(game.list[i]), picked: null });
    setLeft(speed * 1000);
  };

  // ── Inicio: elegir velocidad ──
  if (!game) return html('main', { style: { paddingTop: 18, paddingBottom: 40 } },
    html('div', { className: 'header-row' }, html('button', { className: 'back-btn', onClick: onBack }, '←'), html('h1', { className: 'hanzi-font' }, '这是什么？')),
    html('div', { className: 'zhe-wrap' },
      html('p', { className: 'zhe-intro' }, 'Mirá la foto y elegí el hanzi que completa ', html('b', { className: 'hanzi-font' }, '这是＿＿。'),
        ' Cuanto más rápido respondas, más puntos. ' + cfg.rounds + ' fotos por partida.'),
      html('div', { className: 'zhe-speeds' }, cfg.speeds.map(sp => html('button', { key: sp.name, className: 'zhe-speed' + (sp.name === cfg.default ? ' def' : ''), onClick: () => start(sp.sec) },
        html('b', null, sp.name), html('span', null, sp.sec + ' s por foto')))),
    ));

  // ── Resultado ──
  if (done) return html(HskResult, {
    title: '这是什么？', ok: game.ok, total: game.list.length,
    missed: game.missed.map(m => ({ t: m.hanzi, py: m.pinyin, es: m.es })),
    onAgain: () => start(speed), onBack,
  }, html('div', { className: 'zhe-final' },
    html('div', null, html('b', null, game.score), html('span', null, 'puntos')),
    html('div', null, html('b', null, game.best), html('span', null, 'mejor racha'))));

  // ── Juego ──
  const total = speed * 1000;
  const pct = Math.max(0, Math.min(100, left / total * 100));
  const good = answered && game.picked.hanzi === q.hanzi;
  return html('main', { className: 'zhe-main', style: { paddingTop: 14, paddingBottom: 24 } },
    html('div', { className: 'header-row' },
      html('button', { className: 'back-btn', onClick: onBack }, '←'),
      html('h1', { className: 'hanzi-font' }, '这是什么？'),
      html('div', { className: 'flash-counter' }, (game.i + 1) + '/' + game.list.length)),
    html('div', { className: 'zhe-wrap' },
      html('div', { className: 'zhe-stats' },
        html('span', null, '⭐ ', html('b', null, game.score)),
        game.streak > 1 && html('span', { className: 'zhe-streak' }, '🔥 ' + game.streak + ' seguidas'),
        html('span', null, '⏱ ', html('b', null, Math.ceil(Math.max(0, left) / 1000) + ' s'))),
      html('div', { className: 'zhe-timer' + (pct < 30 ? ' low' : '') }, html('i', { style: { width: (answered ? 0 : pct) + '%' } })),
      html('div', { className: 'zhe-photo', ref: photoRef, style: photoH ? { height: photoH } : null }, html('img', { key: q.id, src: q.image, alt: '' })),
      html('div', { ref: belowRef, className: 'zhe-below', style: belowH ? { minHeight: belowH } : null },
      html('div', { className: 'zhe-q hanzi-font' }, '这是',
        html('span', { className: 'zhe-blank' + (answered ? (good ? ' ok' : ' bad') : '') }, answered ? q.hanzi : ''), '。'),
      answered
        ? html('div', { className: 'zhe-fb ' + (good ? 'ok' : 'bad') },
            html('div', { className: 'zhe-fb-title' }, good ? '¡Correcto!' : game.picked.timeout ? '⏱ Se acabó el tiempo' : 'Incorrecto'),
            html(TonedPinyin, { text: 'Zhè shì ' + q.pinyin + '.', className: 'zhe-fb-py' }),
            html('div', { className: 'zhe-fb-es' }, q.es_s),
            html('div', { className: 'zhe-fb-btns' },
              html('button', { className: 'mini-btn', onClick: () => speakReal(q.hanzi) }, '🔊 Escuchar'),
              html('button', { className: 'primary-btn', onClick: next }, game.i + 1 >= game.list.length ? 'Ver resultado' : 'Siguiente →')))
        : html('div', { className: 'quiz-options grid2 zhe-opts' },
            game.opts.map(o => html('button', { key: o.hanzi, className: 'quiz-option hanzi-font', onClick: () => finishTurn(o) }, o.hanzi)))),
    ));
}

// ----------------- Prueba: Diálogo -----------------
function DialogoGame(props) {
  const [raw, rawErr, rawReload] = useGameQuestions(
    'npcr_dialogo_questions',
    'context,line_a,line_b,blank_in,answer,answer_pinyin,answer_es,options,explanation,lesson',
    r => ({ context: r.context, A: r.line_a, B: r.line_b, blankIn: r.blank_in, answer: r.answer, answerPinyin: r.answer_pinyin, answerEs: r.answer_es, options: r.options, explanation: r.explanation, lesson: r.lesson })
  );
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: '❌ Error de conexión.', onRetry: rawReload });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completa el diálogo', msg: 'Todavía no hay preguntas cargadas. Pedile a tu lǎoshī que las suba desde el panel de administrador.' });
  const lim = withinLessons(raw, props.maxLesson);
  if (!lim.list.length) return html(GameStatusScreen, { onBack: props.onBack, title: 'Completá el diálogo', msg: lockedByLessonMsg(lim.firstLesson, props.maxLesson) });
  // Priorizar preguntas previamente fallidas
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...lim.list.filter(q => priorMissed.has(q.answer)),
    ...shuffle(lim.list.filter(q => !priorMissed.has(q.answer))),
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
  const [raw, rawErr, rawReload] = useGameQuestions('npcr_orden_questions', 'words,correct,es,pinyin,lesson', r => r);
  if (rawErr) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: '❌ Error de conexión.', onRetry: rawReload });
  if (raw === null) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: '⏳ Cargando preguntas...' });
  if (raw.length === 0) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordena la oración', msg: 'Todavía no hay preguntas cargadas. Pedile a tu lǎoshī que las suba desde el panel de administrador.' });
  const lim = withinLessons(raw, props.maxLesson);
  if (!lim.list.length) return html(GameStatusScreen, { onBack: props.onBack, title: 'Ordená la oración', msg: lockedByLessonMsg(lim.firstLesson, props.maxLesson) });
  // Priorizar preguntas previamente fallidas (matched por oración correcta)
  const priorMissed = new Set((props.priorMissed || []).map(m => m.hanzi));
  const ordered = [
    ...lim.list.filter(q => priorMissed.has(q.correct)),
    ...shuffle(lim.list.filter(q => !priorMissed.has(q.correct))),
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