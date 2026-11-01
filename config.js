/**
 * 部署配置 —— 决定「页面在哪」和「数据存哪」。
 *
 * STORAGE 三种模式：
 *   'local'    —— 数据在你自己电脑（需要运行 server.js）。电脑关机就用不了。
 *   'supabase' —— 数据放 Supabase 云端（500MB 免费，国内网络可能连不上）。
 *   'github'   —— 数据放你的 GitHub 仓库（免费 / 国内可访问 / 关机不影响），推荐。
 */
(function () {
  var LOCAL_API = 'http://localhost:3000/api';
  var host = window.location.hostname;
  var isLocalPage = host === 'localhost' || host === '127.0.0.1'
    || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  window.APP_CONFIG = {
    // ============ 存储模式 ============
    //  'local'    数据在你电脑（需跑 server.js）
    //  'github'   数据放你的 GitHub 仓库（免费 / 国内可访问 / 关机不影响）—— 备选
    //  'supabase' 数据放 Supabase 云端（已填好 anon key，数据在云端、关机可用）
    STORAGE: 'github',

    // ---- local 模式用 ----
    // 留空 = 本机页面走同源 /api；外网页面（如 GitHub Pages）自动指向本机 localhost:3000
    API_BASE: isLocalPage ? '' : LOCAL_API,

    // ---- github 模式用（推荐，免费云端）----
    //  GITHUB_REPO:  "用户名/仓库名"，例 'zhangsan/taskboard'
    //  GITHUB_TOKEN: 有 contents 写权限的 token（GitHub → Settings → Developer settings → PAT）
    //  调试好 GitHub 后，把上方 STORAGE 改成 'github' 即可
    GITHUB_REPO: 'chinadewang2012/taskboard',
    GITHUB_TOKEN: '',  // 留空：打开页面时浏览器会提示你输入（只存在你本机浏览器，不进仓库）
    GITHUB_DATA_PATH: 'data.json',
    GITHUB_BRANCH: 'main',
    GITHUB_MAX_MB: 100,   // 仅用于页面显示「数据占用 / 上限」

    // ---- supabase 模式用（已填好，能连通用时把 STORAGE 改成 'supabase'）----
    SUPABASE_URL: 'https://cuzeodtrzyiekuzbhnfw.supabase.co',
    SUPABASE_KEY: 'sb_publishable_I1yX06B_DKKGxQ9Jz-65PA_7fUx6zVv',
    SUPABASE_MAX_MB: 500
  };
})();
