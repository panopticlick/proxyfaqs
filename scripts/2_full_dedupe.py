#!/usr/bin/env python3
"""
Full Semantic Deduplication - Process ALL 4,040 Questions

NO volume filtering - process everything first, then decide what to generate.
Clusters semantically similar questions and merges them.

Input:
  - data/google_proxy_question.csv (3,057 questions)
  - data/google_proxies_question.csv (983 questions)

Output:
  - output/all_questions_deduped.jsonl (unique questions with variants)
"""

import csv
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict


def read_csv_utf16(file_path: Path) -> List[Dict]:
    """Read UTF-16 encoded CSV file"""
    rows = []

    for encoding in ['utf-16', 'utf-16-le', 'utf-16-be']:
        try:
            with open(file_path, 'r', encoding=encoding) as f:
                reader = csv.DictReader(f, delimiter='\t')
                for row in reader:
                    rows.append(row)
            return rows
        except (UnicodeDecodeError, UnicodeError):
            continue

    raise ValueError(f"Failed to read {file_path}")


def normalize_question(question: str) -> str:
    """
    Normalize question for semantic clustering.
    Aggressive normalization to catch more duplicates.
    """
    q = question.lower().strip()

    # Remove punctuation
    q = re.sub(r'[^\w\s]', '', q)

    # Common variations
    q = re.sub(r'\bwhats\b', 'what is', q)
    q = re.sub(r"\bwhat's\b", 'what is', q)
    q = re.sub(r'\bhow do i\b', 'how to', q)
    q = re.sub(r'\bhow can i\b', 'how to', q)
    q = re.sub(r'\bhow do you\b', 'how to', q)

    # Remove stop words
    stop_words = {
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
        'do', 'does', 'did', 'can', 'could', 'would', 'should',
        'i', 'you', 'we', 'they', 'it', 'my', 'your', 'our', 'their',
        'this', 'that', 'these', 'those',
        'for', 'of', 'in', 'on', 'at', 'to', 'with', 'by', 'from',
        'and', 'or', 'but', 'if', 'then', 'so'
    }

    words = q.split()
    words = [w for w in words if w not in stop_words and len(w) > 1]

    # Sort words for order-independent matching
    # e.g., "proxy vs vpn" == "vpn vs proxy"
    normalized = ' '.join(sorted(words))

    return normalized


def parse_int(value: str) -> int:
    """Safe integer parsing"""
    if not value:
        return 0
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return 0


def load_all_questions(data_dir: Path) -> List[Dict]:
    """Load all questions from both CSV files"""
    files = [
        ('google_proxy_question.csv', ['Keyword', 'Country', 'Difficulty', 'Volume']),
        ('google_proxies_question.csv', ['Keyword', 'Volume'])
    ]

    all_questions = []

    for filename, expected_cols in files:
        file_path = data_dir / filename
        if not file_path.exists():
            print(f"  Warning: {filename} not found, skipping")
            continue

        print(f"  Loading {filename}...")
        rows = read_csv_utf16(file_path)

        for row in rows:
            keyword = row.get('Keyword', '').strip()
            if not keyword:
                continue

            question = {
                'question': keyword,
                'volume': parse_int(row.get('Volume', 0)),
                'difficulty': parse_int(row.get('Difficulty', 0)) or None,
                'country': row.get('Country', 'us').strip().lower() or 'us',
                'source': filename
            }
            all_questions.append(question)

        print(f"    Loaded {len(rows)} rows")

    return all_questions


def cluster_questions(questions: List[Dict]) -> Dict[str, List[Dict]]:
    """Cluster questions by normalized form"""
    clusters = defaultdict(list)

    for q in questions:
        key = normalize_question(q['question'])
        if key:
            clusters[key].append(q)

    return clusters


def merge_cluster(cluster: List[Dict]) -> Dict:
    """
    Merge a cluster into a single record.
    Keep highest volume as primary, collect all variants.
    """
    # Sort by volume descending
    sorted_cluster = sorted(cluster, key=lambda x: x.get('volume', 0), reverse=True)

    # Primary is highest volume
    primary = sorted_cluster[0].copy()

    # Collect unique variants (excluding primary)
    seen = {primary['question'].lower()}
    variants = []
    total_volume = primary.get('volume', 0)

    for item in sorted_cluster[1:]:
        q_lower = item['question'].lower()
        if q_lower not in seen:
            seen.add(q_lower)
            variants.append({
                'question': item['question'],
                'volume': item.get('volume', 0)
            })
        total_volume += item.get('volume', 0)

    # Build merged record
    merged = {
        'question': primary['question'],
        'volume': primary.get('volume', 0),
        'total_volume': total_volume,
        'difficulty': primary.get('difficulty'),
        'country': primary.get('country', 'us'),
        'variants': variants,
        'variant_count': len(variants),
        'cluster_size': len(cluster)
    }

    return merged


def generate_slug(question: str) -> str:
    """Generate URL-friendly slug"""
    slug = question.lower().strip()

    # Remove common prefixes
    prefixes = [
        "what is a ", "what is an ", "what is ", "what are ",
        "what does ", "what do ", "how to ", "how do i ",
        "how can i ", "why is ", "why are ", "can i ", "should i "
    ]
    for prefix in prefixes:
        if slug.startswith(prefix):
            slug = slug[len(prefix):]
            break

    slug = slug.rstrip('?')
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')

    if len(slug) > 80:
        slug = slug[:80].rsplit('-', 1)[0]

    return slug


def categorize_question(question: str) -> Tuple[str, str]:
    """Auto-categorize question, returns (category_id, category_name)"""
    q = question.lower()

    # Priority order matching
    categories = [
        ('proxy-types', 'Proxy Types', [
            'residential', 'datacenter', 'rotating', 'mobile',
            'socks', 'http proxy', 'https proxy', 'static', 'isp'
        ]),
        ('web-scraping', 'Web Scraping', [
            'scraping', 'scraper', 'crawl', 'bot', 'selenium', 'puppeteer'
        ]),
        ('comparison', 'Comparisons', [
            ' vs ', 'versus', 'difference', 'compare', ' or '
        ]),
        ('howto', 'How-To Guides', [
            'how to', 'setup', 'configure', 'install', 'connect', 'use '
        ]),
        ('troubleshooting', 'Troubleshooting', [
            'not working', 'error', 'fix', 'problem', 'block', 'ban'
        ]),
        ('security', 'Security & Privacy', [
            'safe', 'secure', 'privacy', 'anonymous', 'legal', 'vpn'
        ]),
        ('basics', 'Proxy Basics', [
            'what is', 'what are', 'what does', 'meaning', 'definition'
        ])
    ]

    for cat_id, cat_name, keywords in categories:
        for kw in keywords:
            if kw in q:
                return cat_id, cat_name

    return 'basics', 'Proxy Basics'


def main():
    base_dir = Path(__file__).parent.parent
    data_dir = base_dir / 'data'
    output_dir = base_dir / 'output'
    output_dir.mkdir(exist_ok=True)

    output_file = output_dir / 'all_questions_deduped.jsonl'

    print("=" * 60)
    print("FULL SEMANTIC DEDUPLICATION")
    print("=" * 60)

    # Load all questions
    print("\nLoading all questions...")
    all_questions = load_all_questions(data_dir)
    print(f"\nTotal loaded: {len(all_questions)}")

    # Cluster by semantic similarity
    print("\nClustering by semantic similarity...")
    clusters = cluster_questions(all_questions)
    print(f"Unique clusters: {len(clusters)}")

    # Merge clusters
    print("\nMerging clusters...")
    merged = []
    for key, cluster in clusters.items():
        merged.append(merge_cluster(cluster))

    # Sort by total volume
    merged = sorted(merged, key=lambda x: x['total_volume'], reverse=True)

    # Add IDs, slugs, categories
    for idx, item in enumerate(merged, 1):
        item['id'] = idx
        item['slug'] = generate_slug(item['question'])
        cat_id, cat_name = categorize_question(item['question'])
        item['category'] = cat_id
        item['category_name'] = cat_name
        item['status'] = 'pending'

    # Save
    print(f"\nWriting to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for item in merged:
            json.dump(item, ensure_ascii=False, fp=f)
            f.write('\n')

    # Statistics
    print("\n" + "=" * 60)
    print("DEDUPLICATION RESULTS")
    print("=" * 60)
    print(f"Input:           {len(all_questions):,} questions")
    print(f"Output:          {len(merged):,} unique clusters")
    print(f"Reduction:       {len(all_questions) - len(merged):,} ({(1 - len(merged)/len(all_questions))*100:.1f}%)")

    # Cluster size distribution
    single = sum(1 for m in merged if m['cluster_size'] == 1)
    multi = sum(1 for m in merged if m['cluster_size'] > 1)
    large = sum(1 for m in merged if m['cluster_size'] >= 5)

    print(f"\nCluster distribution:")
    print(f"  Single (no variants):  {single}")
    print(f"  Multiple (2+ merged):  {multi}")
    print(f"  Large (5+ merged):     {large}")

    # Volume tiers
    high = [m for m in merged if m['volume'] > 1000]
    mid = [m for m in merged if 100 <= m['volume'] <= 1000]
    low = [m for m in merged if m['volume'] < 100]
    zero = [m for m in merged if m['volume'] == 0]

    print(f"\nVolume distribution:")
    print(f"  High (>1000):     {len(high):4} questions")
    print(f"  Mid (100-1000):   {len(mid):4} questions")
    print(f"  Low (1-99):       {len(low) - len(zero):4} questions")
    print(f"  Zero volume:      {len(zero):4} questions")

    # Category distribution
    from collections import Counter
    cats = Counter(m['category_name'] for m in merged)
    print(f"\nCategory distribution:")
    for cat, cnt in cats.most_common():
        print(f"  {cat:20} {cnt:4}")

    # Top clusters by total volume
    print(f"\nTop 15 clusters by total volume:")
    for m in merged[:15]:
        variants_str = f"+{m['variant_count']} variants" if m['variant_count'] else ""
        print(f"  [{m['volume']:>6}] {m['question'][:50]:50} {variants_str}")

    # Top merged clusters
    multi_clusters = [m for m in merged if m['cluster_size'] > 1]
    multi_clusters = sorted(multi_clusters, key=lambda x: x['cluster_size'], reverse=True)

    print(f"\nTop 10 largest merged clusters:")
    for m in multi_clusters[:10]:
        print(f"\n  \"{m['question']}\" ({m['cluster_size']} merged, vol: {m['volume']:,})")
        print(f"    Total volume: {m['total_volume']:,}")
        for v in m['variants'][:3]:
            print(f"      - {v['question']} (vol: {v['volume']})")
        if len(m['variants']) > 3:
            print(f"      ... +{len(m['variants']) - 3} more")

    print(f"\n{'=' * 60}")
    print(f"Output: {output_file}")
    print(f"{'=' * 60}\n")


if __name__ == '__main__':
    main()
