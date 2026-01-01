# ProxyFAQs Deployment Guide

This guide explains how to securely deploy ProxyFAQs to Cloudflare Pages using GitHub Actions.

## 🔒 Security First

**CRITICAL**: Never commit sensitive information to git!

- ✅ Use GitHub Secrets for all credentials
- ✅ Use `wrangler.toml.example` as template
- ❌ Never commit `wrangler.toml` (already in `.gitignore`)
- ❌ Never hardcode API keys or passwords

## 📋 Prerequisites

1. GitHub account
2. Cloudflare account
3. Cloudflare API Token with Pages permissions

## 🚀 Setup GitHub Secrets

Go to your repository settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

### Required Secrets

| Secret Name             | Description           | Example Value                |
| ----------------------- | --------------------- | ---------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token  | `your-cloudflare-api-token`  |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | `your-cloudflare-account-id` |

### Optional Secrets (for database access during build)

| Secret Name       | Description       | Default                 |
| ----------------- | ----------------- | ----------------------- |
| `DB_HOST`         | Database host     | -                       |
| `DB_PORT`         | Database port     | `5432`                  |
| `DB_NAME`         | Database name     | `postgres`              |
| `DB_USER`         | Database user     | `postgres`              |
| `DB_PASSWORD`     | Database password | -                       |
| `DB_SCHEMA`       | Database schema   | `proxyfaqs`             |
| `SITE_URL`        | Production URL    | `https://proxyfaqs.com` |
| `PUBLIC_SITE_URL` | Public site URL   | `https://proxyfaqs.com` |

## 📝 Step-by-Step Setup

### 1. Create GitHub Repository

```bash
cd front
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/affiliateberry/proxyfaqs.git
git push -u origin main
```

### 2. Add GitHub Secrets

Using GitHub CLI (recommended):

```bash
# Set Cloudflare credentials (replace with your actual values)
gh secret set CLOUDFLARE_API_TOKEN --body "YOUR_CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "YOUR_CLOUDFLARE_ACCOUNT_ID"

# Set site URLs
gh secret set SITE_URL --body "https://proxyfaqs.com"
gh secret set PUBLIC_SITE_URL --body "https://proxyfaqs.com"
```

Or manually via GitHub web interface:

1. Go to repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret from the table above

### 3. Verify Cloudflare Token

Test your token:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/tokens/verify" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

Expected response:

```json
{
  "success": true,
  "result": {
    "status": "active"
  }
}
```

### 4. Create Cloudflare Pages Project

Option A: Via Cloudflare Dashboard

1. Go to Cloudflare Dashboard → Pages
2. Create a new project
3. Name it `proxyfaqs`
4. Skip the "Connect to Git" step (we'll use GitHub Actions)

Option B: Via wrangler CLI

```bash
# Copy template and configure
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your settings (DO NOT commit!)

# Create Pages project
npx wrangler pages project create proxyfaqs
```

### 5. Trigger Deployment

Push to main branch:

```bash
git push origin main
```

Or trigger manually:

```bash
gh workflow run deploy.yml
```

## 🔄 Deployment Workflows

### Automatic Deployments

- **Main branch**: Automatically deploys to production
  - URL: `https://proxyfaqs.com`
  - Trigger: Push to `main`

- **Pull requests**: Creates preview deployment
  - URL: `https://preview-proxyfaqs.pages.dev`
  - Trigger: PR opened/updated
  - Comment with preview URL posted automatically

### Manual Deployment

Trigger workflow manually from GitHub Actions tab or:

```bash
gh workflow run deploy.yml
```

## 🛠️ Local Development with wrangler

```bash
# Copy configuration template
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml (never commit this file!)

# Local preview
npx wrangler pages dev dist

# Deploy manually
npx wrangler pages deploy dist
```

## 🔍 Troubleshooting

### Build fails: "Database connection error"

If your database is not publicly accessible, you have two options:

1. **Pre-generate data** (recommended):

   ```bash
   # On server or with DB access
   bun run scripts/export-static-data.ts
   ```

2. **Use static data files** instead of live DB connection during build

### Deployment fails: "Invalid API token"

1. Verify token has correct permissions
2. Check token hasn't expired
3. Regenerate token in Cloudflare Dashboard → My Profile → API Tokens

### Preview deployment not showing

Check GitHub Actions logs:

```bash
gh run list --workflow=preview.yml
gh run view <run-id> --log
```

## 📊 Environment Variables

Production environment variables are set in:

- GitHub Secrets (for CI/CD)
- Cloudflare Pages Dashboard → Settings → Environment variables

## 🔐 Security Checklist

- [ ] `wrangler.toml` is in `.gitignore`
- [ ] All secrets are in GitHub Secrets (not in code)
- [ ] Cloudflare API token has minimal required permissions
- [ ] Database credentials are not in code
- [ ] `.env` files are in `.gitignore`
- [ ] Repository is private (if needed) or secrets are properly protected

## 📚 Additional Resources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Astro Deployment Guide](https://docs.astro.build/en/guides/deploy/)
