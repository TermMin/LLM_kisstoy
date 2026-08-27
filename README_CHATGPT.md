# Kisstoy Multi-device MCP Server

一个安全优先的 TypeScript MCP Server，让 ChatGPT 或其他 MCP 客户端通过 Kisstoy 的远程 WebSocket 会话控制多个已识别设备。

默认运行在 **dry-run** 模式：状态和设备能力查询会访问真实服务，但任何电机控制只返回计划结果，不会驱动设备。

## 已实现的工具

| 工具 | 作用 | 是否驱动物理设备 |
| --- | --- | --- |
| `get_device_status` | 查询会话和设备在线状态 | 否 |
| `get_device_capabilities` | 查询电机类型和安全上限 | 否 |
| `identify_device_link` | 从分享链接识别设备及其通道策略，不保存链接 | 否 |
| `switch_device_link` | 安全停止旧目标并在内存中切换到新分享链接 | 仅在旧目标 live 时发送停止 |
| `arm_control` | 在明确确认成年和佩戴者同意后启动授权控制会话 | 否 |
| `set_secondary_thrust` | 控制顶部通道；网页标为“震动”，实际语义为“二次抽插” | 仅 live 模式 |
| `set_suction` | 控制 Cathy III 顶部“吮吸”通道 | 仅 live 模式 |
| `set_thrust` | 控制底部通道；网页和实际语义均为“抽插” | 仅 live 模式 |
| `stop_all` | 立即停止全部电机，无需控制令牌 | 仅 live 模式 |
| `disarm_control` | 停止设备并销毁控制令牌 | 仅 live 模式 |

控制协议把强度量化为 5 的倍数。默认最高强度为 100、最长单次动作 300 秒、每分钟最多 20 条动作命令。

## 已识别设备与控制策略

| `device_id` | 设备 | 顶部通道 | 底部通道 |
| --- | --- | --- | --- |
| `18` | 突突二代 / TUTU II (`QCTT`) | 页面“震动”→ 实际“二次抽插”→ `set_secondary_thrust` | “抽插”→ `set_thrust` |
| `17` | Cathy III (`KX02`) | “吮吸”→ `set_suction` | “抽插”→ `set_thrust` |

当用户在对话中提供新的 Kisstoy 分享链接时，LLM 应先调用 `identify_device_link`，再调用 `switch_device_link`。切换会先停止旧目标、断开旧连接并销毁旧授权令牌，然后按链接中的 `device_id` 自动选择设备档案。分享链接只保存在当前进程内存中，不会由工具回显或写回 `.env`；服务重启后恢复使用 `.env` 中的默认链接。

## 安装

需要 Node.js 20 或更高版本。

```bash
pnpm install
pnpm build
```

复制配置模板：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`，把 `KISSTOY_REMOTE_URL` 替换为 App 新生成的完整远程控制链接。该链接包含控制凭据，不要提交到 Git、聊天记录或日志。

## 安全地启动

首次启动保持：

```dotenv
KISSTOY_LIVE_CONTROL=false
```

启动 Streamable HTTP MCP：

```bash
pnpm start
```

默认地址为 `http://127.0.0.1:3000/mcp`，健康检查为 `http://127.0.0.1:3000/health`。

本地 stdio 模式：

```bash
pnpm start:stdio
```

## 连接 ChatGPT

本地测试推荐使用 Secure MCP Tunnel，把本机 `/mcp` 端点连接到 ChatGPT Developer mode；也可以部署到稳定的公网 HTTPS 地址。公网端点必须使用 Streamable HTTP，通常路径为 `/mcp`。

在 ChatGPT 中：

1. 打开 **Settings → Security and login → Developer mode**。
2. 在 Plugins 页面添加 MCP 连接。
3. 选择 Secure MCP Tunnel，或输入公网 HTTPS `/mcp` 地址。
4. 检查工具列表和安全标注，然后在新对话中启用该连接。

公网测试可设置 `MCP_BEARER_TOKEN`；正式发布建议实现 OAuth 2.1，不要只依赖静态 Bearer Token。绑定到 `0.0.0.0` 且启用 live 控制时，本服务会拒绝在没有 Bearer Token 的情况下启动。

## Windows 一键启动

项目根目录提供四个可以双击运行的脚本：

| 脚本 | 作用 |
| --- | --- |
| `start-live.cmd` | 要求输入 `LIVE` 确认后，在后台启动真实控制服务 |
| `start-dry-run.cmd` | 在后台启动 dry-run 服务，不会驱动设备 |
| `status-kisstoy.cmd` | 查询当前服务和设备在线状态 |
| `stop-kisstoy.cmd` | 先调用 `stop_all`，再验证并关闭后台进程 |

远程链接存放在 Git 已忽略的 `.env` 中，不会写入启动脚本。更换链接时只需编辑 `.env`。运行日志和 PID 保存在同样被忽略的 `.runtime` 目录。

`start-live.cmd` 启动后，不要直接在任务管理器中结束 Node 进程；使用 `stop-kisstoy.cmd`，确保先发送紧急停止。

### 在另一个 Codex 或 ChatGPT Desktop 对话中使用

项目已经包含 `.codex/config.toml`，其中注册了 `kisstoy_devices`：

1. 双击 `start-live.cmd`，输入 `LIVE`。
2. 在 Codex/ChatGPT Desktop 中以本目录作为受信任项目，重新打开或新建任务。
3. 输入 `/mcp` 或打开 MCP 工具列表，确认 `kisstoy_devices` 已连接。
4. 在新对话里先查询状态，再明确确认成年和当前佩戴者同意，最后调用 `arm_control`。这也是该控制会话唯一一次确认。

项目配置为仅 `arm_control` 请求确认；授权会话有效期内，`set_secondary_thrust` 和 `set_thrust` 不再逐条请求确认。新的 `arm_control` 会使之前的控制令牌失效，因此同一时间只有最后解锁的对话能继续发送动作；`stop_all` 始终可用。修改 `.codex/config.toml` 后需要重新打开 Codex 任务或重启客户端才能加载新审批策略。

ChatGPT Web 不读取本地 `.codex/config.toml`。Web 对话需要先通过 Secure MCP Tunnel 或公网 HTTPS `/mcp` 建立插件连接，然后在每个新对话的工具菜单中加入该连接。

## 启用真实控制

只有在 dry-run 验证完成、当前设备佩戴者明确同意后，才把配置改为：

```dotenv
KISSTOY_LIVE_CONTROL=true
```

推荐操作顺序：

1. 调用 `get_device_status`，确认设备在线。
2. 用户明确确认成年并确认当前佩戴者同意。
3. 调用 `arm_control`，获得默认有效 1 小时的 `control_token`；这是该控制会话唯一一次确认。
4. 在授权会话有效期内，按 `get_device_status` 返回的 `channels[].mcp_tool` 调用 `set_secondary_thrust`、`set_suction` 或 `set_thrust`，无需重复确认。
5. 随时可调用 `stop_all`；结束时调用 `disarm_control`。

每次非零动作都会创建本地自动停止计时器。进程收到 `SIGINT` 或 `SIGTERM` 时也会尝试执行安全停止。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KISSTOY_REMOTE_URL` | 必填 | App 生成的完整远程控制链接 |
| `KISSTOY_LIVE_CONTROL` | `false` | 是否实际发送控制消息 |
| `KISSTOY_MAX_INTENSITY` | `100` | 允许的最大强度，必须是 5 的倍数 |
| `KISSTOY_MAX_DURATION_MS` | `300000` | 单次动作最长持续时间（300 秒） |
| `KISSTOY_ARM_TTL_SECONDS` | `3600` | 授权控制会话有效期（秒，默认 1 小时） |
| `KISSTOY_MAX_COMMANDS_PER_MINUTE` | `20` | 每分钟动作限流 |
| `MCP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `MCP_PORT` | `3000` | HTTP 监听端口 |
| `MCP_BEARER_TOKEN` | 空 | 可选的 HTTP Bearer Token |
| `MCP_ALLOWED_HOSTS` | `*.trycloudflare.com` | 逗号分隔的 Host allowlist；支持仅位于开头的 `*.` 子域通配符，本机 Host 始终允许 |

`KISSTOY_BINDING_ID` 会从远程链接解析，但当前版本不会自动调用网页中的 binding POST 接口，因为该接口会改变远程链接状态。若新链接尚未激活，可先在官方网页中打开一次，再交给 MCP 使用。

## 测试

```bash
pnpm test
```

测试覆盖配置防护、凭据脱敏、分享链接设备识别与安全切换、设备专属通道策略、成年/同意门槛、令牌过期、限流、强度限制、dry-run 隔离，以及通过内存 MCP 传输完成完整工具调用。

## 重要限制

- 这是基于公开网页前端协议实现的非官方客户端，服务端协议可能随时变化。
- 远程链接中的 `group` 实际上是能力凭据；泄露后应立即在 App 中重新生成链接。
- 不要把该 MCP 提供给未成年人，也不要在佩戴者不知情或未同意时使用。
- 自动停止依赖 MCP 进程和网络。佩戴者必须能够直接关闭设备，并保留物理紧急停止手段。
