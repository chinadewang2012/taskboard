/**
 * 部署配置 —— 决定「页面在哪」和「数据存哪」。
 *
 * STORAGE 三种模式：
 *   'local'    —— 数据在你自己电脑（需要运行 server.js）。电脑关机就用不了。
 *   'supabase' —— 数据放 Supabase 云端（免费 / 手机任意设备可用 / 关机不影响），推荐。
 *   'github'   —— 数据放你的 GitHub 仓库（备用方案）。
 *
 * 重要：本文件不再写死任何密钥。Supabase 的 URL / anon key / 看板密码
 *       都在网页「设置」里填，只保存在你本机浏览器（localStorage），不会上传。
 */
(function () {
  var LOCAL_API = 'http://localhost:3000/api';
  var host = window.location.hostname;
  var isLocalPage = host === 'localhost' || host === '127.0.0.1'
    || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  window.APP_CONFIG = {
    // ============ 存储模式 ============
    //  'local'    数据在你电脑（需跑 server.js）
    //  'supabase' 数据放 Supabase 云端（在网页「设置」里填连接，关机可用）—— 推荐
    //  'github'   数据放你的 GitHub 仓库（备用）
    STORAGE: 'supabase',

    // ---- local 模式用 ----
    API_BASE: isLocalPage ? '' : LOCAL_API,

    // ---- github 模式用（备用）----
    GITHUB_REPO: '',
    GITHUB_TOKEN: '',
    GITHUB_DATA_PATH: 'data.json',
    GITHUB_BRANCH: 'main',
    GITHUB_MAX_MB: 100,

    // ---- supabase 模式用 ----
    // 下面两项留空：运行时在网页「设置」里填（不写死在代码，避免泄露）。
    // 填的是你的 Supabase 项目地址 + anon key（sb_publishable_ 开头，允许放前端）。
    SUPABASE_URL: '',
    SUPABASE_KEY: '',
    SUPABASE_MAX_MB: 500
  };
})();
