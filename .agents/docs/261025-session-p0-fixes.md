# Session：修复架构评审 P0 #1–#4

- 日期：2026-10-25

## 目标

修复架构评审 P0 #1–#4。评审中的行号对应 `d7f75f5`，本次按当前代码重新定位。要求改动尽量小，每条先验证再单独提交。

## 完成内容

| # | 提交 | 改动 |
|---|---|---|
| 1 | `5eacfcc` | `api/index.py` 新增 `EmptyResultError`。`/api/locations`、`/api/franchises`、`/api/calculate` 解析为空时抛出该异常，`handler` 和 `server.py` 都把它映射成 502，且不带 `Cache-Control` |
| 2 | `4fa2ed5` | 三处 fetch 都先检查 `res.ok`，失败时弹 Toast（`toastLoadFailed`），保留旧数据。计算请求失败时徽标显示红色「同步失败」（`statusError`、`.status-pill.error`） |
| 3 | `a9e79b3` | 新增 `esc()`，覆盖公司名、方案名、地名和地点 id，以及由它们派生的档案标签和最优方案摘要。`insurerUrl` 只渲染 http(s) 链接 |
| 4 | `dc0e99f` | `setMedicalCost` 改为调用 `saveActiveStateDebounced()`（500ms），覆盖滑块、快捷下拉框、预设按钮和曲线图拖动 |
| — | `9e3ac09` | 新增 `CLAUDE.md`，内容只有 `@AGENTS.md` |
| — | `7b13271` | 把 `AGENTS.md`「CDN 缓存」一条改成 #1 修复后的实际行为，补上 keine Prämien 例外 |

目录调整（不涉及提交，用户要求工作目录放在 dev-playground）：

- 仓库从 `~/projs/playground/priminfo-pro` 移到 `~/projs/dev-playground/priminfo-pro`；`.git` 和 `.vercel` 随目录一起移动
- 原来占着这个位置的旧副本先改名为 `priminfo-pro-old`，之后按用户要求用 `trash` 移进了废纸篓（可恢复）
- `~/projs/dev-playground/priminfo-themes/PROMPT-apply-theme-e.md` 里的仓库路径同步改为新位置
- 移动后在新位置启动 `server.py`：首页和 `/api/calculate` 正常，浏览器冒烟测试通过
- `~/projs/playground/AGENTS.md` 并入 `~/projs/dev-playground/AGENTS.md`：只并入 Vercel 托管一节；Cloudflare 隧道一节与已有内容重复，没有并入

验证结果（均在本地 `python3 server.py` 上完成）：

- #1：真实上游正常查询返回 200（128 个方案）；只勾 PHARM 返回 200 + 空结果；无效地点返回 502。用模拟上游测了宕机（500）、维护页（三个接口都是 502）、只有 change 页坏（502），所有错误响应都不带缓存头
- #2：计算接口 502 时 `state.data` 和表格不变，出现 Toast，徽标为「同步失败」，切换语言后文案跟着变，下次成功后恢复。locations 和 franchises 失败时，下拉框不再被清空（改动前会被清空）
- #3：用构造的恶意上游数据测试，改动前触发 26 次 alert、注入 15 个 img；改动后为 0，payload 按原文显示，`javascript:` 链接不再渲染。真实数据回归正常（25 条链接都在，地点搜索和切换正常）
- #4：逐帧拖动滑块 200 帧，改动前写入 200 次，改动后 1 次；曲线图拖动从 61 次降到 1 次；刷新后能恢复最终值
- 每条都在提交前单独验证；四条都提交后，又在 HEAD 上把以上测试全部重跑了一遍

验证脚本放在 `/tmp/priminfo-verify/`，没有入库：

- 后端：替换 `api.fetch_upstream` 或 `api.BASE_URL`，再用 `ThreadingHTTPServer` 分别挂载 `server.PriminfoHandler` 和 `api.handler`，即可模拟上游故障或恶意数据
- 浏览器：用 npx 缓存里的 playwright-core（`~/.npm/_npx/31e32ef8478fbf80`），`executablePath` 指向 `chromium_headless_shell-1223`

## 关键决策及原因

- **合法空结果仍返回 200**（用户确认）
  - 只勾 PHARM 时，上游提示「keine Prämien」（2027 年没有 PHARM 保费），这不属于故障
  - 判断条件：savings 为空，且页面里包含这句提示
  - 上游改文案后会退化为 502，属于安全的失败方式
- **`/api/calculate` 三页中任一页解析为空就返回 502**
  - 原因：避免只缺矩阵或历史数据的残缺结果被缓存 1 小时
  - 代价：如果只有一页改版，整个接口都会失败
- **用 `isinstance` 映射 502，而不是 `getattr(e, "status")`**
  - `urllib` 的 `HTTPError` 本身带 `.status`，用 getattr 会把上游的状态码透传出去
- **`server.py` 同步改了两行**：让本地和线上一样返回 502，本地才能验证
- **徽标显示「同步失败」**（用户确认）
  - 只靠 Toast 的话，2.6 秒后消失，徽标仍写着「已同步」，正是评审 #2 描述的问题
  - 同时更新 `data-i18n`，切换语言后仍显示失败文案
- **insurerUrl 加 http(s) 白名单**（用户确认）
  - `esc()` 挡不住 `javascript:` 链接；目前上游 128 条链接全是 `http://`
- **以下字段不做转义**
  - 数字、自付额档位、年份：后端已经做了 int 转换或正则校验
  - `modelCategory`：由后端生成，只有 5 个常量
- **debounce 放在 `setMedicalCost` 一处**
  - 所有医疗费输入都经过这里。页面上没有医疗费文本输入框，用户说的「输入框」对应快捷下拉框
  - 选 500ms 而不是 300ms：300ms 的尾部 debounce 在极端操作下理论上仍可能达到 30 秒 100 次
- **`CLAUDE.md` 只写 `@AGENTS.md`**（用户要求新增）
  - Claude Code 只自动加载 `CLAUDE.md`；用 import 的方式，规则只需在 `AGENTS.md` 一处维护
- **移动仓库时，旧副本先改名而不是删除**
  - 新位置被旧副本占着；旧副本不在 git 里，删除后无法恢复，所以先改名保留，等用户确认后才删
- **playground 的 AGENTS.md 采用合并而不是移动**
  - dev-playground 下已有 AGENTS.md，直接移动会覆盖；新并入的内容按目标文件的中文风格改写，命令和 JSON 原样保留

## 遗留问题与下一步

- **内存缓存会让 502 持续一段时间**：`fetch_upstream` 的内存缓存仍会把错误页保存 1 小时，在同一个热实例上 502 会持续。建议和 #15 一起处理（移除内存缓存，或者不缓存解析为空的页面）
- **失败后表单和数据不一致**：表单显示新参数，数据还是上一次的。`getEnrichedPlans` 用新的 `state.franchise` / `yob` 计算看病自付和年度总支出，会和旧数据混算，直到下次成功同步。目前靠徽标提示；如需彻底解决，可以在失败时把表单恢复成上次成功的参数
- **Toast 文案不区分错误类型**：无效输入（如无效地点返回 502）也会显示「请稍后重试」
- **以下问题本次没有处理，均有对应的评审条目**
  - 上游 4xx/5xx 仍返回 500，并把 `str(e)` 返回给客户端（#18）
  - 未知端点仍返回 200 且会被缓存（#10）
  - `/api/insurers`、`/api/plans` 没有加空结果检查（#16，死接口）
- **只勾 PHARM 时部分区块停在旧画面**：KPI、曲线图、历史图会保留上一次的内容，原因是 `renderAll` 各函数在数据为空时直接 return（原有行为）
  - 另外，前端的 PHARM 类别是按关键词猜的（#8），有 4 个方案被归为 PHARM，上游却不这样分类
- **`~/projs/playground/` 还留着原始的 `AGENTS.md`**：独有内容已并入 dev-playground，删除这个目录需要用户确认（之前尝试删除时被 auto mode 安全分类器拦截）
- **Paseo 里最早建站的 agent（f002868）上下文中仍是旧路径**：它写的主题 prompt 已改为新路径，但如果继续和它对话，需要告诉它仓库已移动
- **还没有 push**：仓库没有配置远程，GitHub 上也没有同名仓库，用户决定暂不 push
- **下一步**：按评审的建议顺序做 #13（fixture 测试），可以参考上面的 harness 思路
