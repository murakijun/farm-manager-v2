'use strict';

// ============================================================
// STORE — localStorage farm_v2
// ============================================================
const STORE = (() => {
  const KEY = 'farm_v2';

  const DEFAULT = {
    houses: [],
    trees: [],
    workLogs: [],
    irrigationLogs: [],
    workTypeHistory: ['剪定', '農薬散布', '施肥', '摘果', '袋掛け'],
    nextId: { house: 1, tree: 1, workLog: 1, irrigation: 1 }
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      const data = JSON.parse(raw);
      // Merge missing keys
      return { ...structuredClone(DEFAULT), ...data };
    } catch { return structuredClone(DEFAULT); }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function nextId(data, entity) {
    const id = data.nextId[entity] ?? 1;
    data.nextId[entity] = id + 1;
    return id;
  }

  // --- Houses ---
  function getHouses() { return load().houses; }

  function getHouse(id) { return load().houses.find(h => h.id === id) ?? null; }

  function addHouse({ name, rows, cols }) {
    const data = load();
    const id = nextId(data, 'house');
    const now = new Date().toISOString();
    data.houses.push({ id, name, rows: +rows, cols: +cols, createdAt: now });
    // Pre-create trees
    for (let r = 1; r <= +rows; r++) {
      for (let c = 1; c <= +cols; c++) {
        const tid = nextId(data, 'tree');
        data.trees.push({
          id: tid, houseId: id, row: r, col: c,
          diseaseRating: 5, soilRating: 5,
          floweringDate: null, fruitCount: 0,
          notes: '', updatedAt: now
        });
      }
    }
    save(data);
    return id;
  }

  function updateHouse(id, fields) {
    const data = load();
    const idx = data.houses.findIndex(h => h.id === id);
    if (idx < 0) return;
    data.houses[idx] = { ...data.houses[idx], ...fields };
    save(data);
  }

  function deleteHouse(id) {
    const data = load();
    data.houses = data.houses.filter(h => h.id !== id);
    data.trees = data.trees.filter(t => t.houseId !== id);
    data.workLogs = data.workLogs.filter(w => w.houseId !== id);
    data.irrigationLogs = data.irrigationLogs.filter(i => i.houseId !== id);
    save(data);
  }

  // --- Trees ---
  function getTreesForHouse(houseId) {
    return load().trees.filter(t => t.houseId === houseId)
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  function getTree(id) { return load().trees.find(t => t.id === id) ?? null; }

  function updateTree(id, fields) {
    const data = load();
    const idx = data.trees.findIndex(t => t.id === id);
    if (idx < 0) return;
    data.trees[idx] = { ...data.trees[idx], ...fields, updatedAt: new Date().toISOString() };
    save(data);
  }

  // --- Work Logs ---
  function getWorkLogs(houseId) {
    return load().workLogs.filter(w => w.houseId === houseId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function getWorkLog(id) { return load().workLogs.find(w => w.id === id) ?? null; }

  function addWorkLog({ houseId, date, workType, completedTreeIds, notes }) {
    const data = load();
    const id = nextId(data, 'workLog');
    data.workLogs.push({
      id, houseId, date: date || todayStr(),
      workType, completedTreeIds: completedTreeIds || [], notes: notes || ''
    });
    // Add to workTypeHistory if new
    if (workType && !data.workTypeHistory.includes(workType)) {
      data.workTypeHistory.push(workType);
    }
    save(data);
    return id;
  }

  function updateWorkLog(id, fields) {
    const data = load();
    const idx = data.workLogs.findIndex(w => w.id === id);
    if (idx < 0) return;
    data.workLogs[idx] = { ...data.workLogs[idx], ...fields };
    save(data);
  }

  function deleteWorkLog(id) {
    const data = load();
    data.workLogs = data.workLogs.filter(w => w.id !== id);
    save(data);
  }

  // --- Irrigation Logs ---
  function getIrrigationLogs(houseId) {
    return load().irrigationLogs.filter(i => i.houseId === houseId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function addIrrigationLog({ houseId, date, minutes }) {
    const data = load();
    const id = nextId(data, 'irrigation');
    data.irrigationLogs.push({ id, houseId, date: date || todayStr(), minutes: +minutes });
    save(data);
    return id;
  }

  function deleteIrrigationLog(id) {
    const data = load();
    data.irrigationLogs = data.irrigationLogs.filter(i => i.id !== id);
    save(data);
  }

  function getWorkTypeHistory() { return load().workTypeHistory; }

  return {
    getHouses, getHouse, addHouse, updateHouse, deleteHouse,
    getTreesForHouse, getTree, updateTree,
    getWorkLogs, getWorkLog, addWorkLog, updateWorkLog, deleteWorkLog,
    getIrrigationLogs, addIrrigationLog, deleteIrrigationLog,
    getWorkTypeHistory
  };
})();

// ============================================================
// PHOTO_DB — IndexedDB farmPhotosV2
// ============================================================
const PHOTO_DB = (() => {
  const DB_NAME = 'farmPhotosV2';
  const STORE_NAME = 'photos';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('treeId', 'treeId', { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function getPhotos(treeId) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('treeId');
      const req = idx.getAll(treeId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function addPhoto(treeId, dataUrl) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).add({
        treeId, dataUrl, createdAt: new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function deletePhoto(id) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  function deletePhotosForTree(treeId) {
    return getPhotos(treeId).then(photos =>
      Promise.all(photos.map(p => deletePhoto(p.id)))
    );
  }

  // Resize image to max 900px and return base64
  function resizeImage(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 900;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return { getPhotos, addPhoto, deletePhoto, deletePhotosForTree, resizeImage };
})();

// ============================================================
// TIME — localStorage farm_v2_time
// ============================================================
const TIME = (() => {
  const KEY = 'farm_v2_time';

  const DEFAULT = {
    daySessions: [],
    houseSessions: [],
    houseTotals: {},
    activeDay: null,
    activeHouseSession: null,
    nextId: { day: 1, house: 1 }
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      return { ...structuredClone(DEFAULT), ...JSON.parse(raw) };
    } catch { return structuredClone(DEFAULT); }
  }

  function save(data) { localStorage.setItem(KEY, JSON.stringify(data)); }

  function nextId(data, entity) {
    const id = data.nextId[entity] ?? 1;
    data.nextId[entity] = id + 1;
    return id;
  }

  // Day session
  function startDay() {
    const data = load();
    if (data.activeDay) return; // already running
    const now = new Date();
    data.activeDay = {
      id: nextId(data, 'day'),
      date: todayStr(),
      startTime: timeStr(now),
      startTs: now.getTime(),
      endTime: null
    };
    save(data);
  }

  function stopDay() {
    const data = load();
    if (!data.activeDay) return;
    const now = new Date();
    const session = {
      ...data.activeDay,
      endTime: timeStr(now),
      minutes: Math.round((now.getTime() - data.activeDay.startTs) / 60000)
    };
    data.daySessions.push(session);
    data.activeDay = null;
    save(data);
  }

  // House session
  function startHouseSession(houseId, workType) {
    const data = load();
    if (data.activeHouseSession) return; // already running
    const now = new Date();
    data.activeHouseSession = {
      id: nextId(data, 'house'),
      houseId,
      date: todayStr(),
      workType,
      startTime: timeStr(now),
      startTs: now.getTime(),
      endTime: null
    };
    save(data);
  }

  function stopHouseSession() {
    const data = load();
    if (!data.activeHouseSession) return;
    const now = new Date();
    const mins = Math.round((now.getTime() - data.activeHouseSession.startTs) / 60000);
    const session = { ...data.activeHouseSession, endTime: timeStr(now), minutes: mins };
    data.houseSessions.push(session);

    // Accumulate houseTotals
    const hid = String(session.houseId);
    if (!data.houseTotals[hid]) data.houseTotals[hid] = { totalMinutes: 0, byWorkType: {} };
    data.houseTotals[hid].totalMinutes += mins;
    const wt = session.workType || '不明';
    data.houseTotals[hid].byWorkType[wt] = (data.houseTotals[hid].byWorkType[wt] || 0) + mins;

    data.activeHouseSession = null;
    save(data);
  }

  function cancelHouseSession() {
    const data = load();
    data.activeHouseSession = null;
    save(data);
  }

  function getActiveDay() { return load().activeDay; }
  function getActiveHouseSession() { return load().activeHouseSession; }

  function getDaySessions() { return load().daySessions; }
  function getHouseSessions() { return load().houseSessions; }
  function getHouseTotals() { return load().houseTotals; }

  function getHouseTotalById(houseId) {
    const totals = load().houseTotals;
    return totals[String(houseId)] ?? { totalMinutes: 0, byWorkType: {} };
  }

  // Delete sessions for a month (keep totals)
  function deleteSessionsForMonth(yearMonth) {
    const data = load();
    data.daySessions = data.daySessions.filter(s => !s.date.startsWith(yearMonth));
    data.houseSessions = data.houseSessions.filter(s => !s.date.startsWith(yearMonth));
    save(data);
  }

  // Reset house totals
  function resetHouseTotals(houseId) {
    const data = load();
    delete data.houseTotals[String(houseId)];
    save(data);
  }

  // Get sessions grouped by month
  function getSessionsByMonth() {
    const sessions = load().daySessions;
    const groups = {};
    sessions.forEach(s => {
      const ym = s.date.slice(0, 7);
      if (!groups[ym]) groups[ym] = [];
      groups[ym].push(s);
    });
    return groups;
  }

  // Get house sessions for a month
  function getHouseSessionsForMonth(yearMonth) {
    return load().houseSessions.filter(s => s.date.startsWith(yearMonth));
  }

  return {
    startDay, stopDay,
    startHouseSession, stopHouseSession, cancelHouseSession,
    getActiveDay, getActiveHouseSession,
    getDaySessions, getHouseSessions, getHouseTotals, getHouseTotalById,
    deleteSessionsForMonth, resetHouseTotals,
    getSessionsByMonth, getHouseSessionsForMonth
  };
})();

// ============================================================
// Utilities
// ============================================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timeStr(d = new Date()) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtMinutes(mins) {
  if (!mins) return '0分';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}時間${m > 0 ? m+'分' : ''}` : `${m}分`;
}

function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${y}年${+m}月${+d}日`;
}

function avgRating(trees, field) {
  if (!trees.length) return 0;
  return (trees.reduce((s, t) => s + (t[field] || 0), 0) / trees.length).toFixed(1);
}

function starsHtml(val) {
  const n = Math.round(+val);
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<i class="bi bi-star${i <= n ? '-fill' : ''}" style="color:var(--mango-mid)"></i>`;
  }
  return s;
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0 show mb-2`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  document.getElementById('toast-container').prepend(el);
  setTimeout(() => el.remove(), 3000);
}

function confirm(msg) {
  return window.confirm(msg);
}

let _modal = null;
function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  if (!_modal) _modal = new bootstrap.Modal(document.getElementById('appModal'));
  _modal.show();
}
function hideModal() { _modal && _modal.hide(); }

// Timer tick interval
let _timerInterval = null;
function startTimerTick(callback) {
  stopTimerTick();
  _timerInterval = setInterval(callback, 1000);
}
function stopTimerTick() {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
}

function elapsedStr(startTs) {
  const secs = Math.floor((Date.now() - startTs) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ============================================================
// VIEWS
// ============================================================

// ---- Home ----
function renderHome() {
  stopTimerTick();
  const houses = STORE.getHouses();
  const app = document.getElementById('app');

  if (!houses.length) {
    app.innerHTML = `
      <div class="text-center py-5">
        <i class="bi bi-tree" style="font-size:4rem;color:var(--mango-green)"></i>
        <h5 class="mt-3">ハウスがありません</h5>
        <p class="text-muted">右下の＋ボタンからハウスを追加してください</p>
      </div>
      <button class="fab" onclick="ROUTER.go('/house/new')" title="ハウスを追加">
        <i class="bi bi-plus-lg"></i>
      </button>`;
    return;
  }

  const cards = houses.map(h => {
    const trees = STORE.getTreesForHouse(h.id);
    const avgD = avgRating(trees, 'diseaseRating');
    const avgS = avgRating(trees, 'soilRating');
    const flowering = trees.filter(t => t.floweringDate).length;
    const totalFruit = trees.reduce((s, t) => s + (t.fruitCount || 0), 0);
    return `
      <div class="card house-card mb-3" onclick="ROUTER.go('/house/${h.id}')">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div class="house-name">${h.name}</div>
            <span class="badge bg-secondary">${trees.length}本</span>
          </div>
          <div class="stats-bar mt-2">
            <span class="stat-chip"><i class="bi bi-bug-fill me-1"></i>病害 ${avgD}</span>
            <span class="stat-chip"><i class="bi bi-moisture me-1"></i>土壌 ${avgS}</span>
            <span class="stat-chip"><i class="bi bi-flower1 me-1"></i>開花 ${flowering}本</span>
            <span class="stat-chip"><i class="bi bi-circle-fill me-1"></i>実 ${totalFruit}個</span>
          </div>
          <div class="mt-2 text-muted" style="font-size:0.78rem">
            ${h.rows}行 × ${h.cols}列
          </div>
        </div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <h6 class="section-title">ハウス一覧</h6>
    ${cards}
    <button class="fab" onclick="ROUTER.go('/house/new')" title="ハウスを追加">
      <i class="bi bi-plus-lg"></i>
    </button>`;
}

// ---- House New / Edit ----
function renderHouseForm(houseId) {
  const isEdit = !!houseId;
  const house = isEdit ? STORE.getHouse(houseId) : null;
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="card">
      <div class="card-header d-flex align-items-center gap-2">
        <button class="btn btn-sm btn-outline-secondary" onclick="history.back()">
          <i class="bi bi-arrow-left"></i>
        </button>
        <span>${isEdit ? 'ハウス編集' : 'ハウス追加'}</span>
      </div>
      <div class="card-body">
        <form id="house-form">
          <div class="mb-3">
            <label class="form-label">ハウス名</label>
            <input type="text" class="form-control" id="f-name" required
              value="${house ? house.name : ''}" placeholder="例: 1号棟">
          </div>
          <div class="row g-2 mb-3">
            <div class="col">
              <label class="form-label">行数（列）</label>
              <input type="number" class="form-control" id="f-rows" min="1" max="30" required
                value="${house ? house.rows : 6}" ${isEdit ? 'disabled' : ''}>
            </div>
            <div class="col">
              <label class="form-label">列数（行）</label>
              <input type="number" class="form-control" id="f-cols" min="1" max="30" required
                value="${house ? house.cols : 4}" ${isEdit ? 'disabled' : ''}>
            </div>
          </div>
          ${isEdit ? '<p class="text-muted small">※ 行・列数は変更できません</p>' : ''}
          <button type="submit" class="btn btn-primary w-100">
            ${isEdit ? '保存' : 'ハウスを追加'}
          </button>
          ${isEdit ? `
            <button type="button" class="btn btn-outline-danger w-100 mt-2"
              onclick="deleteHouseConfirm(${houseId})">
              <i class="bi bi-trash3"></i> ハウスを削除
            </button>` : ''}
        </form>
      </div>
    </div>`;

  document.getElementById('house-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('f-name').value.trim();
    const rows = document.getElementById('f-rows').value;
    const cols = document.getElementById('f-cols').value;
    if (!name) return;
    if (isEdit) {
      STORE.updateHouse(houseId, { name });
      showToast('ハウスを更新しました');
      ROUTER.go(`/house/${houseId}`);
    } else {
      const id = STORE.addHouse({ name, rows, cols });
      showToast('ハウスを追加しました');
      ROUTER.go(`/house/${id}`);
    }
  });
}

window.deleteHouseConfirm = function(id) {
  if (!confirm(`このハウスとすべてのデータを削除しますか？\nこの操作は取り消せません。`)) return;
  STORE.deleteHouse(id);
  showToast('ハウスを削除しました', 'warning');
  ROUTER.go('/');
};

// ---- House Detail ----
function renderHouseDetail(houseId) {
  const house = STORE.getHouse(houseId);
  if (!house) { ROUTER.go('/'); return; }

  const trees = STORE.getTreesForHouse(houseId);
  const avgD = avgRating(trees, 'diseaseRating');
  const avgS = avgRating(trees, 'soilRating');
  const flowering = trees.filter(t => t.floweringDate).length;
  const totalFruit = trees.reduce((s, t) => s + (t.fruitCount || 0), 0);

  // Tree grid
  const colCount = house.cols;
  const gridStyle = `grid-template-columns: repeat(${colCount}, 1fr)`;
  const gridCells = trees.map(t =>
    `<div class="tree-cell rating-${t.diseaseRating}"
      onclick="ROUTER.go('/tree/${t.id}')"
      title="${t.row}行${t.col}列 病害:${t.diseaseRating} 土壌:${t.soilRating}">
      ${t.row}-${t.col}
    </div>`
  ).join('');

  // Active house session
  const activeHS = TIME.getActiveHouseSession();
  const isThisHouseActive = activeHS && activeHS.houseId === houseId;

  // Work logs
  const workLogs = STORE.getWorkLogs(houseId).slice(0, 5);
  const workLogItems = workLogs.map(w => {
    const pct = trees.length ? Math.round(w.completedTreeIds.length / trees.length * 100) : 0;
    return `
      <div class="list-group-item list-group-item-action"
        onclick="ROUTER.go('/house/${houseId}/work/${w.id}')">
        <div class="d-flex justify-content-between">
          <span class="work-type-badge">${w.workType}</span>
          <small class="text-muted">${fmtDate(w.date)}</small>
        </div>
        <div class="progress-custom mt-2">
          <div class="progress-custom-bar" style="width:${pct}%"></div>
        </div>
        <small class="text-muted">${w.completedTreeIds.length}/${trees.length}本 完了</small>
      </div>`;
  }).join('');

  // Today's irrigation
  const todayIrr = STORE.getIrrigationLogs(houseId)
    .filter(i => i.date === todayStr())
    .reduce((s, i) => s + i.minutes, 0);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <button class="btn btn-sm btn-outline-secondary" onclick="ROUTER.go('/')">
        <i class="bi bi-arrow-left"></i>
      </button>
      <h5 class="mb-0 flex-grow-1">${house.name}</h5>
      <button class="btn btn-sm btn-outline-secondary"
        onclick="ROUTER.go('/house/${houseId}/edit')">
        <i class="bi bi-pencil"></i>
      </button>
    </div>

    <!-- Stats bar -->
    <div class="stats-bar mb-3">
      <span class="stat-chip"><i class="bi bi-bug-fill me-1"></i>病害 ${avgD}</span>
      <span class="stat-chip"><i class="bi bi-moisture me-1"></i>土壌 ${avgS}</span>
      <span class="stat-chip"><i class="bi bi-flower1 me-1"></i>開花 ${flowering}本</span>
      <span class="stat-chip"><i class="bi bi-circle-fill me-1"></i>実 ${totalFruit}個</span>
    </div>

    <!-- Tree grid -->
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-grid-3x3-gap-fill me-1"></i>木グリッド</span>
        <span class="text-muted small">${trees.length}本</span>
      </div>
      <div class="card-body p-2">
        <div class="tree-grid" style="${gridStyle}">${gridCells}</div>
        <div class="d-flex gap-2 mt-2 flex-wrap justify-content-center">
          ${[5,4,3,2,1].map(r =>
            `<span style="font-size:0.72rem;display:flex;align-items:center;gap:3px">
              <span style="width:12px;height:12px;border-radius:3px;background:var(--rating-${r});display:inline-block"></span>${r}
            </span>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- Work timer -->
    <div class="card mb-3 ${isThisHouseActive ? 'border-warning timer-running' : ''}">
      <div class="card-header"><i class="bi bi-stopwatch me-1"></i>作業打刻</div>
      <div class="card-body">
        ${isThisHouseActive ? `
          <div class="text-center mb-2">
            <div class="timer-display" id="house-timer">${elapsedStr(activeHS.startTs)}</div>
            <div class="text-muted small">${activeHS.workType} — ${activeHS.startTime} 開始</div>
          </div>
          <button class="btn btn-danger w-100" onclick="houseTimerStop()">
            <i class="bi bi-stop-circle me-1"></i>作業終了
          </button>` : `
          <div id="work-type-select" class="mb-2">
            <label class="form-label">作業種類</label>
            <div class="d-flex gap-2">
              <select class="form-select" id="wt-select">
                ${STORE.getWorkTypeHistory().map(wt =>
                  `<option value="${wt}">${wt}</option>`
                ).join('')}
              </select>
              <button class="btn btn-outline-secondary" onclick="showCustomWorkType()">
                <i class="bi bi-plus"></i>
              </button>
            </div>
          </div>
          <button class="btn btn-success w-100" onclick="houseTimerStart(${houseId})">
            <i class="bi bi-play-circle me-1"></i>作業開始
          </button>`}
      </div>
    </div>

    <!-- Irrigation -->
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-droplet-fill me-1"></i>灌水記録</span>
        <span class="text-muted small">本日: ${todayIrr}分</span>
      </div>
      <div class="card-body">
        <div class="d-flex gap-2 align-items-center">
          <input type="number" class="form-control" id="irr-mins"
            min="1" max="999" placeholder="分" style="max-width:100px">
          <button class="btn btn-primary" onclick="addIrrigation(${houseId})">
            <i class="bi bi-plus-lg me-1"></i>記録
          </button>
        </div>
        <div id="irr-log-list" class="mt-2">
          ${renderIrrigationList(houseId)}
        </div>
      </div>
    </div>

    <!-- Work logs -->
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-clipboard-check me-1"></i>作業記録</span>
        <button class="btn btn-sm btn-primary"
          onclick="ROUTER.go('/house/${houseId}/work/new')">
          <i class="bi bi-plus-lg"></i>
        </button>
      </div>
      <div class="list-group list-group-flush" id="work-log-list">
        ${workLogItems || '<div class="list-group-item text-muted">記録がありません</div>'}
      </div>
    </div>`;

  // Start timer tick if active
  if (isThisHouseActive) {
    startTimerTick(() => {
      const el = document.getElementById('house-timer');
      if (el) el.textContent = elapsedStr(TIME.getActiveHouseSession()?.startTs || Date.now());
    });
  }
}

function renderIrrigationList(houseId) {
  const logs = STORE.getIrrigationLogs(houseId).slice(0, 5);
  if (!logs.length) return '<div class="text-muted small">記録がありません</div>';
  return logs.map(i => `
    <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
      <span class="small">${fmtDate(i.date)}</span>
      <span class="small fw-bold">${i.minutes}分</span>
      <button class="btn btn-sm btn-outline-danger py-0 px-1" style="min-height:28px"
        onclick="deleteIrrigation(${i.id}, ${houseId})">
        <i class="bi bi-trash3"></i>
      </button>
    </div>`).join('');
}

window.addIrrigation = function(houseId) {
  const val = document.getElementById('irr-mins').value;
  const mins = parseInt(val);
  if (!mins || mins <= 0) { showToast('分数を入力してください', 'warning'); return; }
  STORE.addIrrigationLog({ houseId, minutes: mins });
  document.getElementById('irr-mins').value = '';
  document.getElementById('irr-log-list').innerHTML = renderIrrigationList(houseId);
  showToast(`灌水 ${mins}分 を記録しました`);
};

window.deleteIrrigation = function(id, houseId) {
  if (!confirm('この灌水記録を削除しますか？')) return;
  STORE.deleteIrrigationLog(id);
  document.getElementById('irr-log-list').innerHTML = renderIrrigationList(houseId);
};

window.houseTimerStart = function(houseId) {
  const wt = document.getElementById('wt-select')?.value || '作業';
  TIME.startHouseSession(houseId, wt);
  renderHouseDetail(houseId);
};

window.houseTimerStop = function() {
  TIME.stopHouseSession();
  const hash = location.hash;
  const m = hash.match(/\/house\/(\d+)/);
  if (m) renderHouseDetail(+m[1]);
  else ROUTER.go('/');
};

window.showCustomWorkType = function() {
  const wt = window.prompt('作業種類を入力してください:');
  if (!wt) return;
  const sel = document.getElementById('wt-select');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = wt; opt.textContent = wt; opt.selected = true;
    sel.appendChild(opt);
  }
};

// ---- Work Log New/Detail ----
function renderWorkLogNew(houseId) {
  const house = STORE.getHouse(houseId);
  if (!house) { ROUTER.go('/'); return; }
  const trees = STORE.getTreesForHouse(houseId);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <button class="btn btn-sm btn-outline-secondary" onclick="history.back()">
        <i class="bi bi-arrow-left"></i>
      </button>
      <h5 class="mb-0">${house.name} — 作業記録追加</h5>
    </div>
    <div class="card">
      <div class="card-body">
        <form id="wl-form">
          <div class="mb-3">
            <label class="form-label">作業日</label>
            <input type="date" class="form-control" id="wl-date" value="${todayStr()}">
          </div>
          <div class="mb-3">
            <label class="form-label">作業種類</label>
            <div class="d-flex gap-2">
              <select class="form-select" id="wl-type">
                ${STORE.getWorkTypeHistory().map(wt =>
                  `<option value="${wt}">${wt}</option>`
                ).join('')}
              </select>
              <button type="button" class="btn btn-outline-secondary"
                onclick="showCustomWorkTypeWL()">
                <i class="bi bi-plus"></i>
              </button>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">メモ</label>
            <textarea class="form-control" id="wl-notes" rows="2"></textarea>
          </div>
          <button type="submit" class="btn btn-primary w-100">
            <i class="bi bi-plus-lg me-1"></i>追加
          </button>
        </form>
      </div>
    </div>`;

  document.getElementById('wl-form').addEventListener('submit', e => {
    e.preventDefault();
    const date = document.getElementById('wl-date').value;
    const workType = document.getElementById('wl-type').value;
    const notes = document.getElementById('wl-notes').value;
    const id = STORE.addWorkLog({ houseId, date, workType, notes });
    showToast('作業記録を追加しました');
    ROUTER.go(`/house/${houseId}/work/${id}`);
  });
}

window.showCustomWorkTypeWL = function() {
  const wt = window.prompt('作業種類を入力してください:');
  if (!wt) return;
  const sel = document.getElementById('wl-type');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = wt; opt.textContent = wt; opt.selected = true;
    sel.appendChild(opt);
  }
};

function renderWorkLogDetail(houseId, wlogId) {
  const house = STORE.getHouse(houseId);
  const wlog = STORE.getWorkLog(wlogId);
  if (!house || !wlog) { ROUTER.go(`/house/${houseId}`); return; }
  const trees = STORE.getTreesForHouse(houseId);

  const app = document.getElementById('app');

  const items = trees.map(t => {
    const checked = wlog.completedTreeIds.includes(t.id);
    return `
      <label class="checklist-item">
        <input type="checkbox" ${checked ? 'checked' : ''}
          onchange="toggleWorkTree(${wlogId}, ${t.id}, this.checked)">
        <span class="flex-grow-1">${t.row}行 ${t.col}列</span>
        <span style="font-size:0.78rem;color:var(--text-muted)">${t.notes ? '📝' : ''}</span>
        <button class="btn btn-sm btn-outline-secondary ms-1 py-0 px-1" style="min-height:28px"
          onclick="event.preventDefault();ROUTER.go('/tree/${t.id}')">
          <i class="bi bi-info-circle"></i>
        </button>
      </label>`;
  }).join('');

  const pct = trees.length ? Math.round(wlog.completedTreeIds.length / trees.length * 100) : 0;

  app.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <button class="btn btn-sm btn-outline-secondary"
        onclick="ROUTER.go('/house/${houseId}')">
        <i class="bi bi-arrow-left"></i>
      </button>
      <h5 class="mb-0 flex-grow-1">${wlog.workType}</h5>
      <button class="btn btn-sm btn-outline-danger"
        onclick="deleteWorkLogConfirm(${houseId}, ${wlogId})">
        <i class="bi bi-trash3"></i>
      </button>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-2 mb-2">
          <span class="work-type-badge">${wlog.workType}</span>
          <span class="text-muted small">${fmtDate(wlog.date)}</span>
        </div>
        <div class="progress-custom mb-1">
          <div class="progress-custom-bar" style="width:${pct}%" id="wl-progress-bar"></div>
        </div>
        <small class="text-muted">
          <span id="wl-count">${wlog.completedTreeIds.length}</span>/${trees.length}本完了 (${pct}%)
        </small>
        ${wlog.notes ? `<p class="mt-2 mb-0 small">${wlog.notes}</p>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-header d-flex justify-content-between">
        <span>木チェックリスト</span>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary"
            onclick="checkAllTrees(${wlogId}, ${houseId}, true)">全選択</button>
          <button class="btn btn-sm btn-outline-secondary"
            onclick="checkAllTrees(${wlogId}, ${houseId}, false)">全解除</button>
        </div>
      </div>
      <div class="card-body p-2">
        ${items}
      </div>
    </div>`;
}

window.toggleWorkTree = function(wlogId, treeId, checked) {
  const wlog = STORE.getWorkLog(wlogId);
  if (!wlog) return;
  let ids = [...wlog.completedTreeIds];
  if (checked && !ids.includes(treeId)) ids.push(treeId);
  else if (!checked) ids = ids.filter(i => i !== treeId);
  STORE.updateWorkLog(wlogId, { completedTreeIds: ids });

  // Update progress display
  const wlog2 = STORE.getWorkLog(wlogId);
  const house = STORE.getHouse(wlog2.houseId);
  const trees = STORE.getTreesForHouse(wlog2.houseId);
  const pct = trees.length ? Math.round(wlog2.completedTreeIds.length / trees.length * 100) : 0;
  const bar = document.getElementById('wl-progress-bar');
  const cnt = document.getElementById('wl-count');
  if (bar) bar.style.width = `${pct}%`;
  if (cnt) cnt.textContent = wlog2.completedTreeIds.length;
};

window.checkAllTrees = function(wlogId, houseId, checked) {
  const trees = STORE.getTreesForHouse(houseId);
  const ids = checked ? trees.map(t => t.id) : [];
  STORE.updateWorkLog(wlogId, { completedTreeIds: ids });
  renderWorkLogDetail(houseId, wlogId);
};

window.deleteWorkLogConfirm = function(houseId, wlogId) {
  if (!confirm('この作業記録を削除しますか？')) return;
  STORE.deleteWorkLog(wlogId);
  showToast('削除しました', 'warning');
  ROUTER.go(`/house/${houseId}`);
};

// ---- Tree Detail ----
function renderTreeDetail(treeId) {
  const tree = STORE.getTree(treeId);
  if (!tree) { ROUTER.go('/'); return; }
  const house = STORE.getHouse(tree.houseId);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <button class="btn btn-sm btn-outline-secondary"
        onclick="ROUTER.go('/house/${tree.houseId}')">
        <i class="bi bi-arrow-left"></i>
      </button>
      <h5 class="mb-0">${house ? house.name : ''} — ${tree.row}行${tree.col}列</h5>
    </div>

    <!-- Disease rating -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="section-title">病害評価（1=最悪 / 5=健康）</div>
        <div class="rating-btn-group" id="disease-btns">
          ${[1,2,3,4,5].map(r =>
            `<button class="rating-btn r${r} ${tree.diseaseRating === r ? 'active' : ''}"
              onclick="setRating(${treeId}, 'disease', ${r})">${r}</button>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- Soil rating -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="section-title">土壌評価（1=最悪 / 5=良好）</div>
        <div class="rating-btn-group" id="soil-btns">
          ${[1,2,3,4,5].map(r =>
            `<button class="rating-btn r${r} ${tree.soilRating === r ? 'active' : ''}"
              onclick="setRating(${treeId}, 'soil', ${r})">${r}</button>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- Flowering -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="section-title">開花日</div>
        <div class="d-flex gap-2 align-items-center">
          <input type="date" class="form-control" id="flowering-date"
            value="${tree.floweringDate || ''}"
            onchange="setFlowering(${treeId}, this.value)">
          <button class="btn btn-outline-secondary" onclick="setFlowering(${treeId}, null)">
            未
          </button>
        </div>
        ${tree.floweringDate ?
          `<div class="text-muted small mt-1">開花: ${fmtDate(tree.floweringDate)}</div>` : ''}
      </div>
    </div>

    <!-- Fruit count -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="section-title">実の数</div>
        <div class="d-flex align-items-center gap-3">
          <button class="btn btn-outline-secondary" style="width:44px;height:44px;padding:0"
            onclick="adjustFruit(${treeId}, -1)">
            <i class="bi bi-dash-lg"></i>
          </button>
          <span class="fs-3 fw-bold" id="fruit-count">${tree.fruitCount}</span>
          <button class="btn btn-primary" style="width:44px;height:44px;padding:0"
            onclick="adjustFruit(${treeId}, 1)">
            <i class="bi bi-plus-lg"></i>
          </button>
          <button class="btn btn-outline-secondary ms-2"
            onclick="setFruitDirect(${treeId})">
            入力
          </button>
        </div>
      </div>
    </div>

    <!-- Notes -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="section-title">メモ</div>
        <textarea class="form-control" id="tree-notes" rows="3"
          onchange="saveNotes(${treeId})">${tree.notes || ''}</textarea>
        <button class="btn btn-outline-primary btn-sm mt-2" onclick="saveNotes(${treeId})">
          <i class="bi bi-floppy me-1"></i>保存
        </button>
      </div>
    </div>

    <!-- Photos -->
    <div class="card mb-3">
      <div class="card-header"><i class="bi bi-camera me-1"></i>写真</div>
      <div class="card-body">
        <div class="photo-grid mb-2" id="photo-grid">
          <div class="text-muted small">読み込み中...</div>
        </div>
        <label class="btn btn-outline-primary w-100">
          <i class="bi bi-camera-fill me-1"></i>写真を追加
          <input type="file" accept="image/*" multiple hidden onchange="addPhotos(${treeId}, this)">
        </label>
      </div>
    </div>

    <div class="text-muted small text-end pb-3">
      最終更新: ${tree.updatedAt ? fmtDate(tree.updatedAt.slice(0,10)) : '—'}
    </div>`;

  loadPhotos(treeId);
}

window.setRating = function(treeId, type, val) {
  const field = type === 'disease' ? 'diseaseRating' : 'soilRating';
  STORE.updateTree(treeId, { [field]: val });
  // Update UI
  const btns = document.querySelectorAll(`#${type}-btns .rating-btn`);
  btns.forEach((b, i) => b.classList.toggle('active', i + 1 === val));
};

window.setFlowering = function(treeId, val) {
  STORE.updateTree(treeId, { floweringDate: val || null });
  if (!val) {
    const inp = document.getElementById('flowering-date');
    if (inp) inp.value = '';
  }
  showToast(val ? `開花日: ${fmtDate(val)}` : '開花日をクリアしました');
};

window.adjustFruit = function(treeId, delta) {
  const tree = STORE.getTree(treeId);
  if (!tree) return;
  const newVal = Math.max(0, (tree.fruitCount || 0) + delta);
  STORE.updateTree(treeId, { fruitCount: newVal });
  const el = document.getElementById('fruit-count');
  if (el) el.textContent = newVal;
};

window.setFruitDirect = function(treeId) {
  const tree = STORE.getTree(treeId);
  const val = window.prompt('実の数を入力してください:', tree.fruitCount || 0);
  if (val === null) return;
  const n = parseInt(val);
  if (isNaN(n) || n < 0) return;
  STORE.updateTree(treeId, { fruitCount: n });
  const el = document.getElementById('fruit-count');
  if (el) el.textContent = n;
};

window.saveNotes = function(treeId) {
  const notes = document.getElementById('tree-notes').value;
  STORE.updateTree(treeId, { notes });
  showToast('メモを保存しました');
};

async function loadPhotos(treeId) {
  const photos = await PHOTO_DB.getPhotos(treeId);
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  if (!photos.length) {
    grid.innerHTML = '<div class="text-muted small">写真がありません</div>';
    return;
  }
  grid.innerHTML = photos.map(p =>
    `<div style="position:relative">
      <img src="${p.dataUrl}" class="photo-thumb" onclick="viewPhoto('${p.dataUrl}')">
      <button class="btn btn-danger btn-sm" style="position:absolute;top:2px;right:2px;min-height:24px;min-width:24px;padding:0;font-size:0.7rem"
        onclick="deletePhotoById(${p.id}, ${treeId})">
        <i class="bi bi-x"></i>
      </button>
    </div>`
  ).join('');
}

window.addPhotos = async function(treeId, input) {
  const files = Array.from(input.files);
  for (const file of files) {
    const dataUrl = await PHOTO_DB.resizeImage(file);
    await PHOTO_DB.addPhoto(treeId, dataUrl);
  }
  await loadPhotos(treeId);
  showToast(`${files.length}枚の写真を追加しました`);
  input.value = '';
};

window.deletePhotoById = async function(photoId, treeId) {
  if (!confirm('この写真を削除しますか？')) return;
  await PHOTO_DB.deletePhoto(photoId);
  await loadPhotos(treeId);
};

window.viewPhoto = function(dataUrl) {
  showModal(`
    <div class="modal-body p-1">
      <img src="${dataUrl}" style="width:100%;border-radius:8px">
    </div>
    <div class="modal-footer p-2">
      <button class="btn btn-secondary" onclick="hideModal()">閉じる</button>
    </div>`);
};

// ---- Time Management ----
function renderTime() {
  const activeDay = TIME.getActiveDay();
  const activeHS = TIME.getActiveHouseSession();
  const houses = STORE.getHouses();
  const sessionsByMonth = TIME.getSessionsByMonth();
  const months = Object.keys(sessionsByMonth).sort().reverse();

  const app = document.getElementById('app');
  app.innerHTML = `
    <h5 class="mb-3"><i class="bi bi-clock-fill me-2"></i>時間管理</h5>

    <!-- Day timer -->
    <div class="card mb-3 ${activeDay ? 'border-warning timer-running' : ''}">
      <div class="card-header"><i class="bi bi-sun me-1"></i>今日の打刻</div>
      <div class="card-body text-center">
        ${activeDay ? `
          <div class="timer-display" id="day-timer">${elapsedStr(activeDay.startTs)}</div>
          <div class="text-muted small mb-2">${activeDay.startTime} 開始</div>
          <button class="btn btn-danger w-100" onclick="dayTimerStop()">
            <i class="bi bi-stop-circle me-1"></i>終了打刻
          </button>` : `
          <button class="btn btn-success w-100" onclick="dayTimerStart()">
            <i class="bi bi-play-circle me-1"></i>開始打刻
          </button>`}
      </div>
    </div>

    <!-- Active house session -->
    ${activeHS ? `
    <div class="card mb-3 border-warning timer-running">
      <div class="card-header"><i class="bi bi-stopwatch me-1"></i>作業中</div>
      <div class="card-body text-center">
        <div class="text-muted small">${(houses.find(h => h.id === activeHS.houseId) || {}).name || 'ハウス'} — ${activeHS.workType}</div>
        <div class="timer-display" id="hs-timer">${elapsedStr(activeHS.startTs)}</div>
        <button class="btn btn-danger w-100 mt-2" onclick="houseTimerStop()">
          <i class="bi bi-stop-circle me-1"></i>作業終了
        </button>
      </div>
    </div>` : ''}

    <!-- House totals -->
    <div class="card mb-3">
      <div class="card-header"><i class="bi bi-house-fill me-1"></i>ハウス別累積時間</div>
      <div class="card-body">
        ${houses.length ? houses.map(h => {
          const tot = TIME.getHouseTotalById(h.id);
          return `
            <div class="mb-2">
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold" onclick="ROUTER.go('/house/${h.id}')"
                  style="cursor:pointer;color:var(--mango-dark)">${h.name}</span>
                <span class="fw-bold">${fmtMinutes(tot.totalMinutes)}</span>
              </div>
              ${Object.entries(tot.byWorkType).map(([wt, m]) =>
                `<div class="d-flex justify-content-between text-muted small ps-2">
                  <span>${wt}</span><span>${fmtMinutes(m)}</span>
                </div>`
              ).join('')}
            </div>`;
        }).join('') : '<div class="text-muted small">ハウスがありません</div>'}
      </div>
    </div>

    <!-- Month list -->
    <div class="card mb-3">
      <div class="card-header"><i class="bi bi-calendar-month me-1"></i>月次一覧</div>
      <div class="card-body p-0">
        ${months.length ? months.map(ym => {
          const sessions = sessionsByMonth[ym];
          const totalMins = sessions.reduce((s, d) => s + (d.minutes || 0), 0);
          return `
            <div class="border-bottom p-2">
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold">${ym.replace('-','年')}月</span>
                <span class="text-muted small">${fmtMinutes(totalMins)}</span>
              </div>
              <div class="d-flex gap-2 mt-1">
                <button class="btn btn-sm btn-outline-primary"
                  onclick="exportMonth('${ym}')">
                  <i class="bi bi-file-earmark-excel me-1"></i>エクスポート
                </button>
                <button class="btn btn-sm btn-outline-danger"
                  onclick="deleteMonthSessions('${ym}')">
                  <i class="bi bi-trash3 me-1"></i>詳細削除
                </button>
              </div>
            </div>`;
        }).join('') : '<div class="p-3 text-muted">記録がありません</div>'}
      </div>
    </div>`;

  // Start tick if timers are active
  if (activeDay || activeHS) {
    startTimerTick(() => {
      const ad = TIME.getActiveDay();
      const ahs = TIME.getActiveHouseSession();
      const dayEl = document.getElementById('day-timer');
      const hsEl = document.getElementById('hs-timer');
      if (dayEl && ad) dayEl.textContent = elapsedStr(ad.startTs);
      if (hsEl && ahs) hsEl.textContent = elapsedStr(ahs.startTs);
    });
  }
}

window.dayTimerStart = function() {
  TIME.startDay();
  renderTime();
};

window.dayTimerStop = function() {
  TIME.stopDay();
  renderTime();
};

window.deleteMonthSessions = function(ym) {
  if (!confirm(`${ym.replace('-','年')}月の詳細記録を削除しますか？\n※ 累積トータルは保持されます`)) return;
  TIME.deleteSessionsForMonth(ym);
  showToast('詳細記録を削除しました', 'warning');
  renderTime();
};

window.exportMonth = function(ym) {
  const sessions = TIME.getHouseSessionsForMonth(ym);
  const houses = STORE.getHouses();
  const houseMap = Object.fromEntries(houses.map(h => [h.id, h.name]));

  const data = sessions.map(s => ({
    '日付': s.date,
    'ハウス': houseMap[s.houseId] || `ハウス${s.houseId}`,
    '作業種類': s.workType,
    '開始': s.startTime,
    '終了': s.endTime || '',
    '時間(分)': s.minutes || 0
  }));

  // Add day sessions
  const daySessions = TIME.getDaySessions().filter(s => s.date.startsWith(ym));
  const dayData = daySessions.map(s => ({
    '日付': s.date,
    'ハウス': '（全体）',
    '作業種類': '—',
    '開始': s.startTime,
    '終了': s.endTime || '',
    '時間(分)': s.minutes || 0
  }));

  const allData = [...data, ...dayData].sort((a, b) => a['日付'].localeCompare(b['日付']));

  if (!allData.length) { showToast('データがありません', 'warning'); return; }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(allData);
  XLSX.utils.book_append_sheet(wb, ws, '作業時間');
  XLSX.writeFile(wb, `作業時間_${ym}.xlsx`);
  showToast(`作業時間_${ym}.xlsx をダウンロードしました`);
};

// ---- Summary ----
function renderSummary() {
  stopTimerTick();
  const houses = STORE.getHouses();
  const houseTotals = TIME.getHouseTotals();

  // Collect all work types
  const allWorkTypes = {};
  Object.values(houseTotals).forEach(ht => {
    Object.entries(ht.byWorkType || {}).forEach(([wt, m]) => {
      allWorkTypes[wt] = (allWorkTypes[wt] || 0) + m;
    });
  });

  const maxHouseMin = Math.max(1, ...houses.map(h =>
    (houseTotals[String(h.id)] || {}).totalMinutes || 0
  ));
  const maxWtMin = Math.max(1, ...Object.values(allWorkTypes));

  const houseChartRows = houses.map(h => {
    const tot = (houseTotals[String(h.id)] || {}).totalMinutes || 0;
    const pct = Math.round(tot / maxHouseMin * 100);
    return `
      <div class="bar-chart-row">
        <div class="bar-chart-label">${h.name}</div>
        <div class="bar-chart-bar-wrap">
          <div class="bar-chart-bar" style="width:${pct}%"></div>
        </div>
        <div class="bar-chart-val">${fmtMinutes(tot)}</div>
        <button class="btn btn-sm btn-outline-danger ms-1 py-0" style="min-height:28px"
          onclick="resetHouseTotalsConfirm(${h.id}, '${h.name}')">
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>
      </div>`;
  }).join('');

  const wtChartRows = Object.entries(allWorkTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([wt, m]) => {
      const pct = Math.round(m / maxWtMin * 100);
      return `
        <div class="bar-chart-row">
          <div class="bar-chart-label">${wt}</div>
          <div class="bar-chart-bar-wrap">
            <div class="bar-chart-bar" style="width:${pct}%"></div>
          </div>
          <div class="bar-chart-val">${fmtMinutes(m)}</div>
        </div>`;
    }).join('');

  // Farm stats
  const trees = houses.flatMap(h => STORE.getTreesForHouse(h.id));
  const totalTrees = trees.length;
  const totalFruit = trees.reduce((s, t) => s + (t.fruitCount || 0), 0);
  const flowering = trees.filter(t => t.floweringDate).length;
  const avgD = avgRating(trees, 'diseaseRating');
  const avgS = avgRating(trees, 'soilRating');

  const app = document.getElementById('app');
  app.innerHTML = `
    <h5 class="mb-3"><i class="bi bi-bar-chart-fill me-2"></i>集計</h5>

    <!-- Farm stats -->
    <div class="card mb-3">
      <div class="card-header">農園全体</div>
      <div class="card-body">
        <div class="stats-bar">
          <span class="stat-chip">${houses.length}棟</span>
          <span class="stat-chip">${totalTrees}本</span>
          <span class="stat-chip"><i class="bi bi-bug-fill me-1"></i>病害平均 ${avgD}</span>
          <span class="stat-chip"><i class="bi bi-moisture me-1"></i>土壌平均 ${avgS}</span>
          <span class="stat-chip"><i class="bi bi-flower1 me-1"></i>開花 ${flowering}本</span>
          <span class="stat-chip"><i class="bi bi-circle-fill me-1"></i>実 ${totalFruit}個</span>
        </div>
      </div>
    </div>

    <!-- House time chart -->
    <div class="card mb-3">
      <div class="card-header">ハウス別累積作業時間</div>
      <div class="card-body">
        ${houseChartRows || '<div class="text-muted small">ハウスがありません</div>'}
      </div>
    </div>

    <!-- Work type chart -->
    <div class="card mb-3">
      <div class="card-header">作業種類別トータル</div>
      <div class="card-body">
        ${wtChartRows || '<div class="text-muted small">記録がありません</div>'}
      </div>
    </div>

    <!-- Annual export -->
    <div class="card mb-3">
      <div class="card-header">エクスポート</div>
      <div class="card-body">
        <button class="btn btn-outline-primary w-100" onclick="exportAnnual()">
          <i class="bi bi-file-earmark-excel me-1"></i>年間集計エクスポート
        </button>
      </div>
    </div>`;
}

window.resetHouseTotalsConfirm = function(houseId, name) {
  if (!confirm(`「${name}」の累積時間をリセットしますか？\nこの操作は取り消せません。`)) return;
  TIME.resetHouseTotals(houseId);
  showToast('リセットしました', 'warning');
  renderSummary();
};

window.exportAnnual = function() {
  const houses = STORE.getHouses();
  const totals = TIME.getHouseTotals();

  const rows = houses.map(h => {
    const tot = totals[String(h.id)] || { totalMinutes: 0, byWorkType: {} };
    const row = {
      'ハウス': h.name,
      '合計時間(分)': tot.totalMinutes,
      '合計時間': fmtMinutes(tot.totalMinutes)
    };
    Object.entries(tot.byWorkType).forEach(([wt, m]) => {
      row[wt] = m;
    });
    return row;
  });

  if (!rows.length) { showToast('データがありません', 'warning'); return; }

  const year = new Date().getFullYear();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '年間集計');
  XLSX.writeFile(wb, `年間集計_${year}.xlsx`);
  showToast(`年間集計_${year}.xlsx をダウンロードしました`);
};

// ============================================================
// ROUTER
// ============================================================
const ROUTER = (() => {
  function go(path) {
    location.hash = '#' + path;
  }

  function dispatch(hash) {
    stopTimerTick();
    const path = hash.replace(/^#/, '') || '/';
    updateNavActive(path);

    // Routes
    if (path === '/' || path === '') return renderHome();
    if (path === '/house/new') return renderHouseForm(null);
    if (path === '/time') return renderTime();
    if (path === '/summary') return renderSummary();

    let m;
    if ((m = path.match(/^\/house\/(\d+)\/edit$/))) return renderHouseForm(+m[1]);
    if ((m = path.match(/^\/house\/(\d+)\/work\/new$/))) return renderWorkLogNew(+m[1]);
    if ((m = path.match(/^\/house\/(\d+)\/work\/(\d+)$/))) return renderWorkLogDetail(+m[1], +m[2]);
    if ((m = path.match(/^\/house\/(\d+)$/))) return renderHouseDetail(+m[1]);
    if ((m = path.match(/^\/tree\/(\d+)$/))) return renderTreeDetail(+m[1]);

    // 404 fallback
    renderHome();
  }

  function updateNavActive(path) {
    document.getElementById('nav-home').classList.toggle('active', path === '/');
    document.getElementById('nav-time').classList.toggle('active', path === '/time');
    document.getElementById('nav-summary').classList.toggle('active', path === '/summary');
  }

  window.addEventListener('hashchange', () => dispatch(location.hash));

  return { go, dispatch };
})();

// ============================================================
// Boot
// ============================================================
(function init() {
  ROUTER.dispatch(location.hash || '#/');
})();
