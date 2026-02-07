-- ============================================================
-- ProxyFAQs Performance Optimizations
-- Server: 107.174.42.198, Host: supabase-db
-- Schema: proxyfaqs
-- Date: 2025-01-09
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- COMPOSITE INDEXES FOR SEARCH PERFORMANCE
-- ============================================================

-- Composite index for category + view_count (popular questions by category)
CREATE INDEX IF NOT EXISTS idx_questions_category_view_count
ON proxyfaqs.questions(category_slug, view_count DESC, id)
WHERE view_count > 0;

-- Composite index for full-text search ranking
CREATE INDEX IF NOT EXISTS idx_questions_search_ranking
ON proxyfaqs.questions USING GIN(search_vector)
WITH (fastupdate = on, gin_pending_list_limit = 4MB);

-- Partial index for popular questions (view_count > 10)
CREATE INDEX IF NOT EXISTS idx_questions_popular
ON proxyfaqs.questions(view_count DESC, created_at DESC)
WHERE view_count > 10;

-- Index for recent questions
CREATE INDEX IF NOT EXISTS idx_questions_recent
ON proxyfaqs.questions(created_at DESC, id)
WHERE created_at > NOW() - INTERVAL '90 days';

-- Index for source keyword lookups
CREATE INDEX IF NOT EXISTS idx_questions_source_keyword_trgm
ON proxyfaqs.questions USING GIN(source_keyword gin_trgm_ops)
WHERE source_keyword IS NOT NULL;

-- ============================================================
-- MATERIALIZED VIEWS
-- ============================================================

-- Popular Questions Materialized View
-- Refresh strategy: REFRESH CONCURRENTLY (allows reads during refresh)
DROP MATERIALIZED VIEW IF EXISTS proxyfaqs.popular_questions CASCADE;

CREATE MATERIALIZED VIEW proxyfaqs.popular_questions AS
SELECT 
    id,
    slug,
    question,
    answer,
    category,
    category_slug,
    view_count,
    created_at,
    updated_at,
    -- Rank calculation for trending (view_count + recent boost)
    (view_count * 1.0 + 
     EXTRACT(EPOCH FROM (NOW() - created_at)) / -86400 * 10) AS trending_score
FROM proxyfaqs.questions
WHERE view_count > 0 OR created_at > NOW() - INTERVAL '30 days'
ORDER BY view_count DESC, created_at DESC
WITH DATA;

-- Unique index on materialized view for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_popular_questions_id
ON proxyfaqs.popular_questions(id);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_popular_questions_slug
ON proxyfaqs.popular_questions(slug);

-- Index for trending queries
CREATE INDEX IF NOT EXISTS idx_popular_questions_trending
ON proxyfaqs.popular_questions(trending_score DESC, id);

-- Category Question Counts Materialized View
DROP MATERIALIZED VIEW IF EXISTS proxyfaqs.category_stats CASCADE;

CREATE MATERIALIZED VIEW proxyfaqs.category_stats AS
SELECT 
    c.id,
    c.slug,
    c.name,
    c.description,
    COUNT(q.id) AS question_count,
    SUM(q.view_count) AS total_views,
    MAX(q.updated_at) AS last_question_update,
    AVG(q.view_count) AS avg_views_per_question
FROM proxyfaqs.categories c
LEFT JOIN proxyfaqs.questions q ON q.category = c.name OR q.category_slug = c.slug
GROUP BY c.id, c.slug, c.name, c.description
ORDER BY question_count DESC
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_stats_slug
ON proxyfaqs.category_stats(slug);

-- Search Analytics Materialized View (for query optimization insights)
DROP MATERIALIZED VIEW IF EXISTS proxyfaqs.search_stats CASCADE;

CREATE MATERIALIZED VIEW proxyfaqs.search_stats AS
SELECT 
    category,
    category_slug,
    COUNT(*) AS total_questions,
    SUM(view_count) AS total_views,
    COUNT(CASE WHEN view_count > 100 THEN 1 END) AS popular_count,
    MAX(created_at) AS latest_question
FROM proxyfaqs.questions
GROUP BY category, category_slug
ORDER BY total_views DESC
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_search_stats_category
ON proxyfaqs.search_stats(category, category_slug);

-- ============================================================
-- REFRESH FUNCTIONS FOR MATERIALIZED VIEWS
-- ============================================================

-- Function to refresh popular questions concurrently
CREATE OR REPLACE FUNCTION proxyfaqs.refresh_popular_questions()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.popular_questions;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail (allows fallback to base table)
        RAISE WARNING 'Failed to refresh popular_questions: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh category stats concurrently
CREATE OR REPLACE FUNCTION proxyfaqs.refresh_category_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.category_stats;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to refresh category_stats: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION proxyfaqs.refresh_all_materialized_views()
RETURNS TABLE(
    view_name text,
    status text,
    refresh_time timestamptz
) AS $$
DECLARE
    v_record RECORD;
BEGIN
    -- Refresh popular_questions
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.popular_questions;
        RETURN QUERY SELECT 'popular_questions'::text, 'success'::text, NOW()::timestamptz;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 'popular_questions'::text, 'failed'::text, NOW()::timestamptz;
    END;
    
    -- Refresh category_stats
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.category_stats;
        RETURN QUERY SELECT 'category_stats'::text, 'success'::text, NOW()::timestamptz;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 'category_stats'::text, 'failed'::text, NOW()::timestamptz;
    END;
    
    -- Refresh search_stats
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.search_stats;
        RETURN QUERY SELECT 'search_stats'::text, 'success'::text, NOW()::timestamptz;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 'search_stats'::text, 'failed'::text, NOW()::timestamptz;
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- OPTIMIZED SEARCH FUNCTION
-- ============================================================

-- Ranked search function with materialized view support
CREATE OR REPLACE FUNCTION proxyfaqs.ranked_search(
    search_query TEXT,
    result_limit INTEGER DEFAULT 20,
    use_materialized BOOLEAN DEFAULT true
)
RETURNS TABLE(
    id UUID,
    slug TEXT,
    question TEXT,
    answer TEXT,
    category TEXT,
    category_slug TEXT,
    view_count BIGINT,
    rank_score REAL
) AS $$
DECLARE
    normalized_query TEXT;
BEGIN
    -- Normalize and clean query
    normalized_query := lower(trim(search_query));
    normalized_query := regexp_replace(normalized_query, '[^\w\s-]', ' ', 'g');
    normalized_query := regexp_replace(normalized_query, '\s+', ' ', 'g');
    
    -- Use materialized view if requested and query is empty (get popular)
    IF use_materialized AND normalized_query = '' THEN
        RETURN QUERY
        SELECT 
            pq.id, pq.slug, pq.question, pq.answer, 
            pq.category, pq.category_slug, pq.view_count,
            pq.trending_score::REAL
        FROM proxyfaqs.popular_questions pq
        ORDER BY pq.trending_score DESC
        LIMIT result_limit;
        RETURN;
    END IF;
    
    -- Full-text search with ranking
    RETURN QUERY
    SELECT 
        q.id, q.slug, q.question, q.answer,
        q.category, q.category_slug, q.view_count,
        ts_rank(q.search_vector, plainto_tsquery('english', normalized_query)) * 10 +
        COALESCE(q.view_count::REAL / 1000, 0) AS rank_score
    FROM proxyfaqs.questions q
    WHERE q.search_vector @@ plainto_tsquery('english', normalized_query)
       OR q.question ILIKE '%' || normalized_query || '%'
    ORDER BY rank_score DESC, q.view_count DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- AUTO-REFRESH SCHEDULING (via pg_cron if available)
-- ============================================================

-- Uncomment if pg_cron is available on your Supabase instance
-- SELECT cron.schedule('refresh-popular-questions', '*/15 * * * *', 
--     'SELECT proxyfaqs.refresh_popular_questions();');
-- 
-- SELECT cron.schedule('refresh-category-stats', '0 * * * *', 
--     'SELECT proxyfaqs.refresh_category_stats();');

-- ============================================================
-- GRANT PERMISSIONS
-- ============================================================

GRANT SELECT ON proxyfaqs.popular_questions TO postgres, anon, authenticated, service_role;
GRANT SELECT ON proxyfaqs.category_stats TO postgres, anon, authenticated, service_role;
GRANT SELECT ON proxyfaqs.search_stats TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION proxyfaqs.refresh_popular_questions() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION proxyfaqs.refresh_category_stats() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION proxyfaqs.refresh_all_materialized_views() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION proxyfaqs.ranked_search(TEXT, INTEGER, BOOLEAN) TO postgres, anon, authenticated, service_role;

-- ============================================================
-- ANALYZE TABLES FOR QUERY PLANNER OPTIMIZATION
-- ============================================================

ANALYZE proxyfaqs.questions;
ANALYZE proxyfaqs.categories;
ANALYZE proxyfaqs.providers;
ANALYZE proxyfaqs.popular_questions;
ANALYZE proxyfaqs.category_stats;

-- ============================================================
-- PERFORMANCE MONITORING VIEWS
-- ============================================================

-- View for monitoring materialized view refresh status
CREATE OR REPLACE VIEW proxyfaqs.materialized_view_stats AS
SELECT 
    'popular_questions' AS view_name,
    pg_size_pretty(pg_total_relation_size('proxyfaqs.popular_questions'::regclass)) AS size,
    (SELECT COUNT(*) FROM proxyfaqs.popular_questions) AS row_count,
    NOW() AS last_checked
UNION ALL
SELECT 
    'category_stats' AS view_name,
    pg_size_pretty(pg_total_relation_size('proxyfaqs.category_stats'::regclass)) AS size,
    (SELECT COUNT(*) FROM proxyfaqs.category_stats) AS row_count,
    NOW() AS last_checked
UNION ALL
SELECT 
    'search_stats' AS view_name,
    pg_size_pretty(pg_total_relation_size('proxyfaqs.search_stats'::regclass)) AS size,
    (SELECT COUNT(*) FROM proxyfaqs.search_stats) AS row_count,
    NOW() AS last_checked;

GRANT SELECT ON proxyfaqs.materialized_view_stats TO postgres, service_role;

COMMENT ON MATERIALIZED VIEW proxyfaqs.popular_questions IS 'Pre-computed popular questions for fast access, refreshed via refresh_popular_questions()';
COMMENT ON MATERIALIZED VIEW proxyfaqs.category_stats IS 'Category statistics with question counts and view aggregations';
COMMENT ON FUNCTION proxyfaqs.ranked_search(TEXT, INTEGER, BOOLEAN) IS 'Optimized search with ranking, falls back to materialized view for empty queries';
COMMENT ON FUNCTION proxyfaqs.refresh_all_materialized_views() IS 'Refresh all materialized views concurrently, returns status for each';

-- ============================================================
-- PERFORMANCE TUNING PARAMETERS (Session-level)
-- ============================================================

-- These can be set per-session for specific queries
-- SET work_mem = '256MB';  -- More memory for sorting/hashing
-- SET statement_timeout = '30s';  -- Prevent long-running queries
-- SET jit = on;  -- Enable JIT compilation for complex queries
