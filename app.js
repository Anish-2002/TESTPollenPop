// app.js - unified logic with live updates and design-matched rendering (V2.8-FINAL-SCORE-CLEANUP)

const OUTBOX_KEY = 'poc:outbox';
const UID_KEY = 'poc:uid';
const NAME_KEY_PREFIX = 'poc:done:';
const VOTES_KEY_PREFIX = 'poc:votes:';
const VERSION = '2.8-FINAL-SCORE-CLEANUP'; // Updated Version
const ENDPOINT = ''; 
const TASK_DATA_FILE = 'tasks_master.json'; 

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


/* ---------------- Votes ---------------- */
function getTaskVote(taskId) {
    return safeGet(`${VOTES_KEY_PREFIX}${taskId}`, null);
}

function setTaskVote(taskId, voteType) {
    let voteValue = 0;
    if (voteType === 'like') voteValue = 1;
    if (voteType === 'dislike') voteValue = -1;
    
    queueEvent({ 
        type: 'vote', 
        task_id: taskId, 
        vote: voteValue 
    });

    // --- FIX: Simplify Toast Message ---
    if (voteType === 'none') {
        localStorage.removeItem(`${VOTES_KEY_PREFIX}${taskId}`);
        toast(`Vote cleared.`, { duration: 1500 }); 
    } else {
        safeSet(`${VOTES_KEY_PREFIX}${taskId}`, voteType);
        toast(`Vote recorded: ${voteType}d.`, { type: 'success', duration: 1500 });
    }
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
    
    applyFilters(); 
}

/* ---------------- tasks / filtering / scoring ---------------- */

let TASKS = []; // Holds ALL tasks from the JSON
let ALLOCATED_TASKS = []; // Holds tasks filtered by tester_mapping

/**
 * Normalizes the raw task data by cleaning up fields.
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
 * Asynchronously loads task data from the external JSON file.
 */
async function loadTasks() {
    try {
        const response = await fetch(TASK_DATA_FILE);
        if (!response.ok) {
            console.error(`Failed to fetch master task file: ${TASK_DATA_FILE}. Status: ${response.status}`);
            TASKS = normalizeTasks(safeGet('poc:tasks:fallback', []));
            return;
        }
        const rawTasks = await response.json();
        TASKS = normalizeTasks(rawTasks);
        safeSet('poc:tasks:fallback', rawTasks);
        
        await loadTesterMapping();
        
    } catch (err) {
        console.error('Error loading tasks:', err);
        TASKS = normalizeTasks(safeGet('poc:tasks:fallback', []));
    }
    
    // Determine the allocated tasks set after TASKS and TESTER_MAP are loaded
    ALLOCATED_TASKS = getAllocatedTasks();
}


let TESTER_MAP = {};

async function loadTesterMapping() {
    const params = new URLSearchParams(location.search);
    const initialTesterId = params.get('tester_id');
    
    if (initialTesterId) {
        try {
            const response = await fetch('tester_mapping.json');
            if (!response.ok) {
                console.error('Failed to fetch tester mapping.');
                return;
            }
            const mapping = await response.json();
            TESTER_MAP = mapping.find(m => m.tester_id === initialTesterId) || {};
            
        } catch (err) {
            console.error('Error loading tester mapping:', err);
        }
    }
}


/**
 * Gets the list of task IDs that a user has marked as complete.
 */
function getDoneTasks() {
    const tasksDone = safeGet(`${NAME_KEY_PREFIX}${TESTER_ID}`, {});
    
    // Simple cleanup/validation
    const validTaskIds = new Set(TASKS.map(t => t.id));
    for (const taskId in tasksDone) {
        if (!validTaskIds.has(taskId)) {
            delete tasksDone[taskId];
        }
    }
    safeSet(`${NAME_KEY_PREFIX}${TESTER_ID}`, tasksDone);
    return tasksDone;
}

/**
 * Checks if a specific task ID is marked as done.
 */
function isTaskDone(taskId) {
    const doneTasks = getDoneTasks();
    return !!doneTasks[taskId];
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
    const doneTasks = getDoneTasks();
    
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
            </div>
            
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

        // Re-attach event listeners for the 'done' checkbox
        tasksContainer.querySelectorAll('.task-done-checkbox').forEach(checkbox => {
            checkbox.removeEventListener('change', handleTaskCompletion); 
            checkbox.addEventListener('change', handleTaskCompletion);
        });
    }
    
    // IMPORTANT: Update progress always uses ALL allocated tasks, regardless of filtering
    updateProgress(); 
    $('#saveMsg').textContent = `Tasks saved locally. Last update: ${new Date().toLocaleTimeString()}`;
}

/**
 * Handles the change event for a task completion checkbox.
 */
function handleTaskCompletion(event) {
    const checkbox = event.currentTarget;
    const taskId = checkbox.dataset.taskId;
    const isDone = checkbox.checked;

    const doneTasks = getDoneTasks();

    // --- FIX: Simplify Toast Message ---
    if (isDone) {
        doneTasks[taskId] = Date.now();
        toast(`Task completed!`, { type: 'success', duration: 2000 });
    } else {
        delete doneTasks[taskId];
        toast(`Task marked incomplete.`, { duration: 2000 });
    }

    safeSet(`${NAME_KEY_PREFIX}${TESTER_ID}`, doneTasks);

    applyFilters(); 
}

/* ---------------- login / local state ---------------- */
let currentUserName = safeGet('poc:name');
const loginForm = $('#loginForm');
const loginCard = $('#loginCard');
const appCard = $('#appCard');
const greeting = $('#greeting');
const nameInput = $('#name');
const feedbackBtn = $('#feedbackBtn');

/**
 * The main function to transition from login to app view.
 */
async function start(name) {
    await loadTasks(); 
    
    if (TASKS.length === 0) {
        if (loginCard) loginCard.classList.remove('hide');
        if (appCard) appCard.classList.add('hide');
        toast('Setup failed. Could not load tasks. Check tasks_master.json.', { type: 'error' });
        return; 
    }

    if (!new URLSearchParams(location.search).get('tester_id')) {
        TESTER_ID = name.toLowerCase().replace(/[^a-z0-9]/g, ''); 
        localStorage.setItem(UID_KEY, TESTER_ID);
    }
    
    safeSet('poc:name', name);
    currentUserName = name;
    
    const key = NAME_KEY_PREFIX + TESTER_ID;
    if (!safeGet(key)) safeSet(key, {});

    const currentParams = new URLSearchParams(location.search);
    currentParams.set('name', name);
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
    if (name) {
        await start(name);
    } else {
        toast('Please enter your name.', { type: 'error' });
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

const params = new URLSearchParams(location.search);
const initialName = params.get('name') || safeGet('poc:name');
const initialTesterId = params.get('tester_id'); 

if (initialTesterId) {
    TESTER_ID = initialTesterId;
    localStorage.setItem(UID_KEY, TESTER_ID);
}

if (initialName) {
    nameInput.value = initialName;
    start(initialName);
} else {
    if (loginCard) loginCard.classList.remove('hide');
    if (appCard) appCard.classList.add('hide');
    loadTasks(); 
}