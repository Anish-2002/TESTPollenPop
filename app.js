// app.js - modernized, responsive, safe render + robust QR loader
// Keep ENDPOINT blank unless you have a server (no client secrets here)
const OUTBOX_KEY = 'poc:outbox';
const UID_KEY = 'poc:uid';
const NAME_KEY_PREFIX = 'poc:done:';
const VOTES_KEY_PREFIX = 'poc:votes:';
const VERSION = '0.4-T02-complete'; // Updated version for tracking
const ENDPOINT = ''; // optional server endpoint

/* ---------------- Configuration Update ---------------- */
// Placeholder for the Google Form URL. Please replace this with your actual form link.
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdofOkktqnShUm4emsW-ZdOhxfyycKfg4TVsryWo-tsYi6NVQ/viewform?usp=header';


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
    
    // Add simple CSS for the modal here, as we can't edit style.css directly
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

/* ---------------- tasks / filtering ---------------- */
const FALLBACK_TASKS = [
  { id: 't1', text: 'Do a 2-minute “Seed of the Day” action', audience: 'All', primary_core: 'Action', stage: 'Seeds', tags: ['Habits'] },
  { id: 't2', text: 'Sort one drawer for reuse/recycle', audience: 'Individual', primary_core: 'Reflective', stage: 'Sprout', tags: ['Waste'] },
  { id: 't3', text: 'Family walk: count 5 tree species', audience: 'Family', primary_core: 'Nature', stage: 'Sprout', tags: ['Bonding'] },
  { id: 't4', text: 'Share 1 sustainability nugget with a friend', audience: 'All', primary_core: 'Creative', stage: 'Bloom', tags: ['Local Engagement'] },
  { id: 't5', text: 'Plan one meat-free meal', audience: 'All', primary_core: 'Action', stage: 'Sprout', tags: ['Energy'] }
];
let TASKS = [];
let currentFilter = { core: '', stage: '', category: '' }; // Added category for completeness, though not in the UI

/**
 * Loads tasks, preferring tasks_master.json, falling back to tasks.json, then to defaults.
 */
async function loadTasks() {
  const masterUrl = 'tasks_master.json';
  const legacyUrl = 'tasks.json';
  let loadedData = [];
  
  try {
    // 1. Try to load from the master file
    const masterRes = await fetch(masterUrl, { cache: 'no-store' });
    if (!masterRes.ok) throw new Error(`HTTP ${masterRes.status} on master file`);
    
    const data = await masterRes.json();
    if (!Array.isArray(data)) throw new Error('Invalid tasks_master.json format');
    loadedData = data;
    console.log('Loaded tasks from master file.');

  } catch (masterErr) {
    // NOTE: This fallback may fail if running locally without a server due to file:// restrictions
    console.warn('loadTasks: Falling back to legacy tasks.json', masterErr);
    // 2. Fallback to legacy
    try {
      const legacyRes = await fetch(legacyUrl, { cache: 'no-store' });
      if (!legacyRes.ok) throw new Error(`HTTP ${legacyRes.status} on legacy file`);

      const data = await legacyRes.json();
      if (!Array.isArray(data)) throw new Error('Invalid tasks.json format');
      loadedData = data;
      console.log('Loaded tasks from legacy file.');
      
    } catch (legacyErr) {
      console.warn('loadTasks: Falling back to hardcoded defaults', legacyErr);
      loadedData = FALLBACK_TASKS;
    }
  }

  // Final cleanup and assignment
  // Standardize the field names from the CSV/JSON data (primary_core, stage, tags)
  TASKS = loadedData.map(t => ({
    id: t.id,
    text: t.text,
    primary_core: t['Core Themes'] || t.primary_core, // Use the more verbose CSV name if present
    stage: t.Stage || t.stage, // Use the more verbose CSV name if present
    audience: t['Audience tag'] || t.audience,
    tags: Array.isArray(t.tags) ? t.tags : (t.Subcategories || '').split(',').map(s => s.trim()).filter(Boolean), // Normalize to an array of tags
  })).filter(t => t && t.id && t.text).slice(0, 200);
}

/**
 * Filters the task list based on the global currentFilter state using AND logic.
 * @param {Array<Object>} allTasks The complete list of tasks.
 * @returns {Array<Object>} The filtered list of tasks.
 */
function filterTasks(allTasks) {
  const { core, stage, category } = currentFilter;

  if (!core && !stage && !category) {
    return allTasks; // No filters, return all tasks
  }
  
  // Normalize filters for case-insensitive matching
  const nCore = core ? core.toLowerCase() : null;
  const nStage = stage ? stage.toLowerCase() : null;
  const nCategory = category ? category.toLowerCase() : null;

  return allTasks.filter(task => {
    let coreMatch = true;
    let stageMatch = true;
    let categoryMatch = true;

    // Core Theme filtering (checks task.primary_core)
    if (nCore) {
      const taskCore = task.primary_core || '';
      // .includes() for robustness against emojis, though strict equality is fine too
      coreMatch = taskCore.toLowerCase().includes(nCore); 
    }

    // Stage filtering (checks task.stage)
    if (nStage) {
      const taskStage = task.stage || '';
      stageMatch = taskStage.toLowerCase() === nStage;
    }
    
    // Category/Subcategory filtering (checks task.tags array)
    if (nCategory) {
      const taskTags = Array.isArray(task.tags) 
        ? task.tags.map(c => c.trim().toLowerCase()) 
        : [];
        
      categoryMatch = taskTags.includes(nCategory);
    }

    // AND Logic: all required conditions must be true
    return coreMatch && stageMatch && categoryMatch;
  });
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
const progressBar = $('#progressBar');
const progressPct = $('#progressPct');
const qrBox = $('#qrcode');
const qrHint = $('#qrHint');
const feedbackBtn = $('#feedbackBtn');

// New Filter DOM Refs
const coreFilterSelect = $('#coreFilter');
const stageFilterSelect = $('#stageFilter');
const applyFilterBtn = $('#applyFilterBtn');

/* ---------------- QR loading ---------------- */
/**
 * Ensure QR lib available: uses window.QRCode (qrcodejs).
 * If not present, injects script from CDN and waits up to timeout.
 */
function ensureQRLib(timeout = 4000) {
  if (window.QRCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    // Check for existing injection logic if necessary
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
    s.defer = true;
    s.async = true;
    s.onload = () => {
      setTimeout(() => resolve(!!window.QRCode), 80);
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
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
  
  // 1. Initialize filters from URL parameters on start
  initFiltersFromURL();

  // 2. Render tasks based on initial filters
  renderTasks(name, filterTasks(TASKS));
  
  await updateQR(name);
  toast('Loaded tasks', { type: 'success', duration: 1200 });
}

/**
 * Initializes filter dropdowns and the currentFilter state from URL parameters.
 */
function initFiltersFromURL() {
    const params = new URLSearchParams(location.search);
    const core = params.get('core') || '';
    const stage = params.get('stage') || '';
    const category = params.get('category') || '';
    
    // Set internal state
    currentFilter = { core: core.toLowerCase(), stage: stage.toLowerCase(), category: category.toLowerCase() };

    // Set UI dropdowns to match URL (case-insensitive find)
    if (core) {
        // Find the option whose value matches the URL param (case-insensitive)
        const coreOption = Array.from(coreFilterSelect.options).find(opt => opt.value.toLowerCase() === core.toLowerCase());
        if (coreOption) coreFilterSelect.value = coreOption.value;
    }
    if (stage) {
        const stageOption = Array.from(stageFilterSelect.options).find(opt => opt.value.toLowerCase() === stage.toLowerCase());
        if (stageOption) stageFilterSelect.value = stageOption.value;
    }
    // Category filter is URL-only for now, as it is not in the dropdowns.
}

/**
 * Handles UI interaction for applying filters and updating the URL.
 */
applyFilterBtn.addEventListener('click', () => {
    // 1. Get values from UI
    const newCore = coreFilterSelect.value;
    const newStage = stageFilterSelect.value;
    
    // 2. Update internal state and apply filter logic
    currentFilter = { 
        core: newCore ? newCore.toLowerCase() : '', 
        stage: newStage ? newStage.toLowerCase() : '', 
        category: '' // Reset category filter if it existed (since it's not a UI element here)
    };
    
    // 3. Update URL (optional but good practice for sharing filtered view)
    const params = new URLSearchParams(location.search);
    if (newCore) {
        params.set('core', newCore);
    } else {
        params.delete('core');
    }
    if (newStage) {
        params.set('stage', newStage);
    } else {
        params.delete('stage');
    }
    // Maintain 'name' parameter for user context
    if (currentUserName) {
        params.set('name', currentUserName);
    }

    const newUrl = `${location.pathname}?${params.toString()}`;
    // Use replaceState to change URL without a full page reload
    window.history.replaceState(null, '', newUrl);

    // 4. Render the filtered tasks
    renderTasks(currentUserName, filterTasks(TASKS));
});


/**
 * Renders the task list, now accepting a specific list to render.
 * @param {string} name The current user's name.
 * @param {Array<Object>} tasksToRender The list of tasks (filtered or unfiltered).
 */
function renderTasks(name, tasksToRender = TASKS) {
  const key = NAME_KEY_PREFIX + name;
  const done = safeGet(key, {});
  tasksEl.innerHTML = '';

  // Use the map to handle emojis for display only
  const CORE_EMOJIS = {
    'Nature': '🌿',
    'Action': '⚡',
    'Reflective': '🌙',
    'Creative': '✨',
  }

  tasksToRender.forEach(t => {
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
    
    // Start of updated meta/pill section
    const meta = document.createElement('div');
    meta.className = 'meta';

    // 1. Audience Pill (Existing)
    if (t.audience) {
        const audiencePill = document.createElement('span');
        audiencePill.className = 'pill';
        audiencePill.textContent = t.audience; 
        meta.appendChild(audiencePill);
    }

    // 2. Core Theme Pill (New - using primary_core)
    if (t.primary_core) {
      const corePill = document.createElement('span');
      corePill.className = 'pill';
      // Add emoji for display
      const coreDisplay = CORE_EMOJIS[t.primary_core] ? `${CORE_EMOJIS[t.primary_core]} ${t.primary_core}` : t.primary_core;
      corePill.textContent = coreDisplay;
      meta.appendChild(corePill);
    }
    
    // 3. Stage Pill (New - using stage)
    if (t.stage) {
      const stagePill = document.createElement('span');
      stagePill.className = 'pill';
      stagePill.textContent = t.stage;
      meta.appendChild(stagePill);
    }

    // 4. Subcategories/Tags (New - using tags array)
    const tags = Array.isArray(t.tags) ? t.tags : [];
    
    if (tags.length) {
      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'tags';
      tags.forEach(tag => {
        const s = document.createElement('span');
        s.className = 'pill';
        s.textContent = tag;
        tagsWrap.appendChild(s);
      });
      meta.appendChild(tagsWrap);
    }
    // End of updated meta/pill section

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
      // Ensure we pass all tags for server analytics
      queueEvent({ name, action: cb.checked ? 'done' : 'undone', task_id: t.id, tags: t.tags || [], primary_core: t.primary_core || '', stage: t.stage || '' });
      tick();
      updateProgress(map, tasksToRender.length); // Use tasksToRender.length
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
      const currentVotes = safeGet(vkey, {});
      currentVotes[t.id] = currentVotes[t.id] === 1 ? 0 : 1;
      safeSet(vkey, currentVotes);
      refreshVotes(currentVotes);
      
      queueEvent({ name, action: currentVotes[t.id] === 1 ? 'like' : 'clear_vote', task_id: t.id });
      tick();
    });
    
    dislikeBtn.addEventListener('click', () => {
      const currentVotes = safeGet(vkey, {});
      currentVotes[t.id] = currentVotes[t.id] === -1 ? 0 : -1;
      safeSet(vkey, currentVotes);
      refreshVotes(currentVotes);
      
      queueEvent({ name, action: currentVotes[t.id] === -1 ? 'dislike' : 'clear_vote', task_id: t.id });
      tick();
    });
    
    // Initial UI render on load
    refreshVotes(safeGet(vkey, {}));
  });

  updateProgress(safeGet(NAME_KEY_PREFIX + name, {}), tasksToRender.length);
}

/**
 * Updates the progress bar based on the tasks currently being displayed.
 * @param {Object} done - The map of completed tasks.
 * @param {number} totalTasks - The total number of tasks being displayed/counted.
 */
function updateProgress(done, totalTasks) {
  // Count only tasks that are both done AND are present in the current filtered list (TASKS is the original master list)
  const completedTaskIds = Object.keys(done).filter(id => done[id]);
  const completedInView = TASKS.filter(t => t.id && completedTaskIds.includes(t.id)).length;
  
  const pct = Math.round((completedInView / Math.max(1, totalTasks)) * 100); 
  progressBar.value = pct;
  progressPct.textContent = pct + '%';
  
  if (totalTasks === 0) {
      progressBar.value = 0;
      progressPct.textContent = '0%';
      tasksEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted); font-weight: 600;">No tasks found matching the selected filter criteria.</div>';
  }
}


function tick() {
  saveMsg.textContent = 'Saved locally ✓';
  clearTimeout(tick._t);
  tick._t = setTimeout(() => (saveMsg.textContent = ''), 1200);
}

/* ---------------- QR generation ---------------- */
// Function now takes the current user's name
async function updateQR(name) {
  try {
    qrBox.innerHTML = '';
    const params = new URLSearchParams(location.search);
    // Ensure the current filters are in the share URL
    const shareUrl = `${window.location.origin}${location.pathname}?name=${encodeURIComponent(name)}${params.toString().includes('core') ? '&' + params.toString().split('&').filter(p => p.startsWith('core') || p.startsWith('stage') || p.startsWith('category')).join('&') : ''}`;

    const ok = await ensureQRLib(4000);
    if (ok && window.QRCode) {
      try {
        new QRCode(qrBox, { text: shareUrl, width: 128, height: 128 });
        qrHint.textContent = 'Scan to open this exact page and your name.';
      } catch (err) {
        qrHint.textContent = 'QR generation failed — use the button below.';
      }
    } else {
      qrHint.textContent = 'QR not available (offline or blocked).';
    }
  } catch (err) {
    console.error('updateQR', err);
  }
}

// Event listener for the new feedback button
feedbackBtn.addEventListener('click', async () => {
  await showConfirm('You are being redirected to a Google Form to submit feedback.');
  window.open(FEEDBACK_FORM_URL, '_blank');
  toast('Opening feedback form...', { type: 'success' });
});

/* ---------------- auto start ---------------- */
const storedName = safeGet('poc:name', '') || '';

// If a name is in the URL (initialName) or stored locally (storedName),
// prioritize the URL name to start the application only once.
const nameToStart = initialName || storedName; 

// Run start() after a small delay to ensure all DOM elements and
// dynamically loaded scripts (like the QR lib) are ready.
if (nameToStart) setTimeout(() => start(nameToStart), 180);