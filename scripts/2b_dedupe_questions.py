#!/usr/bin/env python3
"""
Semantic Deduplication for SEO Questions

Clusters semantically similar questions and keeps the highest-volume variant.
Preserves all variants as FAQ references.

Input:  output/seo_questions.jsonl (260 questions)
Output: output/questions_queue.jsonl (~200 unique questions with variants)
"""

import json
import re
from pathlib import Path
from typing import Dict, List
from collections import defaultdict


def normalize_question(question: str) -> str:
    """
    Normalize question for clustering.
    Removes common words, punctuation, and extra whitespace.
    """
    q = question.lower().strip()

    # Remove common question words and articles
    stop_words = [
        'what', 'is', 'a', 'an', 'the', 'are', 'how', 'to', 'do', 'does',
        'can', 'whats', "what's", 'my', 'your', 'their', 'our', 'its',
        'i', 'you', 'we', 'they', 'it', 'this', 'that', 'these', 'those',
        'for', 'of', 'in', 'on', 'at', 'with', 'by', 'from', 'and', 'or'
    ]

    # Remove punctuation except hyphens
    q = re.sub(r'[^\w\s-]', '', q)

    # Remove stop words
    words = q.split()
    words = [w for w in words if w not in stop_words]

    # Join and clean
    normalized = ' '.join(words)
    normalized = re.sub(r'\s+', ' ', normalized).strip()

    return normalized


def cluster_questions(questions: List[Dict]) -> Dict[str, List[Dict]]:
    """
    Cluster questions by normalized form.
    """
    clusters = defaultdict(list)

    for q in questions:
        key = normalize_question(q['question'])
        if key:  # Skip empty keys
            clusters[key].append(q)

    return clusters


def select_best_variant(cluster: List[Dict]) -> Dict:
    """
    Select the best variant from a cluster (highest volume).
    Preserve other variants as references.
    """
    # Sort by volume (descending)
    sorted_cluster = sorted(cluster, key=lambda x: x.get('volume', 0), reverse=True)

    # Best is highest volume
    best = sorted_cluster[0].copy()

    # Collect variants (excluding the best one)
    variants = []
    for item in sorted_cluster[1:]:
        variant_q = item['question']
        if variant_q != best['question']:
            variants.append(variant_q)

    # Add variants to best
    best['variants'] = variants
    best['variant_count'] = len(variants)
    best['total_volume'] = sum(item.get('volume', 0) for item in cluster)
    best['status'] = 'pending'
    best['category'] = None

    return best


def dedupe_questions(input_path: Path, output_path: Path) -> Dict:
    """
    Main deduplication process.
    """
    # Load questions
    print(f"Loading questions from {input_path}...")
    questions = []
    with open(input_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                questions.append(json.loads(line))

    print(f"  Loaded {len(questions)} questions")

    # Cluster by normalized form
    print("\nClustering questions...")
    clusters = cluster_questions(questions)
    print(f"  Found {len(clusters)} unique clusters")

    # Select best from each cluster
    print("\nSelecting best variants...")
    deduped = []
    merged_count = 0

    for key, cluster in clusters.items():
        best = select_best_variant(cluster)
        deduped.append(best)
        if len(cluster) > 1:
            merged_count += 1

    # Sort by volume (descending)
    deduped = sorted(deduped, key=lambda x: x.get('volume', 0), reverse=True)

    # Assign new sequential IDs
    for idx, item in enumerate(deduped, start=1):
        item['id'] = idx

    # Save output
    print(f"\nWriting to {output_path}...")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        for item in deduped:
            json.dump(item, ensure_ascii=False, fp=f)
            f.write('\n')

    # Statistics
    stats = {
        'input_count': len(questions),
        'output_count': len(deduped),
        'merged_clusters': merged_count,
        'reduction': len(questions) - len(deduped),
        'reduction_pct': (1 - len(deduped) / len(questions)) * 100 if questions else 0,
        'with_variants': sum(1 for d in deduped if d['variants']),
        'total_variants': sum(len(d['variants']) for d in deduped)
    }

    return stats, deduped


def print_stats(stats: Dict, deduped: List[Dict]):
    """Print deduplication statistics."""
    print("\n" + "=" * 60)
    print("DEDUPLICATION STATISTICS")
    print("=" * 60)
    print(f"Input questions:       {stats['input_count']}")
    print(f"Output questions:      {stats['output_count']}")
    print(f"Merged clusters:       {stats['merged_clusters']}")
    print(f"Reduction:             {stats['reduction']} ({stats['reduction_pct']:.1f}%)")
    print(f"Questions with variants: {stats['with_variants']}")
    print(f"Total variants:        {stats['total_variants']}")

    # Volume distribution
    high = sum(1 for d in deduped if d.get('volume', 0) > 1000)
    mid = sum(1 for d in deduped if 200 <= d.get('volume', 0) <= 1000)
    low = sum(1 for d in deduped if d.get('volume', 0) < 200)

    print(f"\nVolume distribution:")
    print(f"  High (>1000):        {high}")
    print(f"  Mid (200-1000):      {mid}")
    print(f"  Low (<200):          {low}")

    # Show top merged clusters
    merged = [d for d in deduped if d['variants']]
    merged = sorted(merged, key=lambda x: x['total_volume'], reverse=True)

    print(f"\nTop 10 merged clusters:")
    for i, item in enumerate(merged[:10], 1):
        print(f"\n  {i}. \"{item['question']}\" (vol: {item['volume']:,})")
        print(f"     Total cluster volume: {item['total_volume']:,}")
        print(f"     Variants ({len(item['variants'])}):")
        for v in item['variants'][:3]:
            print(f"       - {v}")
        if len(item['variants']) > 3:
            print(f"       - ... and {len(item['variants']) - 3} more")


def main():
    """Main entry point."""
    base_dir = Path(__file__).parent.parent
    input_path = base_dir / 'output' / 'seo_questions.jsonl'
    output_path = base_dir / 'output' / 'questions_queue.jsonl'

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        print("Run 2_extract_seo_questions.py first")
        exit(1)

    stats, deduped = dedupe_questions(input_path, output_path)
    print_stats(stats, deduped)

    print(f"\n{'=' * 60}")
    print(f"SUCCESS: Deduplication complete!")
    print(f"Output: {output_path}")
    print(f"{'=' * 60}\n")


if __name__ == '__main__':
    main()
