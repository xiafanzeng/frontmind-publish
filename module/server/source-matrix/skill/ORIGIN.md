# 来源与版本

上游：用户提供的 source-matrix-planner-excel-ranked-20261026.zip。
上游 ZIP SHA-256：495d2ddd6d995f09c9bc514aeb3128dbcc1a6960c39ae789065e9f432f761b9f。

版本：2026.11.08-web.2。准确网站输入基线为 868db40a79c3527cca6ab9b94483dff4b6ae7a1c。保留已合并的内容篇数、报价规划、排序、目标平台和导入研究能力；本轮修订 canonical 行业同源连接、可选本地富化及任务回放规则，并纠正旧文档中无上传入口的说明。网站实际修改包含在同轮 pro-update.zip，Skill 全量包单独交付。离线 Python 和历史产物不改写为本轮运行结果。

本轮参考附件source-matrix-planner-20261026.zip的SHA-256为69df6cfdad43266b6660654c87cf0a16fb5474d52d351c4efabe8d660d68619c。只读比较其中47个skill条目：去CR并去尾部空白后的文本仅assets/preview.css内容不同；逐字节比较另有换行/尾部空白差异，不宣称仓库逐字节仅一项不同。未执行附件脚本，未复制其虚构媒体、报价或旧运行状态作为真实数据。

网站入口为 module/server/source-matrix/http.ts，运行原生 TypeScript，不启动 Python 子进程。本轮独立 Skill 包不包含 website-runtime/；网站代码使用同轮 pro-update.zip，与本目录的规则一并合并。Python scripts/planner.py、export_adapter.py、content_planning.py 继续服务已有离线接口。

demo/skill-original、demo/outputs 和旧一航保存结果属于历史归档，未改写为本版结果。上游例子、虚构报价和旧测试报告均不构成本版真实运行证明。

打包清单补入 references/platform-industry-context.md，防止后续使用内置打包器遗漏 SKILL.md 引用的核心网站规则；对应打包测试源码同步，尚未执行。

本轮未执行运行验证，交由智谱 ZCode 和网站验收。
