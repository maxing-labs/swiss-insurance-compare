# 261029 session：Priminfo Pro 改名为 Swiss Insurance Compare

## 目标

用户要求把文件夹和项目从 priminfo-pro / Priminfo Pro 改名为 Swiss Insurance Compare，和 Vercel 项目名、线上域名 swiss-insurance-compare.vercel.app 以及姊妹站 swiss-tax-compare 保持一致。

## 完成内容

- 目录 `26Q4/26q4-swiss-official-site-wrappers/priminfo-pro` → `swiss-insurance-compare`（整个仓库连同 `.git`、`.vercel` 一起 `mv`）。Vercel 项目本来就叫 `swiss-insurance-compare`，不用改
- `92b3bdf` 显示名改为 Swiss Insurance Compare：`README.md`、`AGENTS.md`、`server.py`、`static/index.html`（title、meta description、h1、页脚、About 标题）、`i18n/{en,de,zh}.js` 的 `docTitle` / `appTitle` / `aboutTitle`
  - 同一提交改了 `static/style.css`：标题变长后在手机上会和右侧按钮重叠。≤768px 时 h1 允许换行（折成两三行），≤359px 时 header 按钮换到第二行
- 外部引用：`../AGENTS.md`（26q4 总览）、`../swiss-tax-compare/AGENTS.md` 和其 `roadmap.md` 里的 `priminfo-pro` 改为 `swiss-insurance-compare`
- 测试：`python3 -m unittest` 23 项通过，`node --test 'tests/js/*.test.mjs'` 33 项通过，e2e 本地和线上各 18 项通过；320 / 360 / 414 / 1280px 截图检查过 header 和 About 弹窗
- 部署：`dpl_9yPn6P74BomPGMb5EAw4ahWtJ8X3`（production，Ready）。回滚目标是上一个 production 部署 `dpl_FRWGuKpDhHacDauzhKNW3wqhLjE2`

## 关键决策及原因

- **localStorage key 不改**（仍是 `priminfo_pro_profiles_v2` / `priminfo_pro_active_state_v2`）：改了会让已有用户的家庭档案丢失。要改的话得加一段从旧 key 迁移的代码
- **历史 session 记录不改**：里面的 `priminfo-pro` 路径是当时的事实
- **`bak.more-vibes/` 里的引用不改**：按 26q4 总览 AGENTS.md，归档项目不顺手修改
- 手机端 header 选「标题换行」而不是「按钮整体换行」：360px 以上 header 只高约 24px，标题像堆叠的 logo；只有 360px 以下才让按钮换行

## 遗留问题与下一步

- Paseo 工作区如果登记过旧路径，需要用户自己更新
- `/tmp/priminfo-consist/e2e.sh` 里的 `cd` 路径已改成新目录
- 将来建 GitHub 仓库时用新名字（之前记录里写的是 `X-Wei/priminfo-pro`）
