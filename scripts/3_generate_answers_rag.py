#!/usr/bin/env python3
"""
Generate High-Quality Answers Using RAG

This script uses Retrieval-Augmented Generation (RAG) to generate comprehensive
answers to SEO questions by retrieving relevant context from the knowledge base.

Input:
- output/knowledge_base.jsonl (88K knowledge entries)
- data/google_proxy_question.csv (3,057 SEO questions)
- data/google_proxies_question.csv (983 SEO questions)

Output:
- output/qa_pairs.jsonl (Q&A pairs with metadata)

Dependencies:
- pandas
- openai (for VectorEngine API)
- scikit-learn (TfidfVectorizer)
- tqdm

API:
- VectorEngine API (grok-4-fast model)
- API Key: VECTORENGINE_API_KEY environment variable
"""

import os
import json
import time
import argparse
import hashlib
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas")
    exit(1)

try:
    from openai import OpenAI
except ImportError:
    print("ERROR: openai not installed. Run: pip install openai")
    exit(1)

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:
    print("ERROR: scikit-learn not installed. Run: pip install scikit-learn")
    exit(1)

try:
    from tqdm import tqdm
except ImportError:
    print("ERROR: tqdm not installed. Run: pip install tqdm")
    exit(1)


class RAGAnswerGenerator:
    """Generate answers using RAG with TF-IDF retrieval and VectorEngine API"""

    def __init__(
        self,
        knowledge_base_path: str,
        output_path: str,
        api_key: str,
        model: str = "grok-4-fast",
        top_k: int = 8,
        max_tokens: int = 800,
        temperature: float = 0.7
    ):
        self.knowledge_base_path = Path(knowledge_base_path)
        self.output_path = Path(output_path)
        self.api_key = api_key
        self.model = model
        self.top_k = top_k
        self.max_tokens = max_tokens
        self.temperature = temperature

        # Initialize OpenAI client with VectorEngine API
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.vectorengine.ai/v1"
        )

        # Knowledge base
        self.knowledge_entries = []
        self.vectorizer = None
        self.tfidf_matrix = None

        # Statistics
        self.stats = {
            'total_questions': 0,
            'generated': 0,
            'failed': 0,
            'skipped': 0,
            'total_tokens': 0,
            'total_time': 0,
            'avg_time_per_question': 0
        }

        # Checkpointing
        self.checkpoint_interval = 10
        self.existing_qa = {}

    def load_knowledge_base(self):
        """Load knowledge base from JSONL file"""
        print(f"\nLoading knowledge base from {self.knowledge_base_path}...")

        if not self.knowledge_base_path.exists():
            raise FileNotFoundError(f"Knowledge base not found: {self.knowledge_base_path}")

        with open(self.knowledge_base_path, 'r', encoding='utf-8') as f:
            for line in tqdm(f, desc="Loading knowledge base"):
                entry = json.loads(line.strip())
                self.knowledge_entries.append(entry)

        print(f"Loaded {len(self.knowledge_entries):,} knowledge entries")

    def build_retrieval_index(self):
        """Build TF-IDF index for retrieval"""
        print("\nBuilding TF-IDF retrieval index...")

        # Extract text from knowledge entries
        texts = [entry['text'] for entry in self.knowledge_entries]

        # Build TF-IDF matrix
        self.vectorizer = TfidfVectorizer(
            max_features=5000,
            stop_words='english',
            ngram_range=(1, 2),
            min_df=2,
            max_df=0.8
        )

        self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        print(f"TF-IDF index built: {self.tfidf_matrix.shape}")

    def retrieve_context(self, question: str, top_k: int = None) -> List[Dict]:
        """Retrieve top-k relevant knowledge entries for a question"""
        if top_k is None:
            top_k = self.top_k

        # Vectorize question
        question_vec = self.vectorizer.transform([question])

        # Compute similarity
        similarities = cosine_similarity(question_vec, self.tfidf_matrix).flatten()

        # Get top-k indices
        top_indices = similarities.argsort()[-top_k:][::-1]

        # Return top-k entries with scores
        results = []
        for idx in top_indices:
            entry = self.knowledge_entries[idx].copy()
            entry['score'] = float(similarities[idx])
            results.append(entry)

        return results

    def format_context(self, context_entries: List[Dict]) -> str:
        """Format context entries for prompt"""
        formatted = []
        for i, entry in enumerate(context_entries, 1):
            text = entry['text']
            score = entry.get('score', 0)
            source = entry.get('source', 'unknown')

            # Clean up text
            text = text.replace('\n', ' ').strip()

            formatted.append(f"[{i}] {text} (relevance: {score:.3f}, source: {source})")

        return '\n'.join(formatted)

    def generate_answer(
        self,
        question: str,
        context: str,
        retry_count: int = 3
    ) -> Tuple[Optional[str], int]:
        """Generate answer using VectorEngine API with retry logic"""

        prompt = f"""You are an expert in proxy servers and web scraping.

Question: {question}

Reference Knowledge:
{context}

Generate a comprehensive, SEO-friendly answer (200-500 words) that:
- Answers the question directly and clearly
- Uses information from the reference knowledge
- Is professional and authoritative
- Includes relevant technical details when appropriate
- Is well-structured with paragraphs
- Is optimized for search engines

Answer:"""

        for attempt in range(retry_count):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": "You are an expert in proxy servers, web scraping, and internet privacy."},
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=self.max_tokens,
                    temperature=self.temperature
                )

                answer = response.choices[0].message.content.strip()
                tokens_used = response.usage.total_tokens

                return answer, tokens_used

            except Exception as e:
                if attempt < retry_count - 1:
                    wait_time = (attempt + 1) * 2
                    print(f"\n  API error (attempt {attempt + 1}/{retry_count}): {e}")
                    print(f"  Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    print(f"\n  Failed after {retry_count} attempts: {e}")
                    return None, 0

        return None, 0

    def load_existing_qa(self):
        """Load existing Q&A pairs to avoid regeneration"""
        if not self.output_path.exists():
            return

        print(f"\nLoading existing Q&A pairs from {self.output_path}...")

        try:
            with open(self.output_path, 'r', encoding='utf-8') as f:
                for line in f:
                    qa = json.loads(line.strip())
                    question = qa.get('question', '').strip().lower()
                    self.existing_qa[question] = qa

            print(f"Loaded {len(self.existing_qa):,} existing Q&A pairs")
        except Exception as e:
            print(f"Warning: Could not load existing Q&A pairs: {e}")

    def save_qa_pair(self, qa_pair: Dict):
        """Append Q&A pair to output file"""
        with open(self.output_path, 'a', encoding='utf-8') as f:
            json.dump(qa_pair, f, ensure_ascii=False)
            f.write('\n')

    def generate_qa_id(self, question: str) -> str:
        """Generate unique ID for Q&A pair"""
        return hashlib.md5(question.lower().encode()).hexdigest()[:12]

    def process_questions(
        self,
        questions_df: pd.DataFrame,
        start_idx: int = 0,
        end_idx: int = None
    ):
        """Process questions and generate answers"""

        if end_idx is None:
            end_idx = len(questions_df)

        # Ensure output directory exists
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

        # Slice questions
        questions_subset = questions_df.iloc[start_idx:end_idx]
        total = len(questions_subset)

        print(f"\nProcessing questions {start_idx} to {end_idx} ({total:,} total)")
        print(f"Output: {self.output_path}")
        print(f"Model: {self.model}")
        print(f"Top-K retrieval: {self.top_k}")
        print(f"Checkpoint interval: {self.checkpoint_interval}")

        # Progress tracking
        start_time = time.time()
        pbar = tqdm(total=total, desc="Generating answers")

        for idx, row in questions_subset.iterrows():
            question = str(row['Keyword']).strip()
            volume = int(row.get('Volume', 0)) if pd.notna(row.get('Volume')) else 0
            difficulty = int(row.get('Difficulty', 0)) if pd.notna(row.get('Difficulty')) else 0

            self.stats['total_questions'] += 1

            # Skip if already exists
            if question.lower() in self.existing_qa:
                self.stats['skipped'] += 1
                pbar.update(1)
                pbar.set_postfix({
                    'generated': self.stats['generated'],
                    'failed': self.stats['failed'],
                    'skipped': self.stats['skipped']
                })
                continue

            # Retrieve context
            context_entries = self.retrieve_context(question)
            context_text = self.format_context(context_entries)

            # Generate answer
            answer, tokens_used = self.generate_answer(question, context_text)

            if answer:
                # Extract source IDs
                source_ids = [entry['id'] for entry in context_entries[:5]]

                # Create Q&A pair
                qa_pair = {
                    'id': self.generate_qa_id(question),
                    'question': question,
                    'answer': answer,
                    'volume': volume,
                    'difficulty': difficulty,
                    'sources': source_ids,
                    'tokens_used': tokens_used,
                    'generated_at': datetime.now().isoformat()
                }

                # Save to file
                self.save_qa_pair(qa_pair)

                # Update cache
                self.existing_qa[question.lower()] = qa_pair

                # Update stats
                self.stats['generated'] += 1
                self.stats['total_tokens'] += tokens_used
            else:
                self.stats['failed'] += 1

            # Update progress
            pbar.update(1)
            pbar.set_postfix({
                'generated': self.stats['generated'],
                'failed': self.stats['failed'],
                'tokens': self.stats['total_tokens']
            })

            # Rate limiting (avoid hitting API limits)
            time.sleep(0.5)

        pbar.close()

        # Calculate final stats
        end_time = time.time()
        self.stats['total_time'] = end_time - start_time
        if self.stats['generated'] > 0:
            self.stats['avg_time_per_question'] = self.stats['total_time'] / self.stats['generated']

    def print_statistics(self):
        """Print generation statistics"""
        print("\n" + "="*60)
        print("ANSWER GENERATION STATISTICS")
        print("="*60)
        print(f"Total questions processed: {self.stats['total_questions']:,}")
        print(f"Successfully generated:     {self.stats['generated']:,}")
        print(f"Failed:                     {self.stats['failed']:,}")
        print(f"Skipped (already exist):    {self.stats['skipped']:,}")
        print(f"\nTotal tokens used:          {self.stats['total_tokens']:,}")
        print(f"Total time:                 {self.stats['total_time']:.1f}s")
        if self.stats['generated'] > 0:
            print(f"Avg time per question:      {self.stats['avg_time_per_question']:.1f}s")
            print(f"Avg tokens per question:    {self.stats['total_tokens'] / self.stats['generated']:.0f}")

        print(f"\nOutput file: {self.output_path}")
        if self.output_path.exists():
            file_size = self.output_path.stat().st_size / (1024 * 1024)
            print(f"File size: {file_size:.2f} MB")


def detect_encoding(file_path: Path) -> str:
    """Detect file encoding (UTF-8 or UTF-16)"""
    with open(file_path, 'rb') as f:
        raw_data = f.read(100)

        if raw_data.startswith(b'\xff\xfe') or raw_data.startswith(b'\xfe\xff'):
            return 'utf-16'
        if raw_data.startswith(b'\xef\xbb\xbf'):
            return 'utf-8-sig'

        return 'utf-8'


def load_seo_questions(data_dir: Path) -> pd.DataFrame:
    """Load and merge SEO question files"""
    print("\nLoading SEO questions...")

    question_files = [
        'google_proxy_question.csv',
        'google_proxies_question.csv'
    ]

    all_questions = []

    for filename in question_files:
        file_path = data_dir / filename

        if not file_path.exists():
            print(f"Warning: {filename} not found, skipping...")
            continue

        # Detect encoding
        encoding = detect_encoding(file_path)
        print(f"  Loading {filename} (encoding: {encoding})...")

        try:
            df = pd.read_csv(file_path, encoding=encoding, sep='\t')

            # Ensure required columns
            if 'Keyword' not in df.columns:
                print(f"  Warning: {filename} missing 'Keyword' column, skipping...")
                continue

            all_questions.append(df)
            print(f"  Loaded {len(df):,} questions from {filename}")

        except Exception as e:
            print(f"  Error loading {filename}: {e}")

    if not all_questions:
        raise ValueError("No question files loaded successfully")

    # Merge and deduplicate
    merged = pd.concat(all_questions, ignore_index=True)

    # Remove duplicates
    original_count = len(merged)
    merged = merged.drop_duplicates(subset=['Keyword'], keep='first')

    print(f"\nTotal questions: {len(merged):,} (removed {original_count - len(merged):,} duplicates)")

    # Sort by volume (descending) - prioritize high-traffic questions
    if 'Volume' in merged.columns:
        merged['Volume'] = pd.to_numeric(merged['Volume'], errors='coerce').fillna(0)
        merged = merged.sort_values('Volume', ascending=False)
        print(f"Sorted by search volume (highest first)")
        print(f"  Top question: '{merged.iloc[0]['Keyword']}' (volume: {int(merged.iloc[0]['Volume']):,})")

    return merged


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Generate high-quality answers using RAG",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate all answers
  python3 scripts/3_generate_answers_rag.py

  # Generate first 100 answers
  python3 scripts/3_generate_answers_rag.py --end 100

  # Generate answers 100-200
  python3 scripts/3_generate_answers_rag.py --start 100 --end 200

  # Use different model
  python3 scripts/3_generate_answers_rag.py --model grok-2-latest
        """
    )

    parser.add_argument(
        '--start',
        type=int,
        default=0,
        help='Start index (default: 0)'
    )

    parser.add_argument(
        '--end',
        type=int,
        default=None,
        help='End index (default: all)'
    )

    parser.add_argument(
        '--model',
        type=str,
        default='grok-4-fast',
        help='VectorEngine model (default: grok-4-fast)'
    )

    parser.add_argument(
        '--top-k',
        type=int,
        default=8,
        help='Number of context entries to retrieve (default: 8)'
    )

    parser.add_argument(
        '--max-tokens',
        type=int,
        default=800,
        help='Max tokens per answer (default: 800)'
    )

    parser.add_argument(
        '--temperature',
        type=float,
        default=0.7,
        help='Temperature for generation (default: 0.7)'
    )

    args = parser.parse_args()

    # Get API key
    api_key = os.getenv('VECTORENGINE_API_KEY')
    if not api_key:
        print("ERROR: VECTORENGINE_API_KEY environment variable not set")
        print("\nSet it with:")
        print("  export VECTORENGINE_API_KEY='your-api-key'")
        exit(1)

    # Paths
    project_root = Path(__file__).parent.parent
    data_dir = project_root / 'data'
    output_dir = project_root / 'output'

    knowledge_base_path = output_dir / 'knowledge_base.jsonl'
    qa_output_path = output_dir / 'qa_pairs.jsonl'

    try:
        # Load SEO questions
        questions_df = load_seo_questions(data_dir)

        # Initialize generator
        generator = RAGAnswerGenerator(
            knowledge_base_path=str(knowledge_base_path),
            output_path=str(qa_output_path),
            api_key=api_key,
            model=args.model,
            top_k=args.top_k,
            max_tokens=args.max_tokens,
            temperature=args.temperature
        )

        # Load knowledge base
        generator.load_knowledge_base()

        # Build retrieval index
        generator.build_retrieval_index()

        # Load existing Q&A pairs (for resume capability)
        generator.load_existing_qa()

        # Process questions
        generator.process_questions(
            questions_df,
            start_idx=args.start,
            end_idx=args.end
        )

        # Print statistics
        generator.print_statistics()

        print(f"\n{'='*60}")
        print("SUCCESS: Answer generation completed!")
        print(f"Output: {qa_output_path}")
        print(f"{'='*60}\n")

    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Progress has been saved.")
        print(f"Resume with: python3 {__file__} --start {args.start}")
        exit(0)

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


if __name__ == '__main__':
    main()
