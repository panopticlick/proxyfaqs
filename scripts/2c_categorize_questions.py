#!/usr/bin/env python3
"""
Auto-Categorize Questions for ProxyFAQs

Assigns categories based on keyword matching.
Generates slug for each question.

Input:  output/questions_queue.jsonl (194 deduped questions)
Output: output/questions_categorized.jsonl (with category assignments)
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple
from collections import Counter


# Category definitions with priority order
CATEGORIES = [
    {
        "id": "proxy-types",
        "name": "Proxy Types",
        "slug": "proxy-types",
        "keywords": [
            "residential proxy", "residential proxies",
            "datacenter proxy", "datacenter proxies",
            "rotating proxy", "rotating proxies",
            "mobile proxy", "mobile proxies",
            "socks proxy", "socks5", "socks4",
            "http proxy", "https proxy",
            "static proxy", "sticky proxy",
            "isp proxy", "backconnect"
        ],
        "priority": 1
    },
    {
        "id": "web-scraping",
        "name": "Web Scraping",
        "slug": "web-scraping",
        "keywords": [
            "scraping", "scraper", "scrape",
            "crawl", "crawler", "crawling",
            "bot", "automation",
            "selenium", "puppeteer", "playwright",
            "requests", "beautiful soup",
            "anti-detect", "fingerprint"
        ],
        "priority": 2
    },
    {
        "id": "proxy-comparison",
        "name": "Comparisons",
        "slug": "proxy-comparison",
        "keywords": [
            " vs ", "versus", " or ",
            "difference between",
            "compare", "comparison",
            "better than", "which is better"
        ],
        "priority": 3
    },
    {
        "id": "proxy-howto",
        "name": "How-To Guides",
        "slug": "proxy-howto",
        "keywords": [
            "how to", "how do", "how can",
            "setup", "set up", "setting up",
            "configure", "configuration",
            "install", "connect", "use "
        ],
        "priority": 4
    },
    {
        "id": "troubleshooting",
        "name": "Troubleshooting",
        "slug": "troubleshooting",
        "keywords": [
            "not working", "doesn't work", "won't work",
            "error", "problem", "issue",
            "fix", "solve", "troubleshoot",
            "block", "blocked", "ban", "banned",
            "captcha", "detect"
        ],
        "priority": 5
    },
    {
        "id": "security-privacy",
        "name": "Security & Privacy",
        "slug": "security-privacy",
        "keywords": [
            "safe", "secure", "security",
            "privacy", "anonymous", "anonymity",
            "legal", "illegal", "law",
            "risk", "danger", "vpn"
        ],
        "priority": 6
    },
    {
        "id": "proxy-basics",
        "name": "Proxy Basics",
        "slug": "proxy-basics",
        "keywords": [
            "what is", "what are", "what does",
            "definition", "meaning", "explain",
            "works", "work", "purpose"
        ],
        "priority": 7  # Lower priority (catch-all for definitions)
    }
]


def generate_slug(question: str) -> str:
    """
    Generate URL-friendly slug from question.
    """
    slug = question.lower().strip()

    # Remove common prefixes
    prefixes = [
        "what is a ", "what is an ", "what is ",
        "what are ", "what does ", "what do ",
        "how to ", "how do i ", "how do you ",
        "how can i ", "how can you ",
        "why is ", "why are ", "why do ", "why does ",
        "can i ", "can you ", "should i ", "should you "
    ]
    for prefix in prefixes:
        if slug.startswith(prefix):
            slug = slug[len(prefix):]
            break

    # Remove trailing question mark
    slug = slug.rstrip('?')

    # Replace special characters with hyphens
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')

    # Limit length
    if len(slug) > 80:
        slug = slug[:80].rsplit('-', 1)[0]

    return slug


def categorize_question(question: str) -> Tuple[str, str, str]:
    """
    Categorize a question based on keyword matching.
    Returns (category_id, category_name, category_slug)
    """
    q_lower = question.lower()

    # Check categories in priority order
    sorted_categories = sorted(CATEGORIES, key=lambda x: x['priority'])

    for cat in sorted_categories:
        for keyword in cat['keywords']:
            if keyword in q_lower:
                return cat['id'], cat['name'], cat['slug']

    # Default to basics
    return "proxy-basics", "Proxy Basics", "proxy-basics"


def categorize_all(input_path: Path, output_path: Path) -> Dict:
    """
    Main categorization process.
    """
    # Load questions
    print(f"Loading questions from {input_path}...")
    questions = []
    with open(input_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                questions.append(json.loads(line))

    print(f"  Loaded {len(questions)} questions")

    # Categorize each question
    print("\nCategorizing questions...")
    category_counts = Counter()

    for q in questions:
        question_text = q['question']

        # Assign category
        cat_id, cat_name, cat_slug = categorize_question(question_text)
        q['category'] = cat_id
        q['category_name'] = cat_name
        q['category_slug'] = cat_slug

        # Generate slug
        q['slug'] = generate_slug(question_text)

        category_counts[cat_id] += 1

    # Save output
    print(f"\nWriting to {output_path}...")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        for q in questions:
            json.dump(q, ensure_ascii=False, fp=f)
            f.write('\n')

    # Statistics
    stats = {
        'total': len(questions),
        'categories': dict(category_counts)
    }

    return stats, questions


def print_stats(stats: Dict, questions: List[Dict]):
    """Print categorization statistics."""
    print("\n" + "=" * 60)
    print("CATEGORIZATION STATISTICS")
    print("=" * 60)
    print(f"Total questions: {stats['total']}")

    print(f"\nCategory distribution:")
    for cat_id, count in sorted(stats['categories'].items(), key=lambda x: -x[1]):
        cat_name = next((c['name'] for c in CATEGORIES if c['id'] == cat_id), cat_id)
        pct = count / stats['total'] * 100
        bar = '#' * int(pct / 2)
        print(f"  {cat_name:20} {count:3} ({pct:5.1f}%) {bar}")

    # Show examples per category
    print(f"\nExamples per category:")
    for cat in CATEGORIES:
        cat_questions = [q for q in questions if q['category'] == cat['id']]
        if cat_questions:
            print(f"\n  [{cat['name']}] ({len(cat_questions)} questions)")
            for q in cat_questions[:3]:
                print(f"    - {q['question'][:60]}...")
                print(f"      slug: /q/{q['slug']}")


def main():
    """Main entry point."""
    base_dir = Path(__file__).parent.parent
    input_path = base_dir / 'output' / 'questions_queue.jsonl'
    output_path = base_dir / 'output' / 'questions_categorized.jsonl'

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        print("Run 2b_dedupe_questions.py first")
        exit(1)

    stats, questions = categorize_all(input_path, output_path)
    print_stats(stats, questions)

    print(f"\n{'=' * 60}")
    print(f"SUCCESS: Categorization complete!")
    print(f"Output: {output_path}")
    print(f"{'=' * 60}\n")


if __name__ == '__main__':
    main()
