# Source Matrix Planner 2026.10.26-web.1

先阅读 SKILL.md。上游及改动边界见 ORIGIN.md。运行依赖仍按 requirements.txt / requirements-excel.txt，网站使用同源 TypeScript，没有新增 Python 或 npm 依赖。

保留：scripts/planner.py（结构化 matrix/budget）、scripts/export_adapter.py（Excel 研究）、scripts/render_preview.py（离线快照）。新增 scripts/content_planning.py：读取可信矩阵和目录，复核 AI 提出的不同新稿/同稿重复篇数及费用，输出非执行 content_plans。字段和调用见 references/content-planning.md。

网站同源运行代码位于独立交付 ZIP 的 website-runtime/module/。它对应业务仓库实际入口，并有散列清单。scripts/build_package.py 打包 Python Skill 及本版全部规则/测试；完整网站运行快照由项目交付打包器从真实 module/ 源码直接收集，避免维护副本。

本轮仅编辑、阅读自查、打包；未执行生成、项目或 Skill 测试、构建、业务调用。ZCode 需实际验证后再记录结果。
