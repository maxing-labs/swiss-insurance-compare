# Priminfo Pro

瑞士基础医保（KVG）保费比价站：实时抓取 BAG 官方站 priminfo.admin.ch 的 HTML，解析成 JSON，再由前端计算和展示。部署在 Vercel。

## 运行

- 本地：`python3 server.py` → http://127.0.0.1:8765
- 测试：`python3 -m unittest`（不联网，用 `tests/fixtures/` 里的上游快照）。上游改版或每年 9 月更新数据后，用 `python3 -m tests.make_fixtures` 重新生成快照（需联网），再按新数据修正测试
- 前端测试：`node --test 'tests/js/*.test.mjs'`（Node ≥ 22，只用内置的 `node:test`），覆盖 `static/js/calc.js`、`location-search.js` 的纯函数和 `state.js` 的派生数据。不要为此加 `package.json`，以免 Vercel 把项目识别成 Node 项目
- 浏览器测试：`tests/e2e/`，覆盖涉及 DOM 和请求的行为（用 `page.route` 模拟接口失败、延迟或改写响应）
  - 先运行 `python3 server.py`。其余请求会经本地服务访问真实上游，需要联网
  - 运行：`PLAYWRIGHT_CORE=<playwright-core 目录> CHROMIUM=<浏览器可执行文件> node --test --test-concurrency=1 'tests/e2e/*.test.mjs'`。`server.py` 一次只处理一个请求，多个测试文件并行时页面会加载超时
  - playwright-core 不是项目依赖，不要加 `package.json`。找不到 playwright-core 时测试自动跳过；它自带的浏览器版本已安装时可以不设 `CHROMIUM`
  - 服务不在 8765 端口时，用 `BASE=http://...` 指定
- 线上：Vercel，路由见 `vercel.json`

## 约定

- **零依赖**：后端只用 Python 标准库，前端是原生 JS、没有构建步骤。引入依赖或构建工具前先征得用户同意。
- **API 逻辑只放在 `api/index.py`**（`handle_api_request`）。`server.py` 只是本地开发的包装层。
- **i18n**：用户可见的文本统一放进 `static/js/i18n/` 下的 `zh.js` / `en.js` / `de.js`，三种语言同时补齐。
- **上游解析很脆弱**：解析器靠表格下标和列位置取数。改动解析逻辑后要用真实上游请求验证，`/api/calculate` 返回的 `plans` 应非空且各字段有值。
- **CDN 缓存**：API 成功响应带 `s-maxage=3600`，会在边缘缓存 1 小时。错误或解析为空的结果必须返回非 2xx，避免被缓存：抛 `EmptyResultError`，返回 502 且不带缓存头。例外：上游明确提示「keine Prämien」（如只勾 PHARM）属于合法的空结果，仍返回 200。
- **年度数据**：`premiumYear`、`dataPublished` 写死在 `api/index.py` 的 `meta` 和多处前端常量里。上游每年 9 月发布新年度保费时要同步更新（位置清单见评审 #14）。

## 协作

- 可能有多个 agent 并行修改本仓库。提交前先用 `git status` / `git diff` 确认只提交自己的改动。

## 文档

- 统一放在 `.agents/docs/`，文件名格式为 `yymmdd-主题.md`。
- **session 开始**：先读日期最新的 `yymmdd-session-*.md`，接上上次的进度。
- **session 结束**：任务完成、给出最终答复之前，新增一份 `yymmdd-session-主题.md`，写清四项：目标、完成内容（附提交 hash）、关键决策及原因、遗留问题与下一步。同一个 session 里已经写过的，就更新那一份。
- 改架构或修已知问题之前，先读架构评审 `.agents/docs/261025-architecture-review.md`。问题按 P0/P1/P2 编号，行号对应文中注明的基准提交。
