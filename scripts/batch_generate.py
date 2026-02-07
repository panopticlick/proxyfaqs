#!/usr/bin/env python3
"""
Batch Article Generator for ProxyFAQs

Reads questions from batch1_questions.jsonl and generates articles
using Claude Task agents in parallel batches.

Usage:
  python3 scripts/batch_generate.py --category proxy-types --batch 10
  python3 scripts/batch_generate.py --all
"""

import json
import subprocess
import time
import argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Current year for articles
CURRENT_YEAR = 2025

# Article generation prompt template
PROMPT_TEMPLATE = '''Generate a comprehensive article for "{question}" for ProxyFAQs.com.

Search Volume: {volume} monthly searches
Category: {category}

Related variants to address:
{variants}

Reference Knowledge:
{context}

Requirements:
1. Quick Answer (exactly 200 words) - direct, concise, featured-snippet ready
2. Detailed Answer (minimum 1000 words) - technical depth, Python code examples when relevant, comparison tables

Output as valid JSON ONLY (no markdown code blocks):
{{
  "title": "SEO H1 title with keyword [{year}]",
  "meta_description": "150-160 chars exactly",
  "quick_answer": "200 word direct answer...",
  "detailed_answer": "1000+ word markdown article with ## headings...",
  "tags": ["tag1", "tag2", "tag3"],
  "word_count": 1234
}}'''


def load_questions(path: Path, category: str = None) -> list:
    """Load questions, optionally filtered by category"""
    questions = []
    with open(path, 'r') as f:
        for line in f:
            q = json.loads(line)
            if category is None or q.get('category') == category:
                questions.append(q)
    return questions


def load_knowledge_context(kb_path: Path, question: str, top_k: int = 10) -> str:
    """Simple keyword-based context retrieval"""
    # For simplicity, load a subset of KB matching keywords
    keywords = set(question.lower().split())
    keywords.discard('what')
    keywords.discard('is')
    keywords.discard('a')
    keywords.discard('the')
    keywords.discard('how')
    keywords.discard('to')

    matches = []
    with open(kb_path, 'r') as f:
        for line in f:
            entry = json.loads(line)
            text = entry.get('text', '').lower()
            score = sum(1 for kw in keywords if kw in text)
            if score > 0:
                matches.append((score, entry.get('text', '')))

    # Sort by score and take top_k
    matches.sort(reverse=True, key=lambda x: x[0])
    context_parts = [m[1][:300] for m in matches[:top_k]]

    return '\n'.join(f"• {c}" for c in context_parts) if context_parts else "General proxy knowledge base."


def build_prompt(question_data: dict, context: str) -> str:
    """Build the generation prompt"""
    variants = question_data.get('variants', [])
    variants_text = '\n'.join(f"- {v.get('question', v) if isinstance(v, dict) else v}"
                              for v in variants[:5]) if variants else "None"

    return PROMPT_TEMPLATE.format(
        question=question_data['question'],
        volume=question_data.get('volume', 0),
        category=question_data.get('category_name', 'General'),
        variants=variants_text,
        context=context,
        year=CURRENT_YEAR
    )


def generate_single(question_data: dict, kb_path: Path, output_dir: Path) -> dict:
    """Generate article for a single question"""
    slug = question_data.get('slug', '')
    output_file = output_dir / f"{slug}.json"

    # Skip if already exists
    if output_file.exists():
        return {'slug': slug, 'status': 'skipped', 'reason': 'exists'}

    # Get context
    context = load_knowledge_context(kb_path, question_data['question'])

    # Build prompt
    prompt = build_prompt(question_data, context)

    # For now, create a placeholder - actual generation will use Task agents
    result = {
        'slug': slug,
        'question': question_data['question'],
        'prompt': prompt,
        'status': 'pending',
        'created_at': datetime.now().isoformat()
    }

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--category', type=str, help='Filter by category')
    parser.add_argument('--batch', type=int, default=10, help='Batch size')
    parser.add_argument('--all', action='store_true', help='Process all')
    parser.add_argument('--list', action='store_true', help='List categories')
    args = parser.parse_args()

    project_root = Path(__file__).parent.parent
    questions_path = project_root / 'output' / 'batch1_questions.jsonl'
    kb_path = project_root / 'output' / 'knowledge_base.jsonl'
    output_dir = project_root / 'output' / 'articles'
    output_dir.mkdir(exist_ok=True)

    # Load questions
    questions = load_questions(questions_path, args.category)

    if args.list:
        from collections import Counter
        all_q = load_questions(questions_path)
        cats = Counter(q['category'] for q in all_q)
        print("Categories:")
        for cat, cnt in cats.most_common():
            print(f"  {cat}: {cnt}")
        return

    print(f"Loaded {len(questions)} questions")
    if args.category:
        print(f"  Category: {args.category}")

    # Limit batch
    if not args.all:
        questions = questions[:args.batch]
        print(f"  Limited to: {len(questions)}")

    # Generate prompts
    print(f"\nPreparing {len(questions)} prompts...")
    prompts_file = output_dir / 'pending_prompts.jsonl'

    with open(prompts_file, 'w') as f:
        for q in questions:
            result = generate_single(q, kb_path, output_dir)
            json.dump(result, f, ensure_ascii=False)
            f.write('\n')

    print(f"\nPrompts saved to: {prompts_file}")
    print(f"Ready for Task agent generation")


if __name__ == '__main__':
    main()
