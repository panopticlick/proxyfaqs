-- ProxyFAQs Database Initialization
-- 清空并重建 questions 表结构

-- Drop existing table if needed (uncomment to reset)
-- DROP TABLE IF EXISTS proxyfaqs.questions CASCADE;

-- Create questions table with enhanced schema
CREATE TABLE IF NOT EXISTS proxyfaqs.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_html TEXT,
  category TEXT NOT NULL,
  category_slug TEXT,

  -- SEO metadata
  search_volume INTEGER DEFAULT 0,
  seo_difficulty INTEGER,
  country TEXT DEFAULT 'us',

  -- Source tracking
  source_keyword TEXT,
  source_url TEXT,
  source_ids TEXT[], -- Array of knowledge base IDs used

  -- SEO fields
  meta_title TEXT,
  meta_description TEXT,

  -- Full-text search
  search_vector tsvector,

  -- Stats
  view_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION proxyfaqs.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_questions_timestamp ON proxyfaqs.questions;
CREATE TRIGGER update_questions_timestamp
  BEFORE UPDATE ON proxyfaqs.questions
  FOR EACH ROW
  EXECUTE FUNCTION proxyfaqs.update_timestamp();

-- Auto-generate search vector trigger
CREATE OR REPLACE FUNCTION proxyfaqs.generate_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.question, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.answer, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_search_vector_trigger ON proxyfaqs.questions;
CREATE TRIGGER generate_search_vector_trigger
  BEFORE INSERT OR UPDATE OF question, answer, category ON proxyfaqs.questions
  FOR EACH ROW
  EXECUTE FUNCTION proxyfaqs.generate_search_vector();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_questions_slug ON proxyfaqs.questions(slug);
CREATE INDEX IF NOT EXISTS idx_questions_category ON proxyfaqs.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_category_slug ON proxyfaqs.questions(category_slug);
CREATE INDEX IF NOT EXISTS idx_questions_volume ON proxyfaqs.questions(search_volume DESC);
CREATE INDEX IF NOT EXISTS idx_questions_search_vector ON proxyfaqs.questions USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_questions_status ON proxyfaqs.questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON proxyfaqs.questions(created_at DESC);

-- Permissions
GRANT USAGE ON SCHEMA proxyfaqs TO postgres, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON proxyfaqs.questions TO anon, authenticated;
GRANT ALL ON proxyfaqs.questions TO postgres, service_role;
GRANT EXECUTE ON FUNCTION proxyfaqs.update_timestamp() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION proxyfaqs.generate_search_vector() TO postgres, anon, authenticated, service_role;

-- Increment view count function
CREATE OR REPLACE FUNCTION proxyfaqs.increment_view_count(question_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE proxyfaqs.questions
  SET view_count = view_count + 1
  WHERE id = question_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION proxyfaqs.increment_view_count(UUID) TO postgres, anon, authenticated, service_role;

-- Display statistics
SELECT
  'Questions table ready' as status,
  COUNT(*) as current_count,
  COALESCE(MAX(search_volume), 0) as max_volume
FROM proxyfaqs.questions;
