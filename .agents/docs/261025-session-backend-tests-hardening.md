# Session：后端测试与加固（评审 #13 #10 #18 #15 #9）

- 日期：2026-10-25

## 目标

- #13：用真实上游快照给 savings / comparison / change / franchises / locations 的解析写 fixture 测试，覆盖「keine Prämien」→ 200、维护页 → 502
- #10：未知端点返回 404，不带缓存头
- #18：错误响应不再返回 `str(e)`，细节只写服务端日志
- #15：处理内存缓存，同时解决上次遗留的「错误页被内存缓存 1 小时，502 持续」
- #9：按名称合并三页数据时，名称对不上就写日志
- 要求：只用标准库 unittest；先做 #13，之后每条补测试；每条单独提交，提交前测试全过，并用 `python3 server.py` + curl 验证

## 完成内容

| # | 提交 | 改动 |
|---|---|---|
| 13 | `08f3f8f` | 新增 `tests/`：`test_api.py`、`make_fixtures.py`、`fixtures/`（6 个文件，约 44KB）。AGENTS.md「运行」补上 `python3 -m unittest` 和重新生成 fixture 的命令 |
| — | `d0b59c0` | `get_locations_json` 遇到无法解析的 JSON 时按空结果处理，返回 502（原来返回 500，见决策） |
| 10 | `54027a0` | 新增 `NotFoundError`，`handle_api_request` 遇到未知路径时抛出；`api.handler` 和 `server.py` 都映射为 404 |
| 18 | `4e3b32b` | 响应体只返回状态短语（`Not Found` / `Bad Gateway` / `Internal Server Error`）。500 用 `logging.exception` 记录 traceback，404/502 用 `logging.warning` 记一行。两个 handler 同步修改 |
| 15 | `ef1b7dd` | 删除 `CACHE` / `CACHE_TTL` 和 `fetch_upstream` 里的缓存逻辑 |
| 9 | `91ec8a6` | 合并前计算两类缺失：savings 中有、comparison 中找不到的 (公司, 方案)，以及 change 中找不到的公司，有缺失时各写一条 warning |

测试：`python3 -m unittest`，共 23 个，约 1 秒，不联网

- `ParserTest`：用 fixture 测五个解析器
- `MergeTest`：名称都匹配时不写日志；改名后写日志，接口照常返回
- `FetchUpstreamTest`：上游先返回维护页再恢复，第二次请求应成功（替换 `urlopen`）
- `VercelHandlerTest` / `LocalServerTest`：同一组 HTTP 测试分别跑在 `api.handler` 和 `server.PriminfoHandler` 上，覆盖状态码、`Cache-Control` 和错误响应体

验证结果（每条都在提交前完成）：

- 先写测试并确认失败，修复后再确认通过（#13 本身只加测试）
- #13：做了变异测试，把列号改错、去掉 keine Prämien 判断、去掉 change 页的空检查、不去软连字符、年份错位，每种都有测试失败；把 `BASE_URL` 指向不可达端口后测试照常通过，证明不联网
- curl（真实上游）：`/api/calculate` 200，128 个方案，矩阵和历史数据齐全；只勾 PHARM 返回 200 和空结果；`/api/nope` 返回 404，不带缓存头；没有出现名称不匹配的 warning
- curl（假上游）：维护页 → 三个接口都返回 502，不带缓存头；locations 改动前返回 500，改动后 502；上游不可达 → 500，响应体只有 `Internal Server Error`，traceback 写进服务端日志；改名 → 返回 200，日志列出对不上的条目
- #15：上游先维护再恢复，改动前恢复后仍是 502，改动后立即 200。去掉缓存后，真实计算请求约 0.45 秒
- 全部提交后在 HEAD 上重跑测试，并用上次的 Playwright 冒烟脚本确认前端正常（25 行排名、「已同步」、无控制台错误）

验证脚本放在 `/tmp/priminfo-fx/scripts/`，没有入库：

- `fake_upstream.py`（8799 端口）：默认返回 fixture；存在 `/tmp/priminfo-fx/broken` 时返回带 CSS 的维护页；存在 `/tmp/priminfo-fx/rename` 时改写名称
- `run_server.py`：把 `api.BASE_URL` 指向假上游后，用 runpy 运行 `server.py`
- `restart.sh real|fake`：按端口杀掉并重启 8765。注意 macOS 上进程名是 `Python`，`pkill -f "python3 server.py"` 匹配不到
- `run_vercel_handler.py`：把 `api.handler` 挂到 8766 端口

## 关键决策及原因

- **fixture 裁剪后入库，并提交生成脚本**（用户选）
  - 来源：默认参数（8001 Zürich、1990、2500、全部模型）的一次真实查询
  - 只保留 3 家公司：KPT（2000 档为「—」，方案名带软连字符）、ÖKK（变音字母和软连字符）、Einsiedeln（只有 1 个方案）
  - 只保留页面里的两个 `<table>`，且保持原顺序（comparison / change 靠 `tables[1]` 取数），行内 HTML 原样保留
  - PHARM 页只保留 keine Prämien 提示块；locations 保留 4 个邮编共 11 个地点，index 同步过滤
  - 生成脚本：`python3 -m tests.make_fixtures`；如果找不到保留的公司或提示块，直接报错退出
- **断言以不变量为主，少写具体金额**
  - 不变量包括：年 = 月 × 12，净额 = 毛额 − 返还，矩阵 2500 档 = savings 月保费，涨幅与相邻两年保费一致，保费随自付额递减
  - 写死的只有：自付额档位、年份、KPT 2000 档为空、Zürich 的地点 id
  - 好处是每年重新生成 fixture 后，大部分测试不用改
  - `historyYears[-1] == premiumYear`：9 月更新 fixture 后，如果忘了改 `meta` 里写死的年份，这条会失败
- **维护页是构造的**：拿不到真实的维护页，所以模拟成带 inline CSS 的 HTML。正因为带 CSS，测出了 locations 返回 500 的问题
- **locations 返回 500 单独修复**（用户选）
  - 原因：`raw.find("{")` 找到的是 CSS 里的大括号，`json.loads` 抛错
  - 修复：捕获 `ValueError`，按空结果处理
- **HTTP 测试同时覆盖两个入口**
  - 状态码映射在 `api.handler` 和 `server.py` 里各有一份（#17），只测一边会漏
  - 客户端用 `http.client` 而不是 urllib，避免受代理环境变量影响
- **状态码映射没有抽成公共函数**：每条改动只在两个 handler 里各改一两行，遵循不顺手重构；等 #17 统一入口时一起处理
- **#18 用 `HTTPStatus` 短语作为响应体**
  - 不需要维护文案表，前端也不读 `error` 字段
  - 404/502 只记一行 warning：避免爬虫扫 `/api/*` 时刷出大量 traceback
- **#15 直接移除内存缓存**（用户选）
  - 线上成功响应仍有 CDN `s-maxage=3600`
  - 上游很快（一页约 0.35 秒），本地开发每次计算多等这些时间
  - 内存无上限和「502 持续」两个问题一起解决
- **#9 只记 savings 一侧的缺失**：缺失时数据会悄悄变空的正是这一侧；每次请求最多两行日志

## 遗留问题与下一步

- **每年 9 月**：重跑 `python3 -m tests.make_fixtures`，按新数据修正写死的断言（年份、KPT 空档等）；同时按评审 #14 更新 `premiumYear`
- **savings 的「参照方案」分支没有覆盖**：请求带 insurer/plan 时表头有 10 列以上，会走另一套列号。前端目前不传这两个参数，所以没有存这种 fixture
- **上游 HTTP 错误和网络错误仍返回 500**：语义上更接近 502。由于不带缓存头，不会被 CDN 缓存，影响不大
- **日志用 root logger 的默认格式**（`WARNING:root:...`），在 Vercel 上的展示效果没有实测
- **日志里有完整的请求路径和查询参数**（含 `yob`、`location_id`）。目前看来可以接受；如果在意，可以只记 path
- **顺带发现的小问题（未处理）**
  - change 页表头里的 `&shy;` 实体没有被 `clean_text` 清掉（它只处理 `­` 字符）。这个表头没被使用，不影响结果
  - `/tmp/priminfo-verify/scripts/smoke.js` 里的 `locations` 计数始终为 0：`state` 不是 window 属性，这是脚本自身的问题
- **评审中仍未处理**：#16（死接口没有空结果检查）、#17（两套入口重复）
- **上次 session 遗留，本次未处理**：失败后表单和数据不一致、Toast 文案不区分错误类型、只勾 PHARM 时部分区块停在旧画面、`~/projs/playground/AGENTS.md` 待删除、仓库尚未 push。详见 `261025-session-p0-fixes.md`
- **下一步**：按评审建议做 #11–#12（前端模块拆分与按需渲染）。#17 统一入口后，可以去掉两处重复的状态码映射
