-- ============================================================
-- ProxyFAQs Database Optimization Migration
-- Version: 002
-- Date: 2025-01-09
-- Description: Performance indexes, materialized views, and helper functions
-- ============================================================

-- ============================================================
-- COMPOSITE INDEXES
-- ============================================================

-- idx_questions_category_views: For "popular in category" queries
-- Supports: ORDER BY category_slug, view_count DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_questions_category_views
    ON proxyfaqs.questions(category_slug, view_count DESC)
    WHERE category_slug IS NOT NULL;

-- idx_questions_published: Partial index for published questions only
-- Smaller index = faster scans for most queries
CREATE INDEX IF NOT EXISTS idx_questions_published
    ON proxyfaqs.questions(category_slug, slug, view_count)
    WHERE answer_html IS NOT NULL AND answer != '';

-- idx_questions_search_covering: Covering index with INCLUDE
-- Reduces table lookups for search results
CREATE INDEX IF NOT EXISTS idx_questions_search_covering
    ON proxyfaqs.questions USING GIN(search_vector)
    INCLUDE (slug, question, category_slug, view_count);

-- idx_questions_category_count: For counting questions per category
-- Supports: SELECT COUNT(*) FROM questions WHERE category_slug = ?
CREATE INDEX IF NOT EXISTS idx_questions_category_count
    ON proxyfaqs.questions(category_slug)
    WHERE category_slug IS NOT NULL;

-- idx_questions_created_at: For time-based queries
CREATE INDEX IF NOT EXISTS idx_questions_created_at
    ON proxyfaqs.questions(created_at DESC);

-- idx_questions_views_created: For trending queries (recent + popular)
CREATE INDEX IF NOT EXISTS idx_questions_views_created
    ON proxyfaqs.questions(view_count DESC, created_at DESC)
    WHERE created_at > NOW() - INTERVAL '30 days';

-- ============================================================
-- TRIGRAM OPTIMIZATIONS
-- ============================================================

-- Add trigram index on answers for fuzzy answer search
CREATE INDEX IF NOT EXISTS idx_questions_answer_trgm
    ON proxyfaqs.questions USING GIN(answer gin_trgm_ops);

-- Add trigram index on category for autocomplete
CREATE INDEX IF NOT EXISTS idx_questions_category_trgm
    ON proxyfaqs.questions USING GIN(category gin_trgm_ops);

-- ============================================================
-- MATERIALIZED VIEW: Popular Questions
-- ============================================================

-- Drop existing if migration is rerun
DROP MATERIALIZED VIEW IF EXISTS proxyfaqs.popular_questions CASCADE;

CREATE MATERIALIZED VIEW proxyfaqs.popular_questions AS
SELECT
    slug,
    question,
    category,
    category_slug,
    view_count,
    created_at,
    -- Ranking score: views + recency bonus
    view_count +
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 * -0.1 AS popularity_score
FROM proxyfaqs.questions
WHERE answer_html IS NOT NULL
    AND answer != ''
    AND category_slug IS NOT NULL
ORDER BY popularity_score DESC
WITH DATA;

-- Indexes on materialized view for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_popular_questions_slug
    ON proxyfaqs.popular_questions(slug);

CREATE INDEX IF NOT EXISTS idx_popular_questions_category_score
    ON proxyfaqs.popular_questions(category_slug, popularity_score DESC);

CREATE INDEX IF NOT EXISTS idx_popular_questions_score
    ON proxyfaqs.popular_questions(popularity_score DESC);

-- ============================================================
-- REFRESH FUNCTION for Materialized View
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.refresh_popular_questions()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.popular_questions;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION proxyfaqs.refresh_popular_questions()
    TO service_role, postgres;

-- ============================================================
-- SEARCH ANALYTICS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS proxyfaqs.search_queries (
    id BIGSERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    results_count INTEGER NOT NULL DEFAULT 0,
    clicked_slug TEXT,
    session_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search analytics
-- Time-series index for cleanup and reporting
CREATE INDEX IF NOT EXISTS idx_search_queries_created_at
    ON proxyfaqs.search_queries(created_at DESC);

-- Index for popular searches query
CREATE INDEX IF NOT EXISTS idx_search_queries_query_count
    ON proxyfaqs.search_queries(query, results_count)
    WHERE created_at > NOW() - INTERVAL '90 days';

-- Partial index for searches with results (conversion tracking)
CREATE INDEX IF NOT EXISTS idx_search_queries_converted
    ON proxyfaqs.search_queries(created_at DESC, clicked_slug)
    WHERE clicked_slug IS NOT NULL;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- rank_search: Returns ranked search results with scoring
CREATE OR REPLACE FUNCTION proxyfaqs.rank_search(
    search_query TEXT,
    category_filter TEXT DEFAULT NULL,
    limit_count INTEGER DEFAULT 10,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
    slug TEXT,
    question TEXT,
    answer TEXT,
    category TEXT,
    category_slug TEXT,
    view_count INTEGER,
    rank_score REAL
) AS $$
DECLARE
    ts_query TSVECTOR;
BEGIN
    -- Parse the search query with stemming
    ts_query := to_tsquery('english',
        replace(replace(coalesce(search_query, ''), '&', ' & '), ' ', ' & '));

    RETURN QUERY
    SELECT
        q.slug,
        q.question,
        q.answer,
        q.category,
        q.category_slug,
        q.view_count,
        -- Combined score: text search (0.7) + views (0.3)
        (ts_rank(q.search_vector, ts_query) * 0.7 +
         LOG(q.view_count + 2) * 0.3)::REAL AS rank_score
    FROM proxyfaqs.questions q
    WHERE q.search_vector @@ ts_query
        AND (category_filter IS NULL OR q.category_slug = category_filter)
        AND q.answer != ''
    ORDER BY rank_score DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.rank_search(TEXT, TEXT, INTEGER, INTEGER)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- increment_view_count: Safely increment question views
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.increment_view_count(question_slug TEXT)
RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE proxyfaqs.questions
    SET view_count = view_count + 1
    WHERE slug = question_slug
    RETURNING view_count INTO new_count;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    RETURN new_count;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.increment_view_count(TEXT)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- get_trending_questions: Recent popular questions
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.get_trending_questions(
    days_ago INTEGER DEFAULT 7,
    limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
    slug TEXT,
    question TEXT,
    category TEXT,
    category_slug TEXT,
    view_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        q.slug,
        q.question,
        q.category,
        q.category_slug,
        q.view_count
    FROM proxyfaqs.questions q
    WHERE q.created_at > NOW() - (days_ago || ' days')::INTERVAL
        AND q.answer != ''
    ORDER BY q.view_count DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.get_trending_questions(INTEGER, INTEGER)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- get_popular_in_category: Category-specific popular questions
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.get_popular_in_category(
    cat_slug TEXT,
    limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    slug TEXT,
    question TEXT,
    category TEXT,
    view_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        q.slug,
        q.question,
        q.category,
        q.view_count
    FROM proxyfaqs.questions q
    WHERE q.category_slug = cat_slug
        AND q.answer != ''
    ORDER BY q.view_count DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.get_popular_in_category(TEXT, INTEGER)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- search_suggestions: Autocomplete for search box
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.search_suggestions(
    search_query TEXT,
    limit_count INTEGER DEFAULT 8
)
RETURNS TABLE (
    suggestion TEXT,
    slug TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        q.question AS suggestion,
        q.slug
    FROM proxyfaqs.questions q
    WHERE q.question % search_query
        AND q.answer != ''
    ORDER BY similarity(q.question, search_query) DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.search_suggestions(TEXT, INTEGER)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- UPDATE CATEGORY QUESTION COUNTS
-- ============================================================

-- Function to recalculate category question counts
CREATE OR REPLACE FUNCTION proxyfaqs.update_category_counts()
RETURNS void AS $$
BEGIN
    UPDATE proxyfaqs.categories c
    SET question_count = (
        SELECT COUNT(*)
        FROM proxyfaqs.questions q
        WHERE q.category_slug = c.slug
    ),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION proxyfaqs.update_category_counts()
    TO service_role, postgres;

-- ============================================================
-- PARTIAL INDEXES FOR SPECIFIC QUERY PATTERNS
-- ============================================================

-- For API endpoints that only return questions with HTML answers
CREATE INDEX IF NOT EXISTS idx_questions_with_html
    ON proxyfaqs.questions(category_slug, view_count DESC)
    WHERE answer_html IS NOT NULL;

-- For sitemap generation (only published, indexed pages)
CREATE INDEX IF NOT EXISTS idx_questions_sitemap
    ON proxyfaqs.questions(slug, updated_at)
    WHERE answer_html IS NOT NULL AND answer != '';

-- For questions with source URLs (backlink tracking)
CREATE INDEX IF NOT EXISTS idx_questions_with_source
    ON proxyfaqs.questions(source_url, created_at)
    WHERE source_url IS NOT NULL;

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON MATERIALIZED VIEW proxyfaqs.popular_questions IS
    'Pre-computed popular questions with popularity scores. Refresh via REFRESH MATERIALIZED VIEW CONCURRENTLY or proxyfaqs.refresh_popular_questions()';

COMMENT ON TABLE proxyfaqs.search_queries IS
    'Tracks search queries for analytics and popular search optimization. Cleanup old entries (>90 days) via cron';

COMMENT ON FUNCTION proxyfaqs.rank_search(TEXT, TEXT, INTEGER, INTEGER) IS
    'Full-text search with ranking. Combines ts_rank with view_count for relevance scoring';

COMMENT ON FUNCTION proxyfaqs.increment_view_count(TEXT) IS
    'Atomically increment view count for a question. Returns new count or 0 if not found';

COMMENT ON FUNCTION proxyfaqs.get_trending_questions(INTEGER, INTEGER) IS
    'Get recently created questions sorted by views (trending content)';

COMMENT ON FUNCTION proxyfaqs.get_popular_in_category(TEXT, INTEGER) IS
    'Get most viewed questions within a specific category';

COMMENT ON FUNCTION proxyfaqs.search_suggestions(TEXT, INTEGER) IS
    'Autocomplete suggestions using pg_trgm similarity search';

-- ============================================================
-- INITIAL DATA SYNC
-- ============================================================

-- Update category counts on first run
SELECT proxyfaqs.update_category_counts();

-- ============================================================
-- PERMISSIONS (ensure all grants are in place)
-- ============================================================

GRANT SELECT ON proxyfaqs.popular_questions TO anon, authenticated, service_role, postgres;
GRANT SELECT, INSERT ON proxyfaqs.search_queries TO anon, authenticated, service_role, postgres;
GRANT USAGE, SELECT ON SEQUENCE proxyfaqs.search_queries_id_seq TO anon, authenticated, service_role, postgres;
