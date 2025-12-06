// app.js - unified logic with live updates and design-matched rendering (V2.8-FINAL-SCORE-CLEANUP-RTDB)

const OUTBOX_KEY = 'poc:outbox';
const UID_KEY = 'poc:uid';
const NAME_KEY_PREFIX = 'poc:done:';
const VOTES_KEY_PREFIX = 'poc:votes:';
// NEW: Key prefix for storing comments
const COMMENT_KEY_PREFIX = 'poc:comments:'; 
const VERSION = '2.8-FINAL-SCORE-CLEANUP-RTDB-COMMENTS'; // Updated Version
// REMOVE: const ENDPOINT = ''; 
// REMOVE: const TASK_DATA_FILE = 'tasks_master.json'; 

/* ---------------- Firebase Setup ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDq0LhVXpeE8Rs4o_7gEiaRhtouov88TGE",
  authDomain: "mywebapptracker.firebaseapp.com",
  databaseURL: "https://mywebapptracker-default-rtdb.firebaseio.com",
  projectId: "mywebapptracker",
  storageBucket: "mywebapptracker.firebasestorage.app",
  messagingSenderId: "570870780358",
  appId: "1:570870780358:web:5c995ab8ed74789bfda2c7"
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
// NEW: Define the score mapping for each stage as requested
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

/**
 * Displays a non-intrusive pop-up notification.
 * @param {string} msg The message to display.
 * @param {object} opts Options for the toast.
 * @param {string} [opts.type] 'success' or 'error'.
 * @param {number} [opts.duration] Display duration in ms. Defaults to 2000ms.
 */
function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + (opts.type === 'error' ? 'error' : opts.type === 'success' ? 'success' : '');
  el.textContent = msg;
  toastWrap.appendChild(el);
  // Default duration is 2000ms (2 seconds)
  setTimeout(() => el.remove(), opts.duration || 2000); 
}

// Custom modal implementation (Kept for feedback button functionality)
function showConfirm(message) {
    return new Promise(resolve => {
        const style = document.createElement('style');
        style.textContent = `.custom-modal-backdrop{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:center;z-index:9999}.custom-modal-content{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90%;width:300px;text-align:center}.custom-modal-actions{margin-top:15px}.custom-modal-content p{margin:0 0 15px;font-weight:600}`;
        document.head.appendChild(style);

        const modal = document.createElement('div');
        modal.className = 'custom-modal-backdrop';

        const closeModal = () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
        };

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

        confirmButton.addEventListener('click', () => {
            resolve(true);
            closeModal();
        });
    });
}


/* ---------------- event queue ---------------- */
function queueEvent(evt) {
  const box = safeGet(OUTBOX_KEY, []);
  box.push({ ...evt, tester_id: TESTER_ID, ua: navigator.userAgent, version: VERSION, ts: Date.now() });
  safeSet(OUTBOX_KEY, box);
  // flushOutbox().catch(e => console.warn(e)); 
}


/* ---------------- Tasks / Persistence (Updated for RTDB) ---------------- */

let TASKS = []; // Holds ALL tasks from the RTDB
let ALLOCATED_TASKS = []; // Holds tasks filtered by tester_mapping
let TESTER_MAP = {}; // The specific tester mapping object for the current TESTER_ID
let USER_TASK_STATUS = {}; // Global cache for user-specific data from RTDB /users/[TESTER_ID]/tasks


/**
 * Gets the list of task IDs that a user has marked as complete.
 * This is primarily for compatibility with updateProgress().
 */
function getDoneTasks() {
    const doneMap = {};
    for (const taskId in USER_TASK_STATUS) {
        // Use isTaskDone to check for all valid 'done' values (true or "done")
        if (isTaskDone(taskId)) {
            // Use true as a placeholder for the old local storage structure
            doneMap[taskId] = true; 
        }
    }
    return doneMap;
}

/**
 * Checks if a specific task ID is marked as done from the global RTDB-sourced status.
 */
function isTaskDone(taskId) {
    const taskStatus = USER_TASK_STATUS[taskId];
    // Check for both boolean {done: true} and string "done" from the RTDB data structure
    return (taskStatus && taskStatus.done === true) || taskStatus === 'done';
}

/**
 * Sets a task's done status, updates RTDB, and queues an event.
 */
function setTaskDone(taskId, isDone) {
    const currentComment = getTaskComment(taskId); // Get current comment to queue with completion event
    
    if (!db) {
        // Fallback to local storage (only for basic persistence of the done status)
        const doneTasks = safeGet(`${NAME_KEY_PREFIX}${TESTER_ID}`, {});
        if (isDone) {
            doneTasks[taskId] = Date.now();
            toast(`Task completed! (Local Storage)`, { type: 'success', duration: 2000 });
        } else {
            delete doneTasks[taskId];
            toast(`Task marked incomplete. (Local Storage)`, { duration: 2000 });
        }
        safeSet(`${NAME_KEY_PREFIX}${TESTER_ID}`, doneTasks);
        
        // Update local status cache to ensure immediate UI update
        USER_TASK_STATUS[taskId] = isDone ? { ...USER_TASK_STATUS[taskId], done: true } : USER_TASK_STATUS[taskId];
        if (!isDone && USER_TASK_STATUS[taskId] && USER_TASK_STATUS[taskId].done) {
            delete USER_TASK_STATUS[taskId].done;
        }

    } else {
        // RTDB Write Logic
        const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);
        
        if (isDone) {
            // Update global cache (merging with existing status)
            const existingStatus = USER_TASK_STATUS[taskId] || {};
            USER_TASK_STATUS[taskId] = {...existingStatus, done: true};

            // Write to RTDB (update to preserve vote/comment)
            taskRef.update({ done: true })
                .then(() => toast(`Task completed! (Saved to DB).`, { type: 'success', duration: 1500 }))
                .catch(e => {
                    console.error("RTDB write error:", e);
                    toast('Error saving done status to DB.', { type: 'error' });
                });

        } else {
            // Clear 'done' status
            if (USER_TASK_STATUS[taskId]) {
                delete USER_TASK_STATUS[taskId].done;
                
                // Check if the task node is now empty and should be removed completely
                if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
                    delete USER_TASK_STATUS[taskId]; // Remove from cache
                    taskRef.remove()
                        .then(() => toast(`Task marked incomplete. (Status cleared from DB).`, { duration: 1500 }))
                        .catch(e => console.error("RTDB write error:", e));
                } else {
                    // Only remove the 'done' property
                    taskRef.update({ done: null })
                        .then(() => toast(`Task marked incomplete. (Status cleared from DB).`, { duration: 1500 }))
                        .catch(e => console.error("RTDB write error:", e));
                }
            } else {
               toast(`Task marked incomplete. (No status found to clear).`, { duration: 1500 });
            }
        }
    }
    
    // Queue completion event
    queueEvent({
        type: 'completion',
        task_id: taskId,
        status: isDone ? 'completed' : 'incomplete',
        comment: currentComment || undefined // Include comment if it exists
    });

    updateProgress();
    applyFilters();
}

/**
 * Handles the change event for a task completion checkbox.
 */
function handleTaskCompletion(event) {
    const checkbox = event.currentTarget;
    const taskId = checkbox.dataset.taskId;
    const isDone = checkbox.checked;

    setTaskDone(taskId, isDone);
}


/* ---------------- Votes (Updated for RTDB) ---------------- */
function getTaskVote(taskId) {
    // Check RTDB cache first, fallback to local storage for display/transition
    const voteValue = USER_TASK_STATUS[taskId]?.vote;
    if (voteValue === 1) return 'like';
    if (voteValue === -1) return 'dislike';
    return safeGet(`${VOTES_KEY_PREFIX}${taskId}`, null); // Fallback to legacy local storage
}

function setTaskVote(taskId, voteType) {
    let voteValue = null; // Use null to remove the property from RTDB
    let toastMsg = 'Vote cleared.';

    if (voteType === 'like') {
        voteValue = 1;
        toastMsg = 'Vote recorded: liked.';
    } else if (voteType === 'dislike') {
        voteValue = -1;
        toastMsg = 'Vote recorded: disliked.';
    }
    
    // Legacy/Cache updates (keep for compatibility with old `handleVote` logic and queueing)
    if (voteType === 'none') {
        localStorage.removeItem(`${VOTES_KEY_PREFIX}${taskId}`);
    } else {
        safeSet(`${VOTES_KEY_PREFIX}${taskId}`, voteType);
    }

    queueEvent({ 
        type: 'vote', 
        task_id: taskId, 
        vote: voteValue === null ? 0 : voteValue // Queue 0 if cleared
    });
    
    if (!db) {
        toast('RTDB not available for writing. Vote saved to local storage.', { type: 'error' });
        applyFilters();
        return;
    }

    const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);
    
    // 1. Update global status cache
    if (!USER_TASK_STATUS[taskId]) {
        USER_TASK_STATUS[taskId] = {};
    }

    if (voteValue === null) {
        delete USER_TASK_STATUS[taskId].vote;
    } else {
        USER_TASK_STATUS[taskId].vote = voteValue;
    }

    // 2. Write to RTDB
    if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
         taskRef.remove()
            .then(() => toast(toastMsg + ' (Saved to DB).', { duration: 1500 }))
            .catch(e => {
                console.error("RTDB write error:", e);
                toast('Error clearing vote in DB.', { type: 'error' });
            });
    } else {
        // Write to RTDB (vote: null removes the 'vote' key)
        taskRef.update({ vote: voteValue })
            .then(() => toast(toastMsg + ' (Saved to DB).', { type: 'success', duration: 1500 }))
            .catch(e => {
                console.error("RTDB write error:", e);
                toast('Error saving vote to DB.', { type: 'error' });
            });
    }

    applyFilters(); 
}

function handleVote(event) {
    const button = event.currentTarget;
    const taskItem = button.closest('.task-item');
    if (!taskItem) return;
    
    const taskId = taskItem.dataset.taskId;
    const voteType = button.dataset.voteType; 
    
    if (!taskId || !voteType) return;

    const currentVote = getTaskVote(taskId);
    
    // Logic for toggling: if clicking the current vote, clear it.
    if (currentVote === voteType) {
        setTaskVote(taskId, 'none');
    } else {
        setTaskVote(taskId, voteType);
    }
    
    // applyFilters() is called inside setTaskVote
}

/* ---------------- Comments (Updated for RTDB) ---------------- */

/**
 * Gets the stored comment for a specific task ID from the global RTDB-sourced status.
 */
function getTaskComment(taskId) {
    return USER_TASK_STATUS[taskId]?.comment || safeGet(`${COMMENT_KEY_PREFIX}${taskId}`, ''); // Fallback to local storage
}

/**
 * Sets the comment for a specific task ID, updates RTDB, and queues an event.
 */
function setTaskComment(taskId, commentText) {
    const trimmedComment = String(commentText).trim();
    const commentValue = trimmedComment || null; // Use null to remove the property from RTDB

    // Legacy/Cache updates
    if (commentValue) {
        safeSet(`${COMMENT_KEY_PREFIX}${taskId}`, trimmedComment);
    } else {
        localStorage.removeItem(`${COMMENT_KEY_PREFIX}${taskId}`);
    }
    
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
        return;
    }
    
    const taskRef = db.ref(`users/${TESTER_ID}/tasks/${taskId}`);

    // 1. Update global status cache
    if (!USER_TASK_STATUS[taskId]) {
        USER_TASK_STATUS[taskId] = {};
    }
    
    if (commentValue === null) {
        delete USER_TASK_STATUS[taskId].comment;
    } else {
        USER_TASK_STATUS[taskId].comment = commentValue;
    }

    // 2. Write to RTDB
    if (Object.keys(USER_TASK_STATUS[taskId]).length === 0) {
         taskRef.remove()
            .then(() => toast(`Comment cleared (Saved to DB).`, { duration: 1500 }))
            .catch(e => {
                console.error("RTDB write error:", e);
                toast('Error clearing comment in DB.', { type: 'error' });
            });
    } else {
        // Write to RTDB (comment: null removes the 'comment' key)
        taskRef.update({ comment: commentValue })
            .then(() => {
                if (commentValue) {
                    toast('Comment saved (Saved to DB).', { type: 'success', duration: 1500 });
                } else {
                    toast('Comment cleared (Saved to DB).', { duration: 1500 });
                }
            })
            .catch(e => {
                console.error("RTDB write error:", e);
                toast('Error saving comment to DB.', { type: 'error' });
            });
    }

    applyFilters(); 
}

/**
 * Handles the click event for the Save Comment button.
 */
function handleCommentSave(event) {
    const button = event.currentTarget;
    const taskItem = button.closest('.task-item');
    if (!taskItem) return;
    
    const taskId = taskItem.dataset.taskId;
    const commentInput = taskItem.querySelector('.task-comment-input');
    
    if (!taskId || !commentInput) return;

    setTaskComment(taskId, commentInput.value);
}

/* ---------------- tasks / filtering / scoring / Data Loading (Updated for RTDB) ---------------- */

/**
 * Normalizes the raw task data by cleaning up fields.
 * (Logic kept as-is, runs on data fetched from RTDB or fallback)
 */
function normalizeTasks(rawTasks) {
    const CORE_MAP = {
        '🌱 Connecting / Belonging': 'connectingbelonging',
        '⚡ Acting / Motivating': 'actingmotivating',
        '🌙 Reflecting / Learning': 'reflectinglearning',
        '✨ Creating / Circularity': 'creatingcircularity'
    };
    // Map stage display name to a clean internal name
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
        
        // Find the score for this task
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
 * Fetches and initializes all global data from Firebase RTDB, with a local file fallback.
 * This replaces the separate loadTasks and loadTesterMapping functions.
 */
async function initData() {
    // If TESTER_ID has changed (e.g., via URL), ensure existing data is cleared for the new user
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
            toast(`Tester ID ${TESTER_ID} not found in mapping. Displaying all tasks.`, { duration: 3000 });
        }
        
        // 3. Process User Data (task status, votes, comments)
        const userSnapshot = await db.ref(`users/${TESTER_ID}`).once('value');
        const userData = userSnapshot.val();
        
        // Populate the global cache with user-specific tasks status
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

/**
 * Fallback function to load data from local JSON files if Firebase fails.
 */
async function loadFallbackData() {
    try {
        const tasksResponse = await fetch('tasks_master.json');
        const rawTasks = tasksResponse.ok ? await tasksResponse.json() : safeGet('poc:tasks:fallback', []);
        TASKS = normalizeTasks(rawTasks);
        safeSet('poc:tasks:fallback', rawTasks);
        
        const mapResponse = await fetch('tester_mapping.json');
        if (mapResponse.ok) {
            const mapping = await mapResponse.json();
            TESTER_MAP = mapping.find(m => m.tester_id === TESTER_ID) || {};
        }
        
        // Load user progress from local storage (legacy) and populate USER_TASK_STATUS cache
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

/**
 * Gets the full list of tasks allocated to the tester, regardless of filters.
 */
function getAllocatedTasks() {
    let allocatedTasks = TASKS;
    
    if (TESTER_MAP.allocated_task_ids && TESTER_MAP.allocated_task_ids.length > 0) {
        const allocated = new Set(TESTER_MAP.allocated_task_ids);
        allocatedTasks = TASKS.filter(t => allocated.has(t.id));
    }
    
    return allocatedTasks;
}


/**
 * Updates the progress bar and points display.
 */
function updateProgress() {
    const allocatedTasks = ALLOCATED_TASKS; // Use ALLOCATED_TASKS
    const doneTasks = getDoneTasks(); // Reads from USER_TASK_STATUS cache
    
    const doneCount = allocatedTasks.filter(t => doneTasks[t.id]).length;
    const totalCount = allocatedTasks.length;
    
    // Total Points is the sum of scores for completed tasks (from allocated list)
    const totalPoints = allocatedTasks
        .filter(t => doneTasks[t.id])
        .reduce((sum, t) => sum + t.score, 0); 

    const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    $('#progressBar').value = progressPct;
    // Progress now shows done/total allocated tasks
    $('#progressPct').textContent = `${doneCount}/${totalCount} (${progressPct}%)`; 
    
    // Update the Total Score Display (CLEANUP: Only show total points)
    const scoreElement = $('#score');
    if (scoreElement) {
        scoreElement.innerHTML = `Total Points: <span id="totalPoints">+${totalPoints}</span>`;
    }
    
    if (progressPct === 100 && totalCount > 0) {
        if (!safeGet('poc:completed:notified', false)) {
             // Use toast for notification with a longer duration
             toast('Congratulations! All assigned tasks completed!', { type: 'success', duration: 4000 });
             safeSet('poc:completed:notified', true);
        }
    } else {
         safeSet('poc:completed:notified', false);
    }
}


/* ---------------- task rendering & filters ---------------- */

// currentFilters now holds Sets of selected internal values for multi-select
let currentFilters = {
    core: new Set(),
    stage: new Set(),
    tags: new Set(),
};

/**
 * Toggles the visibility of a filter dropdown panel.
 */
function toggleDropdownPanel(event) {
    const button = event.currentTarget;
    const multiSelectEl = button.closest('.custom-multi-select');
    const panel = multiSelectEl ? multiSelectEl.querySelector('.dropdown-panel') : null;
    
    if (panel) {
        // Close all other open panels
        $$('.dropdown-panel:not(.hide)').forEach(openPanel => {
            if (openPanel !== panel) {
                openPanel.classList.add('hide');
            }
        });
        
        // Toggle the current panel
        panel.classList.toggle('hide');
    }
}

/**
 * Updates the summary badge for all filters (e.g., "2 selected").
 */
function updateFilterBadges() {
    // Array of filter types matches keys in currentFilters
    ['core', 'stage', 'tags'].forEach(filterType => {
        // The container ID is filterType + 'Filter' (e.g., 'coreFilter', 'stageFilter', 'tagsFilter')
        const container = $(`#${filterType}Filter`); 
        
        // If the element doesn't exist (e.g., if index.html still had tagFilter), skip
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
            // CRITICAL FIX: Ensure badge is hidden and button state is reset when count is zero
            badge.classList.add('hide');
            button.classList.remove('active');
        }
    });
}


/**
 * Renders the filter dropdowns based on ALL available tasks, marking allocated ones.
 */
function renderFilters() {
    const allTasks = TASKS; // Use ALL tasks for the filter options
    const allocatedInternalValues = {
        core: new Set(ALLOCATED_TASKS.map(t => t.primary_core)),
        stage: new Set(ALLOCATED_TASKS.map(t => t.stage)),
        tags: new Set(ALLOCATED_TASKS.flatMap(t => t.tags))
    };

    const coreFilterContainer = $('#coreFilter');
    const stageFilterContainer = $('#stageFilter');
    const tagFilterContainer = $('#tagsFilter'); // NOW uses #tagsFilter

    if (!coreFilterContainer || !stageFilterContainer || !tagFilterContainer) return;

    // Helper to generate a single filter item HTML (for inside the dropdown)
    const generateDropdownItemHtml = (display, internal, filterType) => {
        const id = `filter-${filterType}-${internal}`;
        const isChecked = currentFilters[filterType].has(internal);
        const checkedAttr = isChecked ? 'checked' : '';
        
        // --- FIX: Check if the option is in the allocated set. If not, mark as unavailable.
        const isAvailable = allocatedInternalValues[filterType].has(internal);
        const unavailableClass = isAvailable ? '' : 'unavailable';
        const disabledAttr = isAvailable ? '' : 'disabled';
        
        // If an item is unavailable but checked (e.g., from old URL state), it remains checked but disabled/grayed.
        
        return `
            <div class="dropdown-item ${unavailableClass}">
                <input type="checkbox" id="${id}" data-filter-type="${filterType}" data-filter-value="${internal}" class="filter-checkbox" ${checkedAttr} ${disabledAttr}>
                <label for="${id}">${display}</label>
            </div>
        `;
    };
    
    // Helper to render filter dropdown for a container
    const renderDropdown = (containerEl, map, filterType, filterNameDisplay) => {
        const panelEl = containerEl.querySelector('.dropdown-panel');
        const buttonEl = containerEl.querySelector('.select-btn');
        const filterNameEl = buttonEl.querySelector('.filter-name');

        if (!panelEl || !filterNameEl) return;
        
        filterNameEl.textContent = filterNameDisplay;
        panelEl.innerHTML = '';
        
        // Sort the items
        Array.from(map).sort((a, b) => {
            const displayA = Array.isArray(a) ? a[0] : a;
            const displayB = Array.isArray(b) ? b[0] : b;
            return displayA.localeCompare(displayB);
        }).forEach(item => {
            const [display, internal] = Array.isArray(item) ? item : [item, item];
            panelEl.innerHTML += generateDropdownItemHtml(display, internal, filterType);
        });

        // Add event listener for button to toggle panel visibility
        if (buttonEl) {
            buttonEl.removeEventListener('click', toggleDropdownPanel);
            buttonEl.addEventListener('click', toggleDropdownPanel);
        }
    };

    // 1. Core Filter
    // Use a Map to ensure unique display/internal pairs from ALL tasks
    const coreThemes = new Map(allTasks.map(t => [t.primary_core_display, t.primary_core]));
    renderDropdown(coreFilterContainer, coreThemes, 'core', 'Core Theme');
    
    // 2. Stage Filter
    const stages = new Map(allTasks.map(t => [t.stage_display, t.stage]));
    renderDropdown(stageFilterContainer, stages, 'stage', 'Stage');

    // 3. Tag Filter (Subcategory)
    const tags = new Set(allTasks.flatMap(t => t.tags_display).filter(t => t && t.trim() !== '')); 
    // Need to generate the internal tag name consistently for the map
    const tagMap = Array.from(tags).map(tag => {
        const internalTag = normalizeTasks([{subcategory: tag}])[0].tags[0];
        return [tag, internalTag];
    });
    renderDropdown(tagFilterContainer, tagMap, 'tags', 'Sub Category');

    // Attach listener to all new checkbox elements (must be re-attached every render)
    $$('.filter-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleFilterChange);
        checkbox.addEventListener('change', handleFilterChange);
    });

    // Update all badges immediately
    updateFilterBadges();
    
    // Close dropdown panel when clicking anywhere else on the document
    document.removeEventListener('click', handleDocumentClick);
    document.addEventListener('click', handleDocumentClick);
}

/**
 * Handles clicks outside the dropdown panel to close it.
 */
function handleDocumentClick(event) {
    const isClickInsideDropdown = event.target.closest('.custom-multi-select');
    if (!isClickInsideDropdown) {
        $$('.dropdown-panel').forEach(panel => {
            panel.classList.add('hide');
        });
    }
}


/**
 * Handles the change event for a filter checkbox.
 */
function handleFilterChange(event) {
    const checkbox = event.currentTarget;
    // Prevent interaction with disabled (unavailable/grayed out) items
    if (checkbox.disabled) {
        event.preventDefault(); 
        return;
    }
    
    const filterType = checkbox.dataset.filterType;
    const filterValue = checkbox.dataset.filterValue;

    if (filterType && filterValue) {
        // Toggle value in the Set
        if (checkbox.checked) {
            currentFilters[filterType].add(filterValue);
        } else {
            currentFilters[filterType].delete(filterValue);
        }
    }
    updateFilterBadges(); // Update badge on change
    applyFilters();
}


/**
 * Applies the current filters to the task list and re-renders.
 */
function applyFilters() {
    
    const allocatedTasks = ALLOCATED_TASKS; 
    const filteredTasks = filterTasks(allocatedTasks, currentFilters);

    renderTasks(filteredTasks);

    updateURLState();
}

/**
 * Updates the URL state based on current filters and name.
 */
function updateURLState() {
    const rawUrlParams = new URLSearchParams();
    
    if (currentUserName) {
        rawUrlParams.set('name', currentUserName);
    }
    if (TESTER_MAP.tester_id) {
        rawUrlParams.set('tester_id', TESTER_MAP.tester_id);
    }
    
    // Update URL for multi-select filters (joins selected values)
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


/**
 * Filters the master task list based on the current filters.
 */
function filterTasks(tasks, filters) {
    let filtered = tasks;
    
    // Apply core theme filter (OR logic within the filter)
    if (filters.core.size > 0) {
        filtered = filtered.filter(t => filters.core.has(t.primary_core));
    }

    // Apply stage filter (OR logic within the filter)
    if (filters.stage.size > 0) {
        filtered = filtered.filter(t => filters.stage.has(t.stage));
    }
    
    // Apply tag (subcategory) filter (OR logic within the filter)
    if (filters.tags.size > 0) {
        filtered = filtered.filter(t => {
            // Check if any of the task's tags are in the selected tags set
            return t.tags.some(tag => filters.tags.has(tag));
        });
    }

    return filtered;
}

/**
 * Generates the HTML for a single task item, matching the required design.
 */
function generateTaskHtml(task) {
    const isDone = isTaskDone(task.id);
    const taskVote = getTaskVote(task.id);
    const taskComment = getTaskComment(task.id); // Get existing comment
    const likeActive = taskVote === 'like' ? 'active' : '';
    const dislikeActive = taskVote === 'dislike' ? 'active' : '';
    const completedClass = isDone ? 'task-done' : '';
    const checkedAttr = isDone ? 'checked' : '';
    
    // Determine the color class for the CORE pill
    let coreColorClass = '';
    if (task.primary_core === 'connectingbelonging') coreColorClass = 'core-connect';
    else if (task.primary_core === 'actingmotivating') coreColorClass = 'core-act';
    else if (task.primary_core === 'reflectinglearning') coreColorClass = 'core-reflect';
    else if (task.primary_core === 'creatingcircularity') coreColorClass = 'core-create';

    // Determine the color class for the STAGE pill.
    let stageColorClass = '';
    if (task.stage === 'seeds') { stageColorClass = 'stage-seeds'; }
    else if (task.stage === 'sprout') { stageColorClass = 'stage-sprout'; }
    else if (task.stage === 'bloom') { stageColorClass = 'stage-bloom'; }


    const tagsHtml = task.tags_display.map(tag =>
        `<span class="pill tag-pill">${tag}</span>`
    ).join('');
    
    const audienceHtml = task.audience_display ? `<span class="pill audience-pill">${task.audience_display}</span>` : '';
    
    // NEW: Comment section HTML
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

/**
 * Renders the filtered tasks and attaches event listeners.
 */
function renderTasks(tasksToRender) {
    const tasksContainer = $('#tasks');
    const noMatchMessage = $('#noMatchMessage');
    const progressWrap = $('#progressWrap');
    if (!tasksContainer || !noMatchMessage || !progressWrap) return;

    if (tasksToRender.length === 0) {
        // Hide progress bar and display no-match message (as requested)
        tasksContainer.innerHTML = '';
        progressWrap.classList.add('hide'); 
        
        noMatchMessage.innerHTML = `
            <h3>No tasks match these filters.</h3>
            <p>Try clearing or adjusting your filter selections.</p>
        `;
        noMatchMessage.classList.remove('hide');

    } else {
        // Show progress bar and hide no-match message
        progressWrap.classList.remove('hide'); 
        noMatchMessage.classList.add('hide');
        noMatchMessage.innerHTML = '';

        tasksContainer.innerHTML = tasksToRender.map(task => 
            generateTaskHtml(task)
        ).join('');
        
        // Attach event listeners for votes 
        tasksContainer.querySelectorAll('.vote-btn').forEach(button => {
            button.removeEventListener('click', handleVote); 
            button.addEventListener('click', handleVote);
        });
        
        // NEW: Attach event listeners for comment save button
        tasksContainer.querySelectorAll('.comment-save-btn').forEach(button => {
            button.removeEventListener('click', handleCommentSave); 
            button.addEventListener('click', handleCommentSave);
        });

        // Re-attach event listeners for the 'done' checkbox
        tasksContainer.querySelectorAll('.task-done-checkbox').forEach(checkbox => {
            checkbox.removeEventListener('change', handleTaskCompletion); 
            checkbox.addEventListener('change', handleTaskCompletion);
        });
    }
    
    // IMPORTANT: Update progress always uses ALL allocated tasks, regardless of filtering
    updateProgress(); 
    $('#saveMsg').textContent = `Tasks loaded/synced. Last update: ${new Date().toLocaleTimeString()}`;
}

/* ---------------- login / local state (Updated for RTDB and Email) ---------------- */
let currentUserName = safeGet('poc:name');
let currentUserEmail = safeGet('poc:email'); // NEW: Get saved email
const loginForm = $('#loginForm');
const loginCard = $('#loginCard');
const appCard = $('#appCard');
const greeting = $('#greeting');
const nameInput = $('#name');
const emailInput = $('#email'); // NEW: Define email input element
const feedbackBtn = $('#feedbackBtn');

/**
 * The main function to transition from login to app view.
 */
async function start(name, email) {
    
    // Update TESTER_ID logic: Use URL param if provided, otherwise generate from name
    if (!new URLSearchParams(location.search).get('tester_id')) {
        // Re-using the logic from the original code
        TESTER_ID = name.toLowerCase().replace(/[^a-z0-9]/g, ''); 
        localStorage.setItem(UID_KEY, TESTER_ID);
    }
    
    // Load data from RTDB or fallback files.
    await initData(); 

    if (TASKS.length === 0) {
        if (loginCard) loginCard.classList.remove('hide');
        if (appCard) appCard.classList.add('hide');
        toast('Setup failed. Could not load tasks. Check data source.', { type: 'error' });
        return; 
    }
    
    safeSet('poc:name', name);
    safeSet('poc:email', email); // NEW: Save email to local storage
    currentUserName = name;
    currentUserEmail = email;
    
    // NEW: Write user's name, email, testerId, and last login to RTDB
    if (db) {
        const userRef = db.ref(`users/${TESTER_ID}`);
        userRef.update({
            name: name,
            email: email,
            testerId: TESTER_ID,
            lastLogin: Date.now()
        }).catch(e => console.error("RTDB user data write error:", e));
    }

    const currentParams = new URLSearchParams(location.search);
    currentParams.set('name', name);
    // Do NOT put email in URL for security/privacy reasons
    const newUrl = `${location.pathname}?${currentParams.toString()}`;
    window.history.replaceState(null, '', newUrl);

    if (greeting) {
      greeting.textContent = `Hi ${name.split(' ')[0]}, here are your tasks:`;
    }
    
    if (loginCard) loginCard.classList.add('hide');
    if (appCard) appCard.classList.remove('hide');

    // Render filters first so we can initialize from URL
    renderFilters(); 
    initFiltersFromURL(); 
    applyFilters(); // Renders with current filters
    
    await updateQR(name);
    toast('App ready!', { type: 'success', duration: 1200 });
}


loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim(); // NEW: Capture email
    
    if (name && email) {
        await start(name, email); // NEW: Pass name and email to start
    } else {
        toast('Please enter your name and email.', { type: 'error' });
    }
});

function initFiltersFromURL() {
    const params = new URLSearchParams(location.search);
    
    // Convert comma-separated URL values to Sets
    const getFilterSetFromURL = (param) => {
        const value = params.get(param);
        return value ? new Set(value.split(',').filter(v => v.trim() !== '')) : new Set();
    };

    currentFilters.core = getFilterSetFromURL('core');
    currentFilters.stage = getFilterSetFromURL('stage');
    currentFilters.tags = getFilterSetFromURL('tags');
    
    // Re-render filters to update checkboxes based on the new currentFilters
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
  const confirmed = await showConfirm('You are being redirected to a **trail Form** to submit feedback.');
  
  if (confirmed) {
    window.open(FEEDBACK_FORM_URL, '_blank');
    toast('Opening trail Form...', { type: 'success' });
  }
});

// Initial Load Logic
const params = new URLSearchParams(location.search);
const initialName = params.get('name') || safeGet('poc:name');
const initialEmail = safeGet('poc:email'); // Get saved email
const initialTesterId = params.get('tester_id'); 

if (initialTesterId) {
    TESTER_ID = initialTesterId;
    localStorage.setItem(UID_KEY, TESTER_ID);
}

if (initialName) {
    nameInput.value = initialName;
    
    // Populate email input if available
    if (emailInput && initialEmail) {
        emailInput.value = initialEmail;
    }
    
    // Start app if name is available, using saved email as fallback
    start(initialName, initialEmail || 'N/A'); 
} else {
    // Show login card
    if (loginCard) loginCard.classList.remove('hide');
    if (appCard) appCard.classList.add('hide');
}