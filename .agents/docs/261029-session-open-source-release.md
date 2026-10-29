# 261029 session：正式开源到 maxing-labs

## 目标

补充中英文 README、高清桌面端截图、姊妹项目双向互链，并将仓库发布到 GitHub 组织 `maxing-labs/swiss-insurance-compare`。

## 完成内容

- `186e1c4`：
  - 新增 `docs/screenshot.png`（01 保费排名与核心指标）与 `docs/screenshot-curves.png`（02 免赔额盈亏平衡曲线），由无头 Chromium 在 1280×860 @ 2x Retina 视口下对生产环境实拍
  - 新增 `README-zh.md` 中文说明，并在 `README.md` 与 `README-zh.md` 顶部加入中英文切换及姊妹项目 `Swiss Tax Compare`（线上与 GitHub `maxing-labs/swiss-tax-compare`）互链
  - `.gitignore` 补上 `.DS_Store`
- 创建公开仓库并推送：`https://github.com/maxing-labs/swiss-insurance-compare`

## 关键决策及原因

- **放在 `maxing-labs` 组织下（用户选）**：统一归入 `maxing-labs/swiss-insurance-compare` 与 `maxing-labs/swiss-tax-compare`，与线上域名同名
- **默认英文 `README.md` + 独立 `README-zh.md`（用户选）**：面向国际/瑞士本地社区默认展示英文，同时方便中文读者阅读

## 遗留问题与下一步

- 后续可按需添加 GitHub Actions 跑离线单测，或撰写系列总结文章
