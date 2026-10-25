# Session：前端错误状态与数据一致性

- 日期：2026-10-25
- 接上一份 `261025-session-frontend-split.md`

## 目标

- 上次记录「拆分中发现、按要求未修的问题」第 1–3 条：加载中切换语言、franchises 请求失败、`monthlyNet` 为 null
- 评审 P1：#5 档案摘要与模型筛选、#6 分享链接不含 models、#7 两套净保费算法
- 每条先写能复现的测试并确认失败，再修；每条单独提交；第 2 条、#5、#6、#7 先出方案，经用户确认后再改

## 完成内容

| 条目 | 提交 | 改动 |
|---|---|---|
| 1 | `1a144a3` | 进入加载状态时把徽标的 `data-i18n` 设为 `statusLoading` |
| 测试 | `e959fff` | 新增 `tests/e2e/`（Playwright + `node --test`）；AGENTS.md 补充用法 |
| 3 | `d5765ea` | `calc.js#ascNullsLast`：最低价、排行和矩阵排序都把无保费的方案排到最后；KPI 只统计有保费的方案，一个都没有时显示「—」；CSV 写空格子 |
| 2 | `cce80db` | `changeYob`：franchises 失败时恢复旧出生年、不计算；`applyProfile` 先加载档位，成功后才切换；首次加载不变 |
| #5 | `f4c8abe` | `findActiveProfile`（5 项，models 按集合比较）／`findProfileByConfig`（4 项，保存用），替换原来三处重复的匹配 |
| 文档 | `a85f8d9` | e2e 加 `--test-concurrency=1`：`server.py` 单线程，测试文件并行会超时 |
| #6 | `9321551` | URL 写入 `models=BASE,FLEX,...`（逗号不转义）；读取时过滤未知值，并按复选框顺序排列 |
| #7 | `73a6a2d` | `calc.js#netYearlyAt` 统一净保费；总成本、临界点按分比较；曲线结论用 `bestFranchiseForPlan`；无所选档位时总成本为 null |

测试：

- `python3 -m unittest`：23 个
- `node --test 'tests/js/*.test.mjs'`：22 → 33 个，新增 `tests/js/state.test.mjs`
- `tests/e2e/`：18 个，6 个文件

### 真实数据核对（#7 和第 3 条）

样本：33 次 `/api/calculate`，覆盖 5 个地点（ZH / GE / BE / TI / AI），1990 / 2005 / 2015 三个出生年各 2 个档位，另有 3 次含意外险；共 3,882 个方案。

- **两种算法的差值**：有保费的方案，上游 `yearlyNet` 和 `(gross − rebate) × 12` 只差浮点误差（最大 1.8e-12）
  - `monthlyGross` 等于 `matrixPrices[所选档位]`，所有方案的 rebate 都是 4.75
- **平局**：有 347 个点（方案 × 医疗费，每 10 CHF 一个点）上，所选档位和其他档位的总成本精确到分相同
  - 旧代码在其中 68 个点选了别的档位
  - 方案沟通时说的 106 有误：当时的脚本把所选档位自己也算成了「别的档位」
  - 只统一公式、不按分取整的话还剩 30 个；改后为 0
- **临界点**：38 / 3,882 条曲线的临界点因为浮点误差晚了 CHF 10；改后全部和按分比较的结果一致
- **无保费的方案**：儿童选 F600 时，每个地点有 13–14 个方案不提供 F600，共 68 个
  - 旧代码中，这些方案的总成本只有自付部分
  - 旧代码中，它们的最优档位停在不提供的 600 上
- **#7 前后对比**：
  - 有保费方案的总成本全部不变
  - 最优档位只在上面 68 个平局点，以及无保费方案上有变化

### 验证

每次提交前：

- `python3 -m unittest`、`node --test`、e2e 全部通过
- 用上次的 `golden.js`（`VISIBLE=1`，63 个检查点）和 `errors.js`（9 条）对比上一次提交后的结果。两个入口都跑：`server.py`，以及 `vercel.json` 重写模拟服务。差异逐条确认是预期变化：

| 提交 | 快照差异 | 错误路径差异 |
|---|---|---|
| 1 | 无 | 加载中的 `data-i18n` 变化 |
| 3 | 6 处：儿童 F100 下 KPI 和排行第一行原来是无保费方案，现在是真正的最低价 | 全部无保费时 KPI 显示「—」 |
| 2 | 无 | franchises 502 后出生年回到 1990，不发计算请求 |
| #5 | 无（golden 切换模型时没有匹配的档案，新行为由 e2e 覆盖） | 无 |
| #6 | 每个 URL 多了 `models=`；去掉这个参数后 63 个快照完全一致 | 同左，9 条完全一致 |
| #7 | 1 处：伯尔尼儿童 F100 的矩阵里，38 个方案高亮了真正的最优档位 | 无 |

- **变异检查**：每条修复都改回一处关键代码，确认测试能失败
  - 删掉加载时的 `data-i18n`
  - 撤掉 `ranking.js` 的改动
  - 删掉 `state.franchise = Number(prev)`
  - `prevYob` 不用 `franchisesYob`
  - 保存时改用 5 项匹配
- **控制台**：所有运行都没有报错

## 关键决策及原因

- **第 2 条**（用户选）：franchises 失败时不计算，恢复旧出生年
  - 照常计算的话，表格仍然全是「—」
  - 恢复目标是「当前档位选项所属的出生年」（`franchisesYob`），不是改之前的 `state.yob`：连续改两次、第一次被取代时，后者是从未加载成功的年份
  - `applyProfile` 改为先请求、成功后再切换状态，避免失败后还要回滚 7 个字段
  - `updateFranchisesForYob` 增加「优先保留的档位」参数，保住旧代码顺带做的纠正：档案里存了该年龄没有的档位时回落到默认档位
- **#5**（用户选）：高亮看 5 项，保存按 4 项
  - 模型改了，档案就不再算「当前档案」，摘要不会被覆盖
  - 保存仍更新同一个档案，不会出现标签相同的两个档案
  - 旧档案没有 models、或 models 为空数组时，视为全选（和 `applyProfile` 一致）
- **#6**（用户选）：总是写入 models，没有 models 的旧链接沿用本地存储
  - 按复选框顺序排列，API 请求 URL 不变，CDN 缓存仍能命中
- **#7**（用户选）：统一用本地公式，并按分比较
  - 上游只给所选档位的 `yearlyNet`，所以无法统一用上游的值
  - 排行里的「月净保费 / 年净保费」两列仍显示上游值（和本地算的一致到分）
- **第 3 条范围**（用户选）：排行和矩阵的排序一起改；按总成本排序在 #7 之后才有 null
- **全部方案都无保费时 KPI 显示「—」**：直接 return 会留下上一次的数值，比原来更误导
- **e2e 测试放进 `tests/e2e/`**（用户选）
  - playwright-core 不是依赖，用 `PLAYWRIGHT_CORE` / `CHROMIUM` 环境变量指定，找不到就跳过
  - 不加 package.json
  - 请求经本地服务访问真实上游；需要固定数据的场景用 `page.route` 改写响应

## 遗留问题与下一步

### 本次顺带发现、未修

1. **合法空结果时 KPI 显示旧值**：`plans` 为空（上游「keine Prämien」，如只勾 PHARM）时 `renderKpis` 直接 return，保留上一次的数值（修复前就存在）
2. **`server.py` 是单线程的 `HTTPServer`**：e2e 只能串行；本地开多个 Tab 时请求也会排队。可改用 `ThreadingHTTPServer`（归入 #17）
3. **首次加载 franchises 失败时下拉框不对**：下拉框保留 HTML 里的成人档位，儿童配置（F0）在其中找不到对应项；计算本身用的是正确的档位
4. **无保费方案的「自付」列显示所选档位的自付额**：如「— — 500.00 —」，但这个方案并不提供该档位
5. **对比页缺少某方案时总成本为「—」**：名称对不上时（API 会记 warning），#7 之后总成本显示「—」，不再用 `yearlyNet` 兜底。3,882 个样本里没有出现过
6. **模型列表字面量还有 3 处重复**：`state.js` 的默认 state、默认档案，以及 `controller.js#applyProfile` 的兜底值；`state.js` 新增了 `ALL_MODELS`（归入 #14）
7. **旧链接打开后参数顺序不同**：`models` 会追加在 `lang` 之后，只影响外观
8. **曲线里「最贵档位」的平局仍按浮点排序**：只影响写的是哪个档位，差额相同

### 上次记录中仍未处理的

- 第 4、5、7–11 条
- 第 6 条（三处重复的档案匹配）已随 #5 解决
- 第 12 条（#7）已解决

### 评审进度

- 已完成：P0 全部，以及 #5、#6、#7、#9、#10、#11、#12、#13、#15、#18
- 未处理：#8、#14、#16、#17

### 脚本（未入库）

`/tmp/priminfo-consist/`：

- `e2e.sh`：带上 `PLAYWRIGHT_CORE` / `CHROMIUM`，串行运行 `tests/e2e/`
- `check.sh <label> <prev>`
  - 依次跑 unittest、node 测试和 e2e
  - 再在两个入口跑 golden 和 errors，与上一次提交后的结果比对
- `scripts/errors.js`：上次的错误路径脚本，franchises-502 一步改为不等计算请求
- `scripts/compare-strip-models.js`：去掉 `models=` 参数后再比对
- 数据核对
  - `scripts/fetch_samples.py`：抓取 33 份样本，保存在 `data/`
  - `compare_net.mjs`、`ties.mjs`、`tie-examples.mjs`、`verify-new.mjs`：核对和统计脚本
- `runs/`：每次提交后的快照和错误路径记录（item1 … item7）

上次的 `/tmp/priminfo-split/scripts/`（golden.js、compare.js、vercel_emu.py 等）仍在使用。

### 部署

- 本次没有部署；生产环境仍是 `db2b94e`
- 部署前先问用户

### 下一步建议

1. 部署：先 preview，再 production，用 golden 和 e2e 复验（e2e 用 `BASE=` 指向部署地址）
2. 后端：#8 改用上游 `optgroup` 的官方模型分类（顺带解决 PHARM 误判），#16 死接口
3. 维护：#14 集中管理魔法值（含上面第 6 条和上次的第 11 条），#17 统一入口（含上面第 2 条）
