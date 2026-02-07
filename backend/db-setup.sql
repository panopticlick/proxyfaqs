-- ProxyFAQs Database Schema
-- Server: 107.174.42.198, Host: supabase-db
-- Schema: proxyfaqs
-- Date: 2025-12-27

CREATE SCHEMA IF NOT EXISTS proxyfaqs;

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    question_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON proxyfaqs.categories(slug);

-- ============================================================
-- QUESTIONS (Core: 1M+ rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    answer_html TEXT,
    category TEXT NOT NULL,
    category_slug TEXT,
    source_keyword TEXT,
    source_url TEXT,
    meta_title TEXT,
    meta_description TEXT,
    search_vector TSVECTOR,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_slug ON proxyfaqs.questions(slug);
CREATE INDEX IF NOT EXISTS idx_questions_category ON proxyfaqs.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_search ON proxyfaqs.questions USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_questions_source ON proxyfaqs.questions(source_keyword);

-- Trigram for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_questions_trgm ON proxyfaqs.questions
    USING GIN(question gin_trgm_ops);

-- ============================================================
-- PROVIDERS (Affiliate data)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    website_url TEXT,
    features JSONB DEFAULT '{}',
    pricing JSONB DEFAULT '{}',
    pros TEXT[] DEFAULT '{}',
    cons TEXT[] DEFAULT '{}',
    affiliate_url TEXT,
    affiliate_code TEXT,
    rating DECIMAL(2,1),
    rank INTEGER,
    review_html TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_slug ON proxyfaqs.providers(slug);
CREATE INDEX IF NOT EXISTS idx_providers_rank ON proxyfaqs.providers(rank);

-- ============================================================
-- CHAT_SESSIONS (For context + analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT UNIQUE NOT NULL,
    messages JSONB DEFAULT '[]',
    page_context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_id ON proxyfaqs.chat_sessions(session_id);

-- ============================================================
-- KEYWORDS (SEO tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT UNIQUE NOT NULL,
    volume INTEGER,
    difficulty INTEGER,
    cluster TEXT,
    page_slug TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keywords_cluster ON proxyfaqs.keywords(cluster);

-- ============================================================
-- AUTO-UPDATE TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION proxyfaqs.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION proxyfaqs.update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.question, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.answer, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_questions_timestamp ON proxyfaqs.questions;
CREATE TRIGGER update_questions_timestamp
    BEFORE UPDATE ON proxyfaqs.questions
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_timestamp();

DROP TRIGGER IF EXISTS update_questions_search ON proxyfaqs.questions;
CREATE TRIGGER update_questions_search
    BEFORE INSERT OR UPDATE ON proxyfaqs.questions
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_search_vector();

DROP TRIGGER IF EXISTS update_categories_timestamp ON proxyfaqs.categories;
CREATE TRIGGER update_categories_timestamp
    BEFORE UPDATE ON proxyfaqs.categories
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_timestamp();

DROP TRIGGER IF EXISTS update_providers_timestamp ON proxyfaqs.providers;
CREATE TRIGGER update_providers_timestamp
    BEFORE UPDATE ON proxyfaqs.providers
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_timestamp();

-- ============================================================
-- RATE LIMITING TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS proxyfaqs.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_end TIMESTAMPTZ NOT NULL,
    blocked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON proxyfaqs.rate_limits(identifier, endpoint, window_end);
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON proxyfaqs.rate_limits(window_end);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON proxyfaqs.rate_limits(identifier, endpoint) WHERE blocked_until IS NOT NULL;

DROP TRIGGER IF EXISTS update_rate_limits_timestamp ON proxyfaqs.rate_limits;
CREATE TRIGGER update_rate_limits_timestamp
    BEFORE UPDATE ON proxyfaqs.rate_limits
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_timestamp();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Enable RLS
ALTER TABLE proxyfaqs.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.rate_limits ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY categories_select_public ON proxyfaqs.categories FOR SELECT USING (true);
CREATE POLICY questions_select_public ON proxyfaqs.questions FOR SELECT USING (true);
CREATE POLICY providers_select_public ON proxyfaqs.providers FOR SELECT USING (true);
CREATE POLICY keywords_select_public ON proxyfaqs.keywords FOR SELECT USING (true);
CREATE POLICY chat_sessions_select_public ON proxyfaqs.chat_sessions FOR SELECT USING (true);

-- Deny write policies for public tables
CREATE POLICY categories_no_write ON proxyfaqs.categories FOR ALL WITH CHECK (false);
CREATE POLICY questions_no_write ON proxyfaqs.questions FOR ALL WITH CHECK (false);
CREATE POLICY providers_no_write ON proxyfaqs.providers FOR ALL WITH CHECK (false);
CREATE POLICY keywords_no_write ON proxyfaqs.keywords FOR ALL WITH CHECK (false);

-- Allow chat sessions writes for tracking
CREATE POLICY chat_sessions_insert_public ON proxyfaqs.chat_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY chat_sessions_update_public ON proxyfaqs.chat_sessions FOR UPDATE USING (true);
CREATE POLICY chat_sessions_no_delete ON proxyfaqs.chat_sessions FOR DELETE USING (false);

-- ============================================================
-- PERMISSIONS
-- ============================================================
GRANT USAGE ON SCHEMA proxyfaqs TO postgres, anon, authenticated, service_role;

-- Public read-only access
GRANT SELECT ON ALL TABLES IN SCHEMA proxyfaqs TO anon, authenticated;

-- Allow chat_sessions writes
GRANT INSERT, UPDATE ON proxyfaqs.chat_sessions TO anon, authenticated;

-- Service role full access
GRANT ALL ON ALL TABLES IN SCHEMA proxyfaqs TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA proxyfaqs TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA proxyfaqs TO service_role;

-- ============================================================
-- SEED CATEGORIES
-- ============================================================
INSERT INTO proxyfaqs.categories (slug, name, description) VALUES
    ('proxy-basics', 'Proxy Basics', 'Fundamentals of proxies and how they work'),
    ('proxy-types', 'Proxy Types', 'Datacenter, residential, mobile, and ISP proxies'),
    ('web-scraping', 'Web Scraping', 'Using proxies for web scraping and data collection'),
    ('residential-proxies', 'Residential Proxies', 'Residential proxy providers and usage'),
    ('datacenter-proxies', 'Datacenter Proxies', 'Datacenter proxy setup and configuration'),
    ('mobile-proxies', 'Mobile Proxies', 'Mobile proxy networks and applications'),
    ('proxy-providers', 'Proxy Providers', 'Reviews and comparisons of proxy services'),
    ('scraper-api', 'Scraper API', 'API-based scraping solutions'),
    ('troubleshooting', 'Troubleshooting', 'Common proxy issues and solutions'),
    ('use-cases', 'Use Cases', 'Target-specific proxy configurations')
ON CONFLICT (slug) DO NOTHING;

COMMENT ON SCHEMA proxyfaqs IS 'ProxyFAQs knowledge base - The Stack Overflow for proxies';
