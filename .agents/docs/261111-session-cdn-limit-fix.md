# 261111 session：修复 WKWebView 重载死循环并上线 Cloudflare Pages 纯 Serverless 双活部署

## 目标

1. 排查 Vercel Hobby 账户 `CDN Requests` 达到 `1,008,059 / 1,000,000` 告警的根本原因
2. 修复首屏 `history.replaceState` 引发的第三方嵌入式 `WKWebView` 无限重载循环，以及静态 ES 模块缺失浏览器缓存头导致的请求数放大问题
3. 将完整线上复盘归档至 `.agents/docs/261111-vercel-cdn-limit.md`，并部署修复补丁至 Vercel
4. 新增 **Cloudflare Pages** 纯 Serverless 部署（`https://swiss-insurance-compare.pages.dev`），利用免费不限量的静态资源 CDN 彻底规避按请求数计费风险，同时将防坑规范写入 `AGENTS.md`

## 完成内容

- `1b26fea`：
  - `static/js/state.js`、`controller.js`、`main.js`：
    - `saveActiveStateToStorageAndUrl()` 增加幂等判断（`newUrl !== currentUrl` 时才调用 `history.replaceState`），消除 URL 未变化时的冗余历史改写
    - 合并 `initApp()` 首屏阶段 `applyLanguage` 与 `switchTab` 的重复持久化调用
    - 新增基于 `sessionStorage` 的 4 秒滑动窗口重载熔断器（4 秒内连续启动达 4 次时自动跳过首屏 `replaceState` 改写，用户显式交互不受影响）
  - `vercel.json`：为 `*.woff2` 配置 `public, max-age=31536000, immutable`；为 `*.css` / `*.js` 配置 `public, max-age=300, stale-while-revalidate=86400`
  - `tests/js/state.test.mjs`：新增幂等 `replaceState` 与快速重载熔断单测
  - `.agents/docs/261111-vercel-cdn-limit.md`：记录完整的事件数据、ES Module 瀑布流证据链与修复机制
- `c2eef8c`：
  - `functions/api/[[path]].js`：将 `api/index.py` 的全部上游抓取、HTML 表格解析、模型分类、边缘缓存（`caches.default` + `s-maxage=3600`）与 `404` / `502` / `500` 错误不缓存约定 1:1 移植为无依赖 Cloudflare Pages Function
  - `static/_headers`：同步配置与 `vercel.json` 一致的分层静态资源缓存头
  - `tests/js/cf-functions.test.mjs`：基于 `tests/fixtures/` 上游快照验证 Pages Function 与 Python 后端行为完全对齐
  - `.gitignore` / `.vercelignore` / `AGENTS.md` / `README.md` / `README-zh.md`：补充 Cloudflare Pages 部署说明与防坑约定
- 生产验证：
  - 本地：`python3 -m unittest` 23 项通过，`node --test 'tests/js/*.test.mjs'` 36 项通过
  - 线上：Vercel（`https://swiss-insurance-compare.vercel.app`）与 Cloudflare Pages（`https://swiss-insurance-compare.pages.dev`）均已上线，验证静态缓存头、`/api/calculate`（128 个方案）及线上 Playwright e2e（`share-link.test.mjs` 4 项）全部通过

## 关键决策及原因

- **用户选：使用 Cloudflare Pages 的免费 `.pages.dev` 域名而非私有主域名子域**：既获得免费无限静态 CDN 请求配额，又将公开开源项目与私人自用域名完全隔离，避免在开源代码或证书透明度（CT）日志中关联个人域名
- **保留零构建与零 `package.json` 双端兼容结构**：`functions/api/[[path]].js` 仅使用 Web 标准 API，并通过 `.vercelignore` 排除 `functions/`，使同一份仓库可零改动同时部署到 Cloudflare Pages、Vercel 以及本地 `python3 server.py`
- **保留正常首屏 URL 参数补齐，通过「幂等守卫 + 4 次快速重载熔断」防死循环**：兼顾地址栏直接复制分享与第三方嵌入式 `WKWebView` 兼容性

## 遗留问题与下一步

- 后续每年 9 月更新保费年度常量或调整上游 HTML 解析器时，需同步修改 `api/index.py` 与 `functions/api/[[path]].js`，并跑通 `tests/js/cf-functions.test.mjs`
