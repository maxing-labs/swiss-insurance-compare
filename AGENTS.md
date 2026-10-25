# Priminfo Pro

瑞士基础医保（KVG）保费比价站：实时抓取 BAG 官方站 priminfo.admin.ch 的 HTML，解析成 JSON，再由前端计算和展示。部署在 Vercel。

## 运行

- 本地：`python3 server.py` → http://127.0.0.1:8765
- 线上：Vercel，路由见 `vercel.json`

## 约定

- **零依赖**：后端只用 Python 标准库，前端是原生 JS、没有构建步骤。引入依赖或构建工具前先征得用户同意。
- **API 逻辑只放在 `api/index.py`**（`handle_api_request`）。`server.py` 只是本地开发的包装层。
- **i18n**：用户可见的文本统一放进 `static/app.js` 的 `I18N`，zh / en / de 三种语言同时补齐。
- **上游解析很脆弱**：解析器靠表格下标和列位置取数。改动解析逻辑后要用真实上游请求验证，`/api/calculate` 返回的 `plans` 应非空且各字段有值。
- **CDN 缓存**：API 成功响应带 `s-maxage=3600`，会在边缘缓存 1 小时。错误或空结果必须返回非 2xx 状态，避免被缓存（当前代码还没做到，见评审 P0 #1）。
- **年度数据**：`premiumYear`、`dataPublished` 写死在 `api/index.py` 的 `meta` 和多处前端常量里。上游每年 9 月发布新年度保费时要同步更新（位置清单见评审 #14）。

## 协作

- 可能有多个 agent 并行修改本仓库。提交前先用 `git status` / `git diff` 确认只提交自己的改动。

## 文档

- 统一放在 `.agents/docs/`，文件名格式为 `yymmdd-主题.md`。
- 改架构或修已知问题之前，先读架构评审 `.agents/docs/261025-architecture-review.md`。问题按 P0/P1/P2 编号，行号对应文中注明的基准提交。
