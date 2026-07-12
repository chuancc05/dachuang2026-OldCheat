# ADR-0001：故事变体采用内置种子与站点级对象存储双层架构

## Status

Accepted

## Context

OldCheat 的 Next.js 前端部署在 Netlify。服务器本地文件与 SQLite 在无状态运行环境中不能作为可靠的线上写入存储，但故事变体是一个规模很小、整体读取、低频写入的内容集合。训练主流程还必须在网络、模型或存储异常时继续工作。

## Decision

采用三层读取优先级：站点级 Netlify Blobs 覆盖数据、随部署发布的内置种子变体、原有 Scenario script。线上用单个 JSON 文档保存覆盖集合并启用 strong consistency；本地开发写入 `.data/story-variants.json`。所有层使用同一个校验器。普通训练只读取启用变体，写入与读取停用内容需要 `STORY_VARIANT_ADMIN_TOKEN`。

## Consequences

### Positive

* 线上写入可以跨部署保留。
* 存储失效时不影响原训练主流程。
* 数据量和运维复杂度与当前项目规模匹配。
* 无需迁移现有 Python SQLite 业务表。

### Negative

* 本地覆盖与线上覆盖是不同环境，需要明确提示。
* 单文档写入不适合高并发编辑；V1 只面向少量内部维护人员。
* 新增一个 Netlify SDK 依赖和管理密钥配置。

### Neutral

* 浏览器防重复历史仍保存在本地，不建立跨设备用户账户。

## Alternatives Considered

* **仅修改仓库 JSON**：安全稳定，但不能通过线上管理页面即时维护。
* **复用 `data/data.db` SQLite**：适合本地 Gradio，不适合 Netlify 无状态线上写入。
* **新增 PostgreSQL**：能力充分，但对低频小数据集成本和运维过高。
* **完全由模型生成**：新鲜度高，但一致性、安全性与可测试性不足。

## References

* `docs/prd/PRD-STORY-VARIANTS-V1.md`
* Netlify Blobs site-scoped store documentation

