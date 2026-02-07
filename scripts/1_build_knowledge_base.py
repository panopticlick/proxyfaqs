#!/usr/bin/env python3
"""
Build Knowledge Base - Integrate all raw data sources

Input:
- data/google-paa-*.csv (PAA questions and answers)
- data/proxy_faqs_all.csv (FAQ pairs)
- data/proxy_broad-match_us_2025-12-26.csv (keywords and snippets)

Output:
- output/knowledge_base.jsonl (deduplicated knowledge entries)
"""

import csv
import json
import hashlib
from pathlib import Path
from typing import List, Dict, Set


class KnowledgeBaseBuilder:
    def __init__(self, data_dir: str, output_dir: str):
        self.data_dir = Path(data_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Deduplication tracking
        self.seen_hashes: Set[str] = set()
        self.all_entries: List[Dict] = []
        self.stats = {
            'total_raw': 0,
            'duplicates': 0,
            'unique': 0,
            'by_source': {}
        }

    def detect_encoding(self, file_path: Path) -> str:
        """Detect file encoding (UTF-8 or UTF-16)"""
        with open(file_path, 'rb') as f:
            raw_data = f.read(100)  # Read first 100 bytes

            # Check for UTF-16 BOM
            if raw_data.startswith(b'\xff\xfe') or raw_data.startswith(b'\xfe\xff'):
                return 'utf-16'

            # Check for UTF-8 BOM
            if raw_data.startswith(b'\xef\xbb\xbf'):
                return 'utf-8-sig'

            # Default to UTF-8
            return 'utf-8'

    def read_csv(self, file_path: Path) -> List[Dict]:
        """Read CSV file with automatic encoding detection"""
        encoding = self.detect_encoding(file_path)

        try:
            with open(file_path, 'r', encoding=encoding, errors='replace') as f:
                # Remove BOM if present
                content = f.read()
                if content.startswith('\ufeff'):
                    content = content[1:]

                # Parse CSV
                reader = csv.DictReader(content.splitlines())
                return list(reader)
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            # Try alternative encoding
            try:
                with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
                    if content.startswith('\ufeff'):
                        content = content[1:]
                    reader = csv.DictReader(content.splitlines())
                    return list(reader)
            except Exception as e2:
                print(f"Failed to read {file_path} with fallback encoding: {e2}")
                return []

    def get_text_hash(self, text: str) -> str:
        """Generate hash for deduplication"""
        # Normalize text: lowercase, strip whitespace
        normalized = ' '.join(text.lower().split())
        return hashlib.md5(normalized.encode()).hexdigest()

    def add_entry(self, text: str, source: str) -> bool:
        """Add entry if not duplicate. Returns True if added."""
        if not text or len(text.strip()) < 20:  # Skip very short texts
            return False

        text = text.strip()
        text_hash = self.get_text_hash(text)

        self.stats['total_raw'] += 1

        if text_hash in self.seen_hashes:
            self.stats['duplicates'] += 1
            return False

        self.seen_hashes.add(text_hash)
        self.all_entries.append({
            'text': text,
            'source': source,
            'id': len(self.all_entries) + 1
        })

        self.stats['unique'] += 1
        self.stats['by_source'][source] = self.stats['by_source'].get(source, 0) + 1
        return True

    def print_progress(self, current: int, total: int, prefix: str = ''):
        """Simple progress indicator"""
        if total == 0:
            return
        percent = int((current / total) * 100)
        bar_length = 40
        filled = int(bar_length * current / total)
        bar = '=' * filled + '-' * (bar_length - filled)
        print(f'\r{prefix}[{bar}] {percent}% ({current}/{total})', end='', flush=True)

    def safe_get(self, row: Dict, key: str, default: str = '') -> str:
        """Safely get value from dict and strip, handling None values"""
        value = row.get(key, default)
        if value is None:
            return default
        return str(value).strip()

    def process_paa_files(self):
        """Process Google PAA (People Also Ask) CSV files"""
        paa_files = [
            'google-paa-proxy-level8-25-12-2025.csv',
            'google-paa-proxies-level8-26-12-2025.csv',
            'google-paa-residential-proxy-level8-25-12-2025.csv',
            'google-paa-web-scraping-level8-25-12-2025.csv',
            'google-paa-scraper-api-level8-26-12-2025.csv'
        ]

        for filename in paa_files:
            file_path = self.data_dir / filename
            if not file_path.exists():
                print(f"Warning: {filename} not found, skipping...")
                continue

            print(f"\nProcessing {filename}...")
            rows = self.read_csv(file_path)

            source = f"paa_{filename.replace('google-paa-', '').replace('.csv', '')}"

            total = len(rows)
            for idx, row in enumerate(rows):
                # Extract PAA title and text
                title = self.safe_get(row, 'PAA Title')
                text = self.safe_get(row, 'Text')
                parent = self.safe_get(row, 'Parent')

                # Combine question and answer
                if title and text:
                    # Full Q&A
                    qa_text = f"Q: {title}\nA: {text}"
                    self.add_entry(qa_text, source)

                    # Answer only (for semantic search)
                    if len(text) > 50:
                        self.add_entry(text, source)

                # Add parent question if different
                elif title and parent and title != parent:
                    self.add_entry(f"Related: {parent} -> {title}", source)

                # Update progress
                if (idx + 1) % 100 == 0 or (idx + 1) == total:
                    self.print_progress(idx + 1, total, f"  {filename[:40]:40s} ")

            print()  # New line after progress

    def process_faqs(self):
        """Process proxy_faqs_all.csv"""
        file_path = self.data_dir / 'proxy_faqs_all.csv'
        if not file_path.exists():
            print(f"Warning: proxy_faqs_all.csv not found, skipping...")
            return

        print(f"\nProcessing proxy_faqs_all.csv...")
        rows = self.read_csv(file_path)

        source = "faq_collection"

        total = len(rows)
        for idx, row in enumerate(rows):
            keyword = self.safe_get(row, 'Keyword')

            # Add as knowledge entry
            if keyword:
                # Format as question
                question_text = f"Q: {keyword}"
                self.add_entry(question_text, source)

            # Update progress
            if (idx + 1) % 100 == 0 or (idx + 1) == total:
                self.print_progress(idx + 1, total, "  proxy_faqs_all.csv                       ")

        print()  # New line after progress

    def process_broad_match(self):
        """Process proxy_broad-match_us_2025-12-26.csv"""
        file_path = self.data_dir / 'proxy_broad-match_us_2025-12-26.csv'
        if not file_path.exists():
            print(f"Warning: proxy_broad-match_us_2025-12-26.csv not found, skipping...")
            return

        print(f"\nProcessing proxy_broad-match_us_2025-12-26.csv...")
        rows = self.read_csv(file_path)

        source = "broad_match_keywords"

        total = len(rows)
        for idx, row in enumerate(rows):
            keyword = self.safe_get(row, 'Keyword')
            intent = self.safe_get(row, 'Intent')
            volume = self.safe_get(row, 'Volume')

            # Create entry with metadata
            if keyword and len(keyword) > 3:
                # Add keyword with context
                entry_text = f"Keyword: {keyword}"
                if intent:
                    entry_text += f" | Intent: {intent}"
                if volume:
                    entry_text += f" | Volume: {volume}"

                self.add_entry(entry_text, source)

            # Update progress
            if (idx + 1) % 100 == 0 or (idx + 1) == total:
                self.print_progress(idx + 1, total, "  proxy_broad-match                        ")

        print()  # New line after progress

    def save_knowledge_base(self):
        """Save deduplicated knowledge base to JSONL"""
        output_file = self.output_dir / 'knowledge_base.jsonl'

        print(f"\nSaving knowledge base to {output_file}...")

        total = len(self.all_entries)
        with open(output_file, 'w', encoding='utf-8') as f:
            for idx, entry in enumerate(self.all_entries):
                json.dump(entry, f, ensure_ascii=False)
                f.write('\n')

                # Update progress
                if (idx + 1) % 1000 == 0 or (idx + 1) == total:
                    self.print_progress(idx + 1, total, "  Writing JSONL                            ")

        print()  # New line after progress
        print(f"\nKnowledge base saved: {output_file}")
        return output_file

    def print_statistics(self):
        """Print processing statistics"""
        print("\n" + "="*60)
        print("KNOWLEDGE BASE STATISTICS")
        print("="*60)
        print(f"Total raw entries:     {self.stats['total_raw']:,}")
        print(f"Duplicates removed:    {self.stats['duplicates']:,}")
        print(f"Unique entries:        {self.stats['unique']:,}")
        print(f"Deduplication rate:    {(self.stats['duplicates']/max(self.stats['total_raw'], 1)*100):.1f}%")

        print(f"\nEntries by source:")
        for source, count in sorted(self.stats['by_source'].items(), key=lambda x: x[1], reverse=True):
            print(f"  {source:30s} {count:6,} entries")

        print("\nSample entries (first 5):")
        for entry in self.all_entries[:5]:
            text_preview = entry['text'][:100].replace('\n', ' ')
            print(f"  [{entry['id']}] {text_preview}... (source: {entry['source']})")

    def build(self):
        """Main build process"""
        print("Starting knowledge base construction...")
        print(f"Data directory: {self.data_dir}")
        print(f"Output directory: {self.output_dir}")

        # Process all data sources
        self.process_paa_files()
        self.process_faqs()
        self.process_broad_match()

        # Save results
        self.save_knowledge_base()

        # Print statistics
        self.print_statistics()

        return self.output_dir / 'knowledge_base.jsonl'


def main():
    """Main entry point"""
    # Paths
    project_root = Path(__file__).parent.parent
    data_dir = project_root / 'data'
    output_dir = project_root / 'output'

    # Build knowledge base
    builder = KnowledgeBaseBuilder(
        data_dir=str(data_dir),
        output_dir=str(output_dir)
    )

    output_file = builder.build()

    print(f"\n{'='*60}")
    print(f"SUCCESS: Knowledge base built successfully!")
    print(f"Output: {output_file}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
