# 261111 线上复盘：单客户端 WKWebView 重载死循环刷爆 Vercel 100 万 CDN 请求额度

- 日期：2026-11-11
- 影响范围：`swiss-insurance-compare`（实际触发）、`swiss-tax-compare`（同构隐患同步修复）

## 1. 事件现象

收到 Vercel Hobby 计划配额告警邮件（`Exceeded your limits: Upgrade now to avoid service disruption`）。检查控制台 Usage 与 Observability 后发现各指标极度不对称：

| 指标 | 用量 / Hobby 上限 | 占比 | 说明 |
|---|---|---|---|
| **CDN Requests** | **1,008,059 / 1,000,000** | **100.8%** | 唯一超标项，`swiss-insurance-compare` 占 998,972 次（99.1%） |
| Fast Data Transfer | 1.88 GB / 100 GB | 1.9% | 几乎不耗带宽，绝大多数响应为 `304 Not Modified` |
| Function Invocations | 2.9K / 1M | 0.3% | `/api/*` 因 `s-maxage=3600` 边缘缓存命中率达 99.7% |

进一步下钻 `swiss-insurance-compare` 最近 12 小时的 **982K** 次请求：

- **单一来源 IP**：`157.143.24.x`（瑞士苏黎世家宽运营商 `iway AG` 动态地址池）独自发出了 **982K** 次请求（占 99.97%，排名第 2 的正常访客仅 81 次）。
- **单一 User-Agent**：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` —— 注意末尾不含 `Version/... Safari/...`，这是典型的 **macOS 内嵌 `WKWebView`**（常见于第三方 Reddit 客户端、RSS 阅读器、IM 链接预览窗或 SwiftUI WebView 封装）。
- **时间分布**：集中在下午至傍晚两段平坦的矩形脉冲窗口（约 15:00–16:30 与 17:45–19:45，对应宿主应用窗口打开与合盖/关闭的时间段），速率稳定在每秒约 3–5 次整页刷新。

---

## 2. 根因链路还原（1 个触发 Bug + 2 层放大器）

### 2.1 证据链：Referrer 与 ES Module 加载瀑布流

Observability 的 Referrer 与 Routes 统计完整还原了死循环现场：

- **Referrer 分布**：
  - `No Referrer`：**53K** 次（对应 5.3 万次顶层文档导航请求）
  - `https://swiss-insurance-compare.vercel.app/?loc=80011450512497&yob=1990&fran=2500&acc=0&models=BASE,FLEX,PRAXIS,TEL_DIG,PHARM&med=500&tab=ranking&lang=en`：**929K** 次（对应文档内发起的所有静态子资源与 API 请求）
  - 裸根路径 `https://swiss-insurance-compare.vercel.app/`：仅 **166** 次
- **ES Module 依赖层级瀑布流（缓存命中率均为 100%）**：
  - Tier 0（HTML 直接引用的 `/static/`、`main.js`、`style.css`）：各 **53K** 次
  - Tier 1（`main.js` 直接 `import` 的 `i18n/index.js`、`state.js`、`controller.js` 等）：**45K–48K** 次
  - Tier 2（二级 `import` 的词典、`calc.js`、`api.js`、各 `views/*.js`）：**31K–32K** 次
  - Tier 3（三级 `import` 的 `views/chart-theme.js` 及随后执行的 `/api/index`）：**26K–28K** 次

注意 **Tier 0（53K）恰好是 Tier 3（26.5K）的 2 倍**。

### 2.2 触发机制：首屏无条件调用 3 次 `history.replaceState`

修复前，`initApp()` 的启动流程如下：

1. `applyLanguage(state.lang)` → 调用 `saveActiveStateToStorageAndUrl()` → **第 1 次无条件执行 `window.history.replaceState(null, "", newUrl)`**
2. `switchTab(state.activeTab)` → 调用 `saveActiveStateToStorageAndUrl()` → **第 2 次无条件执行 `window.history.replaceState(null, "", newUrl)`**
3. `fetchAndRenderCalculation()` → 响应返回后 **第 3 次无条件执行 `window.history.replaceState(null, "", newUrl)`**

这在普通桌面/手机浏览器中没有明显副作用，但在 macOS / iOS 第三方客户端封装的 `WKWebView` 中会踩中两类经典缺陷：

1. **WebKit KVO 重载循环（本次命中）**：即使 `newUrl` 与当前 `window.location` 完全相同，调用 `history.replaceState` 在 WebKit 中仍会触发 `WKWebView.url` 的 KVO 通知；部分宿主 App 监听 `url` 变化但未比对新旧值，直接触发 `webView.reload()`。由于 `initApp()` 同步连调了 2 次 `replaceState`，每次模块树加载到底（26.5K 次）都会触发 2 轮 `reload()`（53K 次顶层请求，其中第 1 轮在加载到 Tier 1–2 时被第 2 轮打断取消）。
2. **SwiftUI `updateNSView` 裸链接回跳循环（同类高发隐患）**：当宿主绑定裸 URL（`/`），而网页首屏通过 `replaceState` 补齐默认查询参数（`/?loc=...`）时，宿主在 `updateNSView` 中判断 `webView.url != targetURL` 便重新 `load("/")`，同样会形成死循环。

### 2.3 两层请求数放大器

为什么 5.3 万次重载没有耗尽带宽或函数调用，唯独打穿了 100 万次 CDN 请求上限？

1. **无打包原生 ES Modules（×18.5 倍）**：项目遵循零构建约定，首屏按模块树加载 1 个 HTML + 1 个 CSS + 2 个 `.woff2` 字体 + 17 个 `.js` 模块（部分在半途被下一轮刷新中断，平均每次刷新发出 18.5 个请求）。
2. **默认 `max-age=0, must-revalidate` 缓存头**：`vercel.json` 原先只配了 `rewrites` 未配 `headers`，Vercel 对静态文件默认下发 `cache-control: public, max-age=0, must-revalidate`。浏览器每次刷新都必须向边缘节点发送 `If-None-Match` 条件请求——虽然返回 `304 Not Modified` 几乎不占流量，但 **每一次 `304` 在 Vercel 计费模型里都算作 1 次完整的 CDN Request**。

---

## 3. 修复措施

已在 `swiss-insurance-compare` 与姊妹站 `swiss-tax-compare` 同步落地三道防线：

1. **`replaceState` 幂等守卫 + 合并首屏持久化**（`static/js/state.js`、`controller.js`、`main.js`）：
   - `saveActiveStateToStorageAndUrl()` 先比对 `newUrl !== window.location.pathname + window.location.search`，URL 未变化时绝不调用 `history.replaceState`。
   - 首屏 `initApp()` 调用 `applyLanguage` 与 `switchTab` 时传入 `{ persist: false }`，避免启动阶段重复写存储和改历史记录。
2. **基于 `sessionStorage` 的快速重载熔断器**（`static/js/state.js`）：
   - 记录当前标签页在 `4000 ms` 滑动窗口内的启动时间戳；若连续启动达到 **4 次**，判定宿主 WebView 处于异常重载循环，自动抑制首屏（`{ startup: true }`）的 `replaceState` 改写，从根源切断裸链接回跳死循环（上限封死在前 3 次刷新以内）。
   - 用户主动点击筛选控件触发的 `saveActiveStateToStorageAndUrl()` 不受影响，仍正常更新地址栏供复制分享。
3. **静态资源分层浏览器缓存头**（`vercel.json` 与 `static/_headers`）：
   - 自托管字体（`*.woff2`）：`public, max-age=31536000, immutable`（1 年强缓存，永不重复校验）。
   - 样式与原生 ES 模块脚本（`*.css`、`*.js`）：`public, max-age=300, stale-while-revalidate=86400`（5 分钟浏览器本地强缓存 + 后台静默更新：既无需引入打包器文件名 hash、保证发版 5 分钟内全网生效，又能把短时间连续刷新的静态资源网络请求直接降为 **0**）。
4. **Cloudflare Pages 纯 Serverless 双活部署**（`functions/api/[[path]].js` + `static/_headers`）：
   - 新增 Cloudflare Pages 部署（`*.pages.dev`），静态资源请求免费且无次数上限，彻底消除单客户端刷屏或社区引流高峰耗尽 CDN 配额的风险；同时保留 Vercel 与本地 `server.py` 兼容。

---

## 4. 经验小结

- **零构建原生 ES Modules 上线公网时，必须显式配置浏览器 `max-age`**：否则 1 次访问 = 20+ 次条件请求，极易放大异常客户端或爬虫对按请求数计费 CDN（如 Vercel Hobby 1M 上限）的冲击。
- **首屏自动同步 URL 参数需谨慎对待嵌入式 WebView**：务必保证 `history.replaceState` 幂等（URL 不变不调），并为不可控的第三方 `WKWebView` 宿主预留快速重载熔断保护。
