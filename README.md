# ZYwindsurf-tool

Windsurf 账号管理工具，支持多账号管理、一键切号、积分查询、批量获取 Token 等功能。

适用于 **Mac** / **Windows** | **完全开源** | 本地运行 | 无后端服务器

**本工具不收集任何用户数据**，所有账号信息仅存储在您的本地设备上。

## 主要功能

- **账号管理**：添加、删除、批量导入账号
- **一键切号**：快速切换当前使用的 Windsurf 账号
- **积分查询**：查看账号积分、今日已用、使用率、到期时间
- **Token 获取**：支持最多 20 个账号并发登录获取 Token
- **数据刷新**：一键刷新所有账号的订阅/积分/到期时间等信息
- **代理支持**：支持配置 HTTP/HTTPS 代理

## 运行

```bash
pnpm install
pnpm start
```

## Token 获取原理

Token 有效期约 1 小时，认证流程如下：

```
用户输入邮箱密码
        ↓
调用 Firebase 官方认证 API（通过 Cloudflare Workers 中转，解决国内访问问题）
        ↓
获取 Firebase idToken
        ↓
调用 Windsurf 官方 API: register.windsurf.com
        ↓
获取 API Key (Token)
```

- **Firebase 登录**：使用 Windsurf 官方的 Firebase API Key 进行身份验证
- **Cloudflare Workers 中转**：仅解决国内无法直接访问 Firebase 的问题，不存储任何数据
- **获取 API Key**：使用 Firebase 返回的 idToken 调用 Windsurf 官方接口 `RegisterUser`

核心代码：`js/accountLogin.js`

## 关于中转服务器

代码中使用了 Cloudflare Workers 中转服务（`js/constants.js`）。

**中转服务器只做**：转发登录请求到 Firebase 官方 API，原样返回 Token。**不存储任何账号信息，不记录日志。**

如果不信任中转服务器，可以：
1. 自行部署 Cloudflare Workers
2. 修改 `js/constants.js` 中的 `WORKER_URL` 为自己的地址
3. 使用 VPN 直连 Firebase

## 数据安全

- **本地存储**：账号数据存储在 `%APPDATA%/windsurf-tool/`（Windows）或 `~/Library/Application Support/windsurf-tool/`（Mac）
- **无远程服务器**：不上传任何用户数据
- **开源透明**：所有代码公开，可自行审查

## 免责声明

本项目仅供学习和研究使用，不得用于商业用途。

- 使用本工具所产生的一切后果由使用者自行承担
- 本项目与 Codeium / Windsurf 官方无任何关联
- 使用本工具可能违反 Windsurf 的服务条款，请自行评估风险

## License

MIT License
