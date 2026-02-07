#!/usr/bin/env python3
"""
Import Generated Articles to PostgreSQL Database

Imports articles to proxyfaqs.questions table with RAG weight optimization.
High-volume questions get higher search weight.

Input:  output/qa_articles.jsonl
Output: PostgreSQL proxyfaqs.questions table

Weight Strategy:
  - Volume > 1000:  question='A', answer='A' (highest priority)
  - Volume 200-1000: question='A', answer='B'
  - Volume < 200:    question='B', answer='C' (lower priority)

Usage:
  python3 scripts/4_import_to_db.py              # Import all
  python3 scripts/4_import_to_db.py --dry-run    # Preview without inserting
  python3 scripts/4_import_to_db.py --batch 50   # Import in batches
"""

import os
import json
import argparse
from pathlib import Path
from typing import Dict, List, Tuple
from datetime import datetime

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    exit(1)

try:
    from tqdm import tqdm
except ImportError:
    print("ERROR: tqdm not installed. Run: pip install tqdm")
    exit(1)


# Database connection settings
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'supabase-db'),
    'port': int(os.getenv('DB_PORT', 5432)),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'options': '-c search_path=proxyfaqs,public'
}


def get_weight_class(volume: int) -> Tuple[str, str]:
    """
    Determine search weight class based on volume.
    Returns (question_weight, answer_weight)
    """
    if volume > 1000:
        return 'A', 'A'  # Highest priority
    elif volume >= 200:
        return 'A', 'B'  # High priority
    else:
        return 'B', 'C'  # Normal priority


def connect_db() -> psycopg2.extensions.connection:
    """Create database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"ERROR: Could not connect to database: {e}")
        print("\nCheck your environment variables:")
        print("  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD")
        exit(1)


def load_articles(input_path: Path) -> List[Dict]:
    """Load articles from JSONL file"""
    print(f"Loading articles from {input_path}...")

    articles = []
    failed = 0

    with open(input_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                article = json.loads(line)
                # Skip failed records
                if article.get('status') == 'failed':
                    failed += 1
                    continue
                if not article.get('article'):
                    failed += 1
                    continue
                articles.append(article)

    print(f"  Loaded {len(articles)} articles ({failed} failed/skipped)")
    return articles


def prepare_record(article: Dict) -> Dict:
    """Prepare article record for database insertion"""
    volume = article.get('volume', 0) or 0
    q_weight, a_weight = get_weight_class(volume)

    return {
        'slug': article.get('slug', ''),
        'question': article.get('question', ''),
        'answer': article.get('article', ''),
        'answer_html': article.get('article_html', ''),
        'category': article.get('category_name', 'General'),
        'category_slug': article.get('category_slug', 'general'),
        'meta_title': article.get('title', ''),
        'meta_description': article.get('meta_description', ''),
        'source_keyword': ','.join(article.get('variants', [])[:5]),
        'source_url': '',
        'view_count': 0,
        'volume': volume,
        'difficulty': article.get('difficulty'),
        'word_count': article.get('word_count', 0),
        'q_weight': q_weight,
        'a_weight': a_weight
    }


def insert_articles(conn, articles: List[Dict], dry_run: bool = False):
    """Insert articles into database"""
    cursor = conn.cursor()

    # SQL with upsert and dynamic weight assignment
    sql = """
    INSERT INTO proxyfaqs.questions (
        slug, question, answer, answer_html,
        category, category_slug,
        meta_title, meta_description,
        source_keyword, source_url,
        view_count, search_vector
    ) VALUES (
        %(slug)s, %(question)s, %(answer)s, %(answer_html)s,
        %(category)s, %(category_slug)s,
        %(meta_title)s, %(meta_description)s,
        %(source_keyword)s, %(source_url)s,
        %(view_count)s,
        setweight(to_tsvector('english', %(question)s), %(q_weight)s) ||
        setweight(to_tsvector('english', %(answer)s), %(a_weight)s)
    )
    ON CONFLICT (slug) DO UPDATE SET
        question = EXCLUDED.question,
        answer = EXCLUDED.answer,
        answer_html = EXCLUDED.answer_html,
        category = EXCLUDED.category,
        category_slug = EXCLUDED.category_slug,
        meta_title = EXCLUDED.meta_title,
        meta_description = EXCLUDED.meta_description,
        source_keyword = EXCLUDED.source_keyword,
        search_vector = EXCLUDED.search_vector,
        updated_at = NOW()
    """

    inserted = 0
    updated = 0
    failed = 0

    for article in tqdm(articles, desc="Importing"):
        record = prepare_record(article)

        if dry_run:
            # Preview mode
            print(f"\n[DRY RUN] Would insert: {record['slug']}")
            print(f"  Title: {record['meta_title'][:60]}...")
            print(f"  Category: {record['category']}")
            print(f"  Volume: {record['volume']} -> Weight: {record['q_weight']}/{record['a_weight']}")
            print(f"  Words: {record['word_count']}")
            inserted += 1
            continue

        try:
            cursor.execute(sql, record)

            # Check if inserted or updated
            if cursor.rowcount > 0:
                inserted += 1

        except Exception as e:
            failed += 1
            print(f"\n  ERROR inserting {record['slug']}: {e}")
            conn.rollback()
            continue

    if not dry_run:
        conn.commit()

    cursor.close()

    return inserted, updated, failed


def verify_import(conn, expected_count: int):
    """Verify import by counting records"""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM proxyfaqs.questions")
    total = cursor.fetchone()[0]

    cursor.execute("""
        SELECT category, COUNT(*) as cnt
        FROM proxyfaqs.questions
        GROUP BY category
        ORDER BY cnt DESC
    """)
    categories = cursor.fetchall()

    cursor.close()

    print(f"\nDatabase verification:")
    print(f"  Total records: {total}")
    print(f"\n  By category:")
    for cat, cnt in categories:
        print(f"    {cat}: {cnt}")


def print_stats(articles: List[Dict], inserted: int, failed: int, dry_run: bool):
    """Print import statistics"""
    print("\n" + "=" * 60)
    print("IMPORT STATISTICS" + (" (DRY RUN)" if dry_run else ""))
    print("=" * 60)
    print(f"Total articles:    {len(articles)}")
    print(f"Inserted/Updated:  {inserted}")
    print(f"Failed:            {failed}")

    # Weight distribution
    weights = {'A/A': 0, 'A/B': 0, 'B/C': 0}
    for a in articles:
        volume = a.get('volume', 0) or 0
        q, ans = get_weight_class(volume)
        key = f"{q}/{ans}"
        weights[key] = weights.get(key, 0) + 1

    print(f"\nWeight distribution:")
    for w, cnt in weights.items():
        print(f"  {w}: {cnt}")

    # Word count stats
    word_counts = [a.get('word_count', 0) for a in articles if a.get('word_count')]
    if word_counts:
        print(f"\nWord counts:")
        print(f"  Average: {sum(word_counts) / len(word_counts):.0f}")
        print(f"  Min:     {min(word_counts)}")
        print(f"  Max:     {max(word_counts)}")
        print(f"  < 1000:  {sum(1 for w in word_counts if w < 1000)}")
        print(f"  >= 1200: {sum(1 for w in word_counts if w >= 1200)}")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Import generated articles to PostgreSQL"
    )

    parser.add_argument('--dry-run', action='store_true',
                       help='Preview without inserting')
    parser.add_argument('--batch', type=int, default=None,
                       help='Limit to N articles')
    parser.add_argument('--verify', action='store_true',
                       help='Verify import after completion')

    args = parser.parse_args()

    # Paths
    project_root = Path(__file__).parent.parent
    input_path = project_root / 'output' / 'qa_articles.jsonl'

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        print("Run 3_generate_articles.py first")
        exit(1)

    # Load articles
    articles = load_articles(input_path)

    if args.batch:
        articles = articles[:args.batch]
        print(f"  Limited to {len(articles)} articles (--batch)")

    if not articles:
        print("No articles to import")
        exit(0)

    # Connect to database
    if not args.dry_run:
        print("\nConnecting to database...")
        conn = connect_db()
        print("  Connected")
    else:
        conn = None

    # Import articles
    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Importing {len(articles)} articles...")

    try:
        inserted, updated, failed = insert_articles(conn, articles, args.dry_run)

        # Print stats
        print_stats(articles, inserted, failed, args.dry_run)

        # Verify if requested
        if args.verify and conn and not args.dry_run:
            verify_import(conn, len(articles))

    finally:
        if conn:
            conn.close()

    print(f"\n{'=' * 60}")
    print(f"{'[DRY RUN] ' if args.dry_run else ''}Import complete!")
    print(f"{'=' * 60}\n")


if __name__ == '__main__':
    main()
