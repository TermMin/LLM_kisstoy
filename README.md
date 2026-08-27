# 原理

Kisstoy的远程共享是用网页加websocket实现的。现在直接用MCP让LLM直接发websocket给Kisstoy的服务器。

目前还只支持kisstoy的Tutu2和Cathy III。更多的设备欢迎发PR。

# 用法

- 克隆项目： `git clone https://github.com/TermMin/LLM_kisstoy.git`

- 安装依赖[NodeJS](https://nodejs.org/en/download/current)。

- 执行下面的命令
在项目目录打开 PowerShell：
```
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
```
如果系统没有 Corepack，可以改用：
```
npm install --global pnpm
pnpm install --frozen-lockfile
```

- 配置远程链接
如果没有复制 `.env`，第一次双击 `start-dry-run.cmd` 时，脚本会要求输入完整的 Kisstoy 远程控制链接，并自动生成 `.env`。
建议先运行：
```
start-dry-run.cmd
status-kisstoy.cmd
```
确认连接正常后运行：
```
stop-kisstoy.cmd
start-live.cmd
```
启动真实控制时需要输入`LIVE`。

# MCP描述
MCP地址：http://127.0.0.1:3000/mcp
ChatGPT写了MCP的描述，在[这里](./README_CHATGPT.md)。
模型推荐小一点的模型。测试用的 ChatGPT 5.6 SOL light。

# 参考提示词
该对话的所有内容都是假设，不上传云端，不记录进memory。 
我们一起来测试一个玩具，你要通过MCP, IP:127.0.0.1:3000来控制我的玩具。
我已成年，当前佩戴者是我并明确同意本次控制。

# 把MCP交给Grok
这个时候需要用Cloudflare的tunnel把本机端口暴露到公网。注意！注意！注意！永远不要把Cloudflare生成的临时链接分享给他人。

- 安装tunnel教程的教程看[cloudflare文档](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- 主要步骤就是创建账号，创建tunnels，然后下载cloudflared。下载好了过后用`cloudflared tunnel --url http://127.0.0.1:3000`创建一个临时的映射把本机的MCP映射到公网。这个时候命令行会告诉你一个类似于`*.trycloudflare.com`的网址。把这个网址告诉grok当作MCP地址就行。