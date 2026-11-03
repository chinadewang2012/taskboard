/**
 * 统一数据层 —— 前端只跟 store 打交道，不用关心数据存在哪。
 *
 * 三种存储模式（由 public/config.js 的 STORAGE 决定）：
 *   local    —— 数据在你自己的电脑（需要运行 server.js）
 *   supabase —— 数据放 Supabase 免费云端数据库（手机/任意设备可用，电脑关机也不影响）
 *   github   —— 数据放 GitHub 仓库（备用方案）
 */
(function () {
  const CFG = window.APP_CONFIG || {};
  const MODE = (CFG.STORAGE === 'github') ? 'github'
    : (CFG.STORAGE === 'supabase') ? 'supabase' : 'local';

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function computeCounts(tasks) {
    const pending = tasks.filter(t => t.status !== 'done');
    const byUrgency = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    pending.forEach(t => { if (byUrgency[t.urgency] !== undefined) byUrgency[t.urgency]++; });
    return { totalPending: pending.length, byUrgency };
  }

  async function request(method, path, body, extraHeaders) {
    const opts = { method, headers: Object.assign({}, extraHeaders || {}) };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error(MODE === 'supabase'
        ? '无法连接云端数据库：请检查网络，以及 config.js 里的 SUPABASE_URL / SUPABASE_KEY'
        : '无法连接数据服务：请确认已在你电脑上启动 server.js（http://localhost:3000）');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = (data.error || data.message || '请求失败');
      if (MODE === 'supabase' && res.status === 404) {
        msg = '数据表不存在：请确认已在 Supabase 执行 supabase.sql 建表，并在 SQL Editor 运行 NOTIFY pgrst, \'reload schema\'; 刷新缓存';
      }
      throw new Error(msg + ' (HTTP ' + res.status + ')');
    }
    return data;
  }

  // ================= 模式一：本机 / 自建服务 =================
  const localAdapter = {
    async list() {
      const d = await request('GET', (CFG.API_BASE || '/api') + '/tasks');
      const tasks = d.tasks || [];
      return {
        tasks, limits: d.limits, counts: computeCounts(tasks),
        dbSizeMb: d.dbSizeMb || 0, maxDbMb: d.maxDbMb || 0
      };
    },
    async add(t) { return request('POST', (CFG.API_BASE || '/api') + '/tasks', t); },
    async update(id, patch) { return request('PUT', (CFG.API_BASE || '/api') + '/tasks/' + id, patch); },
    async remove(id) { return request('DELETE', (CFG.API_BASE || '/api') + '/tasks/' + id); },
    async setLimits(l) { return request('PUT', (CFG.API_BASE || '/api') + '/limits', l); }
  };

  // ================= 模式二：Supabase 云端（免费） =================
  // 运行时从 localStorage 读取（网页「设置」里填的），不写死在代码里
  function sbCfg(k) {
    try { return (typeof localStorage !== 'undefined' && localStorage[k]) || CFG['SUPABASE_' + k.toUpperCase()]; }
    catch (e) { return CFG['SUPABASE_' + k.toUpperCase()]; }
  }
  function boardHash() {
    return (typeof localStorage !== 'undefined' && localStorage.board_hash) || '';
  }
  function sbUrl(p) {
    const raw = String(sbCfg('url') || '').trim();
    let origin;
    try { origin = new URL(raw).origin; } catch (e) { origin = raw.replace(/\/+$/, ''); }
    return origin.replace(/\/+$/, '') + '/rest/v1/' + p;
  }
  function sbHeaders(extra) {
    const key = sbCfg('key') || '';
    const h = boardHash();
    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    };
    if (h) headers['x-board'] = h; // 仅在有看板密码时带，避免发送 undefined header
    return Object.assign(headers, extra || {});
  }

  // 数据库列名用 snake_case，前端用驼峰，这里做映射
  const fromRow = r => ({
    id: r.id, title: r.title, description: r.description || '',
    urgency: r.urgency, dueDate: r.due_date || null,
    status: r.status, createdAt: r.created_at, completedAt: r.completed_at || null
  });
  const toRow = t => ({
    id: t.id, title: t.title, description: t.description || '',
    urgency: t.urgency, due_date: t.dueDate || null,
    status: t.status || 'pending',
    created_at: t.createdAt || new Date().toISOString(),
    completed_at: t.completedAt || null,
    board: boardHash()
  });
  function toRowPatch(p) {
    const o = {};
    if (p.title !== undefined) o.title = p.title;
    if (p.description !== undefined) o.description = p.description;
    if (p.urgency !== undefined) o.urgency = p.urgency;
    if (p.dueDate !== undefined) o.due_date = p.dueDate || null;
    if (p.status !== undefined) {
      o.status = p.status;
      o.completed_at = p.status === 'done' ? new Date().toISOString() : null;
    }
    return o;
  }

  const supabaseAdapter = {
    async list() {
      const h = boardHash();
      const [rows, settings] = await Promise.all([
        request('GET', sbUrl('tasks?select=*&board=eq.' + encodeURIComponent(h))),
        request('GET', sbUrl('settings?select=*&id=eq.1&board=eq.' + encodeURIComponent(h)))
      ]);
      const list = (rows || []).map(fromRow);
      const s = (settings && settings[0]) || {};
      const limits = { maxTotal: s.max_total || 0, perUrgency: s.per_urgency || {} };
      const sizeMb = +(new Blob([JSON.stringify(list)]).size / 1048576).toFixed(2);
      return {
        tasks: list, limits, counts: computeCounts(list),
        dbSizeMb: sizeMb, maxDbMb: CFG.SUPABASE_MAX_MB || 0
      };
    },
    async add(t) {
      const task = Object.assign({ id: genId(), status: 'pending', createdAt: new Date().toISOString() }, t);
      const rows = await request('POST', sbUrl('tasks'), toRow(task), { Prefer: 'return=representation' });
      return { task: (rows && rows[0]) ? fromRow(rows[0]) : task };
    },
    async update(id, patch) {
      const h = boardHash();
      const rows = await request('PATCH', sbUrl('tasks?id=eq.' + encodeURIComponent(id) + '&board=eq.' + encodeURIComponent(h)), toRowPatch(patch), { Prefer: 'return=representation' });
      return { task: (rows && rows[0]) ? fromRow(rows[0]) : Object.assign({ id: id }, patch) };
    },
    async remove(id) {
      const h = boardHash();
      await request('DELETE', sbUrl('tasks?id=eq.' + encodeURIComponent(id) + '&board=eq.' + encodeURIComponent(h)));
      return { ok: true };
    },
    async setLimits(l) {
      const h = boardHash();
      const existing = await request('GET', sbUrl('settings?select=*&id=eq.1&board=eq.' + encodeURIComponent(h)));
      if (existing && existing.length) {
        await request('PATCH', sbUrl('settings?id=eq.1&board=eq.' + encodeURIComponent(h)),
          { max_total: l.maxTotal, per_urgency: l.perUrgency }, { Prefer: 'return=representation' });
      } else {
        await request('POST', sbUrl('settings'),
          { id: 1, board: h, max_total: l.maxTotal, per_urgency: l.perUrgency });
      }
      return { limits: l };
    }
  };

  // ================= 模式三：GitHub 仓库（免费云端，国内可访问） =================
  // 把整个看板数据存成仓库里的一个 JSON 文件（默认 data.json）。
  // 走 api.github.com（实测国内可访问），你电脑关机不影响，手机 / 任意设备都能读。
  // 注意：前端会包含 GITHUB_TOKEN（等同于把该仓库写权限公开），仅适合个人自用。
  function ghContentPath() {
    const repo = CFG.GITHUB_REPO || '';
    const file = encodeURIComponent(CFG.GITHUB_DATA_PATH || 'data.json');
    const branch = CFG.GITHUB_BRANCH || 'main';
    return `https://api.github.com/repos/${repo}/contents/${file}?ref=${branch}`;
  }
  function ghHeaders(extra) {
    return Object.assign({
      Authorization: `Bearer ${((typeof localStorage !== 'undefined' && localStorage.github_token) || CFG.GITHUB_TOKEN)}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'taskboard'
    }, extra || {});
  }
  // base64 编解码需兼容中文（atob/btoa 只认 Latin1，故经 TextEncoder/Decoder 中转）
  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  const GH_DEFAULT_LIMITS = { maxTotal: 200, perUrgency: { 1: 30, 2: 30, 3: 40, 4: 40, 5: 60 } };

  const githubAdapter = {
    _sha: null,
    async readAll() {
      let data;
      try {
        data = await request('GET', ghContentPath(), undefined, ghHeaders());
      } catch (e) {
        if (/HTTP 404/.test(e.message)) { this._sha = null; return { tasks: [], limits: GH_DEFAULT_LIMITS }; }
        throw new Error('读取 GitHub 仓库失败：' + e.message + '\n请检查 config.js 的 GITHUB_REPO / GITHUB_TOKEN / GITHUB_BRANCH');
      }
      this._sha = data.sha;
      let all;
      try { all = JSON.parse(b64ToUtf8(data.content)); }
      catch (e) { throw new Error('仓库里的 data.json 解析失败（不是合法 JSON）：' + e.message); }
      all.tasks = Array.isArray(all.tasks) ? all.tasks : [];
      all.limits = all.limits || GH_DEFAULT_LIMITS;
      cache.tasks = all.tasks; cache.limits = all.limits;  // 同步缓存，供限制校验使用
      return all;
    },
    async writeAll(obj, depth = 0) {
      if (depth > 3) throw new Error('写入 GitHub 仓库冲突过多，请稍后重试');
      const body = {
        message: 'taskboard sync',
        content: utf8ToB64(JSON.stringify(obj, null, 2)),
        branch: CFG.GITHUB_BRANCH || 'main'
      };
      if (this._sha) body.sha = this._sha;
      try {
        const r = await request('PUT', ghContentPath().split('?')[0], body, ghHeaders());
        this._sha = r.content && r.content.sha;
      } catch (e) {
        if (/HTTP 409/.test(e.message)) {   // 版本冲突：重新拉取再写一次（最多 3 次）
          this._sha = null;
          await this.readAll();
          return this.writeAll(obj, depth + 1);
        }
        throw new Error('写入 GitHub 仓库失败：' + e.message);
      }
    },
    async list() {
      const all = await this.readAll();
      const tasks = all.tasks;
      const sizeMb = +(new Blob([JSON.stringify(tasks)]).size / 1048576).toFixed(2);
      return { tasks, limits: all.limits, counts: computeCounts(tasks), dbSizeMb: sizeMb, maxDbMb: CFG.GITHUB_MAX_MB || 100 };
    },
    async add(t) {
      const all = await this.readAll();
      if ((t.status || 'pending') !== 'done') {
        const v = violationFor(all.tasks, all.limits, t.urgency, null);
        if (v) throw new Error(v);
      }
      const task = Object.assign({ id: genId(), status: 'pending', createdAt: new Date().toISOString() }, t);
      all.tasks.push(task);
      await this.writeAll(all);
      return { task };
    },
    async update(id, patch) {
      const all = await this.readAll();
      const task = all.tasks.find(t => t.id === id);
      if (!task) throw new Error('任务不存在');
      const merged = Object.assign({}, task, patch);
      if (merged.status !== 'done') {
        const v = violationFor(all.tasks, all.limits, merged.urgency, id);
        if (v) throw new Error(v);
      }
      Object.assign(task, patch);
      await this.writeAll(all);
      return { task };
    },
    async remove(id) {
      const all = await this.readAll();
      all.tasks = all.tasks.filter(t => t.id !== id);
      await this.writeAll(all);
      return { ok: true };
    },
    async setLimits(l) {
      const all = await this.readAll();
      all.limits = l;
      await this.writeAll(all);
      return { limits: l };
    }
  };

  const adapter = MODE === 'github' ? githubAdapter
    : MODE === 'supabase' ? supabaseAdapter : localAdapter;

  // 缓存最近一次数据：云端模式下用它做数量限制的本地校验
  let cache = { tasks: [], limits: { maxTotal: 0, perUrgency: {} } };

  // 基于给定数据集判断新增 / 变更后的紧急度是否突破限制
  function violationFor(tasks, limits, urgency, excludeId) {
    const pending = tasks.filter(t => t.status !== 'done' && t.id !== excludeId);
    if (limits.maxTotal && pending.length + 1 > limits.maxTotal) {
      return `任务总数已达上限（${limits.maxTotal}），无法继续添加`;
    }
    const cap = limits.perUrgency && limits.perUrgency[String(urgency)];
    if (cap) {
      const same = pending.filter(t => String(t.urgency) === String(urgency)).length + 1;
      if (same > cap) return `紧急程度 ${urgency} 的任务已达上限（${cap}），无法继续添加`;
    }
    return null;
  }
  // 前端缓存版（页面加载后 cache 已是最新，用于快速校验）
  function violation(urgency, excludeId) {
    return violationFor(cache.tasks, cache.limits, urgency, excludeId);
  }

  window.store = {
    mode: MODE,
    async list() {
      const d = await adapter.list();
      cache.tasks = d.tasks;
      cache.limits = d.limits || cache.limits;
      return d;
    },
    async add(t) {
      if ((t.status || 'pending') !== 'done') {
        const v = violation(t.urgency, null);
        if (v) throw new Error(v);
      }
      return adapter.add(t);
    },
    async update(id, patch) {
      const existing = cache.tasks.find(t => t.id === id) || {};
      const merged = Object.assign({}, existing, patch);
      if (merged.status !== 'done') {
        const v = violation(merged.urgency, id);
        if (v) throw new Error(v);
      }
      return adapter.update(id, patch);
    },
    async remove(id) { return adapter.remove(id); },
    async setLimits(l) { return adapter.setLimits(l); }
  };
})();
