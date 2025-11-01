// app.js - modernized, responsive, safe render + robust QR loader
// Keep ENDPOINT blank unless you have a server (no client secrets here)
const OUTBOX_KEY = 'poc:outbox';
const UID_KEY = 'poc:uid';
const NAME_KEY_PREFIX = 'poc:done:';
const VOTES_KEY_PREFIX = 'poc:votes:';
const VERSION = '0.3-responsive';
const ENDPOINT = ''; // optional server endpoint

/* ---------------- Configuration Update ---------------- */
// Placeholder for the Google Form URL. Please replace this with your actual form link.
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScP_55QY_x0_R_K_9h2XlXm_w7y_qGqA4N6j1Q/viewform?usp=sf_link';


/* ---------------- utilities ---------------- */
const $ = s => document.querySelector(s);
const safeGet = (k, fallback = null) => {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { console.warn('safeGet', k, e); return fallback; }
};
const safeSet = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { console.error('safeSet', e); return false; }
};
const uid = () => {
  try { return localStorage.getItem(UID_KEY) || crypto.randomUUID(); }
  catch { return localStorage.getItem(UID_KEY) || 'p_' + Math.random().toString(36).slice(2,10); }
};
let TESTER_ID = localStorage.getItem(UID_KEY) || uid();
localStorage.setItem(UID_KEY, TESTER_ID);

const toastWrap = document.createElement('div');
toastWrap.className = 'toastWrap';
document.body.appendChild(toastWrap);
function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + (opts.type === 'error' ? 'error' : opts.type === 'success' ? 'success' : '');
  el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || 3000);
}

// Custom modal implementation to replace alert()/confirm()
function showConfirm(message) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'custom-modal-backdrop';
    modal.innerHTML = `
      <div class="custom-modal-content">
        <p>${message}</p>
        <div class="custom-modal-actions">
          <button id="modalConfirm" class="btn">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const confirmButton = modal.querySelector('#modalConfirm');
    
    // Add simple CSS for the modal here, as we can't edit style.css
    const style = document.createElement('style');
    style.textContent = `
      .custom-modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6); display: flex; justify-content: center;
        align-items: center; z-index: 1000;
      }
      .custom-modal-content {
        background: white; padding: 25px; border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); max-width: 90%;
        width: 300px; text-align: center;
      }
      .custom-modal-actions { margin-top: 15px; }
      .custom-modal-content p { margin: 0 0 15px; font-weight: 600; }
    `;
    document.head.appendChild(style);

    const closeModal = () => {
      document.body.removeChild(modal);
      document.head.removeChild(style);
    };

    confirmButton.addEventListener('click', () => {
      resolve(true); // Always resolve true for a simple "OK" confirmation
      closeModal();
    });
  });
}


/* ---------------- event queue ---------------- */
function queueEvent(evt) {
  const box = safeGet(OUTBOX_KEY, []);
  box.push({ ...evt, tester_id: TESTER_ID, ua: navigator.userAgent, version: VERSION, ts: Date.now() });
  safeSet(OUTBOX_KEY, box);
  flushOutbox().catch(e => console.warn(e));
}

let _flushBusy = false;
async function flushOutbox() {
  const box = safeGet(OUTBOX_KEY, []);
  if (!box.length || _flushBusy || !navigator.onLine || !ENDPOINT) return;
  _flushBusy = true;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(box)
    });
    if (res.ok) {
      safeSet(OUTBOX_KEY, []);
      toast('Synced feedback to server', { type: 'success' });
    } else {
      console.error('flushOutbox server status', res.status);
    }
  } catch (err) {
    console.warn('flushOutbox network', err);
  } finally { _flushBusy = false; }
}
window.addEventListener('online', () => flushOutbox());

/* ---------------- tasks ---------------- */
const FALLBACK_TASKS = [
  { id: 't1', text: 'Do a 2-minute “Seed of the Day” action', audience: 'All' },
  { id: 't2', text: 'Sort one drawer for reuse/recycle', audience: 'Individual' },
  { id: 't3', text: 'Family walk: count 5 tree species', audience: 'Family' },
  { id: 't4', text: 'Share 1 sustainability nugget with a friend', audience: 'All' },
  { id: 't5', text: 'Plan one meat-free meal', audience: 'All' }
];
let TASKS = [];
async function loadTasks() {
  try {
    const res = await fetch('tasks.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid tasks.json');
    TASKS = data.filter(t => t && t.id && t.text).slice(0, 200);
  } catch (err) {
    console.warn('loadTasks fallback', err);
    TASKS = FALLBACK_TASKS;
  }
}

/* ---------------- DOM refs ---------------- */
const nameInput = $('#name');
const loginForm = $('#loginForm');
const loginCard = $('#loginCard');
const appCard = $('#appCard');
const greeting = $('#greeting');
const who = $('#who');
const tasksEl = $('#tasks');
const saveMsg = $('#saveMsg');
// shareLink element is now removed from HTML
const progressBar = $('#progressBar');
const progressPct = $('#progressPct');
const qrBox = $('#qrcode');
const qrHint = $('#qrHint');
// feedbackBtn remains for the new functionality
const feedbackBtn = $('#feedbackBtn');

/* ---------------- QR loading ---------------- */
/**
 * Ensure QR lib available: uses window.QRCode (qrcodejs).
 * If not present, injects script from CDN and waits up to timeout.
 */
function ensureQRLib(timeout = 4000) {
  if (window.QRCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-qrcode-injected]');
    if (existing) {
      // wait until library appears or timeout
      const start = Date.now();
      const check = () => {
        if (window.QRCode) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, 120);
      };
      check();
      return;
    }
    // inject
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
    s.defer = true;
    s.async = true;
    s.setAttribute('data-qrcode-injected', '1');
    s.onload = () => {
      // small delay to let global set
      setTimeout(() => resolve(!!window.QRCode), 80);
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    // fallback timeout
    setTimeout(() => resolve(!!window.QRCode), timeout + 100);
  });
}

/* ---------------- UI logic ---------------- */
const params = new URLSearchParams(location.search);
const initialName = params.get('name') || '';
if (initialName) nameInput.value = initialName;

loginForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); toast('Please enter a name', { type: 'error' }); return; }
  await start(name);
});

let currentUserName = ''; // Store the current user name for QR generation

async function start(name) {
  safeSet('poc:name', name);
  currentUserName = name; // Set current user name
  const key = NAME_KEY_PREFIX + name;
  if (!safeGet(key)) safeSet(key, {}); // init done map

  greeting.textContent = `Hi ${name.split(' ')[0]}, here are your tasks:`;
  who.textContent = name;
  loginCard.classList.add('hide');
  appCard.classList.remove('hide');

  await loadTasks();
  renderTasks(name);
  // Update QR to point to the current page + user's name
  await updateQR(name);
  toast('Loaded tasks', { type: 'success', duration: 1200 });
}

function renderTasks(name) {
  const key = NAME_KEY_PREFIX + name;
  const done = safeGet(key, {});
  tasksEl.innerHTML = '';

  TASKS.forEach(t => {
    const row = document.createElement('div');
    row.className = 'task';
    row.setAttribute('role', 'listitem');

    // checkbox cell
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!done[t.id];
    cb.setAttribute('aria-label', `Mark ${t.text} as done`);

    // content cell
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'taskTitle';
    title.textContent = t.text;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = t.audience || 'All';
    meta.appendChild(pill);

    if (Array.isArray(t.tags) && t.tags.length) {
      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'tags';
      t.tags.forEach(tag => {
        const s = document.createElement('span');
        s.className = 'pill';
        s.textContent = tag;
        tagsWrap.appendChild(s);
      });
      meta.appendChild(tagsWrap);
    }

    content.appendChild(title);
    content.appendChild(meta);

    // actions cell
    const actions = document.createElement('div');
    actions.className = 'votes';
    const likeBtn = document.createElement('button');
    likeBtn.className = 'btn ghost like';
    likeBtn.type = 'button';
    likeBtn.setAttribute('aria-label', 'like task');
    likeBtn.textContent = '👍 Like';
    const dislikeBtn = document.createElement('button');
    dislikeBtn.className = 'btn ghost dislike';
    dislikeBtn.type = 'button';
    dislikeBtn.setAttribute('aria-label', 'dislike task');
    dislikeBtn.textContent = '👎 Dislike';
    const stat = document.createElement('div');
    stat.className = 'stat';
    stat.setAttribute('data-stat', '');

    actions.appendChild(likeBtn);
    actions.appendChild(dislikeBtn);
    actions.appendChild(stat);

    row.appendChild(cb);
    row.appendChild(content);
    row.appendChild(actions);
    tasksEl.appendChild(row);

    // handlers
    cb.addEventListener('change', () => {
      const map = safeGet(key, {});
      map[t.id] = cb.checked;
      safeSet(key, map);
      queueEvent({ name, action: cb.checked ? 'done' : 'undone', task_id: t.id, tags: t.tags || [] });
      tick();
      updateProgress(map);
    });

    const vkey = VOTES_KEY_PREFIX + name;
    
    // Pass the initial votes object to refreshVotes
    function refreshVotes(currentVotes) {
      const v = currentVotes[t.id] || 0;
      likeBtn.classList.toggle('active', v === 1);
      dislikeBtn.classList.toggle('active', v === -1);
      stat.textContent = v === 1 ? 'You liked this' : v === -1 ? 'You disliked this' : '';
    }
    
    likeBtn.addEventListener('click', () => {
      // 1. Read the LATEST votes from storage
      const currentVotes = safeGet(vkey, {});
      // 2. Modify the value for THIS task
      currentVotes[t.id] = currentVotes[t.id] === 1 ? 0 : 1;
      // 3. Save the modified object back to storage
      safeSet(vkey, currentVotes);
      // 4. Update the UI using the NEW votes object
      refreshVotes(currentVotes);
      
      queueEvent({ name, action: currentVotes[t.id] === 1 ? 'like' : 'clear_vote', task_id: t.id });
      tick();
    });
    
    dislikeBtn.addEventListener('click', () => {
      // 1. Read the LATEST votes from storage
      const currentVotes = safeGet(vkey, {});
      // 2. Modify the value for THIS task
      currentVotes[t.id] = currentVotes[t.id] === -1 ? 0 : -1;
      // 3. Save the modified object back to storage
      safeSet(vkey, currentVotes);
      // 4. Update the UI using the NEW votes object
      refreshVotes(currentVotes);
      
      queueEvent({ name, action: currentVotes[t.id] === -1 ? 'dislike' : 'clear_vote', task_id: t.id });
      tick();
    });
    
    // Initial UI render on load
    refreshVotes(safeGet(vkey, {}));
  });

  updateProgress(safeGet(NAME_KEY_PREFIX + name, {}));
}

function updateProgress(done) {
  const completed = Object.values(done).filter(Boolean).length;
  const pct = Math.round((completed / Math.max(1, TASKS.length)) * 100);
  progressBar.value = pct;
  progressPct.textContent = pct + '%';
}

function tick() {
  saveMsg.textContent = 'Saved locally ✓';
  clearTimeout(tick._t);
  tick._t = setTimeout(() => (saveMsg.textContent = ''), 1200);
}

/* ---------------- QR generation (Reverted to share page logic) ---------------- */
// Function now takes the current user's name
async function updateQR(name) {
  try {
    // clear
    qrBox.innerHTML = '';

    // Construct the share URL (base URL + ?name=User Name)
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?name=${encodeURIComponent(name)}`;

    // ensure library
    const ok = await ensureQRLib(4000);
    if (ok && window.QRCode) {
      // qrcodejs inserts a child (img or table)
      try {
        new QRCode(qrBox, { text: shareUrl, width: 128, height: 128 });
        qrHint.textContent = 'Scan to open this exact page and your name.';
      } catch (err) {
        console.warn('qrcode draw failed', err);
        qrHint.textContent = 'QR generation failed — use the button below.';
      }
    } else {
      qrHint.textContent = 'QR not available (offline or blocked).';
      // qrBox will stay empty; shareLink is visible and copy works
    }
  } catch (err) {
    console.error('updateQR', err);
  }
}

// Event listener for the new feedback button
feedbackBtn.addEventListener('click', async () => {
  // Show confirmation dialog before redirecting
  await showConfirm('You are being redirected to a Google Form to submit feedback.');
  
  // Open the feedback form URL in a new tab
  window.open(FEEDBACK_FORM_URL, '_blank');
  toast('Opening feedback form...', { type: 'success' });
});

/* ---------------- auto start ---------------- */
const storedName = safeGet('poc:name', '') || '';
if (storedName) setTimeout(() => start(storedName), 180);
if (initialName) setTimeout(() => start(initialName), 120);
