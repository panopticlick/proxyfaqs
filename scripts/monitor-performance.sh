#!/bin/bash
# ProxyFAQs Performance Monitoring Script
# Run this to check performance metrics and cache status

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== ProxyFAQs Performance Monitor ==="
echo ""

# Configuration
DB_CONTAINER="supabase-db"
DB_USER="postgres"
DB_NAME="postgres"

# Check if container is running
if ! docker ps | grep -q "$DB_CONTAINER"; then
    echo -e "${RED}Error: Database container $DB_CONTAINER is not running${NC}"
    exit 1
fi

# Function to run SQL query
run_sql() {
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_CONTAINER" -t -c "$1"
}

# 1. Database size
echo -e "${YELLOW}=== Database Size ===${NC}"
run_sql "SELECT 
    'proxyfaqs.questions' as table_name,
    pg_size_pretty(pg_total_relation_size('proxyfaqs.questions')) as size,
    COUNT(*) as row_count
FROM proxyfaqs.questions
UNION ALL
SELECT 
    'proxyfaqs.categories' as table_name,
    pg_size_pretty(pg_total_relation_size('proxyfaqs.categories')) as size,
    COUNT(*) as row_count
FROM proxyfaqs.categories;"
echo ""

# 2. Materialized view stats
echo -e "${YELLOW}=== Materialized Views ===${NC}"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_CONTAINER" -c "SELECT * FROM proxyfaqs.materialized_view_stats;"
echo ""

# 3. Index usage
echo -e "${YELLOW}=== Index Usage (Top 10) ===${NC}"
run_sql "SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE schemaname = 'proxyfaqs'
ORDER BY idx_scan DESC 
LIMIT 10;"
echo ""

# 4. Cache hit ratio
echo -e "${YELLOW}=== Cache Hit Ratio ===${NC}"
run_sql "SELECT 
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100 as cache_hit_ratio
FROM pg_statio_user_tables 
WHERE schemaname = 'proxyfaqs';"
echo ""

# 5. Slow queries (if pg_stat_statements is available)
echo -e "${YELLOW}=== Top Slowest Queries (pg_stat_statements) ===${NC}"
if docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_CONTAINER" -t -c "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements';" | grep -q 1; then
    run_sql "SELECT 
        calls,
        total_exec_time / 1000 as total_seconds,
        mean_exec_time / 1000 as avg_seconds,
        query 
    FROM pg_stat_statements 
    WHERE query LIKE '%proxyfaqs%'
    ORDER BY mean_exec_time DESC 
    LIMIT 5;" 2>/dev/null || echo "pg_stat_statements available but no data yet"
else
    echo -e "${YELLOW}pg_stat_statements extension not installed${NC}"
fi
echo ""

# 6. Popular questions cache check
echo -e "${YELLOW}=== Popular Questions MV Age ===${NC}"
run_sql "SELECT 
    age(COALESCE(
        (SELECT pg_catalog.pg_relation_is_updatable('proxyfaqs.popular_questions'::regclass, true) > 0), 
        false
    )) as is_updatable;"
echo ""

echo -e "${GREEN}=== Performance Check Complete ===${NC}"
echo ""
echo "To refresh materialized views, run:"
echo "  make db-refresh"
