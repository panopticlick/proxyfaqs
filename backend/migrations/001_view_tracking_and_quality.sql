-- ProxyFAQs Migration: View Tracking and Content Quality Scoring
-- Date: 2025-01-09
-- Description: Adds view count RPC function and quality scoring columns

-- ============================================================
-- VIEW COUNT INCREMENT FUNCTION
-- ============================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS proxyfaqs.increment_view_count(UUID);

-- Create function to increment view count atomically
CREATE OR REPLACE FUNCTION proxyfaqs.increment_view_count(question_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    -- Increment view count and return new value
    UPDATE proxyfaqs.questions
    SET view_count = view_count + 1
    WHERE id = question_id
    RETURNING view_count INTO new_count;
    
    RETURN new_count;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the request
        RAISE WARNING 'increment_view_count failed for id %: %', question_id, SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
PARALLEL SAFE;

-- Grant permissions to all roles
GRANT EXECUTE ON FUNCTION proxyfaqs.increment_view_count(UUID) TO postgres, anon, authenticated, service_role;

-- ============================================================
-- CONTENT QUALITY COLUMNS
-- ============================================================

-- Add quality_score column to questions (0-100 scale)
ALTER TABLE proxyfaqs.questions 
    ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT NULL 
    CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100));

-- Add last_reviewed timestamp
ALTER TABLE proxyfaqs.questions 
    ADD COLUMN IF NOT EXISTS last_reviewed TIMESTAMPTZ DEFAULT NULL;

-- Add index for quality-based queries
CREATE INDEX IF NOT EXISTS idx_questions_quality_score 
    ON proxyfaqs.questions(quality_score DESC NULLS LAST) 
    WHERE quality_score IS NOT NULL;

-- Add index for content review workflow
CREATE INDEX IF NOT EXISTS idx_questions_last_reviewed 
    ON proxyfaqs.questions(last_reviewed NULLS FIRST);

-- ============================================================
-- QUALITY SCORE CALCULATION FUNCTION
-- ============================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS proxyfaqs.calculate_quality_score(UUID);

-- Calculate quality score based on various factors
CREATE OR REPLACE FUNCTION proxyfaqs.calculate_quality_score(question_id UUID)
RETURNS INTEGER AS $$
DECLARE
    q RECORD;
    score INTEGER := 0;
    answer_length INTEGER;
    has_html BOOLEAN;
    has_meta BOOLEAN;
    days_since_update NUMERIC;
BEGIN
    -- Get question data
    SELECT * INTO q FROM proxyfaqs.questions WHERE id = question_id;
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    
    -- Base score: 20 points
    score := 20;
    
    -- Answer length (up to 30 points)
    answer_length := LENGTH(q.answer);
    IF answer_length > 500 THEN
        score := score + 30;
    ELSIF answer_length > 200 THEN
        score := score + 20;
    ELSIF answer_length > 100 THEN
        score := score + 10;
    END IF;
    
    -- Has HTML formatted answer (15 points)
    has_html := (q.answer_html IS NOT NULL AND LENGTH(q.answer_html) > 100);
    IF has_html THEN
        score := score + 15;
    END IF;
    
    -- Has meta tags (10 points)
    has_meta := (q.meta_title IS NOT NULL OR q.meta_description IS NOT NULL);
    IF has_meta THEN
        score := score + 10;
    END IF;
    
    -- Has source URL (5 points)
    IF q.source_url IS NOT NULL THEN
        score := score + 5;
    END IF;
    
    -- Freshness bonus (up to 10 points)
    days_since_update := EXTRACT(EPOCH FROM (NOW() - q.updated_at)) / 86400;
    IF days_since_update < 30 THEN
        score := score + 10;
    ELSIF days_since_update < 90 THEN
        score := score + 5;
    END IF;
    
    -- Cap at 100
    score := LEAST(score, 100);
    
    -- Update the quality_score column
    UPDATE proxyfaqs.questions
    SET quality_score = score, last_reviewed = NOW()
    WHERE id = question_id;
    
    RETURN score;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION proxyfaqs.calculate_quality_score(UUID) TO postgres, anon, authenticated, service_role;

-- ============================================================
-- BATCH QUALITY SCORE UPDATE
-- ============================================================

-- Function to update quality scores for all questions
CREATE OR REPLACE FUNCTION proxyfaqs.recalculate_all_quality_scores()
RETURNS INTEGER AS $$
DECLARE
    q RECORD;
    count INTEGER := 0;
BEGIN
    FOR q IN SELECT id FROM proxyfaqs.questions LOOP
        PERFORM proxyfaqs.calculate_quality_score(q.id);
        count := count + 1;
    END LOOP;
    RETURN count;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION proxyfaqs.recalculate_all_quality_scores() TO postgres, service_role;

-- ============================================================
-- VIEWS FOR MONITORING
-- ============================================================

-- View for low-quality content needing review
CREATE OR REPLACE VIEW proxyfaqs.content_review_queue AS
SELECT 
    id,
    slug,
    question,
    category,
    quality_score,
    view_count,
    updated_at,
    last_reviewed
FROM proxyfaqs.questions
WHERE quality_score IS NULL OR quality_score < 50
ORDER BY 
    quality_score NULLS FIRST,
    view_count DESC;

-- View for high-quality content
CREATE OR REPLACE VIEW proxyfaqs.top_quality_content AS
SELECT 
    id,
    slug,
    question,
    category,
    quality_score,
    view_count
FROM proxyfaqs.questions
WHERE quality_score >= 70
ORDER BY quality_score DESC, view_count DESC;

-- ============================================================
-- INITIAL POPULATION (optional - commented out)
-- ============================================================

-- Uncomment to run initial quality score calculation
-- SELECT proxyfaqs.recalculate_all_quality_scores();

COMMENT ON FUNCTION proxyfaqs.increment_view_count(UUID) IS 'Atomically increment view count for a question and return new count';
COMMENT ON FUNCTION proxyfaqs.calculate_quality_score(UUID) IS 'Calculate and store quality score (0-100) for a question based on content factors';
COMMENT ON FUNCTION proxyfaqs.recalculate_all_quality_scores() IS 'Recalculate quality scores for all questions in the database';
COMMENT ON COLUMN proxyfaqs.questions.quality_score IS 'Content quality score (0-100) based on completeness, formatting, and freshness';
COMMENT ON COLUMN proxyfaqs.questions.last_reviewed IS 'Timestamp of last content quality review';
