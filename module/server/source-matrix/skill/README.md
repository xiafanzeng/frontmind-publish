# Source Matrix Planner 2026.11.08-web.2

先阅读 SKILL.md。上游及改动边界见 ORIGIN.md。运行依赖仍按 requirements.txt / requirements-excel.txt，网站使用同源 TypeScript，没有新增 Python 或 npm 依赖。

网站平台AI、授权冻结正文、真实行业快照与两种aggregate关联见 references/platform-industry-context.md。该网站增补由原生TypeScript校验，Python离线脚本不自动获得新的全行业引用能力；本轮不运行或改写离线历史产物。

保留：scripts/planner.py（结构化 matrix/budget）、scripts/export_adapter.py（Excel 研究）、scripts/render_preview.py（离线快照）。新增 scripts/content_planning.py：读取可信矩阵和目录，复核 AI 提出的不同新稿/同稿重复篇数及费用，输出非执行 content_plans。字段和调用见 references/content-planning.md。

网站运行代码位于业务仓库 module/，本轮随 pro-update.zip 交付修改文件。独立 Skill ZIP 提供本目录完整内容及文件散列清单，不包含网站运行时或依赖，不能替代 pro-update.zip 的三方合并。scripts/build_package.py 仍用于离线 Python Skill 的打包。网站规则版本与 instructions.ts 的 source-matrix-planner/2026.11.08-web.2 一致；离线脚本不自动取得线上行业数据。

本轮仅编辑、阅读自查、打包；未执行生成、项目或 Skill 测试、构建、业务调用。ZCode 需实际验证后再记录结果。
