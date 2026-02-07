#!/usr/bin/env python3
"""
Extract SEO questions with search volume from CSV files.

Input:
  - data/google_proxy_question.csv (UTF-16, columns: Keyword, Country, Difficulty, Volume)
  - data/google_proxies_question.csv (UTF-16, columns: Keyword, Volume)

Output:
  - output/seo_questions.jsonl

Features:
  - Merges and deduplicates questions
  - Filters by Volume >= 100
  - Sorts by Volume (descending)
  - Outputs JSONL format with stats
"""

import csv
import json
from pathlib import Path
from typing import Dict, List, Optional


def read_csv_utf16(file_path: Path) -> List[Dict]:
    """Read CSV file with UTF-16 encoding."""
    rows = []
    encodings = ['utf-16', 'utf-16-le', 'utf-16-be']

    for encoding in encodings:
        try:
            with open(file_path, 'r', encoding=encoding) as f:
                reader = csv.DictReader(f, delimiter='\t')
                for row in reader:
                    rows.append(row)
            return rows
        except (UnicodeDecodeError, UnicodeError):
            continue

    # If all UTF-16 variants fail, raise error
    raise ValueError(f"Failed to read {file_path} with UTF-16 encoding")


def parse_volume(value: str) -> int:
    """Parse volume value, return 0 if invalid."""
    if not value or value.strip() == '':
        return 0
    try:
        return int(value.strip())
    except ValueError:
        return 0


def parse_difficulty(value: str) -> Optional[int]:
    """Parse difficulty value, return None if invalid."""
    if not value or value.strip() == '':
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def main():
    base_dir = Path(__file__).parent.parent
    data_dir = base_dir / 'data'
    output_dir = base_dir / 'output'
    output_dir.mkdir(exist_ok=True)

    # Input files
    file1 = data_dir / 'google_proxy_question.csv'
    file2 = data_dir / 'google_proxies_question.csv'
    output_file = output_dir / 'seo_questions.jsonl'

    print("Reading CSV files...")

    # Read first file (Keyword, Country, Difficulty, Volume)
    print(f"  Reading {file1.name}...")
    rows1 = read_csv_utf16(file1)
    print(f"    Loaded {len(rows1)} rows")

    # Read second file (Keyword, Volume)
    print(f"  Reading {file2.name}...")
    rows2 = read_csv_utf16(file2)
    print(f"    Loaded {len(rows2)} rows")

    # Process and merge data
    questions_dict: Dict[str, Dict] = {}

    # Process first file
    for row in rows1:
        keyword = row.get('Keyword', '').strip().lower()
        if not keyword:
            continue

        volume = parse_volume(row.get('Volume', '0'))
        if volume < 100:  # Filter low volume
            continue

        questions_dict[keyword] = {
            'question': keyword,
            'volume': volume,
            'difficulty': parse_difficulty(row.get('Difficulty', '')),
            'country': row.get('Country', '').strip().lower() or 'us'
        }

    # Process second file (merge/update)
    for row in rows2:
        keyword = row.get('Keyword', '').strip().lower()
        if not keyword:
            continue

        volume = parse_volume(row.get('Volume', '0'))
        if volume < 100:  # Filter low volume
            continue

        # If keyword already exists, keep the one with higher volume
        if keyword in questions_dict:
            if volume > questions_dict[keyword]['volume']:
                questions_dict[keyword]['volume'] = volume
        else:
            questions_dict[keyword] = {
                'question': keyword,
                'volume': volume,
                'difficulty': None,
                'country': 'us'
            }

    # Sort by volume (descending)
    sorted_questions = sorted(
        questions_dict.values(),
        key=lambda x: x['volume'],
        reverse=True
    )

    # Add sequential IDs
    for idx, question in enumerate(sorted_questions, start=1):
        question['id'] = idx

    # Calculate statistics
    total_count = len(sorted_questions)
    high_traffic = sum(1 for q in sorted_questions if q['volume'] > 1000)
    mid_traffic = sum(1 for q in sorted_questions if 200 <= q['volume'] <= 1000)
    low_traffic = sum(1 for q in sorted_questions if q['volume'] < 200)

    # Write output
    print(f"\nWriting to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for question in sorted_questions:
            json.dump(question, f, ensure_ascii=False)
            f.write('\n')

    # Print statistics
    print("\n" + "="*60)
    print("SEO Questions Extraction Complete")
    print("="*60)
    print(f"Total questions:        {total_count}")
    print(f"High traffic (>1000):   {high_traffic}")
    print(f"Mid traffic (200-1000): {mid_traffic}")
    print(f"Low traffic (<200):     {low_traffic}")
    print(f"\nOutput: {output_file}")
    print("="*60)

    # Show top 10 examples
    print("\nTop 10 questions by volume:")
    for i, q in enumerate(sorted_questions[:10], 1):
        print(f"  {i}. {q['question'][:60]:<60} (Vol: {q['volume']:>6}, Diff: {q['difficulty'] or 'N/A':>3})")


if __name__ == '__main__':
    main()
