# 261111 session：排查并修复 WKWebView 重载死循环刷爆 Vercel CDN 请求额度

## 目标

1. 排查 Vercel Hobby 账户 `CDN Requests` 达到 `1,008,059 / 1,000,000` 告警的根本原因
2. 修复首屏 `history.replaceState` 引发的第三方嵌入式 `WKWebView` 无限重载循环，以及静态 ES 模块缺失浏览器缓存头导致的请求数放大问题
3. 将完整线上复盘归档至 `.agents/docs/261111-vercel-cdn-limit.md`，并同步修复姊妹站 `../swiss-tax-compare`

## 完成内容

- `1b26fea`：
  - `static/js/state.js`、`controller.js`、`main.js`：
    - `saveActiveStateToStorageAndUrl()` 增加幂等判断（`newUrl !== currentUrl` 时才调用 `history.replaceState`），消除 URL 未变化时的冗余历史改写
    - 合并 `initApp()` 首屏阶段 `applyLanguage` 与 `switchTab` 的重复持久化调用
    - 新增基于 `sessionStorage` 的 4 秒滑动窗口重载熔断器（4 秒内连续启动达 4 次时自动跳过首屏 `replaceState` 改写，用户显式交互不受影响）
  - `vercel.json`：为 `*.woff2` 配置 `public, max-age=31536000, immutable`；为 `*.css` / `*.js` 配置 `public, max-age=300, stale-while-revalidate=86400`
  - `tests/js/state.test.mjs`：新增幂等 `replaceState` 与快速重载熔断单测
  - `.agents/docs/261111-vercel-cdn-limit.md`：记录完整的事件数据、ES Module 瀑布流证据链与修复机制
- 验证：`python3 -m unittest` 23 项通过，`node --test 'tests/js/*.test.mjs'` 34 项通过，Playwright e2e（`share-link` + `franchises-failure`）9 项通过

## 关键决策及原因

- **保留正常首屏 URL 参数补齐，通过「幂等守卫 + 4 次快速重载熔断」防死循环**：本站无独立分享按钮，用户直接复制浏览器地址栏分享配置（`tests/e2e/share-link.test.mjs` 验证此契约）；幂等守卫解决了重载相同 URL 时的 KVO 死循环，4 次熔断器兜底了裸 URL 回跳类 `WKWebView` 缺陷，不影响正常浏览器使用
- **无打包 `.js` / `.css` 采用 5 分钟 `max-age=300` 而非长效强缓存**：项目无构建文件名 hash，5 分钟短强缓存在杜绝高频刷新 `304` 风暴的同时，保证代码更新在 5 分钟内全网生效且无新旧模块混用风险
- **暂未自动执行生产部署与远程推送**：待用户确认继续留在 Vercel 还是迁移至 Cloudflare Pages / Workers 后再执行部署与 `git push`

## 遗留问题与下一步

- 用户确认后执行 `vercel deploy --prod --yes` 与 `git push`，使防刷补丁与静态缓存头在线上生效
- 如需彻底摆脱 Vercel Hobby 滚动 30 天 100 万次请求上限（尤其在社区推广引流前），可将前端静态资源与 `/api/*` 代理平滑迁移至 Cloudflare Pages / Workers
