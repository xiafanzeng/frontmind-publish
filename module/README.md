# FrontMind 媒体发布模块

- Public 仓库：<https://github.com/xiafanzeng/frontmind-publish>
- 维护子域名：<https://publish.frontmind.cn/>
- 同步映射：子仓 `module/` ↔ 主仓 `modules/publish/`。

## 代码入口

- `client/`：稿件、媒体库、发布工作台与订单结果页面。
- `server/`：业务 API、媒体和订单持久化、报价与资金事务。
- `server/providers/kol/`：完整服务端供应商 API 客户端，包含鉴权、目录分页、
  订单提交和查询、响应解析、有限 GET 重试及错误处理。
- `worker/`：目录同步、稿件导入、发布、状态轮询及素材处理。
- `schema/`：模块业务数据结构。

供应商 API 真实实现属于本模块，可以直接修改并随子仓发布。主仓旧 provider
包只做兼容导出。业务凭据由服务器注入，团队不需要获取 key，也不把 key 放进
前端、GitHub 或 Pro ZIP。详细说明见 [API 开发指南](server/providers/kol/README.md)。

## 开发与验收

在公开子仓根目录使用 Node.js 22、pnpm 10.4.1：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

本地预览使用合成数据；模块测试使用 fake fetch，不会发起付费请求。真实目录、
保存和后台任务在维护子域名验收。修改供应商逻辑后，用 delivery Skill 发布
子域名的 API/worker，再验证对应流程；代码 push 成功不等于线上已更新。

主仓提供身份、租户、账务基础能力、对象存储及跨模块连接。独立壳 `standalone/`
不回灌主仓，`vendor/` 共享组件由主仓维护。保持未涉及的侧栏、字体、弹窗与
现有业务流程，避免接口修改与页面风格变化混在一次交付里。
