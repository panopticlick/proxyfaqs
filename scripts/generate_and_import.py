#!/usr/bin/env python3
"""
Generate + Auto-Import to Database

Each completed article is immediately imported to PostgreSQL.
Monitors output/articles/ for new complete articles and imports them.
"""

import json
import time
import glob
import os
from pathlib import Path
from datetime import datetime

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("pip install psycopg2-binary")
    exit(1)

# Database config
DB_CONFIG = {
    'host': 'supabase-db',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres',
    'password': os.getenv('DB_PASSWORD', ''),
    'options': '-c search_path=proxyfaqs,public'
}

def get_weight_class(volume):
    if volume > 1000:
        return 'A', 'A'
    elif volume >= 200:
        return 'A', 'B'
    else:
        return 'B', 'C'

def connect_db():
    return psycopg2.connect(**DB_CONFIG)

def get_imported_slugs(conn):
    """Get already imported slugs"""
    cur = conn.cursor()
    cur.execute("SELECT slug FROM proxyfaqs.questions")
    slugs = set(row[0] for row in cur.fetchall())
    cur.close()
    return slugs

def import_article(conn, article):
    """Import single article to database"""
    slug = article.get('slug', '')
    question = article.get('question', '')
    quick = article.get('quick_answer', '')
    detailed = article.get('detailed_answer', '')
    volume = article.get('volume', 0) or 0

    # Combine quick + detailed as full answer
    full_answer = f"{quick}\n\n{detailed}"

    # Weight
    q_weight, a_weight = get_weight_class(volume)

    # Get metadata
    meta_title = article.get('title', question)
    meta_desc = article.get('meta_description', '')
    category = article.get('category_name', 'General')

    sql = """
    INSERT INTO proxyfaqs.questions (
        slug, question, answer, answer_html,
        category, category_slug,
        meta_title, meta_description,
        view_count, search_vector
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, 0,
        setweight(to_tsvector('english', %s), %s) ||
        setweight(to_tsvector('english', %s), %s)
    )
    ON CONFLICT (slug) DO UPDATE SET
        question = EXCLUDED.question,
        answer = EXCLUDED.answer,
        answer_html = EXCLUDED.answer_html,
        category = EXCLUDED.category,
        meta_title = EXCLUDED.meta_title,
        meta_description = EXCLUDED.meta_description,
        search_vector = EXCLUDED.search_vector,
        updated_at = NOW()
    """

    cur = conn.cursor()
    cur.execute(sql, (
        slug, question, full_answer, full_answer,
        category, category.lower().replace(' ', '-'),
        meta_title, meta_desc,
        question, q_weight, full_answer, a_weight
    ))
    conn.commit()
    cur.close()

    return True

def monitor_and_import():
    """Monitor articles directory and import complete ones"""

    articles_dir = Path("output/articles")
    imported = set()
    failed = set()

    # Get existing from DB
    print("Connecting to database...")
    conn = connect_db()
    imported = get_imported_slugs(conn)
    print(f"  Already imported: {len(imported)} articles")

    print("\n=== Monitoring for new articles ===")
    print("Press Ctrl+C to stop\n")

    last_count = 0
    check_interval = 10  # seconds

    try:
        while True:
            # Find all JSON files
            files = list(articles_dir.glob("*.json"))
            complete = []
            empty = 0

            for f in files:
                try:
                    with open(f) as fp:
                        data = json.load(fp)
                        wc = data.get('word_count', 0)
                        if wc >= 1200:
                            complete.append((f, data))
                        elif wc == 0:
                            empty += 1
                except:
                    empty += 1

            # Import new complete articles
            new_imports = 0
            for f, data in complete:
                slug = data.get('slug', f.stem)
                if slug not in imported and slug not in failed:
                    try:
                        import_article(conn, data)
                        imported.add(slug)
                        new_imports += 1
                        print(f"  ✓ Imported: {slug} ({data.get('word_count', 0)} words)")
                    except Exception as e:
                        failed.add(slug)
                        print(f"  ✗ Failed: {slug} - {e}")

            # Print status if changed
            total = len(complete)
            if total != last_count:
                now = datetime.now().strftime("%H:%M:%S")
                print(f"[{now}] Complete: {total} | Processing: {empty} | Just imported: {new_imports}")
                last_count = total

            time.sleep(check_interval)

    except KeyboardInterrupt:
        print("\n\nStopped by user")
    finally:
        conn.close()

if __name__ == '__main__':
    monitor_and_import()
