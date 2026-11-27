# 🤖 AI Agent Instructions & Personal Life Context (`happy-magazine-center`)
## 🧠 Personal Life Context Sync (`kenandxx/ob-life-hub`)

本项目已接入个人唯一私密 Obsidian 生活与习惯中枢 **`kenandxx/ob-life-hub`**（订阅领域：`global,magazine,ui,dev`）。**即使オーナー在对话中未主动提醒，所有 AI Agent（Antigravity / Claude Code / Gemini / Codex / Cursor）在每次会话开始时都必须自动执行以下流程**：

1. **开工必读最新个人状态（Turn 1 强制）**：
   - 先读取仓库内的 [`.context/PERSONAL_CONTEXT.md`](.context/PERSONAL_CONTEXT.md)（包含最新的作息死线、个人习惯、UI 3 步分区卡片偏好与近期 `#sync/*` 日常动态）。
   - 若当前环境已授权 `gh` CLI 访问 `kenandxx/ob-life-hub`，开工前运行 `./scripts/sync-life-context.sh pull`（或执行 `gh api repos/kenandxx/ob-life-hub/contents/dist/spokes/happy-magazine-center/PERSONAL_CONTEXT.md -H "Accept: application/vnd.github.raw"`）拉取手机端刚刚上传的秒级最新笔记。
2. **跨项目经验反向回流**：
   - 当在本项目中沉淀出可复用的新习惯、交互偏好或避坑经验时，运行：
     `./scripts/sync-life-context.sh push-insight "新总结的经验或偏好" "global,magazine,ui,dev"`
     将其写回 `ob-life-hub/00-Inbox/quick-notes.md`，自动同步给名下其他所有项目。
