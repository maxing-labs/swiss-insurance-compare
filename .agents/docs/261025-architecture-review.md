# Priminfo Pro 架构评审

- 日期：2026-10-25
- 基准提交：`d7f75f5`（下文行号均以此为准）
- 范围：`api/index.py`、`server.py`、`static/*`、`vercel.json`

## 现状

| 层 | 文件 | 职责 |
|---|---|---|
| 线上 API | `api/index.py` (375 行) | Vercel Python 函数；抓取 priminfo.admin.ch HTML → 正则解析 → JSON；内存 TTL 缓存 + CDN `s-maxage=3600` |
| 本地开发 | `server.py` (42 行) | `HTTPServer` 托管 `static/` 并转发 `/api/*` 到 `handle_api_request` |
| 前端 | `static/app.js` (2242 行) | 原生 JS；全局 `state`；`renderAll()` innerHTML 全量重绘；I18N 约 590 行 |
| 前端 | `static/index.html` / `style.css` | 静态结构与样式 |

数据流：表单 → `fetchAndRenderCalculation()` → `/api/calculate`（并发抓 savings / comparison / change 三页并合并）→ `state.data` → `renderAll()`

## P0：线上风险

1. **解析失败的空结果被 CDN 缓存 1 小时** — `api/index.py:338`、`366`
   - 上游改版或返回错误页时，解析得到 `plans: []` 仍以 200 返回并被缓存
   - 修复：解析得到 0 行时返回 502，且不带缓存头
2. **前端不检查 `res.ok`** — `app.js:1181`、`1134`、`1112`
   - 错误 JSON 会覆盖 `state.data`，界面停在旧画面却显示「已同步」
   - 修复：检查 `res.ok`，失败时用 Toast 提示，并保留上一次的数据
3. **XSS：上游数据直接拼进 innerHTML** — 如 `app.js:1413`、`1647`、`1985`
   - 现在是公网站点，需要加一个 `esc()` 转义函数，覆盖公司名、方案名、`insurerUrl` 和地名
4. **滑块每帧都写 localStorage 并调用 `replaceState`** — `app.js:1249-1256`
   - Safari 限制 30 秒内最多 100 次，超出被 try/catch 吞掉，URL 停在旧值
   - 修复：URL/存储写入加 debounce

## P1：逻辑不一致

5. **档案摘要与模型筛选不同步** — `app.js:1190-1204`
   - 档案匹配时忽略 `models`，摘要被当前筛选的结果覆盖，但 `profile.models` 没有更新
6. **分享链接不含 `models`** — `app.js:737-746`
7. **净保费两套算法** — `app.js:1267`（上游 `yearlyNet`）对比 `1275`（本地 `(gross - rebate) × 12`）
   - 应统一为一种
8. **模型分类靠关键词猜** — `api/index.py:247`
   - `"tel"`、`"24"` 这类子串容易误判
   - 上游 `/plans` 返回的 `optgroup` 自带官方分组，可改用它
9. **按名称文本合并数据** — `api/index.py:322-336`
   - 名称不一致时会静默得到空数据，至少应记日志
10. **未知端点返回 200 且会被缓存** — `api/index.py:354`

## P2：架构与维护

11. **前端单文件过大**：拆成原生 ES modules，不需要构建工具
    ```
    static/js/
      i18n/{zh,en,de}.js
      calc.js       # 纯函数：calcOutOfPocket / 最优档位 / 临界点
      api.js        # fetch、错误处理、取消请求
      state.js      # setState + 派生数据
      views/        # ranking / curves / matrix / history / guide / profiles
      main.js
    ```
12. **按需渲染**：拆成 `onDataChange`（全量计算）和 `onCostChange`（只重绘当前 Tab）两条路径
    - 指南 Tab 只在切换语言时渲染
13. **解析器 fixture 测试**：存几份真实 HTML，给 savings / comparison / change 各写测试，以便上游每年 9 月更新数据时能及时发现问题
14. **魔法值集中管理**：`2027`、`4.75`、默认地点 ID 散落在 `index.html:63,69`、`app.js:790,810,1262,1304`、`api/index.py:328,340`
15. **内存缓存无上限** — `api/index.py:12-35`：加上限/LRU；或者既然有 CDN 缓存，直接移除
16. **死接口**：`/api/insurers`、`/api/plans` 没有被前端调用（第 8 条修复后可能会用上）
17. **本地与线上入口重复**：`server.py` 与 `api/index.py` 的 `handler` 响应逻辑重复且不一致（本地没有 Cache-Control）；可考虑本地改用 `vercel dev`
18. **错误信息外泄**：`str(e)` 直接返回给公网客户端

## 建议顺序

1. P0 第 1–4 条
2. 第 13 条（fixture 测试），为后续重构托底
3. 第 11–12 条（模块拆分与按需渲染）
4. 其余 P1/P2
