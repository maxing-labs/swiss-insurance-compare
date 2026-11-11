# Swiss Insurance Compare

瑞士基础医保（KVG）保费比价站：实时抓取 BAG 官方站 priminfo.admin.ch 的 HTML，解析成 JSON，再由前端计算和展示。线上同时部署在 Cloudflare Pages（https://swiss-insurance-compare.pages.dev）与 Vercel（https://swiss-insurance-compare.vercel.app）。

## 运行

- 本地：`python3 server.py` → http://127.0.0.1:8765
- 测试：`python3 -m unittest`（不联网，用 `tests/fixtures/` 里的上游快照）。上游改版或每年 9 月更新数据后，用 `python3 -m tests.make_fixtures` 重新生成快照（需联网），再按新数据修正测试
- 前端与 Pages Function 测试：`node --test 'tests/js/*.test.mjs'`（Node ≥ 22，只用内置的 `node:test`），覆盖 `static/js/calc.js`、`location-search.js`、`state.js` 以及 `functions/api/[[path]].js` 与 `api/index.py` 的快照对齐。不要为此加 `package.json`，以免 Vercel 把项目识别成 Node 项目
- 浏览器测试：`tests/e2e/`，覆盖涉及 DOM 和请求的行为（用 `page.route` 模拟接口失败、延迟或改写响应）
  - 先运行 `python3 server.py`。其余请求会经本地服务访问真实上游，需要联网
  - 运行：`PLAYWRIGHT_CORE=<playwright-core 目录> CHROMIUM=<浏览器可执行文件> node --test --test-concurrency=1 'tests/e2e/*.test.mjs'`。`server.py` 一次只处理一个请求，多个测试文件并行时页面会加载超时
  - playwright-core 不是项目依赖，不要加 `package.json`。找不到 playwright-core 时测试自动跳过；它自带的浏览器版本已安装时可以不设 `CHROMIUM`
  - 服务不在 8765 端口时，用 `BASE=http://...` 指定
- 线上部署：
  - Cloudflare Pages（主力，静态请求不限量）：`wrangler pages deploy static --project-name=swiss-insurance-compare --branch=main`（静态头见 `static/_headers`，接口见 `functions/api/[[path]].js`）
  - Vercel（镜像）：`vercel deploy --prod --yes`（路由与缓存头见 `vercel.json`，`.vercelignore` 排除 `functions/`）

## 约定

- **零依赖**：本地与 Vercel 后端只用 Python 标准库，Cloudflare Pages Function 只用 Web 标准运行时 API，前端是原生 ES 模块、没有构建步骤。引入依赖或构建工具前先征得用户同意。
- **API 逻辑双端同步**：Python 实现在 `api/index.py`（`handle_api_request`，供 `server.py` 与 Vercel 使用），Cloudflare Pages 实现在 `functions/api/[[path]].js`。修改接口或解析逻辑时必须两边同步更新，并跑通 `python3 -m unittest` 与 `tests/js/cf-functions.test.mjs`。
- **i18n**：用户可见的文本统一放进 `static/js/i18n/` 下的 `zh.js` / `en.js` / `de.js`，三种语言同时补齐。默认语言是 `en`：`state.lang` 的初始值和 `index.html` 里的占位文本都是英文。
- **样式**：色板和字体 token 在 `static/style.css` 的 `:root`；SVG 图表颜色在 `static/js/views/chart-theme.js`；字体自托管在 `static/fonts/`（latin 子集，不要改回 Google Fonts 外链）。
- **上游解析很脆弱**：解析器靠表格下标和列位置取数。改动解析逻辑后要用真实上游请求验证，`/api/calculate` 返回的 `plans` 应非空且各字段有值。
- **CDN 与浏览器缓存**：
  - `/api/*` 成功响应带 `s-maxage=3600`（Pages Function 同时写入 `caches.default`），在边缘缓存 1 小时。错误或解析为空的结果必须返回非 2xx，避免被缓存：抛 `EmptyResultError`，返回 502 且不带缓存头。例外：上游明确提示「keine Prämien」（如只勾 PHARM）属于合法的空结果，仍返回 200。
  - 静态资源在 `static/_headers` 与 `vercel.json` 同步下发浏览器缓存头：`*.woff2` 为 `1 年 immutable`，无构建 hash 的 `*.js` / `*.css` 为 `public, max-age=300, stale-while-revalidate=86400`，防止高频刷新产生大量 `304` 请求（复盘见 `.agents/docs/261111-vercel-cdn-limit.md`）。
- **URL 同步与嵌入式 WebView 防护**：`saveActiveStateToStorageAndUrl()` 必须先判断 `newUrl !== currentUrl` 再调 `history.replaceState`，且保留 `sessionStorage` 快速启动熔断器（4 秒内连续启动达 4 次则跳过首屏 `replaceState`），防止第三方客户端内嵌 `WKWebView` 陷入无限 `reload()` 循环。
- **年度数据**：`premiumYear`、`dataPublished` 写死在 `api/index.py`、`functions/api/[[path]].js` 的 `meta` 和多处前端常量里。上游每年 9 月发布新年度保费时要同步更新（位置清单见评审 #14）。

## 协作

- 可能有多个 agent 并行修改本仓库。提交前先用 `git status` / `git diff` 确认只提交自己的改动。

## 文档

- 统一放在 `.agents/docs/`，文件名格式为 `yymmdd-主题.md`。
- **session 开始**：先读日期最新的 `yymmdd-session-*.md`，接上上次的进度。
- **session 结束**：任务完成、给出最终答复之前，新增一份 `yymmdd-session-主题.md`，写清四项：目标、完成内容（附提交 hash）、关键决策及原因、遗留问题与下一步。同一个 session 里已经写过的，就更新那一份。
- 改架构或修已知问题之前，先读架构评审 `.agents/docs/261025-architecture-review.md`。问题按 P0/P1/P2 编号，行号对应文中注明的基准提交。
