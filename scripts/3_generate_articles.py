#!/usr/bin/env python3
"""
Generate Long-Form Articles Using RAG + VectorEngine API

Generates comprehensive SEO articles (1200+ words) for each question
using RAG retrieval from knowledge base.

Input:
  - output/questions_categorized.jsonl (194 questions with categories)
  - output/knowledge_base.jsonl (88K knowledge entries)

Output:
  - output/qa_articles.jsonl (generated articles)

Usage:
  python3 scripts/3_generate_articles.py --batch 10  # First 10 for testing
  python3 scripts/3_generate_articles.py             # All remaining
  python3 scripts/3_generate_articles.py --resume    # Resume from last checkpoint
"""

import os
import json
import time
import argparse
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

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

try:
    import markdown
except ImportError:
    markdown = None
    print("WARNING: markdown not installed. HTML conversion will be skipped.")


# Article generation prompt template
ARTICLE_PROMPT = """You are a senior proxy and web scraping expert writing for ProxyFAQs.com, the leading knowledge platform for proxy servers and web scraping.

## Question to Answer
{question}

## Search Volume: {volume:,} monthly searches
## SEO Difficulty: {difficulty}
## Category: {category}

## Related Question Variants (address these in your FAQ section)
{variants}

## Reference Knowledge from Our Database
{context}

## Article Requirements

Write a comprehensive, SEO-optimized article that meets these criteria:

### 1. Length & Depth
- **Minimum 1,200 words** (no upper limit)
- Cover the topic thoroughly with practical insights
- Include technical details appropriate for the audience

### 2. Structure (use exact Markdown format)
```
# [SEO Title - include main keyword]

[Opening paragraph: Direct answer + hook to keep reading]

## Table of Contents
- [Section 1]
- [Section 2]
- ...

## [H2: First Major Section]
[Detailed content with examples]

### [H3: Subsection if needed]
[More specific content]

## [Continue with logical sections...]

## Frequently Asked Questions

### [Variant question 1]?
[Answer]

### [Variant question 2]?
[Answer]

## Conclusion
[Summary + actionable takeaways]
```

### 3. SEO Optimization
- Natural keyword density (2-3%)
- Include semantic variations
- Write meta description (150-160 chars)
- Suggest internal links to related topics

### 4. Content Quality
- Technical accuracy (you're the expert)
- Real-world examples and use cases
- Python code snippets when relevant
- Comparison tables where appropriate
- Avoid fluff - every sentence adds value

### 5. Output Format (JSON)

Return ONLY valid JSON with this exact structure:
```json
{{
  "title": "SEO-optimized H1 title (include main keyword)",
  "meta_description": "Compelling meta description, 150-160 characters exactly",
  "article": "Full markdown article content here...",
  "word_count": 1234,
  "suggested_internal_links": ["related-slug-1", "related-slug-2", "related-slug-3"]
}}
```

Generate the article now. Remember: minimum 1,200 words, comprehensive coverage, practical value."""


class ArticleGenerator:
    """Generate long-form articles using RAG + VectorEngine API"""

    def __init__(
        self,
        knowledge_base_path: str,
        questions_path: str,
        output_path: str,
        api_key: str,
        model: str = "grok-4-fast",
        top_k: int = 12,
        max_tokens: int = 4000,
        temperature: float = 0.7
    ):
        self.knowledge_base_path = Path(knowledge_base_path)
        self.questions_path = Path(questions_path)
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

        # Data stores
        self.knowledge_entries = []
        self.vectorizer = None
        self.tfidf_matrix = None
        self.existing_articles = {}

        # Statistics
        self.stats = {
            'total': 0,
            'generated': 0,
            'failed': 0,
            'skipped': 0,
            'total_words': 0,
            'total_tokens': 0,
            'min_words': float('inf'),
            'max_words': 0
        }

    def load_knowledge_base(self):
        """Load knowledge base from JSONL file"""
        print(f"\nLoading knowledge base from {self.knowledge_base_path}...")

        if not self.knowledge_base_path.exists():
            raise FileNotFoundError(f"Knowledge base not found: {self.knowledge_base_path}")

        with open(self.knowledge_base_path, 'r', encoding='utf-8') as f:
            for line in tqdm(f, desc="Loading KB"):
                entry = json.loads(line.strip())
                self.knowledge_entries.append(entry)

        print(f"  Loaded {len(self.knowledge_entries):,} entries")

    def build_retrieval_index(self):
        """Build TF-IDF index for retrieval"""
        print("\nBuilding TF-IDF retrieval index...")

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

    def retrieve_context(self, question: str, top_k: int = None) -> List[Dict]:
        """Retrieve top-k relevant knowledge entries"""
        if top_k is None:
            top_k = self.top_k

        question_vec = self.vectorizer.transform([question])
        similarities = cosine_similarity(question_vec, self.tfidf_matrix).flatten()
        top_indices = similarities.argsort()[-top_k:][::-1]

        results = []
        for idx in top_indices:
            if similarities[idx] > 0.05:  # Minimum relevance threshold
                entry = self.knowledge_entries[idx].copy()
                entry['score'] = float(similarities[idx])
                results.append(entry)

        return results

    def format_context(self, context_entries: List[Dict]) -> str:
        """Format context entries for prompt"""
        formatted = []
        for i, entry in enumerate(context_entries, 1):
            text = entry.get('text', '')
            score = entry.get('score', 0)
            source = entry.get('source', 'kb')

            # Clean and truncate
            text = re.sub(r'\s+', ' ', text).strip()
            if len(text) > 400:
                text = text[:400] + "..."

            formatted.append(f"[{i}] {text}")

        return '\n\n'.join(formatted)

    def generate_article(
        self,
        question_data: Dict,
        retry_count: int = 3
    ) -> Tuple[Optional[Dict], int]:
        """Generate article using VectorEngine API"""

        question = question_data['question']
        volume = question_data.get('volume', 0)
        difficulty = question_data.get('difficulty', 'N/A')
        category = question_data.get('category_name', 'General')
        variants = question_data.get('variants', [])

        # Retrieve context
        context_entries = self.retrieve_context(question)
        context_text = self.format_context(context_entries)

        # Format variants
        variants_text = '\n'.join([f"- {v}" for v in variants]) if variants else "None"

        # Build prompt
        prompt = ARTICLE_PROMPT.format(
            question=question,
            volume=volume,
            difficulty=difficulty if difficulty else 'N/A',
            category=category,
            variants=variants_text,
            context=context_text
        )

        for attempt in range(retry_count):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an expert technical writer. Always respond with valid JSON only."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=self.max_tokens,
                    temperature=self.temperature
                )

                content = response.choices[0].message.content.strip()
                tokens_used = response.usage.total_tokens

                # Parse JSON response
                # Handle markdown code blocks
                if content.startswith('```'):
                    content = re.sub(r'^```(?:json)?\n?', '', content)
                    content = re.sub(r'\n?```$', '', content)

                result = json.loads(content)

                # Validate required fields
                if 'article' not in result or 'title' not in result:
                    raise ValueError("Missing required fields in response")

                # Calculate word count
                word_count = len(result['article'].split())
                result['word_count'] = word_count

                return result, tokens_used

            except json.JSONDecodeError as e:
                if attempt < retry_count - 1:
                    print(f"\n  JSON parse error (attempt {attempt + 1}): {e}")
                    time.sleep(2)
                else:
                    print(f"\n  Failed to parse JSON after {retry_count} attempts")
                    return None, 0

            except Exception as e:
                if attempt < retry_count - 1:
                    wait_time = (attempt + 1) * 3
                    print(f"\n  API error (attempt {attempt + 1}): {e}")
                    time.sleep(wait_time)
                else:
                    print(f"\n  Failed after {retry_count} attempts: {e}")
                    return None, 0

        return None, 0

    def load_existing_articles(self):
        """Load existing articles to support resume"""
        if not self.output_path.exists():
            return

        print(f"\nLoading existing articles from {self.output_path}...")

        try:
            with open(self.output_path, 'r', encoding='utf-8') as f:
                for line in f:
                    article = json.loads(line.strip())
                    slug = article.get('slug', '')
                    if slug:
                        self.existing_articles[slug] = article

            print(f"  Loaded {len(self.existing_articles):,} existing articles")
        except Exception as e:
            print(f"  Warning: Could not load existing articles: {e}")

    def save_article(self, article: Dict):
        """Append article to output file"""
        with open(self.output_path, 'a', encoding='utf-8') as f:
            json.dump(article, f, ensure_ascii=False)
            f.write('\n')

    def convert_to_html(self, markdown_text: str) -> str:
        """Convert markdown to HTML"""
        if markdown is None:
            return ""
        try:
            return markdown.markdown(
                markdown_text,
                extensions=['tables', 'fenced_code', 'toc']
            )
        except Exception:
            return ""

    def process_questions(
        self,
        start_idx: int = 0,
        end_idx: int = None,
        batch_size: int = None
    ):
        """Process questions and generate articles"""

        # Load questions
        print(f"\nLoading questions from {self.questions_path}...")
        questions = []
        with open(self.questions_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    questions.append(json.loads(line))

        print(f"  Loaded {len(questions)} questions")

        # Apply range
        if end_idx is None:
            end_idx = len(questions)
        if batch_size:
            end_idx = min(start_idx + batch_size, len(questions))

        questions_subset = questions[start_idx:end_idx]
        total = len(questions_subset)

        print(f"\nProcessing questions {start_idx} to {end_idx} ({total} total)")
        print(f"Model: {self.model}")
        print(f"Top-K retrieval: {self.top_k}")
        print(f"Max tokens: {self.max_tokens}")

        # Ensure output directory exists
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

        # Progress tracking
        start_time = time.time()
        pbar = tqdm(total=total, desc="Generating articles")

        for q in questions_subset:
            slug = q.get('slug', '')
            question = q['question']

            self.stats['total'] += 1

            # Skip if already exists
            if slug in self.existing_articles:
                self.stats['skipped'] += 1
                pbar.update(1)
                pbar.set_postfix({
                    'gen': self.stats['generated'],
                    'skip': self.stats['skipped'],
                    'fail': self.stats['failed']
                })
                continue

            # Generate article
            result, tokens_used = self.generate_article(q)

            if result:
                word_count = result.get('word_count', 0)

                # Build full article record
                article = {
                    'id': q.get('id'),
                    'slug': slug,
                    'question': question,
                    'title': result.get('title', question.title()),
                    'meta_description': result.get('meta_description', ''),
                    'article': result.get('article', ''),
                    'article_html': self.convert_to_html(result.get('article', '')),
                    'word_count': word_count,
                    'volume': q.get('volume', 0),
                    'difficulty': q.get('difficulty'),
                    'category': q.get('category'),
                    'category_slug': q.get('category_slug'),
                    'category_name': q.get('category_name'),
                    'variants': q.get('variants', []),
                    'internal_links': result.get('suggested_internal_links', []),
                    'tokens_used': tokens_used,
                    'generated_at': datetime.now().isoformat(),
                    'status': 'completed'
                }

                # Save
                self.save_article(article)
                self.existing_articles[slug] = article

                # Update stats
                self.stats['generated'] += 1
                self.stats['total_words'] += word_count
                self.stats['total_tokens'] += tokens_used
                self.stats['min_words'] = min(self.stats['min_words'], word_count)
                self.stats['max_words'] = max(self.stats['max_words'], word_count)

            else:
                self.stats['failed'] += 1

                # Log failed question
                failed_record = {
                    'id': q.get('id'),
                    'slug': slug,
                    'question': question,
                    'status': 'failed',
                    'failed_at': datetime.now().isoformat()
                }
                self.save_article(failed_record)

            # Update progress
            pbar.update(1)
            pbar.set_postfix({
                'gen': self.stats['generated'],
                'words': self.stats['total_words'],
                'fail': self.stats['failed']
            })

            # Rate limiting
            time.sleep(1.5)

        pbar.close()

        # Calculate final stats
        self.stats['total_time'] = time.time() - start_time

    def print_statistics(self):
        """Print generation statistics"""
        print("\n" + "=" * 60)
        print("ARTICLE GENERATION STATISTICS")
        print("=" * 60)
        print(f"Total processed:        {self.stats['total']}")
        print(f"Successfully generated: {self.stats['generated']}")
        print(f"Failed:                 {self.stats['failed']}")
        print(f"Skipped (existing):     {self.stats['skipped']}")

        if self.stats['generated'] > 0:
            avg_words = self.stats['total_words'] / self.stats['generated']
            avg_tokens = self.stats['total_tokens'] / self.stats['generated']

            print(f"\nWord count:")
            print(f"  Total:    {self.stats['total_words']:,}")
            print(f"  Average:  {avg_words:.0f}")
            print(f"  Min:      {self.stats['min_words']}")
            print(f"  Max:      {self.stats['max_words']}")

            print(f"\nTokens used:")
            print(f"  Total:    {self.stats['total_tokens']:,}")
            print(f"  Average:  {avg_tokens:.0f}")

        print(f"\nTime: {self.stats.get('total_time', 0):.1f}s")
        print(f"Output: {self.output_path}")

        if self.output_path.exists():
            size_mb = self.output_path.stat().st_size / (1024 * 1024)
            print(f"File size: {size_mb:.2f} MB")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Generate long-form articles using RAG + VectorEngine API",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument('--start', type=int, default=0, help='Start index')
    parser.add_argument('--end', type=int, default=None, help='End index')
    parser.add_argument('--batch', type=int, default=None, help='Batch size (overrides --end)')
    parser.add_argument('--model', type=str, default='grok-4-fast', help='Model name')
    parser.add_argument('--top-k', type=int, default=12, help='Top-K retrieval')
    parser.add_argument('--max-tokens', type=int, default=4000, help='Max tokens per response')
    parser.add_argument('--resume', action='store_true', help='Resume from last checkpoint')

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
    kb_path = project_root / 'output' / 'knowledge_base.jsonl'
    questions_path = project_root / 'output' / 'questions_categorized.jsonl'
    output_path = project_root / 'output' / 'qa_articles.jsonl'

    try:
        # Initialize generator
        generator = ArticleGenerator(
            knowledge_base_path=str(kb_path),
            questions_path=str(questions_path),
            output_path=str(output_path),
            api_key=api_key,
            model=args.model,
            top_k=args.top_k,
            max_tokens=args.max_tokens
        )

        # Load knowledge base and build index
        generator.load_knowledge_base()
        generator.build_retrieval_index()

        # Load existing articles for resume
        if args.resume or args.start > 0:
            generator.load_existing_articles()

        # Process questions
        generator.process_questions(
            start_idx=args.start,
            end_idx=args.end,
            batch_size=args.batch
        )

        # Print statistics
        generator.print_statistics()

        print(f"\n{'=' * 60}")
        print("SUCCESS: Article generation completed!")
        print(f"{'=' * 60}\n")

    except KeyboardInterrupt:
        print("\n\nInterrupted. Progress saved.")
        print(f"Resume with: python3 {__file__} --resume")
        exit(0)

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


if __name__ == '__main__':
    main()
