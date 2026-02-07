-- ============================================================
-- ProxyFAQs Security Migration
-- ============================================================
-- Purpose: Add Row Level Security (RLS) policies and rate limiting
-- Schema: proxyfaqs
-- Date: 2025-01-09
-- ============================================================

-- Enable Row Level Security on all tables
ALTER TABLE proxyfaqs.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxyfaqs.keywords ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES: Public READ-ONLY access
-- ============================================================

-- Categories: Read-only for everyone
DROP POLICY IF EXISTS categories_select_public ON proxyfaqs.categories;
CREATE POLICY categories_select_public ON proxyfaqs.categories
    FOR SELECT
    USING (true);

-- Categories: No inserts/updates/deletes for anon/authenticated
DROP POLICY IF EXISTS categories_no_insert ON proxyfaqs.categories;
CREATE POLICY categories_no_insert ON proxyfaqs.categories
    FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS categories_no_update ON proxyfaqs.categories;
CREATE POLICY categories_no_update ON proxyfaqs.categories
    FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS categories_no_delete ON proxyfaqs.categories;
CREATE POLICY categories_no_delete ON proxyfaqs.categories
    FOR DELETE
    USING (false);

-- Questions: Read-only for everyone
DROP POLICY IF EXISTS questions_select_public ON proxyfaqs.questions;
CREATE POLICY questions_select_public ON proxyfaqs.questions
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS questions_no_insert ON proxyfaqs.questions;
CREATE POLICY questions_no_insert ON proxyfaqs.questions
    FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS questions_no_update ON proxyfaqs.questions;
CREATE POLICY questions_no_update ON proxyfaqs.questions
    FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS questions_no_delete ON proxyfaqs.questions;
CREATE POLICY questions_no_delete ON proxyfaqs.questions
    FOR DELETE
    USING (false);

-- Providers: Read-only for everyone
DROP POLICY IF EXISTS providers_select_public ON proxyfaqs.providers;
CREATE POLICY providers_select_public ON proxyfaqs.providers
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS providers_no_insert ON proxyfaqs.providers;
CREATE POLICY providers_no_insert ON proxyfaqs.providers
    FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS providers_no_update ON proxyfaqs.providers;
CREATE POLICY providers_no_update ON proxyfaqs.providers
    FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS providers_no_delete ON proxyfaqs.providers;
CREATE POLICY providers_no_delete ON proxyfaqs.providers
    FOR DELETE
    USING (false);

-- Keywords: Read-only for everyone
DROP POLICY IF EXISTS keywords_select_public ON proxyfaqs.keywords;
CREATE POLICY keywords_select_public ON proxyfaqs.keywords
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS keywords_no_insert ON proxyfaqs.keywords;
CREATE POLICY keywords_no_insert ON proxyfaqs.keywords
    FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS keywords_no_update ON proxyfaqs.keywords;
CREATE POLICY keywords_no_update ON proxyfaqs.keywords
    FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS keywords_no_delete ON proxyfaqs.keywords;
CREATE POLICY keywords_no_delete ON proxyfaqs.keywords
    FOR DELETE
    USING (false);

-- Chat Sessions: Allow inserts for session creation, read-only otherwise
DROP POLICY IF EXISTS chat_sessions_select_public ON proxyfaqs.chat_sessions;
CREATE POLICY chat_sessions_select_public ON proxyfaqs.chat_sessions
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS chat_sessions_insert_public ON proxyfaqs.chat_sessions;
CREATE POLICY chat_sessions_insert_public ON proxyfaqs.chat_sessions
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS chat_sessions_update_public ON proxyfaqs.chat_sessions;
CREATE POLICY chat_sessions_update_public ON proxyfaqs.chat_sessions
    FOR UPDATE
    USING (true);

DROP POLICY IF EXISTS chat_sessions_no_delete ON proxyfaqs.chat_sessions;
CREATE POLICY chat_sessions_no_delete ON proxyfaqs.chat_sessions
    FOR DELETE
    USING (false);

-- ============================================================
-- SERVICE ROLE: Full access for admin operations
-- ============================================================

-- Grant service role full access (for import scripts, admin operations)
GRANT ALL ON ALL TABLES IN SCHEMA proxyfaqs TO service_role;

-- ============================================================
-- RATE LIMITING TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS proxyfaqs.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,        -- IP address or session ID
    endpoint TEXT NOT NULL,           -- 'chat', 'search', etc.
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_end TIMESTAMPTZ NOT NULL,
    blocked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON proxyfaqs.rate_limits(identifier, endpoint, window_end);
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON proxyfaqs.rate_limits(window_end);

-- Index for blocked requests
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON proxyfaqs.rate_limits(identifier, endpoint) WHERE blocked_until IS NOT NULL;

-- ============================================================
-- RATE LIMITING FUNCTIONS
-- ============================================================

-- Function to check rate limit
CREATE OR REPLACE FUNCTION proxyfaqs.check_rate_limit(
    p_identifier TEXT,
    p_endpoint TEXT,
    p_max_requests INTEGER DEFAULT 60,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS TABLE(
    allowed BOOLEAN,
    remaining INTEGER,
    reset_at TIMESTAMPTZ
) AS $$
DECLARE
    v_current_window_start TIMESTAMPTZ;
    v_current_window_end TIMESTAMPTZ;
    v_current_count INTEGER;
    v_blocked TIMESTAMPTZ;
BEGIN
    v_current_window_start := date_trunc('minute', NOW());
    v_current_window_end := v_current_window_start + (p_window_seconds || ' seconds')::INTERVAL;

    -- Check if currently blocked
    SELECT blocked_until INTO v_blocked
    FROM proxyfaqs.rate_limits
    WHERE identifier = p_identifier
      AND endpoint = p_endpoint
      AND blocked_until > NOW()
    FOR UPDATE;

    IF v_blocked IS NOT NULL THEN
        RETURN QUERY SELECT false, 0, v_blocked;
        RETURN;
    END IF;

    -- Get or create rate limit entry
    SELECT request_count INTO v_current_count
    FROM proxyfaqs.rate_limits
    WHERE identifier = p_identifier
      AND endpoint = p_endpoint
      AND window_end = v_current_window_end
    FOR UPDATE;

    IF v_current_count IS NULL THEN
        -- Create new window
        INSERT INTO proxyfaqs.rate_limits (identifier, endpoint, window_start, window_end, request_count)
        VALUES (p_identifier, p_endpoint, v_current_window_start, v_current_window_end, 1);

        RETURN QUERY SELECT true, p_max_requests - 1, v_current_window_end;
        RETURN;
    ELSIF v_current_count < p_max_requests THEN
        -- Increment counter
        UPDATE proxyfaqs.rate_limits
        SET request_count = request_count + 1,
            updated_at = NOW()
        WHERE identifier = p_identifier
          AND endpoint = p_endpoint
          AND window_end = v_current_window_end;

        RETURN QUERY SELECT true, p_max_requests - v_current_count - 1, v_current_window_end;
        RETURN;
    ELSE
        -- Rate limit exceeded - block for remaining time
        UPDATE proxyfaqs.rate_limits
        SET blocked_until = v_current_window_end,
            updated_at = NOW()
        WHERE identifier = p_identifier
          AND endpoint = p_endpoint
          AND window_end = v_current_window_end;

        RETURN QUERY SELECT false, 0, v_current_window_end;
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old rate limit entries
CREATE OR REPLACE FUNCTION proxyfaqs.cleanup_rate_limits() RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    -- Delete entries older than 1 hour
    DELETE FROM proxyfaqs.rate_limits
    WHERE window_end < NOW() - INTERVAL '1 hour';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SCHEDULED CLEANUP (via pg_cron if available)
-- ============================================================

-- Uncomment if pg_cron is installed:
-- SELECT cron.schedule('cleanup-rate-limits', '*/10 * * * *', 'SELECT proxyfaqs.cleanup_rate_limits();');

-- ============================================================
-- UPDATED TIMESTAMP TRIGGER FOR rate_limits
-- ============================================================

DROP TRIGGER IF EXISTS update_rate_limits_timestamp ON proxyfaqs.rate_limits;
CREATE TRIGGER update_rate_limits_timestamp
    BEFORE UPDATE ON proxyfaqs.rate_limits
    FOR EACH ROW EXECUTE FUNCTION proxyfaqs.update_timestamp();

-- ============================================================
-- SECURITY: REVOKE EXCESSIVE PERMISSIONS
-- ============================================================

-- Revoke write permissions from anon and authenticated roles
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA proxyfaqs FROM anon, authenticated;

-- Grant SELECT only for public data
GRANT SELECT ON ALL TABLES IN SCHEMA proxyfaqs TO anon, authenticated;

-- Allow chat_sessions writes for session tracking
GRANT INSERT, UPDATE ON proxyfaqs.chat_sessions TO anon, authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE proxyfaqs.rate_limits IS 'Rate limiting tracking for API endpoints';
COMMENT ON FUNCTION proxyfaqs.check_rate_limit IS 'Check and enforce rate limits for API requests';
COMMENT ON FUNCTION proxyfaqs.cleanup_rate_limits IS 'Clean up expired rate limit entries';

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'proxyfaqs';

-- Verify policies exist
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'proxyfaqs';
