# Session：Editorial Bold 主题、易懂文案、About 弹窗

- 日期：2026-10-25
- 接上一份 `261025-session-frontend-consistency.md`
- 任务书：`/Users/xwei/projs/dev-playground/priminfo-themes/PROMPT-apply-theme-e.md`（规格 `theme-e-editorial-bold.css`、参考截图同目录）

## 目标

1. 按任务书把视觉切换为「Editorial Bold」主题（正式集成到 `style.css`，不是叠加覆盖层）
2. 把对不懂医保条款的人不知所云的按钮 / Tab 文案改成易懂的词（三种语言同步）
3. 增加「关于」弹窗：数据来自官方、无广告、仅供参考
4. 复核「盈亏曲线」里临界点约在 CHF 1'900、左侧 F2500 右侧 F300 的计算

## 完成内容

| 条目 | 提交 | 改动 |
|---|---|---|
| 1 | `0e77ab6` | `style.css` 全量重写 token 与组件规则；`static/fonts/` 自托管 Fraunces + IBM Plex Sans；SVG 颜色抽到 `views/chart-theme.js`；`guide.js` 的内联徽章色改为 `.cat-RULE` |
| 2 | `38ae44f` | `i18n/{zh,en,de}.js`、`index.html` 文案；`curves.js` 的卡片标题改用新 key `franchiseTag`；3 个 e2e 的期望字符串 |
| 3 | `8eb7901` | 头部「关于」按钮 + 原生 `<dialog>`（`index.html`、`main.js`）；`applyLanguage` 新增 `data-i18n-aria`；About 文案 zh/en/de |
| 文档 | 本次 | 本文件；AGENTS.md 补一行字体 / 色板位置 |
| 色板 | `047ed97` | `FRANCHISE_COLORS` 的 F400 / F1000 和 `HISTORY_LINE_COLORS` 第 4 色 `#d97706` → `#b45309`（暖白底上 3.0:1 → 4.6:1） |
| 小修 | `634f095` | About 弹窗居中（全局 `* { margin: 0 }` 盖掉了 UA 的 `dialog { margin: auto }`，之前贴在左上角）；出生年标签去掉「(1900–2027)」；Tab 05 新手指南 → 就医模式指南 / Model Guide |
| 临界点 | `5c1a832` | 指南卡片改为「低于约 CHF 1'800–2'000 选 2500，高于选 300，准确值看曲线页」；快捷选项和预设按钮从 1'800 改为 1'900（key 改名 `medOptBreakEven` / `presetBreakEven`） |

任务书写的是 `static/app.js`，但仓库早已拆成 `static/js/`，所以颜色常量改在 `views/curves.js`、`views/history.js`、`views/guide.js`。

### 文案对照（zh / en / de）

| 位置 | 原 | 新 |
|---|---|---|
| 状态胶囊 | 已同步 / Synced / Synchron | 数据已加载 / Data loaded / Daten geladen（加载中、加载失败同理） |
| Tab 02 | 盈亏曲线 / Cost Curves / Kostenkurven | 自付额怎么选 / Which Franchise? / Welche Franchise? |
| Tab 03 | 全档矩阵 / Matrix / Matrix | 自付额对照表 / Franchise Table / Franchise-Tabelle |
| Tab 05 | 模型指南 / Model Guide / Ratgeber | 就医模式指南 / Model Guide / Ratgeber（先改为新手指南，用户要求再改） |
| 表单标签 | 模型筛选 | 就医模式（en/de 不变） |
| 排行列 + 按钮 | 精算曲线 · 看曲线 / Curve | 自付额分析 · 分析 / Franchise Check · Check |
| 曲线页 | 精算结论 / Actuarial Verdict | 建议 / Recommendation |
| 中文各处 | Franchise、F300 | 自付额、自付额 300（图例仍用 F300 省空间） |
| KPI | 年省空间 (对比最贵)、5年均涨最低 (公司基准) | 每年最多可省 (对比最贵方案)、5年涨幅最低的公司 |

### 验收（任务书 5 条）

截图在 `/tmp/priminfo-theme/shots/`（未入库）：`{desktop,mobile}-{zh,en,de}-{ranking,curves,matrix,history,guide}.png` 30 张 + `{desktop,mobile}-zh-about.png`。生成脚本 `/tmp/priminfo-theme/shots.mjs`，检查结果 `report.json`。

1. 1280×900 / 390×844 × 5 Tab × 3 语言各一张，与参考截图对比：布局、字体、色板一致。两处有意偏差见「关键决策」
2. 390 宽：页面无横向滚动；三个数字 KPI 单行；第三个 KPI（公司名）按参考图允许换行。Tab 栏 5 个 Tab 在三种语言下都放不进 369px（参考图的 4 字 Tab 名也放不下），保留横向滚动，新增右侧渐隐提示还有更多 Tab
3. axe-core（wcag2a + wcag2aa）：桌面 / 手机 × 5 Tab + About 弹窗，零 violation
4. 控制台无报错；字体文件 200 且 `document.fonts.check` 为真；`server.py` 未改动（8765 端口上一直跑着的就是它）
5. `grep` 旧色值（`#f0fdf4` `#dcfce7` `#1d4ed8` `#047857` `#e5e7eb` `#6b7280` `#111827` `#d90429` `#fcfcfd` `#fff0f3` `#b45309` `#d97706`）：`style.css` 为零；`#d97706` 只剩 `FRANCHISE_COLORS` / `HISTORY_LINE_COLORS`（按任务书保留）

测试：`python3 -m unittest` 23；`node --test 'tests/js/*.test.mjs'` 33；e2e 18/18（`/tmp/priminfo-consist/e2e.sh`，`PLAYWRIGHT_CORE=~/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core`，`CHROMIUM=~/Library/Caches/ms-playwright/chromium_headless_shell-1223/.../chrome-headless-shell`）。

### 第 4 点：临界点复核

用上次留下的 33 份真实样本（`/tmp/priminfo-consist/data/`，2'005 个去重方案）跑 `calc.js` 的 `findCrossover`（脚本 `/tmp/priminfo-theme/crossover-check.mjs`、`middle-best.mjs`）：

- 成人 F300 vs F2500 的临界点：1'294 条曲线全部与闭式解 `x = (270 + ΔP) / 0.9` 一致（ΔP = F300 与 F2500 的年净保费差，按 10 CHF 向上取整）。推导：300 < x < 2500 时，F300 总成本 = Y300 + 300 + 0.1(x − 300)，F2500 = Y300 − ΔP + x
- 分布：中位数 1'900，P10–P90 为 1'810–1'930，最大 2'020（ΔP 最高 1'541，即法定上限 70% × 2'200 = 1'540）；最小 870 来自一家只打 505 折扣的保险公司
- 临界点左侧 F2500 最省、右侧 F300 最省：正确。两条线在 [0, 2500] 内必有且仅有一个交点（x = 2500 时 F2500 比 F300 贵 1'980 − ΔP > 0）
- 中间档位：成人方案里没有任何一个 x 让 500–2000 档成为唯一最省（与指南卡片的说法一致）。儿童例外：Sodalis 的 F500 与 F600 保费相同，x < 360 时 F500 比 F600 便宜 0 分（平局，代码按分比较后选了 F500）

## 关键决策及原因

- **字体自托管而不是 Google Fonts `<link>`**：默认界面是中文，Google Fonts 在中国大陆不可达，页面会一直等字体；自托管也让页面没有任何第三方请求，和 About 里「无跟踪统计」一致。只取 latin 子集（含 ü é è），两个可变字体文件共 108 KB；`index.html` 预加载两者。Google 现在把 IBM Plex Sans 作为可变字体分发，四个字重的文件逐字节相同，所以只留一个
- **`--text-muted` 用 `#6b645e` 而不是规格的 `#78716c`**：规格值在米色页面底上的对比度 4.2:1，KPI 标签、页脚、表单标签这些小字会被 axe 判为 AA 不达标；加深到 5.1:1，肉眼几乎看不出
- **整个 header 用页面米色**：规格只写了 `.swiss-header` 用页面底色；参考截图里 profile 行和 Tab 行偏白，是旧 CSS 残留。三行都限宽 1360px，如果各自配不同底色，1440px 以上会在两侧露出色差，所以统一为米色，用分隔线区分
- **手机端 Tab 栏保留横向滚动**：零宽度下三种语言都放不下 5 个 Tab（参考图里 05 同样被截断）；改为右侧 1.75rem 渐隐 + 第 5 个 Tab 露出一截，提示可滑动。隐藏红色编号本可让中文刚好放下，但 en/de 仍放不下，且会失去主题的识别元素
- **手机端头部**：加了「关于」按钮后 390px 放不下，把品牌字号 1.05→0.95rem、瑞士十字 28→24px、状态胶囊和语言按钮内边距各收一点，「关于」在 ≤768px 只显示圆形 i 图标（文字用 sr-only 保留给读屏）
- **文案改动范围**：用户点名的是按钮文字，我顺带把中文里的「Franchise / F300」换成「自付额」，因为这是不懂医保条款的人最大的障碍；en/de 的 Franchise 是官方用语，保留。`matrixHint`、`chartSub` 等说明句一并改了，`meta description`、CSV 列名、档案标签里的 `F2500` 没动
- **About 用 `<dialog>` 弹窗而不是 Tab**：不占 Tab 位，Esc / 背景点击 / 两个关闭按钮都能关；正文是纯文本，走现有 `data-i18n`，只给 ✕ 按钮加了 `data-i18n-aria`
- **拆成三次提交**：任务书要求主题一次提交，另外两项是独立需求，用 `git apply --cached --unidiff-zero` 按 hunk 分拣。三处不纯：About 的 CSS 随主题提交；`index.html` 里 KPI「年省空间」的新文案和 `text-accent` 在同一个 hunk，落在主题提交；状态胶囊的文案和「关于」按钮在同一个 hunk，落在第三次提交

### 部署（用户要求：提交后发布到生产）

- 直接 `vercel deploy --prod --yes`，HEAD `5c1a832`
- 部署 `swiss-insurance-compare-bydpfs693-jddymx-8366s-projects.vercel.app`，别名 `swiss-insurance-compare.vercel.app`，`dpl_73mKqnAszfzNEbvN5GCiRLyvSUad`
- 第二次：HEAD `634f095`，部署 `swiss-insurance-compare-89gj014d0-jddymx-8366s-projects.vercel.app`，别名同上；验证首页含新标签、`style.css` 含居中规则、生产上弹窗在 1280×900 / 1465×575 / 390×844 居中
- 验证：首页 / `style.css` / 两个字体（`font/woff2`，与本地字节一致）/ `chart-theme.js` / API 均 200；页面含 `btn-about` 与 `presetBreakEven`；`quick.mjs` 对生产的读数与本地一致；e2e 18/18（`BASE=` 指向生产）；控制台无报错
- 回滚：Vercel 控制台 promote 上一个生产部署（`62ccfd0`，`swiss-insurance-compare-a7hftjm1j-…`），或 `vercel rollback`

## 遗留问题与下一步

1. ~~指南卡片和预设按钮的「1'800」~~ 已按用户决定改为区间 + 1'900 预设（`5c1a832`）。原记录：**「1'800」是经验值**：实际临界点随方案在 1'810–2'020 之间（中位 1'900），指南说「< 1'800 选 2500 永远最省 / > 1'800 选 300 永远最省」在 1'800–2'000 这段并不总成立。建议把文案改成「约 1'800–2'000，以曲线页为准」或把预设改成 1'900；未改，等用户决定
2. ~~`FRANCHISE_COLORS` 的 `#d97706`~~ 已按用户决定换成 `#b45309`（`047ed97`，历史图第 4 色一并换）
3. **手机端 Tab 栏仍需横向滑动**（见上）；若要完全放下，需要把 Tab 名缩到 4 个字并去掉编号
4. **自托管字体只有 latin 子集**：中文走系统 `Songti SC` / `PingFang SC`，没有 Noto 的设备会回落到默认衬线 / 无衬线
5. 上次遗留的 1–8 条与评审 #8、#14、#16、#17 未动

### 脚本（未入库）

`/tmp/priminfo-theme/`：`shots.mjs`（截图 + 布局检查 + axe）、`measure.mjs`（手机端头部 / Tab 宽度）、`crossover-check.mjs`、`middle-best.mjs`、`stage_hunks.py`（按 hunk 暂存）、`fonts/`（下载的原始字体）、`gfonts.css`。
