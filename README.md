# FrontMind publish

Public business source and standalone UI for [publish.frontmind.cn](https://publish.frontmind.cn).

## Local preview

Use Node.js 22 and pnpm 10.4.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Local preview uses synthetic fixtures and labels them as preview data. It does not connect to test databases or paid providers. The same module/client components are built into the real development domain. Live persistence, jobs, files and provider execution require its private Core runtime.

Business code and dependencies belong in module/. The independent entry, root Vite settings and root shell dependencies also participate in the development-domain build. Only module/ synchronizes into the private main repository. vendor/ is a reviewed version from main; request shared changes there.

Open the development domain through the configured browser gateway; no product login or tenant selection belongs in this standalone shell. Gateway credentials and deployment settings are supplied privately and never committed here.

## Capability and handoff guide

Read [CAPABILITIES.md](CAPABILITIES.md) for source coverage, checks actually performed, known limitations and provider operations that remain unverified. Use [PRO_GUIDE.md](PRO_GUIDE.md) for the exact-baseline ZIP format. Repository main can be newer than the deployed image; export the current `/api/version` baseline before each Pro round.

## Shared Dashboard presentation

The standalone app uses the original Dashboard sidebar, tabs, layout, and controls from vendor/module-ui. It only filters navigation to this business module. Keep business page and style changes in module/client so source synchronization brings them back to Dashboard. standalone/ only supplies runtime adapters and independent inputs; it is not merged into production. Shared shell changes are maintained in main and sent to vendor.

## 完整供应商 API 开发

KOL 的认证、媒体目录、报价相关数据、订单提交和结果解析实现已位于 [module/server/providers/kol](module/server/providers/kol/README.md)。可以自行增加供应商 API、修改后端和前端，再通过 delivery skill 发布到本模块子域名。

只在子域名测试时，成员无需获取或配置 Key；服务器自动注入现有凭据。API 代码必须在服务端运行。新增功能的具体步骤见上述目录说明。只读联通验证入口：`/api/monitoring/trpc/publisher.provider.checkConnection`（需开发门禁，只读取媒体目录，不创建订单）。
