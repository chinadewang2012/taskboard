'use strict';

// ===== 运行时连接设置（URL / anon key / 看板密码 都只存在本机浏览器，不写进代码）=====
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function openSetupModal(resolve) {
  const modal = $('#setupModal');
  modal.classList.add('show');
  const form = $('#setupForm');
  form.sbUrl.value = localStorage.getItem('sb_url') || '';
  form.sbKey.value = localStorage.getItem('sb_key') || '';
  form.pwd.value = '';  // 出于安全，不回显明文密码
  form.onsubmit = async (e) => {
    e.preventDefault();
    const url = form.sbUrl.value.trim();
    const key = form.sbKey.value.trim();
    const pwd = form.pwd.value;
    if (!url || !key || !pwd) { toast('三项都要填', 'err'); return; }
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    localStorage.setItem('board_hash', await sha256(pwd)); // 只存密码哈希，不存明文
    modal.classList.remove('show');
    resolve();
  };
}
function ensureSetup() {
  return new Promise(resolve => {
    const ok = localStorage.getItem('sb_url') && localStorage.getItem('sb_key') && localStorage.getItem('board_hash');
    if (ok) return resolve();
    openSetupModal(resolve);
  });
}

const URGENCY = {
  1: { label: '不急', color: 'var(--u1)' },
  2: { label: '较低', color: 'var(--u2)' },
  3: { label: '一般', color: 'var(--u3)' },
  4: { label: '较急', color: 'var(--u4)' },
  5: { label: '紧急', color: 'var(--u5)' }
};

const state = {
  tasks: [],
  limits: { maxTotal: 0, perUrgency: {} },
  counts: { totalPending: 0, byUrgency: {} },
  view: 'list',
  filterUrgency: 'all',
  filterStatus: 'all',
  search: '',
  editingId: null,
  dbSizeMb: 0,
  maxDbMb: 0
};

const $ = sel => document.querySelector(sel);

// 数据读写统一走 public/store.js（本机模式 / Supabase 云端模式）

async function load() {
  // GitHub 模式：首次打开时让用户在浏览器里填入 PAT（只存在本机，不进仓库）
  if (window.APP_CONFIG && window.APP_CONFIG.STORAGE === 'github') {
    const haveToken = (typeof localStorage !== 'undefined' && localStorage.github_token) || window.APP_CONFIG.GITHUB_TOKEN;
    if (!haveToken) {
      const t = prompt('请输入 GitHub Personal Access Token（仅读写你自己的仓库数据，只存在本机浏览器，不会上传）：');
      if (t && t.trim()) { try { localStorage.github_token = t.trim(); } catch (e) {} }
    }
  }
  try {
    const data = await store.list();
    state.tasks = data.tasks;
    state.limits = data.limits;
    state.counts = data.counts;
    state.dbSizeMb = data.dbSizeMb || 0;
    state.maxDbMb = data.maxDbMb || 0;
    render();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

// ---------- 工具 ----------
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function fmtDuration(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

function dueInfo(dueDate) {
  if (!dueDate) return { text: '无截止时间', cls: 'none', abs: '' };
  const due = new Date(dueDate).getTime();
  const diff = due - Date.now();
  const abs = new Date(dueDate).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (diff < 0) return { text: `已逾期 ${fmtDuration(-diff)}`, cls: 'overdue', abs };
  if (diff < 86400000) return { text: `剩余 ${fmtDuration(diff)}`, cls: 'soon', abs };
  return { text: `剩余 ${fmtDuration(diff)}`, cls: 'normal', abs };
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function sortByDue(arr) {
  return arr.slice().sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
}

function filtered() {
  let arr = state.tasks;
  if (state.filterUrgency !== 'all') arr = arr.filter(t => String(t.urgency) === String(state.filterUrgency));
  if (state.filterStatus === 'pending') arr = arr.filter(t => t.status !== 'done');
  if (state.filterStatus === 'done') arr = arr.filter(t => t.status === 'done');
  if (state.search) {
    const q = state.search.toLowerCase();
    arr = arr.filter(t => (t.title + ' ' + (t.description || '')).toLowerCase().includes(q));
  }
  return sortByDue(arr);
}

// ---------- 渲染 ----------
function render() {
  renderStats();
  renderBoard();
}

function renderStats() {
  const now = Date.now();
  let overdue = 0, soon = 0;
  state.tasks.forEach(t => {
    if (t.status === 'done' || !t.dueDate) return;
    const d = new Date(t.dueDate).getTime() - now;
    if (d < 0) overdue++;
    else if (d < 86400000) soon++;
  });
  const c = state.counts;
  const el = $('#stats');
  el.innerHTML = `
    <div class="stat"><div class="num">${c.totalPending}</div><div class="lbl">待办任务总数</div></div>
    <div class="stat alert"><div class="num">${overdue}</div><div class="lbl">已逾期</div></div>
    <div class="stat warn"><div class="num">${soon}</div><div class="lbl">24小时内到期</div></div>
    <div class="stat"><div class="num" style="color:var(--u1)">${c.byUrgency['1'] || 0}</div><div class="lbl">不急 (1)</div></div>
    <div class="stat"><div class="num" style="color:var(--u2)">${c.byUrgency['2'] || 0}</div><div class="lbl">较低 (2)</div></div>
    <div class="stat"><div class="num" style="color:var(--u3)">${c.byUrgency['3'] || 0}</div><div class="lbl">一般 (3)</div></div>
    <div class="stat"><div class="num" style="color:var(--u4)">${c.byUrgency['4'] || 0}</div><div class="lbl">较急 (4)</div></div>
    <div class="stat"><div class="num" style="color:var(--u5)">${c.byUrgency['5'] || 0}</div><div class="lbl">紧急 (5)</div></div>
    <div class="stat"><div class="num">${state.dbSizeMb}<span style="font-size:13px"> MB</span></div><div class="lbl">数据占用${state.maxDbMb ? ' / 上限 ' + state.maxDbMb + 'MB' : ''}</div></div>
  `;
}

function taskActions(t) {
  const done = t.status === 'done';
  return `<div class="actions">
    <button class="mini ok" data-act="toggle" data-id="${t.id}">${done ? '↺ 重开' : '✓ 完成'}</button>
    <button class="mini" data-act="edit" data-id="${t.id}">编辑</button>
    <button class="mini danger" data-act="del" data-id="${t.id}">删除</button>
  </div>`;
}

function renderBoard() {
  const board = $('#board');
  const list = filtered();
  $('#emptyHint').hidden = list.length !== 0;

  if (state.view === 'list') {
    if (!list.length) { board.innerHTML = ''; return; }
    board.innerHTML = `<table class="list">
      <thead><tr><th style="width:8px"></th><th>紧急</th><th>任务</th><th>截止 / 剩余</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody></table>`;
  } else {
    board.innerHTML = `<div class="board-cols">${[5,4,3,2,1].map(u => colHtml(u, list)).join('')}</div>`;
  }
}

function rowHtml(t) {
  const u = URGENCY[t.urgency];
  const di = dueInfo(t.dueDate);
  const done = t.status === 'done';
  return `<tr class="task-row ${done ? 'done' : ''}">
    <td><span class="u-bar" style="background:${u.color}"></span></td>
    <td><span class="tag" style="background:${u.color}">${u.label}</span></td>
    <td><div class="t-title">${esc(t.title)}</div>${t.description ? `<div class="t-desc">${esc(t.description)}</div>` : ''}</td>
    <td><span class="due ${di.cls}">${di.text}${di.abs ? `<span class="abs">${di.abs}</span>` : ''}</span></td>
    <td>${taskActions(t)}</td>
  </tr>`;
}

function colHtml(u, list) {
  const ur = URGENCY[u];
  const items = list.filter(t => t.urgency == u);
  const cards = items.map(t => {
    const di = dueInfo(t.dueDate);
    const done = t.status === 'done';
    return `<div class="kcard ${done ? 'done' : ''}" style="border-left-color:${ur.color}">
      <div class="t-title">${esc(t.title)}</div>
      ${t.description ? `<div class="t-desc">${esc(t.description)}</div>` : ''}
      <div class="due ${di.cls}">${di.text}${di.abs ? `<span class="abs">${di.abs}</span>` : ''}</div>
      ${taskActions(t)}
    </div>`;
  }).join('');
  return `<div class="bcol">
    <h4><span class="tag" style="background:${ur.color}">${ur.label}</span><span class="cnt">${items.length}</span></h4>
    ${cards || '<p class="empty" style="padding:10px">—</p>'}
  </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ---------- 事件 ----------
async function onBoardClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (act === 'toggle') {
    await store.update(id, { status: task.status === 'done' ? 'pending' : 'done' });
    toast('已更新状态', 'ok');
  } else if (act === 'edit') {
    openTaskModal(task);
    return;
  } else if (act === 'del') {
    if (!confirm('确定删除该任务？')) return;
    await store.remove(id);
    toast('已删除', 'ok');
  }
  await load();
}

function openTaskModal(task) {
  state.editingId = task ? task.id : null;
  $('#taskModalTitle').textContent = task ? '编辑任务' : '添加任务';
  const form = $('#taskForm');
  form.title.value = task ? task.title : '';
  form.description.value = task ? (task.description || '') : '';
  form.urgency.value = task ? String(task.urgency) : '3';
  form.dueDate.value = task ? toLocalInput(task.dueDate) : '';
  updateLimitHint();
  $('#taskModal').classList.add('show');
  form.title.focus();
}

function updateLimitHint() {
  const u = $('#urgencySelect').value;
  const cap = state.limits.perUrgency && state.limits.perUrgency[u];
  const total = state.limits.maxTotal;
  const parts = [];
  if (total) parts.push(`总数上限 ${total}（当前待办 ${state.counts.totalPending}）`);
  if (cap) parts.push(`本档上限 ${cap}（当前 ${state.counts.byUrgency[u] || 0}）`);
  $('#limitHint').textContent = parts.length ? '📌 ' + parts.join(' · ') : '';
}

async function onSubmitTask(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    title: form.title.value.trim(),
    description: form.description.value.trim(),
    urgency: Number(form.urgency.value),
    dueDate: form.dueDate.value ? new Date(form.dueDate.value).toISOString() : null
  };
  try {
    if (state.editingId) {
      await store.update(state.editingId, payload);
      toast('已保存', 'ok');
    } else {
      await store.add(payload);
      toast('已添加', 'ok');
    }
    closeModals();
    await load();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function openLimitsModal() {
  const l = state.limits;
  $('#limitsForm').maxTotal.value = l.maxTotal || 0;
  const wrap = $('#perUrgencyInputs');
  wrap.innerHTML = [1,2,3,4,5].map(u =>
    `<label>${URGENCY[u].label}
      <input type="number" min="0" data-u="${u}" value="${l.perUrgency[u] || 0}">
    </label>`).join('');
  $('#limitsModal').classList.add('show');
}

async function onSubmitLimits(e) {
  e.preventDefault();
  const perUrgency = {};
  $('#perUrgencyInputs').querySelectorAll('input').forEach(i => { perUrgency[i.dataset.u] = Number(i.value) || 0; });
  const payload = { maxTotal: Number($('#limitsForm').maxTotal.value) || 0, perUrgency };
  try {
    const d = await store.setLimits(payload);
    state.limits = d.limits || payload;
    toast('限制已保存', 'ok');
    closeModals();
    await load();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function closeModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

function fillUrgencySelect() {
  const sel = $('#urgencySelect');
  sel.innerHTML = [1,2,3,4,5].map(u => `<option value="${u}">${u} · ${URGENCY[u].label}</option>`).join('');
}

function init() {
  fillUrgencySelect();
  // 筛选下拉填充紧急度
  const fu = $('#filterUrgency');
  fu.innerHTML = '<option value="all">全部紧急度</option>' +
    [1,2,3,4,5].map(u => `<option value="${u}">${u} · ${URGENCY[u].label}</option>`).join('');

  $('#openAdd').addEventListener('click', () => openTaskModal(null));
  $('#openLimits').addEventListener('click', openLimitsModal);
  $('#taskForm').addEventListener('submit', onSubmitTask);
  $('#limitsForm').addEventListener('submit', onSubmitLimits);
  $('#urgencySelect').addEventListener('change', updateLimitHint);

  $('#board').addEventListener('click', onBoardClick);

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

  document.querySelectorAll('.seg').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.view = b.dataset.view;
    renderBoard();
  }));

  $('#filterUrgency').addEventListener('change', e => { state.filterUrgency = e.target.value; renderBoard(); });
  $('#filterStatus').addEventListener('change', e => { state.filterStatus = e.target.value; renderBoard(); });
  $('#search').addEventListener('input', e => { state.search = e.target.value.trim(); renderBoard(); });

  $('#openSetup').addEventListener('click', () => openSetupModal(() => load()));
  ensureSetup().then(() => load()).catch(err => toast(err.message, 'err'));
}

document.addEventListener('DOMContentLoaded', init);
