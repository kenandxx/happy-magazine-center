# 🤖 AI Agent Instructions & Personal Life Context (`happy-magazine-center`)

## 🧠 Personal Life Context Sync (`kenandxx/ob-life-hub`)

本项目已接入个人唯一私密 Obsidian 生活与习惯中枢 **`kenandxx/ob-life-hub`**（v2.0 `#secret` 极简模式）。**即使オーナー在对话中未主动提醒，所有 AI Agent（Antigravity / Claude Code / Gemini / Codex / Cursor）在每次会话中都必须遵循以下机制**：

1. **开工必读最新个人全量上下文（Turn 1 强制）**：
   - 先读取仓库内的 [`.context/PERSONAL_CONTEXT.md`](.context/PERSONAL_CONTEXT.md)（公开安全级准则）；若已授权 `gh` CLI，在内存中隔空读取 `gh api repos/kenandxx/ob-life-hub/contents/dist/MASTER_CONTEXT.md -H "Accept: application/vnd.github.raw"`（**严禁将私人笔记原文粘贴进公开仓库**）。
2. **全项目共同维护未来新项目灵感池（`05-Projects/IDEA_BACKLOG.md`）**：
   - 开发本项目过程中，一旦对话冒出**适合孵化为未来独立新项目或给其他兄弟仓库复用的新点子**，AI 必须主动运行：
     `./scripts/sync-life-context.sh push-idea "新项目或跨界点子描述"`
     将其直接登记进 `ob-life-hub/05-Projects/IDEA_BACKLOG.md`！
   - 若沉淀出可跨项目复用的新习惯或交互经验，运行：
     `./scripts/sync-life-context.sh push-insight "新总结的习惯或经验" "#it"`
