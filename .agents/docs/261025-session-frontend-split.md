# Session：前端拆分与按需渲染（评审 #11 #12）

- 日期：2026-10-25

## 目标

- #11：把 `static/app.js`（2279 行）拆成原生 ES modules，零依赖、无构建步骤，`index.html` 改用 `<script type="module">`；模块路径在 `server.py` 和 Vercel 重写规则下都要能加载
- 只搬代码，不改行为、不改样式、不顺手修 bug；分多步提交，每步之后页面都能正常运行
- #12：拆成「数据变化 → 全量重绘」和「医疗费变化 → 只重绘当前 Tab」两条渲染路径，指南只在切换语言时渲染。先出方案、经确认后再改，并对比改动前后的渲染次数和耗时
- 每步提交前：`python3 -m unittest` 全部通过，浏览器冒烟测试覆盖各 Tab、语言、档案、分享链接、刷新恢复，控制台无报错
- 用户追加：先部署 Vercel preview 验证，通过后部署到生产

## 完成内容

| 步骤 | 提交 | 改动 |
|---|---|---|
| 1 | `7e33023` | `git mv static/app.js static/js/main.js`，`index.html` 改为 `<script type="module" src="js/main.js">` |
| 2 | `defd414` | `js/i18n/{zh,en,de,index}.js`、`js/format.js`（fmtChf / fmtSignedPct / esc）；AGENTS.md 的 i18n 规则改为指向新位置 |
| 3 | `2fe73d3` | `js/calc.js`：calcOutOfPocket、enrichPlans、buildCurveSeries、findCrossover、buildInsurerMinMap、familyBundleTop5；`js/location-search.js`：normalizeSearchStr、buildLocationIndex、searchLocations。函数体不变，原来读 `state` 的地方改成参数 |
| 3b | `f66b7c5` | `tests/js/*.test.mjs`，共 22 个 node:test 测试；AGENTS.md「运行」一节补上 `node --test 'tests/js/*.test.mjs'` |
| 4 | `541b64f` | `js/state.js`：state、localStorage/URL 读写、派生数据（getEnrichedPlans、filterAndSortPlans 等） |
| 5 | `7c60f60` | `js/api.js`：三个接口的 fetch + `res.ok` 检查 |
| 6 | `541d80e` | `js/views/`：toast、controls、profiles、ranking、curves、matrix、history、guide；getTrendBadgeHtml 移到 format.js |
| 7 | `183e9f2` | `js/controller.js`：编排逻辑。main.js 只剩 bindEvents + initApp（344 行） |
| #12 | `817c447` | `onDataChange()` 加 `invalidateTabs(tabs)`，配合过期 Tab 集合 |
| 文档 | `7d2f2e4` `db2b94e` 及本次提交 | 本 session 记录：preview 验证、生产部署、下一个 session 的 prompt |
| 部署 | — | 先部署 preview 验证，再部署到生产（`db2b94e`），两个环境都复验通过，详见「其他」 |

最终结构（共 2423 行）：

```
static/js/
  main.js         事件绑定 + 初始化
  controller.js   编排；两条渲染路径；三个加载函数及其请求序号/AbortController
  state.js        state、持久化、派生数据
  api.js / calc.js / location-search.js / format.js
  i18n/{index,zh,en,de}.js
  views/{toast,controls,profiles,ranking,curves,matrix,history,guide}.js
```

依赖方向是单向的：main → controller → views / state / api → calc / format / i18n，没有循环 import。

### #12 渲染路径

| 事件 | 路径 | 重绘内容 |
|---|---|---|
| 请求成功（地点 / 出生年 / 自付额 / 意外险 / 模型 / 切换档案） | onDataChange | 所有数据视图，指南除外；曲线下拉框从每次 2 遍减为 1 遍 |
| 切换语言 | onDataChange + 指南 | 指南从每次 2 遍减为 1 遍 |
| 医疗费（滑块 / 快捷下拉框 / 预设按钮 / 曲线拖动） | invalidateTabs | 排行 / 曲线 / 矩阵中的当前 Tab，另外更新医疗费下拉框 |
| 搜索 | invalidateTabs | 排行 / 矩阵 / 历史 |
| 排序 | invalidateTabs | 排行 / 矩阵 |
| 矩阵模式 | invalidateTabs | 矩阵 |
| 曲线方案下拉框、「看曲线」按钮、矩阵行点击 | invalidateTabs | 曲线 |
| 切换 Tab | — | 目标 Tab 过期时先渲染再显示 |

前后对比（headless Chromium，每次事件；「含 layout」指同步派发后读 `offsetHeight` 强制 layout）：

| 场景 | 容器重写次数 | 仅 JS | 含 layout |
|---|---|---|---|
| 滑块 @曲线 | 9 → 2 | 3.9 → 0.3 ms | 5.6 → 0.8 ms |
| 滑块 @排行（25 行） | 9 → 2 | 4.0 → 0.6 ms | 6.7 → 3.0 ms |
| 滑块 @排行（全部 128 行） | 9 → 2 | 6.5 → 2.8 ms | 18.8 → 14.4 ms |
| 滑块 @矩阵 | 9 → 2 | 4.0 → 1.7 ms | 10.7 → 7.9 ms |
| 搜索每敲一个键 @排行 | 8 → 1 | — | 3.8 → 1.7 ms |

拆分前（`cf734e7`）和 #11 完成后的耗时一致，说明拆成模块本身没有运行时开销。

### 验证

每一步提交前都跑一遍 `/tmp/priminfo-split/scripts/check.sh <label>`，#12 用 `check12.sh`：

- `python3 -m unittest`（23 个）和 `node --test`（22 个）
- **DOM 快照比对**（golden.js）：44 个检查点，覆盖排行的搜索、排序和展开、看曲线、曲线拖动、滑块、快捷下拉框、预设、方案切换、矩阵的两种模式和行点击、历史、指南、类型标签跳转、三种语言、移动端折叠、档案的保存/新增/切换/删除和家庭总账、地点的搜索/键盘选择/无结果/Esc、意外险、自付额、模型筛选（含「至少保留一个」）、CSV 导出、刷新后恢复、分享链接（当前状态，以及 de + matrix 参数）
  - 每个检查点记录 body HTML（去掉 script）、表单值、URL、localStorage 和 Toast
  - 基准取自 `cf734e7`，结果要逐项相同。家庭总账模板少了一层缩进，只影响 innerHTML 里的空白，比对时折叠空白后相同的单独列出
  - 基准连跑两次结果一致；人为改一处临界点步长，有 20 处差异被检出
- **两个入口**：`server.py`（8765），以及按 `vercel.json` 规则实现重写的模拟服务（8767，`.js` 按 Vercel 线上的 `application/javascript` 返回）。全部模块都经 `/js/... → /static/js/...` 重写拿到 2xx
- **错误路径**（errors.js）：计算接口 502（含切换语言和恢复）、franchises 502、请求被新请求取代、locations 502。每步结果都和 `cf734e7` 逐项相同，调用栈除外
- **静态检查**：conserve.py 确认纯搬运的步骤里代码行一行不多一行不少；refs.py 确认每个模块用到的原顶层名字都已声明或 import，也没有多余的 import
- **#12**：快照改为只比较可见内容（隐藏的 Tab 允许留着过期 DOM），并新增 19 个「改完参数后切到其他 Tab」的检查点，共 63 个，和 `cf734e7` 逐项相同。做了 3 个变异：切 Tab 不渲染过期 Tab、医疗费只标记曲线、搜索不标记历史，都被检出

## 关键决策及原因

- **calc.js 抽成纯函数**（用户选）：内联在视图里的最优档位、曲线、临界点和家庭总账也抽成参数显式的纯函数，才能用 node 测试。函数体不变，曲线颜色留在视图层
- **地点搜索单独放进 `location-search.js`**：它不属于保费计算，但同样是纯函数，可以一起测
- **加 node:test 测试，不加 package.json**（用户选）
  - Node 22 会自动把无 `type` 的 `.js` 识别为 ESM
  - 不加 package.json，是为了避免 Vercel 把项目识别成 Node 项目
  - Node 22 的 `--test` 不接受目录参数，要传 glob
  - 每条断言都用改错的代码验证过能失败；有 4 个变异起初没被发现，补了用例：平局保留所选档位、临界点不在 20 的倍数上、相等算作已交叉、精确邮编和其他匹配竞争
- **main + controller 两个文件**（用户选）：main.js 只负责事件绑定，controller.js 负责编排；视图不 import 编排层，所以没有循环依赖
- **增加 `format.js`**：评审的目录树里没有这个文件，但 i18n 字典要用 fmtChf / fmtSignedPct，不能留在 main.js
- **请求序号和 AbortController 留在调用方**：它们还决定响应是否更新界面、徽标和 Toast，和 UI 逻辑耦合，所以 api.js 只负责 fetch + `res.ok`。查询参数顺序保持不变，因为 CDN 缓存按 URL 区分
- **#12 的搜索 / 排序 / 矩阵模式 / 曲线方案也走 B 路径**（用户选）：搜索每敲一个键都会触发，收益最明显
- **过期 Tab 用集合记录**（用户选）：渲染次数最少；数据变化时整体清空
- **验证用 DOM 快照比对**：「只搬代码」的标准是行为完全不变，所以每一步都和拆分前的 HTML 逐字比较，不靠肉眼看截图

## 遗留问题与下一步

### 拆分中发现、按要求未修的问题（拆分前就存在）

1. **加载中切换语言，徽标显示「已同步」**：加载期间 `data-i18n` 仍是上一次的 `statusReady`，`applyLanguage` 会把文本改成 "Synced"，但 loading 样式还在（已在浏览器实测）
2. **franchises 请求失败时，计算仍用旧的自付额**：比如出生年改成 2015 时 franchises 返回 502，自付额停在 2500（儿童没有这一档），排行表全是「—」，徽标却显示「已同步」
3. **`getCheapestPlanFromCurrentData`、KPI 排序、CSV 导出没有处理 `monthlyNet` 为 null 的方案**：null 参与比较会得到 NaN，CSV 里写成 `0.00`（和第 2 条同时出现）
4. **家庭总账里的 `/yr` 写死在 `views/profiles.js`**，没有走 i18n
5. **删除当前档案后，第一个档案被标成「当前」**，即使当前配置和它并不匹配；其他地方都是按配置匹配
6. **「档案与当前配置是否匹配」的判断重复 3 处**（state.js 一处，controller.js 两处）
7. **每次请求成功都把 `selectedCurvePlanIdx` 重置为 0**：改任何筛选条件，用户选的曲线方案都会丢失
8. **移动端折叠摘要用 `split(" ")[0]`**，显示的是邮编（如 "8001"）而不是城市名，和变量名 `shortCity` 不符
9. **`index.html` 里的 `#location-id` 隐藏输入框没人读写**，是死代码
10. **`searchQuery` / `sortBy` / `matrixMode` 不写入 URL 和 localStorage**，其他视图状态都会写入，不确定是否有意为之
11. **兜底值重复（归入 #14）**：`4.75` 和默认自付额列表在 `state.js#getEnrichedPlans` 和 `controller.js#viewInputs` 各有一份（原来在 renderAll 和 getEnrichedPlans 里也是两份）；CSV 文件名里写死了 `2027`
12. **#7 两套净保费算法**：从 `enrichPlans` 能看得很清楚，`totalYearCost` 用上游的 `yearlyNet`，最优档位用本地的 `(gross − rebate) × 12`；测试中「平局保留所选档位」这条固定了现有行为

### 其他

- **已部署到生产**（均经用户同意）
  - preview：HEAD `7d2f2e4`，`vercel deploy`，preview 地址已略去，没有开启访问保护
  - 生产：HEAD `db2b94e`，`vercel deploy --prod`，别名为 `swiss-insurance-compare.vercel.app`。和 preview 相比只多了文档提交，没有代码改动
  - 两个环境的验证结果相同
    - `/js/main.js`、`/js/views/*.js`、`/js/i18n/*.js` 均为 200，Content-Type 为 `application/javascript`，缓存头为 `max-age=0, must-revalidate`
    - `VISIBLE=1` 快照 63/63 与 `cf734e7` 一致；错误路径 9/9 一致；控制台无报错
  - 旧的 `/app.js` 在生产上已是 404。HTML 带 `must-revalidate`，浏览器会重新取页面，不会继续引用旧脚本
  - preview 页面会注入 `vercel.live` 反馈脚本，生产环境没有；快照比对时会去掉 script 标签
  - 如需回滚：在 Vercel 控制台把上一个生产部署 promote 回来，或执行 `vercel rollback`
- **模块请求有瀑布**：main → controller → views，3 层、17 个文件。HTTP/2 下问题不大，如果首屏慢，可以在 `index.html` 加 `<link rel="modulepreload">`
- **大表格仍然慢**：排行展开全部 128 行时，每次滑块事件约 14ms，主要花在可见表格的 layout 上；如需优化，可以只更新受医疗费影响的两列，或者节流
- **验证脚本放在 `/tmp/priminfo-split/scripts/`，没有入库**
  - `golden.js`（`VISIBLE=1` 为 #12 模式）、`compare.js`
  - `errors.js`、`errors-compare.js`、`perf.js`
  - `check.sh`、`check12.sh`
  - `vercel_emu.py`：读 `vercel.json` 模拟重写，端口 8767
  - `move.py`：按名字原样搬运顶层块；`conserve.py`：校验代码行守恒；`refs.py`：检查漏掉或多余的 import；`fix_imports.py`：按符号表生成 import
  - 基准代码在 `/tmp/priminfo-split/base`（`cf734e7` 的 git archive），在 8768 端口运行
- **评审中仍未处理**：#5–#8、#14、#16、#17
- **下一步建议**（按顺序）
  1. 前端错误状态与数据一致性：上面第 1–3 条，以及评审 #5、#6、#7。都在前端，calc 已有单元测试兜底，prompt 见下
  2. 后端：#8 改用上游 `optgroup` 的官方模型分类（顺带解决 PHARM 被误判的问题），#16 死接口。需要用真实上游验证
  3. 维护：#14 集中管理魔法值（含第 11 条的重复兜底值）、#17 统一本地和线上入口

### 下一个 session 的 prompt

```
项目在 ~/projs/dev-playground/priminfo-pro。先读 AGENTS.md，再按里面的文档规则读 .agents/docs/ 下最新的 session 记录和架构评审。

本次任务：前端错误状态与数据一致性（评审里的行号对应提交 d7f75f5，前端已拆成 static/js/ 下的模块，以当前代码为准重新定位）
- 上次 session 记录「拆分中发现、按要求未修的问题」第 1–3 条：
  1. 加载中切换语言，状态徽标显示「已同步」
  2. franchises 请求失败时，计算仍用旧的自付额（如出生年改成儿童年份），排行全是「—」，徽标却显示已同步
  3. monthlyNet 为 null 的方案在最低价、KPI 排序和 CSV 导出里没有处理（NaN 比较，CSV 写成 0.00）
- 评审 P1：#5 档案摘要与模型筛选不同步；#6 分享链接不含 models；#7 净保费两套算法，统一成一种

要求：
- 每条先写能复现问题的测试，确认失败后再修：纯函数用 node --test（tests/js/），涉及 DOM 和请求的用 Playwright。用法和脚本见上次 session 记录；/tmp/priminfo-split/ 下的脚本如果已经不在，就按记录重建
- 每条单独提交。提交前 python3 -m unittest 和 node --test 'tests/js/*.test.mjs' 全部通过；本地 python3 server.py 后用浏览器冒烟测试，覆盖排名表、曲线图拖动、矩阵、历史、指南、档案、切换语言、分享链接、刷新后恢复状态，控制台无报错
- 只改和当前这一条相关的代码，顺带发现的问题记下来，最后汇总给我
- 以下几条先给方案，我确认后再改：
  - 第 2 条：franchises 失败后怎么处理（不发计算请求并恢复旧的出生年？还是照常计算但给出提示？）
  - #5：档案匹配要不要把 models 算进去，还是保存时同步更新 profile.models
  - #6：URL 参数的格式，以及没有 models 的旧链接怎么兼容
  - #7：统一用上游的 yearlyNet，还是本地的 (gross − rebate) × 12；先用真实数据核对两种算法差多少，再说明对最优档位、临界点和现有测试的影响
- 改动用户可见的文本时，zh / en / de 三种语言同时补齐
- 遇到需要取舍的地方先问我；部署前先问我
- 结束前按 AGENTS.md 写 session 记录
```
