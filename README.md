# 广大课表 · AI 中转站

独立于「蜜薯小窝」的轻量中转服务：Cloudflare Pages Functions，把 App 的 AI 请求转发到智谱
（`open.bigmodel.cn`），API Key 只存在 Cloudflare 环境变量里，客户端零凭据。

- 路由：`POST /api/ai/chat/completions`（App 端 Base URL 配 `https://<域名>/api/ai`）
- 健康检查：`GET /api/ai/healthz` → `{ ok, configured, ts }`；App 端只在可达时允许使用 AI

## 部署（Cloudflare Pages，约 2 分钟）

1. Cloudflare 控制台 → Workers 和 Pages → 创建 → Pages → 连接到 Git → 选择本仓库。
2. 构建配置：框架预设选 **None**，构建命令留空，输出目录留空（本项目只有 Functions，无静态资源）。
3. Settings → 环境变量，添加：
   - `ZHIPU_API_KEY`（**密钥类型**，值=你的智谱开放平台 Key）
   - 可选 `ALLOWED_MODELS`（默认 `glm-4.7-flash`）、`ALLOWED_ORIGINS`（默认含 Capacitor 本地来源）
4. 保存后重新部署一次（环境变量在下次部署生效）。
5. 测健康：浏览器打开 `https://<项目>.pages.dev/api/ai/healthz`，看到 `{"ok":true,"configured":true}` 即成功。

## 安全设计

| 风险 | 对策 |
| --- | --- |
| Key 被反编译 APK 拿走 | Key 只在 CF 环境变量，客户端零凭据 |
| 被刷付费模型欠费 | 模型白名单，名单外自动替换为免费 `glm-4.7-flash` |
| 被当开放代理 | 只服务 `/api/ai/*`；IP 限流 20 次/分；请求体 ≤1MB |
| SSRF / 内网探测 | 上游是代码字面量常量（智谱官方 https），无运行时可变目标 |
| 跨站盗刷 | CORS 回显白名单来源，不用 `*` |
| 超大 token 消耗 | 上游请求 max_tokens 上限 4096 |

## 国内网络说明

`*.pages.dev` 在部分校园网/运营商网络下可能不可达或较慢。若你的用户主要在国内，建议在
Cloudflare 给本项目**绑定一个自定义域名**（Pages → 自定义域），国内解析通常比 pages.dev 稳定；
客户端已支持多地址自动探测，绑定后把新地址加进 App 的候选列表即可。

## 备用部署（自托管 Node）

不需要 Cloudflare 时，可把 `GZHU-Schedule` 仓库 `relay/server.js` 丢到任意 Node 主机：
`ZHIPU_API_KEY=xxx node server.js`，然后把 App 的 Base URL 指向它。
