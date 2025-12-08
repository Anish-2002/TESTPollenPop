// app.js - unified logic with live updates and design-matched rendering (V2.9-EMAIL-CHECK-RTDB-SESSION)

const OUTBOX_KEY = 'poc:outbox';
const UID_KEY = 'poc:uid';
const NAME_KEY_PREFIX = 'poc:done:';
const VOTES_KEY_PREFIX = 'poc:votes:';
const COMMENT_KEY_PREFIX = 'poc:comments:'; 
const VERSION = '2.9-EMAIL-CHECK-RTDB-SESSION'; // Updated Version
const SESSION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes in milliseconds

/* ---------------- Firebase Setup ---------------- */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA0DJBS3xYmuDgZhQNSco4jA5uUCPtgPss",
  authDomain: "testwebtracker.firebaseapp.com",
  databaseURL: "https://testwebtracker-default-rtdb.firebaseio.com",
  projectId: "testwebtracker",
  storageBucket: "testwebtracker.firebasestorage.app",
  messagingSenderId: "323598600436",
  appId: "1:323598600436:web:9e46d8ed047685775db6a1",
  measurementId: "G-75N92JTRSY"
};

let db = null;
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} else if (typeof firebase !== 'undefined') {
  db = firebase.database();
}

/* ---------------- Configuration Update ---------------- */
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdofOkktqnShUm4emsW-ZdOhxfyycKfg4TVsryWo-tsYi6NVQ/viewform?usp=header';
const STAGE_SCORES = {
    "🌰 Seeds": 2,
    "🌱 Sprout": 4,
    "🌸 Bloom": 9
};

/* ---------------- utilities ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
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
  catch { return localStorage.getItem(UID_KEY) || 'p_' + Math.random().toString(36).slice(2, 10); }
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
  setTimeout(() => el.remove(), opts.duration || 2000); 
}

/**
 * NEW: Generic modal for simple confirmation or error messages.
 * Replaces the old showConfirm with a more useful generic modal.
 * @param {string} message - The HTML content of the message.
 * @returns {Promise<boolean>} Resolves when the modal is closed.
 */
function showModalMessage(message, isError = false) {
    return new Promise(resolve => {
        // Use existing showConfirm styles
        const style = document.createElement('style');
        style.textContent = `.custom-modal-backdrop{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:center;z-index:9999}.custom-modal-content{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90%;width:300px;text-align:center}.custom-modal-actions{margin-top:15px}.custom-modal-content p{margin:0 0 15px;font-weight:600}`;
        document.head.appendChild(style);

        const modal = document.createElement('div');
        modal.className = 'custom-modal-backdrop';

        const closeModal = () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
            resolve(true);
        };

        modal.innerHTML = `
        <div class="custom-modal-content" style="${isError ? 'border-top: 5px solid var(--danger);' : ''}">
            <p>${message}</p>
            <div class="custom-modal-actions">
            <button id="modalConfirm" class="btn ${isError ? 'error-btn' : ''}">OK</button>
            </div>
        </div>
        `;

        document.body.appendChild(modal);
        const confirmButton = modal.querySelector('#modalConfirm');

        confirmButton.addEventListener('click', closeModal);
    });
}


/* ---------------- event queue ---------------- */
function queueEvent(evt) {
  const box = safeGet(OUTBOX_KEY, []);
  box.push({ ...evt, tester_id: TESTER_ID, ua: navigator.userAgent, version: VERSION, ts: Date.now() });
  safeSet(OUTBOX_KEY, box);
  // flushOutbox().catch(e => console.warn(e)); 
}


/* ---------------- Tasks / Persistence ---------------- */

let TASKS = []; 
let ALLOCATED_TASKS = []; 
let TESTER_MAP = {}; 
let USER_TASK_STATUS = {}; 


function getDoneTasks() {
    const doneMap = {};
    for (const taskId in USER_TASK_STATUS) {
        if (isTaskDone(taskId)) {
            doneMap[taskId] = true; 
        }
    }
    return doneMap;
}

function isTaskDone(taskId) {
    const taskStatus = USER_TASK_STATUS[taskId];
    return (taskStatus && taskStatus.done === true) || taskStatus === 'done';
}

function setTaskDone(taskId, isDone) {
    const currentComment = getTaskComment(taskId); 
    
    // --- RTDB Logic ---
    if (!db) {
        // Fallback to local storage (omitted for brevity, keep only RTDB logic for clarity)
        return toast('Error: Database not available.', { type: 'error' });
    }

    const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);
    
    if (isDone) {
        const existingStatus = USER_TASK_STATUS[taskId] || {};
        USER_TASK_STATUS[taskId] = {...existingStatus, done: true};
        taskRef.update({ done: true })
            .then(() => toast(`Task completed! (Saved to DB).`, { type: 'success', duration: 1500 }))
            .catch(e => { console.error("RTDB write error:", e); toast('Error saving done status to DB.', { type: 'error' }); });
    } else {
        if (USER_TASK_STATUS[taskId]) {
            delete USER_TASK_STATUS[taskId].done;
            if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
                delete USER_TASK_STATUS[taskId]; 
                taskRef.remove()
                    .then(() => toast(`Task marked incomplete. (Status cleared from DB).`, { duration: 1500 }))
                    .catch(e => console.error("RTDB write error:", e));
            } else {
                taskRef.update({ done: null })
                    .then(() => toast(`Task marked incomplete. (Status cleared from DB).`, { duration: 1500 }))
                    .catch(e => console.error("RTDB write error:", e));
            }
        } else {
           toast(`Task marked incomplete. (No status found to clear).`, { duration: 1500 });
        }
    }
    
    queueEvent({
        type: 'completion',
        task_id: taskId,
        status: isDone ? 'completed' : 'incomplete',
        comment: currentComment || undefined 
    });

    updateProgress();
    applyFilters();
    resetActivityTimer(); // Reset timer on interaction
}

function handleTaskCompletion(event) {
    const checkbox = event.currentTarget;
    const taskId = checkbox.dataset.taskId;
    const isDone = checkbox.checked;

    setTaskDone(taskId, isDone);
}


/* ---------------- Votes ---------------- */
function getTaskVote(taskId) {
    const voteValue = USER_TASK_STATUS[taskId]?.vote;
    if (voteValue === 1) return 'like';
    if (voteValue === -1) return 'dislike';
    return null; 
}

function setTaskVote(taskId, voteType) {
    let voteValue = null; 
    let toastMsg = 'Vote cleared.';

    if (voteType === 'like') {
        voteValue = 1;
        toastMsg = 'Vote recorded: liked.';
    } else if (voteType === 'dislike') {
        voteValue = -1;
        toastMsg = 'Vote recorded: disliked.';
    }
    
    queueEvent({ 
        type: 'vote', 
        task_id: taskId, 
        vote: voteValue === null ? 0 : voteValue 
    });
    
    if (!db) {
        toast('Error: Database not available.', { type: 'error' });
        return;
    }

    const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);
    
    if (!USER_TASK_STATUS[taskId]) {
        USER_TASK_STATUS[taskId] = {};
    }

    if (voteValue === null) {
        delete USER_TASK_STATUS[taskId].vote;
    } else {
        USER_TASK_STATUS[taskId].vote = voteValue;
    }

    if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
         taskRef.remove()
            .then(() => toast(toastMsg + ' (Saved to DB).', { duration: 1500 }))
            .catch(e => { console.error("RTDB write error:", e); toast('Error clearing vote in DB.', { type: 'error' }); });
    } else {
        taskRef.update({ vote: voteValue })
            .then(() => toast(toastMsg + ' (Saved to DB).', { type: 'success', duration: 1500 }))
            .catch(e => { console.error("RTDB write error:", e); toast('Error saving vote to DB.', { type: 'error' }); });
    }

    applyFilters(); 
    resetActivityTimer(); // Reset timer on interaction
}

function handleVote(event) {
    const button = event.currentTarget;
    const taskItem = button.closest('.task-item');
    if (!taskItem) return;
    
    const taskId = taskItem.dataset.taskId;
    const voteType = button.dataset.voteType; 
    
    if (!taskId || !voteType) return;

    const currentVote = getTaskVote(taskId);
    
    if (currentVote === voteType) {
        setTaskVote(taskId, 'none');
    } else {
        setTaskVote(taskId, voteType);
    }
}

/* ---------------- Comments ---------------- */

function getTaskComment(taskId) {
    return USER_TASK_STATUS[taskId]?.comment || ''; 
}

function setTaskComment(taskId, commentText) {
    const trimmedComment = String(commentText).trim();
    const commentValue = trimmedComment || null; 

    queueEvent({ 
        type: 'comment', 
        task_id: taskId, 
        comment: trimmedComment
    });
    
    if (!db) {
        if (commentValue) {
            toast('Comment saved (Local Storage).', { type: 'success', duration: 1500 });
        } else {
            toast('Comment cleared (Local Storage).', { duration: 1500 });
        }
        applyFilters();
        resetActivityTimer(); // Reset timer on interaction
        return;
    }
    
    const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);

    if (!USER_TASK_STATUS[taskId]) {
        USER_TASK_STATUS[taskId] = {};
    }
    
    if (commentValue === null) {
        delete USER_TASK_STATUS[taskId].comment;
    } else {
        USER_TASK_STATUS[taskId].comment = commentValue;
    }

    if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
         taskRef.remove()
            .then(() => toast(`Comment cleared (Saved to DB).`, { duration: 1500 }))
            .catch(e => { console.error("RTDB write error:", e); toast('Error clearing comment in DB.', { type: 'error' }); });
    } else {
        taskRef.update({ comment: commentValue })
            .then(() => {
                if (commentValue) {
                    toast('Comment saved (Saved to DB).', { type: 'success', duration: 1500 });
                } else {
                    toast('Comment cleared (Saved to DB).', { duration: 1500 });
                }
            })
            .catch(e => { console.error("RTDB write error:", e); toast('Error saving comment to DB.', { type: 'error' }); });
    }

    applyFilters(); 
    resetActivityTimer(); // Reset timer on interaction
}

function handleCommentSave(event) {
    const button = event.currentTarget;
    const taskItem = button.closest('.task-item');
    if (!taskItem) return;
    
    const taskId = taskItem.dataset.taskId;
    const commentInput = taskItem.querySelector('.task-comment-input');
    
    if (!taskId || !commentInput) return;

    setTaskComment(taskId, commentInput.value);
}

/* ---------------- tasks / filtering / scoring / Data Loading ---------------- */

function normalizeTasks(rawTasks) {
    const CORE_MAP = {
        '🌱 Connecting / Belonging': 'connectingbelonging',
        '⚡ Acting / Motivating': 'actingmotivating',
        '🌙 Reflecting / Learning': 'reflectinglearning',
        '✨ Creating / Circularity': 'creatingcircularity'
    };
    const STAGE_MAP = {
        '🌰 Seeds': { internal: 'seeds', display: '🌰 Seeds' },
        '🌱 Sprout': { internal: 'sprout', display: '🌱 Sprout' },
        '🌸 Bloom': { internal: 'bloom', display: '🌸 Bloom' }
    };
    const cleanTag = (tag) => {
        if (!tag) return '';
        return tag.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim().replace(/\s+/g, '');
    };

    return rawTasks.map(t => {
        const rawStage = t.stage || '🌰 Seeds';
        const stageData = STAGE_MAP[rawStage] || { internal: 'seeds', display: rawStage };
        const rawCoreTheme = t.core_theme || '';
        const internalCore = CORE_MAP[rawCoreTheme] || cleanTag(rawCoreTheme);

        const rawSubcategory = t.subcategory || '';
        const displayTags = rawSubcategory ? [rawSubcategory] : [];
        const internalTags = rawSubcategory ? [cleanTag(rawSubcategory)] : [];
        const score = STAGE_SCORES[rawStage] || 0;

        return {
            ...t,
            score: score, 
            primary_core_display: rawCoreTheme,
            stage_display: stageData.display,
            audience_display: t.audience,
            tags_display: displayTags,
            primary_core: internalCore,
            stage: stageData.internal,
            tags: internalTags,
        };
    });
}

/**
 * NEW: Checks the entered email against the RTDB's list of approved testers.
 * @param {string} email - The email entered by the user.
 * @returns {Promise<string|null>} The tester_id if found, otherwise null.
 */
async function checkTesterEmail(email) {
    if (!db) {
        console.warn('DB not available for email check. Skipping security check.');
        // Fallback: If DB is down, assume success if a name was entered.
        return 'FALLBACK_TESTER'; 
    }
    
    try {
        // Normalize the email to lowercase for consistent key lookup
        const normalizedEmail = email.toLowerCase().replace(/\./g, ','); // RTDB keys cannot contain '.', so replace with ','
        
        // Query the approved_emails node directly for the key
        const emailRef = db.ref(`approved_emails/${normalizedEmail}`);
        const snapshot = await emailRef.once('value');
        
        const testerId = snapshot.val(); 

        return testerId; // Returns the tester_id string or null
        
    } catch (e) {
        console.error("Error checking tester email:", e);
        toast('Database error during email check.', { type: 'error' });
        return null; // Treat any error as failed lookup
    }
}

async function initData() {
    USER_TASK_STATUS = {}; 

    if (!db) {
        toast('Firebase Database not initialized. Falling back to local files.', { type: 'error' });
        await loadFallbackData(); 
        return;
    }

    try {
        const dataSnapshot = await db.ref('/').once('value');
        const data = dataSnapshot.val();

        if (!data || !data.tasks || !data.tester_mapping) {
            toast('RTDB is missing required data (tasks/tester_mapping). Falling back to local files.', { type: 'error' });
            await loadFallbackData();
            return;
        }

        // 1. Process Tasks
        const rawTasks = Object.values(data.tasks); 
        TASKS = normalizeTasks(rawTasks); 

        // 2. Process Tester Mapping
        const currentTesterMap = data.tester_mapping[TESTER_ID];
        if (currentTesterMap) {
            TESTER_MAP = currentTesterMap;
        } else {
            TESTER_MAP = { allocated_task_ids: [], preferred_cores: [], preferred_categories: [] };
            // Note: This toast is now less likely to happen as TESTER_ID comes from the email check
            toast(`Tester ID ${TESTER_ID} not found in mapping. Displaying all tasks.`, { duration: 3000 });
        }
        
        // 3. Process User Data
        const userSnapshot = await db.ref(`users/${TESTER_ID}`).once('value');
        const userData = userSnapshot.val();
        
        USER_TASK_STATUS = (userData && userData.tasks) || {};
        
        // 4. Set allocated tasks 
        ALLOCATED_TASKS = getAllocatedTasks(); 

        $('#saveMsg').textContent = 'Data loaded from Firebase.'; 
        toast('Data loaded from Firebase.', { type: 'success' });

    } catch (e) {
        console.error("Error loading data from Firebase:", e);
        toast('Failed to connect or load data from Firebase. Falling back to local files.', { type: 'error' });
        await loadFallbackData();
    }
}

async function loadFallbackData() {
    try {
        const tasksResponse = await fetch('tasks_master.json');
        const rawTasks = tasksResponse.ok ? await tasksResponse.json() : [];
        TASKS = normalizeTasks(rawTasks);
        
        const mapResponse = await fetch('tester_mapping.json');
        if (mapResponse.ok) {
            const mapping = await mapResponse.json();
            TESTER_MAP = mapping.find(m => m.tester_id === TESTER_ID) || {};
        }
        
        // Load user progress from local storage (legacy)
        const doneTasks = safeGet(`${NAME_KEY_PREFIX}${TESTER_ID}`, {});
        const localUserStatus = {};
        for (const taskId in doneTasks) {
            localUserStatus[taskId] = { done: true };
        }
        USER_TASK_STATUS = localUserStatus;
        
        ALLOCATED_TASKS = getAllocatedTasks();
        toast('Loaded data from local files (Fallback).', { type: 'warning' });

    } catch (err) {
        console.error('Error loading fallback data:', err);
    }
}

function getAllocatedTasks() {
    let allocatedTasks = TASKS;
    
    if (TESTER_MAP.allocated_task_ids && TESTER_MAP.allocated_task_ids.length > 0) {
        const allocated = new Set(TESTER_MAP.allocated_task_ids);
        allocatedTasks = TASKS.filter(t => allocated.has(t.id));
    }
    
    return allocatedTasks;
}

function updateProgress() {
    const allocatedTasks = ALLOCATED_TASKS; 
    const doneTasks = getDoneTasks(); 
    
    const doneCount = allocatedTasks.filter(t => doneTasks[t.id]).length;
    const totalCount = allocatedTasks.length;
    const totalPoints = allocatedTasks
        .filter(t => doneTasks[t.id])
        .reduce((sum, t) => sum + t.score, 0); 

    const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    $('#progressBar').value = progressPct;
    $('#progressPct').textContent = `${doneCount}/${totalCount} (${progressPct}%)`; 
    
    const scoreElement = $('#score');
    if (scoreElement) {
        scoreElement.innerHTML = `Total Points: <span id="totalPoints">+${totalPoints}</span>`;
    }
    
    if (progressPct === 100 && totalCount > 0) {
        if (!safeGet('poc:completed:notified', false)) {
             toast('Congratulations! All assigned tasks completed!', { type: 'success', duration: 4000 });
             safeSet('poc:completed:notified', true);
        }
    } else {
         safeSet('poc:completed:notified', false);
    }
}


/* ---------------- task rendering & filters ---------------- */

let currentFilters = {
    core: new Set(),
    stage: new Set(),
    tags: new Set(),
};

function toggleDropdownPanel(event) {
    const button = event.currentTarget;
    const multiSelectEl = button.closest('.custom-multi-select');
    const panel = multiSelectEl ? multiSelectEl.querySelector('.dropdown-panel') : null;
    
    if (panel) {
        $$('.dropdown-panel:not(.hide)').forEach(openPanel => {
            if (openPanel !== panel) {
                openPanel.classList.add('hide');
            }
        });
        panel.classList.toggle('hide');
    }
    resetActivityTimer(); // Reset timer on interaction
}

function updateFilterBadges() {
    ['core', 'stage', 'tags'].forEach(filterType => {
        const container = $(`#${filterType}Filter`); 
        if (!container) return;
        const button = container.querySelector('.select-btn');
        if (!button) return;
        const badge = button.querySelector('.count-badge');
        if (!badge) return;
        
        const count = currentFilters[filterType].size;
        
        if (count > 0) {
            badge.textContent = `${count} selected`;
            badge.classList.remove('hide');
            button.classList.add('active'); 
        } else {
            badge.classList.add('hide');
            button.classList.remove('active');
        }
    });
}

function renderFilters() {
    const allTasks = TASKS; 
    const allocatedInternalValues = {
        core: new Set(ALLOCATED_TASKS.map(t => t.primary_core)),
        stage: new Set(ALLOCATED_TASKS.map(t => t.stage)),
        tags: new Set(ALLOCATED_TASKS.flatMap(t => t.tags))
    };

    const coreFilterContainer = $('#coreFilter');
    const stageFilterContainer = $('#stageFilter');
    const tagFilterContainer = $('#tagsFilter'); 

    if (!coreFilterContainer || !stageFilterContainer || !tagFilterContainer) return;

    const generateDropdownItemHtml = (display, internal, filterType) => {
        const id = `filter-${filterType}-${internal}`;
        const isChecked = currentFilters[filterType].has(internal);
        const checkedAttr = isChecked ? 'checked' : '';
        
        const isAvailable = allocatedInternalValues[filterType].has(internal);
        const unavailableClass = isAvailable ? '' : 'unavailable';
        const disabledAttr = isAvailable ? '' : 'disabled';
        
        return `
            <div class="dropdown-item ${unavailableClass}">
                <input type="checkbox" id="${id}" data-filter-type="${filterType}" data-filter-value="${internal}" class="filter-checkbox" ${checkedAttr} ${disabledAttr}>
                <label for="${id}">${display}</label>
            </div>
        `;
    };
    
    const renderDropdown = (containerEl, map, filterType, filterNameDisplay) => {
        const panelEl = containerEl.querySelector('.dropdown-panel');
        const buttonEl = containerEl.querySelector('.select-btn');
        const filterNameEl = buttonEl.querySelector('.filter-name');

        if (!panelEl || !filterNameEl) return;
        
        filterNameEl.textContent = filterNameDisplay;
        panelEl.innerHTML = '';
        
        Array.from(map).sort((a, b) => {
            const displayA = Array.isArray(a) ? a[0] : a;
            const displayB = Array.isArray(b) ? b[0] : b;
            return displayA.localeCompare(displayB);
        }).forEach(item => {
            const [display, internal] = Array.isArray(item) ? item : [item, item];
            panelEl.innerHTML += generateDropdownItemHtml(display, internal, filterType);
        });

        if (buttonEl) {
            buttonEl.removeEventListener('click', toggleDropdownPanel);
            buttonEl.addEventListener('click', toggleDropdownPanel);
        }
    };

    // 1. Core Filter
    const coreThemes = new Map(allTasks.map(t => [t.primary_core_display, t.primary_core]));
    renderDropdown(coreFilterContainer, coreThemes, 'core', 'Core Theme');
    
    // 2. Stage Filter
    const stages = new Map(allTasks.map(t => [t.stage_display, t.stage]));
    renderDropdown(stageFilterContainer, stages, 'stage', 'Stage');

    // 3. Tag Filter (Subcategory)
    const tags = new Set(allTasks.flatMap(t => t.tags_display).filter(t => t && t.trim() !== '')); 
    const tagMap = Array.from(tags).map(tag => {
        const internalTag = normalizeTasks([{subcategory: tag}])[0].tags[0];
        return [tag, internalTag];
    });
    renderDropdown(tagFilterContainer, tagMap, 'tags', 'Sub Category');

    $$('.filter-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleFilterChange);
        checkbox.addEventListener('change', handleFilterChange);
    });

    updateFilterBadges();
    
    document.removeEventListener('click', handleDocumentClick);
    document.addEventListener('click', handleDocumentClick);
}

function handleDocumentClick(event) {
    const isClickInsideDropdown = event.target.closest('.custom-multi-select');
    if (!isClickInsideDropdown) {
        $$('.dropdown-panel').forEach(panel => {
            panel.classList.add('hide');
        });
    }
}

function handleFilterChange(event) {
    const checkbox = event.currentTarget;
    if (checkbox.disabled) {
        event.preventDefault(); 
        return;
    }
    
    const filterType = checkbox.dataset.filterType;
    const filterValue = checkbox.dataset.filterValue;

    if (filterType && filterValue) {
        if (checkbox.checked) {
            currentFilters[filterType].add(filterValue);
        } else {
            currentFilters[filterType].delete(filterValue);
        }
    }
    updateFilterBadges(); 
    applyFilters();
    resetActivityTimer(); // Reset timer on interaction
}

function applyFilters() {
    
    const allocatedTasks = ALLOCATED_TASKS; 
    const filteredTasks = filterTasks(allocatedTasks, currentFilters);

    renderTasks(filteredTasks);

    updateURLState();
}

function updateURLState() {
    const rawUrlParams = new URLSearchParams();
    
    if (currentUserName) {
        rawUrlParams.set('name', currentUserName);
    }
    // CRITICAL FIX: Ensure TESTER_ID is always present in URL state
    if (TESTER_ID) {
        rawUrlParams.set('tester_id', TESTER_ID);
    }
    
    if (currentFilters.core.size > 0) {
        rawUrlParams.set('core', Array.from(currentFilters.core).join(','));
    }
    if (currentFilters.stage.size > 0) {
        rawUrlParams.set('stage', Array.from(currentFilters.stage).join(','));
    }
    if (currentFilters.tags.size > 0) {
        rawUrlParams.set('tags', Array.from(currentFilters.tags).join(','));
    }

    const newUrl = `${location.pathname}?${rawUrlParams.toString()}`;
    window.history.replaceState(null, '', newUrl);
}

function filterTasks(tasks, filters) {
    let filtered = tasks;
    
    if (filters.core.size > 0) {
        filtered = filtered.filter(t => filters.core.has(t.primary_core));
    }

    if (filters.stage.size > 0) {
        filtered = filtered.filter(t => filters.stage.has(t.stage));
    }
    
    if (filters.tags.size > 0) {
        filtered = filtered.filter(t => {
            return t.tags.some(tag => filters.tags.has(tag));
        });
    }

    return filtered;
}

function generateTaskHtml(task) {
    const isDone = isTaskDone(task.id);
    const taskVote = getTaskVote(task.id);
    const taskComment = getTaskComment(task.id); 
    const likeActive = taskVote === 'like' ? 'active' : '';
    const dislikeActive = taskVote === 'dislike' ? 'active' : '';
    const completedClass = isDone ? 'task-done' : '';
    const checkedAttr = isDone ? 'checked' : '';
    
    let coreColorClass = '';
    if (task.primary_core === 'connectingbelonging') coreColorClass = 'core-connect';
    else if (task.primary_core === 'actingmotivating') coreColorClass = 'core-act';
    else if (task.primary_core === 'reflectinglearning') coreColorClass = 'core-reflect';
    else if (task.primary_core === 'creatingcircularity') coreColorClass = 'core-create';

    let stageColorClass = '';
    if (task.stage === 'seeds') { stageColorClass = 'stage-seeds'; }
    else if (task.stage === 'sprout') { stageColorClass = 'stage-sprout'; }
    else if (task.stage === 'bloom') { stageColorClass = 'stage-bloom'; }


    const tagsHtml = task.tags_display.map(tag =>
        `<span class="pill tag-pill">${tag}</span>`
    ).join('');
    
    const audienceHtml = task.audience_display ? `<span class="pill audience-pill">${task.audience_display}</span>` : '';
    
    const commentHtml = `
        <div class="task-comment-wrap">
            <label for="comment-input-${task.id}" class="comment-label">Your Comment</label>
            <div class="comment-input-group">
                <input 
                    type="text" 
                    id="comment-input-${task.id}" 
                    class="task-comment-input" 
                    placeholder="Enter your thoughts..." 
                    value="${taskComment}" 
                />
                <button 
                    class="btn comment-save-btn" 
                    data-task-id="${task.id}" 
                    type="button"
                >
                    Save
                </button>
            </div>
        </div>
    `;


    return `
        <div class="task-item card ${completedClass}" data-task-id="${task.id}" role="listitem">
            
            <div class="task-checkbox-wrap-outer">
                <input type="checkbox" data-task-id="${task.id}" ${checkedAttr} class="task-done-checkbox" id="checkbox-${task.id}">
            </div>

            <div class="task-content">
                <div class="task-title-score-wrap">
                    <label for="checkbox-${task.id}" class="task-text">${task.text}</label>
                </div>

                <div class="task-pills-wrap">
                    <div class="task-score-green">+${task.score}</div>
                    <span class="pill ${coreColorClass}">${task.primary_core_display}</span>
                    <span class="pill ${stageColorClass}">${task.stage_display}</span>
                    ${audienceHtml}
                    ${tagsHtml}
                </div>
                
                <div class="task-details">
                    <p><strong>Impact:</strong> ${task.impactValue || 'N/A'}</p>
                    <p><strong>Source:</strong> ${task.source || 'N/A'}</p>
                    <p><strong>Confidence:</strong> ${task.confidence || 'N/A'}</p>
                </div>

                ${commentHtml} </div>
            
            <div class="task-actions">
                <button class="vote-btn like-btn ${likeActive}" data-vote-type="like" aria-label="Like this task">
                    <span>👍 Like</span>
                </button>
                <button class="vote-btn downvote-btn ${dislikeActive}" data-vote-type="dislike" aria-label="Dislike this task">
                    <span>👎 Dislike</span>
                </button>
            </div>
        </div>
    `;
}

function renderTasks(tasksToRender) {
    const tasksContainer = $('#tasks');
    const noMatchMessage = $('#noMatchMessage');
    const progressWrap = $('#progressWrap');
    if (!tasksContainer || !noMatchMessage || !progressWrap) return;

    if (tasksToRender.length === 0) {
        tasksContainer.innerHTML = '';
        progressWrap.classList.add('hide'); 
        
        noMatchMessage.innerHTML = `
            <h3>No tasks match these filters.</h3>
            <p>Try clearing or adjusting your filter selections.</p>
        `;
        noMatchMessage.classList.remove('hide');

    } else {
        progressWrap.classList.remove('hide'); 
        noMatchMessage.classList.add('hide');
        noMatchMessage.innerHTML = '';

        tasksContainer.innerHTML = tasksToRender.map(task => 
            generateTaskHtml(task)
        ).join('');
        
        tasksContainer.querySelectorAll('.vote-btn').forEach(button => {
            button.removeEventListener('click', handleVote); 
            button.addEventListener('click', handleVote);
        });
        
        tasksContainer.querySelectorAll('.comment-save-btn').forEach(button => {
            button.removeEventListener('click', handleCommentSave); 
            button.addEventListener('click', handleCommentSave);
        });

        tasksContainer.querySelectorAll('.task-done-checkbox').forEach(checkbox => {
            checkbox.removeEventListener('change', handleTaskCompletion); 
            checkbox.addEventListener('change', handleTaskCompletion);
        });
    }
    
    updateProgress(); 
    $('#saveMsg').textContent = `Tasks loaded/synced. Last update: ${new Date().toLocaleTimeString()}`;
}

/* ---------------- session / login / local state ---------------- */
let currentUserName = safeGet('poc:name');
let currentUserEmail = safeGet('poc:email'); 
const loginForm = $('#loginForm');
const loginCard = $('#loginCard');
const appCard = $('#appCard');
const greeting = $('#greeting');
const nameInput = $('#name');
const emailInput = $('#email'); 
const feedbackBtn = $('#feedbackBtn');

// New global variables for session management
let sessionTimeoutId;
let lastActivityTime = Date.now();

// Utility function to reset the UI to the login screen
function resetAppToLogin() {
    clearTimeout(sessionTimeoutId);
    
    // Check if the app is currently visible before resetting
    if (appCard && !appCard.classList.contains('hide')) {
        toast('Session expired due to inactivity. Please log in again.', { type: 'warning', duration: 3000 });
    }
    
    // Hide app, show login
    if (loginCard) loginCard.classList.remove('hide');
    if (appCard) appCard.classList.add('hide');
    
    // The form inputs will automatically be populated from localStorage on next load
    // We do NOT clear localStorage here to allow quick re-login
}

// Function to handle activity and reset the timer
function resetActivityTimer() {
    if (appCard && appCard.classList.contains('hide')) {
        // Don't start/reset the timer if the user isn't logged in
        return;
    }
    
    lastActivityTime = Date.now();
    clearTimeout(sessionTimeoutId);
    
    sessionTimeoutId = setTimeout(resetAppToLogin, SESSION_TIMEOUT_MS);
}

// Function to attach listeners for activity (runs once on successful login)
function setupActivityListeners() {
    // Listen for common user interactions
    document.removeEventListener('mousemove', resetActivityTimer);
    document.removeEventListener('keypress', resetActivityTimer);
    document.removeEventListener('scroll', resetActivityTimer);

    document.addEventListener('mousemove', resetActivityTimer);
    document.addEventListener('keypress', resetActivityTimer);
    document.addEventListener('scroll', resetActivityTimer);
    
    // Immediately start the first timer
    resetActivityTimer(); 
}


/**
 * The main function to transition from login to app view.
 */
async function start(name, email) {
    
    // 1. NEW: Check if email is in the approved tester list
    let requiredTesterId = new URLSearchParams(location.search).get('tester_id');
    const lookupEmail = email.toLowerCase();

    // Only perform the email check if we don't have a pre-defined tester_id from the URL
    if (!requiredTesterId || requiredTesterId === 'FALLBACK_TESTER') {
        const foundTesterId = await checkTesterEmail(lookupEmail);
        
        if (!foundTesterId) {
            // FAILED LOGIN: Show error pop up and halt
            const contactEmail = 'contact@pollenpop.com'; // Placeholder contact email
            await showModalMessage(
                `We could not find an account for <strong>${email}</strong>.<br><br>Please reach out to ${contactEmail} to register for the trial.`, 
                true
            );
            loginForm.reset(); // Clear the form
            return; 
        }
        requiredTesterId = foundTesterId;
    }
    
    // 2. Set the global TESTER_ID and save locally/in session
    TESTER_ID = requiredTesterId;
    localStorage.setItem(UID_KEY, TESTER_ID);

    // 3. Load all tasks and user progress based on the confirmed TESTER_ID
    await initData(); 

    if (TASKS.length === 0) {
        if (loginCard) loginCard.classList.remove('hide');
        if (appCard) appCard.classList.add('hide');
        toast('Setup failed. Could not load tasks. Check data source.', { type: 'error' });
        return; 
    }
    
    // 4. Update local storage and RTDB for the successful login
    safeSet('poc:name', name);
    safeSet('poc:email', lookupEmail);
    currentUserName = name;
    currentUserEmail = lookupEmail;
    
    if (db) {
        const userRef = db.ref(`users/${TESTER_ID}`);
        userRef.update({
            name: name,
            email: lookupEmail,
            testerId: TESTER_ID,
            lastLogin: Date.now()
        }).catch(e => console.error("RTDB user data write error:", e));
    }

    // 5. Update URL state and UI
    const currentParams = new URLSearchParams(location.search);
    currentParams.set('name', name);
    currentParams.set('tester_id', TESTER_ID);
    const newUrl = `${location.pathname}?${currentParams.toString()}`;
    window.history.replaceState(null, '', newUrl);

    if (greeting) {
      greeting.textContent = `Hi ${name.split(' ')[0]}, here are your tasks:`;
    }
    
    if (loginCard) loginCard.classList.add('hide');
    if (appCard) appCard.classList.remove('hide');

    renderFilters(); 
    initFiltersFromURL(); 
    applyFilters(); 
    
    // NEW: Setup the activity timer after successful login
    setupActivityListeners(); 

    await updateQR(name);
    toast('App ready!', { type: 'success', duration: 1200 });
}


loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim(); 
    
    if (name && email) {
        // IMPORTANT: Start function now handles the email check and ID assignment
        await start(name, email); 
    } else {
        toast('Please enter your name and email.', { type: 'error' });
    }
});

function initFiltersFromURL() {
    const params = new URLSearchParams(location.search);
    
    const getFilterSetFromURL = (param) => {
        const value = params.get(param);
        return value ? new Set(value.split(',').filter(v => v.trim() !== '')) : new Set();
    };

    currentFilters.core = getFilterSetFromURL('core');
    currentFilters.stage = getFilterSetFromURL('stage');
    currentFilters.tags = getFilterSetFromURL('tags');
    
    renderFilters();
}

async function updateQR(name) {
  const qrContainer = $('#qrcode');
  if (!qrContainer) return;

  const url = window.location.href; 

  qrContainer.innerHTML = '';
  try {
    const libReady = await ensureQRLib();
    if (libReady) {
      new QRCode(qrContainer, {
        text: url,
        width: 128,
        height: 128,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
      });
      $('#qrHint').textContent = 'Scan to open this page and your saved session.';
    } else {
      qrContainer.textContent = 'QR Code library failed to load.';
    }
  } catch (err) {
    console.error('updateQR', err);
  }
}

function ensureQRLib(timeout = 4000) {
  if (window.QRCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => {
      if (window.QRCode) return resolve(true);
      if (Date.now() - start > timeout) return resolve(false);
      setTimeout(check, 120);
    };
    const start = Date.now();
    setTimeout(check, 120);
  });
}

feedbackBtn.addEventListener('click', async () => {
  const confirmed = await showModalMessage('You are being redirected to a **trail Form** to submit feedback.');
  
  if (confirmed) {
    window.open(FEEDBACK_FORM_URL, '_blank');
    toast('Opening trail Form...', { type: 'success' });
  }
  resetActivityTimer(); // Reset timer on interaction
});

// Initial Load Logic
const params = new URLSearchParams(location.search);
const initialName = params.get('name') || safeGet('poc:name');
const initialEmail = safeGet('poc:email'); 
const initialTesterId = params.get('tester_id'); 

if (initialTesterId) {
    TESTER_ID = initialTesterId;
    localStorage.setItem(UID_KEY, TESTER_ID);
}

if (initialName && initialEmail) {
    nameInput.value = initialName;
    emailInput.value = initialEmail;
    
    // When re-loading the page, we allow the session to start immediately based on local storage
    // The main email check is skipped here, assuming the user was already authenticated.
    // However, if the URL has a tester_id, the app uses that.
    start(initialName, initialEmail); 
} else {
    // Show login card
    if (loginCard) loginCard.classList.remove('hide');
    if (appCard) appCard.classList.add('hide');
}