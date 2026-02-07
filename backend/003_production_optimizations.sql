-- ============================================================
-- ProxyFAQs Production Optimizations v3
-- Server: 107.174.42.198, Host: supabase-db
-- Schema: proxyfaqs
-- Date: 2026-02-06
-- Description: Production-grade performance, monitoring, and maintenance
-- ============================================================

-- ============================================================
-- 1. CONNECTION POOL OPTIMIZATION SETTINGS
-- ============================================================

-- Session-level settings for optimal performance
-- Apply these via PgBouncer or connection init
COMMENT ON SCHEMA proxyfaqs IS 'ProxyFAQs - Recommended session settings:
  SET work_mem = ''128MB'';
  SET statement_timeout = ''30s'';
  SET idle_in_transaction_session_timeout = ''60s'';
  SET lock_timeout = ''10s'';';

-- ============================================================
-- 2. ENHANCED SEARCH WITH FALLBACK
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.smart_search(
    search_query TEXT,
    result_limit INTEGER DEFAULT 20,
    category_filter TEXT DEFAULT NULL,
    min_score REAL DEFAULT 0.01
)
RETURNS TABLE(
    id UUID,
    slug TEXT,
    question TEXT,
    answer TEXT,
    category TEXT,
    category_slug TEXT,
    view_count INTEGER,
    rank_score REAL,
    search_method TEXT
) AS $$
DECLARE
    normalized_query TEXT;
    ts_query TSQUERY;
    result_count INTEGER := 0;
BEGIN
    -- Normalize query
    normalized_query := lower(trim(COALESCE(search_query, '')));
    normalized_query := regexp_replace(normalized_query, '[^\w\s-]', ' ', 'g');
    normalized_query := regexp_replace(normalized_query, '\s+', ' ', 'g');

    -- Empty query: return popular questions
    IF normalized_query = '' OR length(normalized_query) < 2 THEN
        RETURN QUERY
        SELECT
            q.id, q.slug, q.question, q.answer,
            q.category, q.category_slug, q.view_count,
            (q.view_count::REAL / 100)::REAL AS rank_score,
            'popular'::TEXT AS search_method
        FROM proxyfaqs.questions q
        WHERE q.answer IS NOT NULL AND q.answer != ''
            AND (category_filter IS NULL OR q.category_slug = category_filter)
        ORDER BY q.view_count DESC
        LIMIT result_limit;
        RETURN;
    END IF;

    -- Try full-text search first
    ts_query := plainto_tsquery('english', normalized_query);

    RETURN QUERY
    SELECT
        q.id, q.slug, q.question, q.answer,
        q.category, q.category_slug, q.view_count,
        (ts_rank(q.search_vector, ts_query) * 10 +
         COALESCE(q.view_count::REAL / 1000, 0))::REAL AS rank_score,
        'fulltext'::TEXT AS search_method
    FROM proxyfaqs.questions q
    WHERE q.search_vector @@ ts_query
        AND q.answer IS NOT NULL AND q.answer != ''
        AND (category_filter IS NULL OR q.category_slug = category_filter)
    ORDER BY rank_score DESC
    LIMIT result_limit;

    GET DIAGNOSTICS result_count = ROW_COUNT;

    -- Fallback to trigram if no full-text results
    IF result_count < 3 THEN
        RETURN QUERY
        SELECT
            q.id, q.slug, q.question, q.answer,
            q.category, q.category_slug, q.view_count,
            (similarity(q.question, normalized_query) * 10 +
             COALESCE(q.view_count::REAL / 1000, 0))::REAL AS rank_score,
            'trigram'::TEXT AS search_method
        FROM proxyfaqs.questions q
        WHERE q.question % normalized_query
            AND q.answer IS NOT NULL AND q.answer != ''
            AND (category_filter IS NULL OR q.category_slug = category_filter)
            AND similarity(q.question, normalized_query) >= min_score
        ORDER BY rank_score DESC
        LIMIT result_limit - result_count;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

GRANT EXECUTE ON FUNCTION proxyfaqs.smart_search(TEXT, INTEGER, TEXT, REAL)
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- 3. PERFORMANCE MONITORING FUNCTIONS
-- ============================================================

-- Get slow queries from pg_stat_statements
CREATE OR REPLACE FUNCTION proxyfaqs.get_slow_queries(
    min_duration_ms NUMERIC DEFAULT 100,
    limit_count INTEGER DEFAULT 20
)
RETURNS TABLE(
    query TEXT,
    calls BIGINT,
    total_time_ms NUMERIC,
    mean_time_ms NUMERIC,
    max_time_ms NUMERIC,
    rows_returned BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        left(s.query, 200) AS query,
        s.calls,
        round(s.total_exec_time::NUMERIC, 2) AS total_time_ms,
        round(s.mean_exec_time::NUMERIC, 2) AS mean_time_ms,
        round(s.max_exec_time::NUMERIC, 2) AS max_time_ms,
        s.rows
    FROM pg_stat_statements s
    WHERE s.mean_exec_time > min_duration_ms
        AND s.query LIKE '%proxyfaqs%'
    ORDER BY s.mean_exec_time DESC
    LIMIT limit_count;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'pg_stat_statements not available';
        RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.get_slow_queries(NUMERIC, INTEGER)
    TO service_role, postgres;

-- Table and index size monitoring
CREATE OR REPLACE FUNCTION proxyfaqs.get_table_stats()
RETURNS TABLE(
    table_name TEXT,
    row_count BIGINT,
    total_size TEXT,
    index_size TEXT,
    toast_size TEXT,
    live_tuples BIGINT,
    dead_tuples BIGINT,
    last_vacuum TIMESTAMPTZ,
    last_analyze TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.relname::TEXT AS table_name,
        c.reltuples::BIGINT AS row_count,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
        pg_size_pretty(pg_total_relation_size(c.reltoastrelid)) AS toast_size,
        s.n_live_tup AS live_tuples,
        s.n_dead_tup AS dead_tuples,
        s.last_vacuum,
        s.last_analyze
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_tables t ON t.tablename = c.relname AND t.schemaname = n.nspname
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'proxyfaqs'
        AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.get_table_stats()
    TO service_role, postgres;

-- Index usage statistics
CREATE OR REPLACE FUNCTION proxyfaqs.get_index_stats()
RETURNS TABLE(
    index_name TEXT,
    table_name TEXT,
    index_size TEXT,
    idx_scan BIGINT,
    idx_tup_read BIGINT,
    idx_tup_fetch BIGINT,
    usage_ratio NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.indexrelname::TEXT AS index_name,
        i.relname::TEXT AS table_name,
        pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
        i.idx_scan,
        i.idx_tup_read,
        i.idx_tup_fetch,
        CASE WHEN i.idx_scan > 0
            THEN round((i.idx_tup_fetch::NUMERIC / i.idx_scan), 2)
            ELSE 0
        END AS usage_ratio
    FROM pg_stat_user_indexes i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'proxyfaqs'
    ORDER BY i.idx_scan DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.get_index_stats()
    TO service_role, postgres;

-- ============================================================
-- 4. MAINTENANCE FUNCTIONS
-- ============================================================

-- Cleanup old rate limit entries
CREATE OR REPLACE FUNCTION proxyfaqs.cleanup_rate_limits(
    older_than INTERVAL DEFAULT '1 hour'
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM proxyfaqs.rate_limits
    WHERE window_end < NOW() - older_than;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.cleanup_rate_limits(INTERVAL)
    TO service_role, postgres;

-- Cleanup old search queries (analytics)
CREATE OR REPLACE FUNCTION proxyfaqs.cleanup_search_queries(
    older_than INTERVAL DEFAULT '90 days'
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM proxyfaqs.search_queries
    WHERE created_at < NOW() - older_than;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.cleanup_search_queries(INTERVAL)
    TO service_role, postgres;

-- Cleanup old chat sessions
CREATE OR REPLACE FUNCTION proxyfaqs.cleanup_chat_sessions(
    older_than INTERVAL DEFAULT '30 days'
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM proxyfaqs.chat_sessions
    WHERE last_active < NOW() - older_than;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.cleanup_chat_sessions(INTERVAL)
    TO service_role, postgres;

-- Full maintenance routine
CREATE OR REPLACE FUNCTION proxyfaqs.run_maintenance()
RETURNS TABLE(
    task TEXT,
    result TEXT,
    duration_ms NUMERIC
) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    task_start TIMESTAMPTZ;
    count_result INTEGER;
BEGIN
    start_time := clock_timestamp();

    -- 1. Cleanup rate limits
    task_start := clock_timestamp();
    SELECT proxyfaqs.cleanup_rate_limits() INTO count_result;
    RETURN QUERY SELECT
        'cleanup_rate_limits'::TEXT,
        format('Deleted %s entries', count_result),
        extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;

    -- 2. Cleanup search queries
    task_start := clock_timestamp();
    SELECT proxyfaqs.cleanup_search_queries() INTO count_result;
    RETURN QUERY SELECT
        'cleanup_search_queries'::TEXT,
        format('Deleted %s entries', count_result),
        extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;

    -- 3. Cleanup chat sessions
    task_start := clock_timestamp();
    SELECT proxyfaqs.cleanup_chat_sessions() INTO count_result;
    RETURN QUERY SELECT
        'cleanup_chat_sessions'::TEXT,
        format('Deleted %s entries', count_result),
        extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;

    -- 4. Refresh materialized views
    task_start := clock_timestamp();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.popular_questions;
        RETURN QUERY SELECT
            'refresh_popular_questions'::TEXT,
            'Success'::TEXT,
            extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT
            'refresh_popular_questions'::TEXT,
            format('Failed: %s', SQLERRM),
            extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;
    END;

    -- 5. Update category counts
    task_start := clock_timestamp();
    PERFORM proxyfaqs.update_category_counts();
    RETURN QUERY SELECT
        'update_category_counts'::TEXT,
        'Success'::TEXT,
        extract(milliseconds FROM clock_timestamp() - task_start)::NUMERIC;

    -- 6. Total duration
    RETURN QUERY SELECT
        'TOTAL'::TEXT,
        'Maintenance complete'::TEXT,
        extract(milliseconds FROM clock_timestamp() - start_time)::NUMERIC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.run_maintenance()
    TO service_role, postgres;

-- ============================================================
-- 5. HEALTH CHECK FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION proxyfaqs.health_check()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details JSONB
) AS $$
DECLARE
    question_count BIGINT;
    category_count BIGINT;
    provider_count BIGINT;
BEGIN
    -- Check questions table
    SELECT COUNT(*) INTO question_count FROM proxyfaqs.questions;
    RETURN QUERY SELECT
        'questions_table'::TEXT,
        CASE WHEN question_count > 0 THEN 'ok' ELSE 'warning' END::TEXT,
        jsonb_build_object('count', question_count);

    -- Check categories table
    SELECT COUNT(*) INTO category_count FROM proxyfaqs.categories;
    RETURN QUERY SELECT
        'categories_table'::TEXT,
        CASE WHEN category_count > 0 THEN 'ok' ELSE 'warning' END::TEXT,
        jsonb_build_object('count', category_count);

    -- Check providers table
    SELECT COUNT(*) INTO provider_count FROM proxyfaqs.providers;
    RETURN QUERY SELECT
        'providers_table'::TEXT,
        CASE WHEN provider_count > 0 THEN 'ok' ELSE 'warning' END::TEXT,
        jsonb_build_object('count', provider_count);

    -- Check search vector index
    RETURN QUERY SELECT
        'search_index'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'proxyfaqs'
            AND indexname = 'idx_questions_search'
        ) THEN 'ok' ELSE 'error' END::TEXT,
        jsonb_build_object('index', 'idx_questions_search');

    -- Check materialized view
    RETURN QUERY SELECT
        'popular_questions_mv'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM pg_matviews
            WHERE schemaname = 'proxyfaqs'
            AND matviewname = 'popular_questions'
        ) THEN 'ok' ELSE 'warning' END::TEXT,
        jsonb_build_object('view', 'popular_questions');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION proxyfaqs.health_check()
    TO anon, authenticated, service_role, postgres;

-- ============================================================
-- 6. ADDITIONAL INDEXES FOR PRODUCTION
-- ============================================================

-- Covering index for question detail pages
CREATE INDEX IF NOT EXISTS idx_questions_detail_covering
    ON proxyfaqs.questions(slug)
    INCLUDE (question, answer, answer_html, category, category_slug, view_count, meta_title, meta_description);

-- Index for related questions lookup
CREATE INDEX IF NOT EXISTS idx_questions_related
    ON proxyfaqs.questions(category_slug, id)
    WHERE answer IS NOT NULL AND answer != '';

-- BRIN index for time-series queries (very efficient for large tables)
CREATE INDEX IF NOT EXISTS idx_questions_created_brin
    ON proxyfaqs.questions USING BRIN(created_at)
    WITH (pages_per_range = 128);

-- ============================================================
-- 7. VACUUM AND ANALYZE
-- ============================================================

-- Run ANALYZE to update statistics
ANALYZE proxyfaqs.questions;
ANALYZE proxyfaqs.categories;
ANALYZE proxyfaqs.providers;
ANALYZE proxyfaqs.chat_sessions;
ANALYZE proxyfaqs.keywords;

-- ============================================================
-- 8. COMMENTS
-- ============================================================

COMMENT ON FUNCTION proxyfaqs.smart_search(TEXT, INTEGER, TEXT, REAL) IS
    'Production search with automatic fallback: fulltext -> trigram -> popular';

COMMENT ON FUNCTION proxyfaqs.run_maintenance() IS
    'Run all maintenance tasks: cleanup old data, refresh views, update counts';

COMMENT ON FUNCTION proxyfaqs.health_check() IS
    'Database health check for monitoring and alerting';

COMMENT ON FUNCTION proxyfaqs.get_table_stats() IS
    'Get table sizes, row counts, and vacuum statistics';

COMMENT ON FUNCTION proxyfaqs.get_index_stats() IS
    'Get index usage statistics for optimization';
