# 🚀 Quick Deployment Guide

快速部署 ProxyFAQs 到 Cloudflare Pages

## ⚡ 快速开始 (5分钟)

### 步骤 1: 初始化 Git 并提交代码

```bash
# 已完成 - Git 已初始化
git add .
git commit -m "Initial commit: ProxyFAQs with 723 articles"
```

### 步骤 2: 创建 GitHub Repository

**选项 A: 使用 GitHub CLI** (推荐)

```bash
# 使用当前认证的 GitHub 账号
GITHUB_USER=$(gh api user -q .login)
echo "Creating repo for user: $GITHUB_USER"

# 创建 repository
gh repo create proxyfaqs --public \
  --description "ProxyFAQs - The Stack Overflow for Proxies" \
  --homepage "https://proxyfaqs.com"

# 添加远程仓库
git remote add origin "https://github.com/$GITHUB_USER/proxyfaqs.git"
```

**选项 B: 手动创建**

1. 访问 https://github.com/new
2. Repository name: `proxyfaqs`
3. Description: `ProxyFAQs - The Stack Overflow for Proxies`
4. 设为 Public
5. 点击 "Create repository"
6. 复制远程仓库 URL 并添加:

```bash
git remote add origin https://github.com/YOUR_USERNAME/proxyfaqs.git
```

### 步骤 3: 推送代码到 GitHub

```bash
git branch -M main
git push -u origin main
```

### 步骤 4: 设置 GitHub Secrets

访问你的 repository → Settings → Secrets and variables → Actions

点击 "New repository secret" 添加以下 secrets:

| Name                    | Value                        |
| ----------------------- | ---------------------------- |
| `CLOUDFLARE_API_TOKEN`  | `your-cloudflare-api-token`  |
| `CLOUDFLARE_ACCOUNT_ID` | `your-cloudflare-account-id` |
| `SITE_URL`              | `https://proxyfaqs.com`      |
| `PUBLIC_SITE_URL`       | `https://proxyfaqs.com`      |

**使用 CLI 设置 (更快):**

```bash
# 获取当前 repo 名称
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# 设置 secrets (replace with your actual tokens)
echo "YOUR_CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN -R $REPO
echo "YOUR_CLOUDFLARE_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID -R $REPO
echo "https://proxyfaqs.com" | gh secret set SITE_URL -R $REPO
echo "https://proxyfaqs.com" | gh secret set PUBLIC_SITE_URL -R $REPO

# 验证 secrets
gh secret list -R $REPO
```

### 步骤 5: 在 Cloudflare 创建 Pages Project

**选项 A: 使用 Cloudflare Dashboard**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 选择你的账户
3. 点击 "Pages" → "Create a project"
4. 点击 "Create using Direct Upload"
5. Project name: `proxyfaqs`
6. 点击 "Create project"

**选项 B: 使用 wrangler CLI**

```bash
# 安装 wrangler (如果还没安装)
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 Pages project
wrangler pages project create proxyfaqs
```

### 步骤 6: 触发首次部署

GitHub Actions 会自动部署。你也可以手动触发:

```bash
# 查看 workflow 运行状态
gh workflow list
gh run list --workflow=deploy.yml

# 手动触发部署
gh workflow run deploy.yml
```

## 🎉 完成!

你的网站将在几分钟内部署到:

- **Production**: https://proxyfaqs.com (配置好 DNS 后)
- **Cloudflare URL**: https://proxyfaqs.pages.dev

## 📊 检查部署状态

```bash
# 查看最新的 workflow 运行
gh run list --limit 5

# 查看特定运行的日志
gh run view --log

# 在浏览器中查看 Actions
gh repo view --web
```

## 🔄 后续部署

每次推送到 `main` 分支都会自动触发部署:

```bash
git add .
git commit -m "Update content"
git push
```

## 🔧 手动部署 (可选)

如果你想跳过 CI/CD 直接部署:

```bash
# 构建网站
bun install
bun run build

# 部署到 Cloudflare Pages
npx wrangler pages deploy dist --project-name proxyfaqs
```

## 📝 配置自定义域名

1. 在 Cloudflare Dashboard → Pages → proxyfaqs → Custom domains
2. 点击 "Set up a custom domain"
3. 输入 `proxyfaqs.com`
4. 按照指引配置 DNS (通常自动完成)

## 🐛 故障排除

### 部署失败: "Unauthorized"

检查 Cloudflare API Token:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/tokens/verify" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### GitHub Actions 无法访问 secrets

确保 secrets 设置在正确的 repository:

```bash
gh secret list
```

### 构建失败: Missing dependencies

在 Cloudflare Pages Dashboard 检查构建设置:

- **Build command**: `bun run build`
- **Build output directory**: `dist`
- **Root directory**: `/` (or `/front` if in monorepo)

## 🔗 相关链接

- [完整部署文档](./DEPLOYMENT.md)
- [GitHub Repository](https://github.com/YOUR_USERNAME/proxyfaqs)
- [Cloudflare Pages Dashboard](https://dash.cloudflare.com)
- [GitHub Actions](https://github.com/YOUR_USERNAME/proxyfaqs/actions)

---

需要帮助? 查看 [DEPLOYMENT.md](./DEPLOYMENT.md) 获取详细说明。
