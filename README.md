# ProxyFAQs 🌐

> The Stack Overflow for Proxies - Vendor-neutral Q&A knowledge platform for proxies and web scraping

[![Deploy to Cloudflare Pages](https://github.com/panopticlick/proxyfaqs/actions/workflows/deploy.yml/badge.svg)](https://github.com/panopticlick/proxyfaqs/actions/workflows/deploy.yml)

## 🚀 Features

- **2,807+ In-depth Articles** - Comprehensive proxy knowledge base
- **8 Categories** - Organized proxy topics
- **Full-text Search** - PostgreSQL-powered semantic search
- **SEO Optimized** - Meta tags, sitemaps, and structured data
- **Static Site** - Fast Cloudflare Pages deployment
- **AI-Generated** - RAG-powered content from 88K+ Google PAA data

## 📊 Content Statistics

| Category            | Articles | Coverage |
| ------------------- | -------- | -------- |
| Scraper API         | 1,194    | 42.5%    |
| Proxy Basics        | 880      | 31.3%    |
| Residential Proxies | 577      | 20.6%    |
| Troubleshooting     | 72       | 2.6%     |
| Mobile Proxies      | 50       | 1.8%     |
| Proxy Providers     | 19       | 0.7%     |
| Proxy Types         | 13       | 0.5%     |
| Datacenter Proxies  | 2        | 0.1%     |

**Total**: 2,807 articles | **Average**: ~1,500 words/article

## 🛠️ Tech Stack

- **Framework**: [Astro](https://astro.build) v4.16 (SSG)
- **Styling**: [Tailwind CSS](https://tailwindcss.com) v3.4
- **Database**: PostgreSQL (Supabase)
- **Search**: PostgreSQL full-text + pg_trgm
- **Deployment**: Cloudflare Pages
- **CI/CD**: GitHub Actions
- **Runtime**: Bun

## 📦 Quick Start

### Prerequisites

- Bun runtime
- PostgreSQL database
- Cloudflare account (for deployment)

### Installation

```bash
# Install dependencies
bun install

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Run database setup
cd ../backend
psql -h localhost -U postgres -d postgres -f db-setup.sql

# Import articles (if data available)
cd ../front
bun run import:articles

# Start dev server
bun run dev
```

Visit `http://localhost:4321`

## 📝 Available Scripts

```bash
bun run dev          # Start dev server
bun run build        # Build for production
bun run preview      # Preview production build
bun run typecheck    # TypeScript checking

# Data import
bun run import:articles   # Import article JSON files
bun run sitemap          # Generate sitemap.xml

# Tests
bun test                 # Run all tests
```

## 🚀 Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deploy to Cloudflare Pages

```bash
# Build site
bun run build

# Deploy
npx wrangler pages deploy dist --project-name proxyfaqs
```

### Automated CI/CD

Push to `main` branch to trigger automatic deployment via GitHub Actions.

## 🏗️ Project Structure

```
front/
├── src/
│   ├── pages/              # File-based routing
│   │   ├── index.astro     # Homepage
│   │   ├── q/[slug].astro  # Question pages (2,807+)
│   │   ├── category/       # Category pages
│   │   └── api/            # Search & chat endpoints
│   ├── components/         # Astro components
│   ├── layouts/            # Layout templates
│   └── lib/                # Utilities & DB client
├── scripts/                # Data import scripts
├── public/                 # Static assets
└── .github/workflows/      # CI/CD workflows
```

## 🔧 Configuration

### Environment Variables

Create `.env` file:

```env
# Database (required for build)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-password
DB_SCHEMA=proxyfaqs

# Site URLs
SITE_URL=https://proxyfaqs.com
PUBLIC_SITE_URL=https://proxyfaqs.com
```

### Database Schema

```sql
-- All tables in proxyfaqs schema
CREATE SCHEMA IF NOT EXISTS proxyfaqs;

-- Main questions table (2,807 rows)
CREATE TABLE proxyfaqs.questions (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE,
  question TEXT,
  answer TEXT,
  answer_html TEXT,
  category TEXT,
  category_slug TEXT,
  search_vector TSVECTOR,
  ...
);

-- Categories, providers, keywords tables
CREATE TABLE proxyfaqs.categories (...);
CREATE TABLE proxyfaqs.providers (...);
CREATE TABLE proxyfaqs.keywords (...);
```

## 📈 Performance

- **Build Time**: ~5 minutes (2,807 static pages)
- **Bundle Size**: < 100KB (gzipped)
- **Lighthouse Score**: 95+ (all metrics)
- **First Contentful Paint**: < 1s
- **Time to Interactive**: < 2s

## 🔒 Security

- All secrets managed via GitHub Secrets
- `wrangler.toml` never committed (in `.gitignore`)
- Database credentials via environment variables only
- CSP headers configured
- No client-side API keys

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Content generated via RAG pipeline
- Data sourced from 88,709 Google PAA questions
- Powered by Cloudflare Pages
- Built with Astro & Tailwind CSS

---

**Live Site**: [proxyfaqs.com](https://proxyfaqs.com)
**Status**: Production Ready ✅
