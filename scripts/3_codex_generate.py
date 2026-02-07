#!/usr/bin/env python3
"""
Codex Batch Content Generation with RAG

Uses RAG retrieval from knowledge base + Codex API for content generation.
Generates articles with:
- Quick Answer (200 words)
- Detailed Answer (1000+ words)
- Total minimum 1200 words

Usage:
  python3 scripts/3_codex_generate.py --batch 5        # Test with 5
  python3 scripts/3_codex_generate.py --category proxy-types
  python3 scripts/3_codex_generate.py --all            # All 390 questions
"""

import os
import json
import time
import argparse
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

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


# Content generation prompt
CONTENT_PROMPT = """You are a senior proxy and web scraping expert writing for ProxyFAQs.com.

## Question
{question}

## Search Volume: {volume:,} monthly searches
## Category: {category}

## Related Variants (address these naturally in your content)
{variants}

## Reference Knowledge (from Google PAA data)
{context}

---

## REQUIREMENTS

Generate a comprehensive article with EXACTLY this structure:

### Part 1: Quick Answer (200 words)
- Direct, concise answer to the question
- Key takeaways in 2-3 sentences
- Perfect for featured snippets

### Part 2: Detailed Answer (1000+ words minimum, no upper limit)
- In-depth explanation with technical details
- Real-world examples and use cases
- Python code snippets when relevant
- Comparison tables where appropriate
- Address all variant questions naturally
- SEO-optimized with semantic keywords

## OUTPUT FORMAT

Return valid JSON only:
```json
{{
  "title": "SEO H1 title with main keyword",
  "meta_description": "150-160 char compelling description",
  "quick_answer": "200 word quick answer here...",
  "detailed_answer": "1000+ word detailed answer in markdown...",
  "tags": ["tag1", "tag2", "tag3"],
  "word_count": 1234,
  "suggested_links": ["related-slug-1", "related-slug-2"]
}}
```

IMPORTANT:
- Minimum total 1200 words (quick + detailed)
- Be technical and authoritative
- Include practical examples
- NO fluff - every sentence adds value

Generate now:"""


class CodexGenerator:
    """Generate content using RAG + Codex API"""

    def __init__(
        self,
        knowledge_base_path: str,
        api_key: str,
        model: str = "codex",
        top_k: int = 15
    ):
        self.knowledge_base_path = Path(knowledge_base_path)
        self.api_key = api_key
        self.model = model
        self.top_k = top_k

        # Initialize Codex client (OpenRouter)
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1"
        )

        # Available models via OpenRouter
        self.model_id = "openai/gpt-4o"  # Default, can be overridden

        # RAG components
        self.knowledge_entries = []
        self.vectorizer = None
        self.tfidf_matrix = None

        # Stats
        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'total_words': 0
        }

    def load_knowledge_base(self):
        """Load knowledge base"""
        print(f"Loading knowledge base from {self.knowledge_base_path}...")

        with open(self.knowledge_base_path, 'r', encoding='utf-8') as f:
            for line in tqdm(f, desc="Loading KB"):
                entry = json.loads(line.strip())
                self.knowledge_entries.append(entry)

        print(f"  Loaded {len(self.knowledge_entries):,} entries")

    def build_rag_index(self):
        """Build TF-IDF index for RAG"""
        print("Building RAG index...")

        texts = [entry.get('text', '') for entry in self.knowledge_entries]

        self.vectorizer = TfidfVectorizer(
            max_features=10000,
            stop_words='english',
            ngram_range=(1, 2),
            min_df=2,
            max_df=0.85
        )

        self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        print(f"  Index shape: {self.tfidf_matrix.shape}")

    def retrieve_context(self, question: str, top_k: int = None) -> str:
        """Retrieve relevant context from knowledge base"""
        if top_k is None:
            top_k = self.top_k

        # Vectorize question
        q_vec = self.vectorizer.transform([question])
        similarities = cosine_similarity(q_vec, self.tfidf_matrix).flatten()

        # Get top-k
        top_indices = similarities.argsort()[-top_k:][::-1]

        # Format context
        context_parts = []
        for idx in top_indices:
            if similarities[idx] > 0.05:
                text = self.knowledge_entries[idx].get('text', '')
                text = re.sub(r'\s+', ' ', text).strip()
                if len(text) > 300:
                    text = text[:300] + "..."
                context_parts.append(f"• {text}")

        return '\n'.join(context_parts) if context_parts else "No specific context found."

    def generate_content(
        self,
        question_data: Dict,
        retry_count: int = 3
    ) -> Tuple[Optional[Dict], str]:
        """Generate content for a question"""

        question = question_data['question']
        volume = question_data.get('volume', 0)
        category = question_data.get('category_name', 'General')
        variants = question_data.get('variants', [])

        # RAG retrieval
        context = self.retrieve_context(question)

        # Format variants
        variants_text = '\n'.join([f"- {v['question']}" for v in variants[:5]]) if variants else "None"

        # Build prompt
        prompt = CONTENT_PROMPT.format(
            question=question,
            volume=volume,
            category=category,
            variants=variants_text,
            context=context
        )

        for attempt in range(retry_count):
            try:
                response = self.client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a technical content expert. Always respond with valid JSON only. No markdown code blocks."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=4000,
                    temperature=0.7
                )

                content = response.choices[0].message.content.strip()

                # Clean JSON
                if content.startswith('```'):
                    content = re.sub(r'^```(?:json)?\n?', '', content)
                    content = re.sub(r'\n?```$', '', content)

                result = json.loads(content)

                # Validate and calculate word count
                quick = result.get('quick_answer', '')
                detailed = result.get('detailed_answer', '')
                word_count = len(quick.split()) + len(detailed.split())
                result['word_count'] = word_count

                return result, "success"

            except json.JSONDecodeError as e:
                if attempt < retry_count - 1:
                    time.sleep(2)
                else:
                    return None, f"JSON error: {e}"

            except Exception as e:
                if attempt < retry_count - 1:
                    time.sleep(3)
                else:
                    return None, f"API error: {e}"

        return None, "Max retries exceeded"

    def process_questions(
        self,
        questions: List[Dict],
        output_path: Path,
        workers: int = 1
    ):
        """Process questions and generate content"""

        print(f"\nProcessing {len(questions)} questions...")
        print(f"Output: {output_path}")
        print(f"Workers: {workers}")

        # Load existing to support resume
        existing = set()
        if output_path.exists():
            with open(output_path, 'r') as f:
                for line in f:
                    data = json.loads(line)
                    existing.add(data.get('slug', ''))
            print(f"  Found {len(existing)} existing articles")

        # Filter out existing
        pending = [q for q in questions if q.get('slug', '') not in existing]
        print(f"  Pending: {len(pending)}")

        if not pending:
            print("All questions already processed!")
            return

        # Process
        output_path.parent.mkdir(parents=True, exist_ok=True)

        for q in tqdm(pending, desc="Generating"):
            self.stats['total'] += 1

            result, status = self.generate_content(q)

            if result:
                # Build full record
                article = {
                    'id': q.get('id'),
                    'slug': q.get('slug', ''),
                    'question': q['question'],
                    'title': result.get('title', q['question'].title()),
                    'meta_description': result.get('meta_description', ''),
                    'quick_answer': result.get('quick_answer', ''),
                    'detailed_answer': result.get('detailed_answer', ''),
                    'word_count': result.get('word_count', 0),
                    'tags': result.get('tags', []),
                    'volume': q.get('volume', 0),
                    'category': q.get('category'),
                    'category_name': q.get('category_name'),
                    'variants': q.get('variants', []),
                    'suggested_links': result.get('suggested_links', []),
                    'generated_at': datetime.now().isoformat(),
                    'status': 'completed'
                }

                # Append to file
                with open(output_path, 'a', encoding='utf-8') as f:
                    json.dump(article, f, ensure_ascii=False)
                    f.write('\n')

                self.stats['success'] += 1
                self.stats['total_words'] += result.get('word_count', 0)

            else:
                # Log failure
                failed = {
                    'id': q.get('id'),
                    'slug': q.get('slug', ''),
                    'question': q['question'],
                    'status': 'failed',
                    'error': status,
                    'failed_at': datetime.now().isoformat()
                }
                with open(output_path, 'a', encoding='utf-8') as f:
                    json.dump(failed, f, ensure_ascii=False)
                    f.write('\n')

                self.stats['failed'] += 1

            # Rate limit
            time.sleep(1)

    def print_stats(self):
        """Print generation stats"""
        print("\n" + "=" * 60)
        print("GENERATION STATISTICS")
        print("=" * 60)
        print(f"Total processed: {self.stats['total']}")
        print(f"Successful:      {self.stats['success']}")
        print(f"Failed:          {self.stats['failed']}")
        if self.stats['success'] > 0:
            avg = self.stats['total_words'] / self.stats['success']
            print(f"Total words:     {self.stats['total_words']:,}")
            print(f"Avg words:       {avg:.0f}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate content using RAG + Codex"
    )

    parser.add_argument('--batch', type=int, help='Process N questions')
    parser.add_argument('--category', type=str, help='Filter by category')
    parser.add_argument('--all', action='store_true', help='Process all')
    parser.add_argument('--model', type=str, default='openai/gpt-4o',
                       help='Model ID (OpenRouter format)')
    parser.add_argument('--workers', type=int, default=1, help='Parallel workers')

    args = parser.parse_args()

    # API key from env
    api_key = os.getenv('OPENROUTER_API_KEY') or os.getenv('CODEX_API_KEY')
    if not api_key:
        print("ERROR: Set OPENROUTER_API_KEY or CODEX_API_KEY")
        exit(1)

    # Paths
    project_root = Path(__file__).parent.parent
    kb_path = project_root / 'output' / 'knowledge_base.jsonl'
    questions_path = project_root / 'output' / 'batch1_questions.jsonl'
    output_path = project_root / 'output' / 'generated_articles.jsonl'

    # Load questions
    print("Loading questions...")
    questions = []
    with open(questions_path, 'r') as f:
        for line in f:
            questions.append(json.loads(line))
    print(f"  Loaded {len(questions)} questions")

    # Filter by category if specified
    if args.category:
        questions = [q for q in questions if q.get('category') == args.category]
        print(f"  Filtered to {len(questions)} ({args.category})")

    # Limit batch size
    if args.batch:
        questions = questions[:args.batch]
        print(f"  Limited to {len(questions)} (--batch)")

    if not questions:
        print("No questions to process!")
        exit(0)

    # Initialize generator
    generator = CodexGenerator(
        knowledge_base_path=str(kb_path),
        api_key=api_key,
        model=args.model
    )
    generator.model_id = args.model

    # Load KB and build RAG
    generator.load_knowledge_base()
    generator.build_rag_index()

    # Process
    generator.process_questions(
        questions=questions,
        output_path=output_path,
        workers=args.workers
    )

    # Stats
    generator.print_stats()

    print(f"\n{'=' * 60}")
    print("Generation complete!")
    print(f"Output: {output_path}")
    print(f"{'=' * 60}\n")


if __name__ == '__main__':
    main()
