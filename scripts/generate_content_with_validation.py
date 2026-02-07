#!/usr/bin/env python3
"""
Content Generation with Validation and Duplicate Detection

Features:
1. Question template loading from JSON
2. Slug generation and duplicate checking
3. Content quality validation
4. Batch generation with progress tracking
5. Safe article saving with backup

Usage:
    python3 scripts/generate_content_with_validation.py --category web-scraping --limit 10
    python3 scripts/generate_content_with_validation.py --all
"""

import os
import json
import re
import hashlib
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

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
    tqdm = None


# Paths
PROJECT_DIR = Path(__file__).parent.parent
DOCS_DIR = PROJECT_DIR / "docs"
QUESTIONS_FILE = DOCS_DIR / "MISSING_QUESTIONS_BY_CATEGORY.json"
OUTPUT_DIR = PROJECT_DIR / "output" / "validated_articles"
BACKUP_DIR = PROJECT_DIR / "output" / "backups"

# Ensure directories exist
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def slugify(question: str) -> str:
    """Convert question to URL-friendly slug"""
    # Remove common stop words at start
    stop_words = {"what", "how", "why", "when", "where", "which", "who", "are", "is", "do", "does", "can"}
    words = question.lower().split()
    if words and words[0] in stop_words:
        words = words[1:]
    # Remove special chars but keep hyphens
    slug = re.sub(r"[^a-z0-9\s-]", "", " ".join(words))
    slug = re.sub(r"\s+", "-", slug.strip())
    return slug


def load_existing_slugs() -> set:
    """Load all existing slugs to prevent duplicates"""
    slugs = set()
    # Check existing articles in questions_categorized.jsonl
    categorized_file = PROJECT_DIR / "output" / "questions_categorized.jsonl"
    if categorized_file.exists():
        with open(categorized_file, "r") as f:
            for line in f:
                if line.strip():
                    try:
                        data = json.loads(line)
                        if "slug" in data:
                            slugs.add(data["slug"])
                    except json.JSONDecodeError:
                        continue
    # Check generated articles
    for f in OUTPUT_DIR.glob("*.json"):
        slugs.add(f.stem)
    return slugs


def load_questions_from_file(category: Optional[str] = None) -> List[Dict]:
    """Load questions from the missing questions file"""
    if not QUESTIONS_FILE.exists():
        print(f"ERROR: Questions file not found: {QUESTIONS_FILE}")
        return []

    with open(QUESTIONS_FILE, "r") as f:
        data = json.load(f)

    questions = []
    existing_slugs = load_existing_slugs()

    for cat_key, cat_data in data.items():
        if category and cat_key != category and cat_data.get("category_slug") != category:
            continue

        for q in cat_data.get("questions", []):
            slug = slugify(q["question"])
            # Skip if already exists
            if slug in existing_slugs:
                q["status"] = "exists"
                q["skip_reason"] = "already exists"
            else:
                q["status"] = "pending"
            q["category"] = cat_data["category_name"]
            q["category_slug"] = cat_data["category_slug"]
            q["slug"] = slug
            questions.append(q)

    # Sort by priority then volume
    questions.sort(key=lambda x: (x.get("priority", 99), -x.get("volume", 0)))
    return questions


class ContentValidator:
    """Validates generated content against quality standards"""

    MIN_WORD_COUNT = 1200
    MAX_TITLE_LENGTH = 60
    MIN_META_DESC = 150
    MAX_META_DESC = 160

    @staticmethod
    def validate_word_count(content: str) -> Tuple[bool, str]:
        """Check minimum word count"""
        count = len(content.split())
        if count < ContentValidator.MIN_WORD_COUNT:
            return False, f"Word count {count} below minimum {ContentValidator.MIN_WORD_COUNT}"
        return True, f"Word count: {count}"

    @staticmethod
    def validate_title(title: str) -> Tuple[bool, str]:
        """Check title length"""
        if len(title) > ContentValidator.MAX_TITLE_LENGTH:
            return False, f"Title {len(title)} chars exceeds max {ContentValidator.MAX_TITLE_LENGTH}"
        return True, "Title length OK"

    @staticmethod
    def validate_meta_description(meta_desc: str) -> Tuple[bool, str]:
        """Check meta description length"""
        length = len(meta_desc)
        if length < ContentValidator.MIN_META_DESC:
            return False, f"Meta description {length} chars below minimum {ContentValidator.MIN_META_DESC}"
        if length > ContentValidator.MAX_META_DESC:
            return False, f"Meta description {length} chars exceeds maximum {ContentValidator.MAX_META_DESC}"
        return True, f"Meta description {length} chars"

    @staticmethod
    def validate_structure(content: str) -> Tuple[bool, str]:
        """Check for required markdown structure"""
        issues = []
        if not re.search(r"^#\s+", content, re.MULTILINE):
            issues.append("Missing H1 title")
        if not re.search(r"^##\s+", content, re.MULTILINE):
            issues.append("Missing H2 sections")
        if "## Frequently Asked Questions" not in content:
            issues.append("Missing FAQ section")
        if "## Conclusion" not in content:
            issues.append("Missing Conclusion section")

        if issues:
            return False, "; ".join(issues)
        return True, "Structure OK"

    @staticmethod
    def validate_code_blocks(content: str) -> Tuple[bool, str]:
        """Check code blocks have language tags"""
        # Find code blocks
        blocks = re.findall(r"```(\w*)", content)
        untagged = blocks.count("")
        if untagged > 0:
            return False, f"{untagged} code blocks missing language tags"
        return True, "Code blocks OK"

    @classmethod
    def validate_all(cls, article: Dict) -> Tuple[bool, List[str]]:
        """Run all validations"""
        results = []
        all_valid = True

        for field, validator in [
            ("article", cls.validate_word_count),
            ("title", cls.validate_title),
            ("meta_description", cls.validate_meta_description),
            ("article", cls.validate_structure),
            ("article", cls.validate_code_blocks),
        ]:
            if field in article:
                valid, msg = validator(article[field])
                results.append(msg)
                if not valid:
                    all_valid = False

        return all_valid, results


class ArticleGenerator:
    """Generate articles with VectorEngine API"""

    def __init__(self, api_key: str, model: str = "grok-4-fast"):
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.vectorengine.ai/v1"
        )
        self.model = model
        self.validator = ContentValidator()

    def get_article_type(self, question: str) -> str:
        """Determine article type based on question"""
        q_lower = question.lower()
        if any(w in q_lower for w in ["how to", "how do", "setup", "configure", "set up"]):
            return "how-to"
        elif any(w in q_lower for w in ["vs", "versus", "or", "difference"]):
            return "comparison"
        elif any(w in q_lower for w in ["error", "fix", "not working", "troubleshoot"]):
            return "troubleshooting"
        else:
            return "explainer"

    def generate_article(self, question_data: Dict, retry_count: int = 3) -> Optional[Dict]:
        """Generate article for a question"""
        question = question_data["question"]
        category = question_data.get("category", "General")
        volume = question_data.get("volume", 0)
        article_type = self.get_article_type(question)

        prompt = self._build_prompt(question, category, volume, article_type)

        for attempt in range(retry_count):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an expert technical writer for ProxyFAQs.com. Always respond with valid JSON only."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=4000,
                    temperature=0.7
                )

                content = response.choices[0].message.content.strip()

                # Parse JSON
                if content.startswith("```"):
                    content = re.sub(r"^```(?:json)?\n?", "", content)
                    content = re.sub(r"\n?```$", "", content)

                result = json.loads(content)

                # Add metadata
                result["question"] = question
                result["category"] = category
                result["article_type"] = article_type
                result["volume"] = volume
                result["slug"] = question_data["slug"]

                # Validate
                is_valid, messages = self.validator.validate_all(result)
                result["validation"] = {
                    "valid": is_valid,
                    "messages": messages
                }

                return result

            except json.JSONDecodeError as e:
                if attempt < retry_count - 1:
                    print(f"  JSON parse error (attempt {attempt + 1}): {e}")
                    import time
                    time.sleep(2)
                else:
                    print(f"  Failed to parse JSON after {retry_count} attempts")
                    return None
            except Exception as e:
                if attempt < retry_count - 1:
                    wait_time = (attempt + 1) * 3
                    print(f"  API error (attempt {attempt + 1}): {e}")
                    import time
                    time.sleep(wait_time)
                else:
                    print(f"  Failed after {retry_count} attempts: {e}")
                    return None

        return None

    def _build_prompt(self, question: str, category: str, volume: int, article_type: str) -> str:
        """Build generation prompt based on article type"""

        base_prompt = f"""You are a senior proxy and web scraping expert writing for ProxyFAQs.com.

## Question to Answer
{question}

## Context
- Category: {category}
- Search Volume: {volume:,} monthly searches
- Article Type: {article_type}

"""

        type_instructions = {
            "how-to": """Write a step-by-step how-to guide with:
1. Prerequisites section
2. What You'll Need
3. Step-by-step instructions with code examples
4. Troubleshooting common issues
5. Next steps

Include Python code examples where relevant.""",

            "comparison": """Write a comparison article with:
1. Quick Answer (which wins and why)
2. Comparison table with features
3. Pros/Cons of each option
4. Use case recommendations
5. Conclusion""",

            "troubleshooting": """Write a troubleshooting guide with:
1. Error description
2. Common causes
3. Step-by-step solutions
4. Prevention tips""",

            "explainer": """Write an explanatory article with:
1. Clear definition
2. How it works
3. Use cases and examples
4. Pros and cons
5. Alternatives"""
        }

        instructions = type_instructions.get(article_type, type_instructions["explainer"])

        requirements = """

## Article Requirements
- Minimum 1,200 words
- Include code examples with syntax highlighting
- Add comparison table for comparisons
- Include FAQ section with 5+ related questions
- Add conclusion with actionable takeaways

## Output Format
Return ONLY valid JSON:
```json
{
  "title": "SEO-optimized H1 (max 60 chars, include main keyword)",
  "meta_description": "150-160 character compelling description",
  "article": "Full markdown article with proper formatting"
}
```"""

        return base_prompt + instructions + requirements


def save_article_safe(article: Dict) -> bool:
    """Save article with validation checks"""
    slug = article.get("slug", "unknown")
    timestamp = datetime.now().isoformat()

    # Add metadata
    article["saved_at"] = timestamp

    # Write to temp file first
    temp_file = OUTPUT_DIR / f".tmp_{slug}.json"
    target_file = OUTPUT_DIR / f"{slug}.json"

    try:
        with open(temp_file, "w") as f:
            json.dump(article, f, indent=2, ensure_ascii=False)

        # Verify JSON
        with open(temp_file) as f:
            json.load(f)

        # Backup if exists
        if target_file.exists():
            backup_file = BACKUP_DIR / f"{slug}.bak.{timestamp}"
            backup_file.parent.mkdir(exist_ok=True)
            import shutil
            shutil.copy2(target_file, backup_file)

        # Atomic move
        temp_file.replace(target_file)
        return True

    except Exception as e:
        print(f"  ERROR saving {slug}: {e}")
        if temp_file.exists():
            temp_file.unlink()
        return False


def generate_batch(category: Optional[str], limit: Optional[int], api_key: str):
    """Generate articles in batch"""
    questions = load_questions_from_file(category)

    if not questions:
        print("No questions to process")
        return

    # Filter out existing
    pending = [q for q in questions if q.get("status") == "pending"]

    if limit:
        pending = pending[:limit]

    print(f"\n{'='*60}")
    print(f"CONTENT GENERATION")
    print(f"{'='*60}")
    print(f"Category: {category or 'All'}")
    print(f"Questions to process: {len(pending)}")
    print(f"Output: {OUTPUT_DIR}\n")

    generator = ArticleGenerator(api_key)
    stats = {"generated": 0, "failed": 0, "skipped": 0, "validation_failed": 0}

    progress_bar = tqdm(pending, desc="Generating")
    start_time = datetime.now()

    for q in progress_bar:
        if q.get("status") == "exists":
            stats["skipped"] += 1
            continue

        result = generator.generate_article(q)

        if result:
            validation = result.get("validation", {})
            if validation.get("valid", True):
                if save_article_safe(result):
                    stats["generated"] += 1
                else:
                    stats["failed"] += 1
            else:
                stats["validation_failed"] += 1
                # Still save for review
                save_article_safe(result)
        else:
            stats["failed"] += 1

        progress_bar.set_postfix({
            "gen": stats["generated"],
            "fail": stats["failed"],
            "val": stats["validation_failed"]
        })

        # Rate limiting
        import time
        time.sleep(2)

    elapsed = (datetime.now() - start_time).total_seconds()

    print(f"\n{'='*60}")
    print(f"GENERATION COMPLETE")
    print(f"{'='*60}")
    print(f"Generated:        {stats['generated']}")
    print(f"Failed:           {stats['failed']}")
    print(f"Validation Issues:{stats['validation_failed']}")
    print(f"Skipped:          {stats['skipped']}")
    print(f"Time:             {elapsed:.1f}s")
    print(f"\nArticles saved to: {OUTPUT_DIR}")


def list_categories():
    """List available categories"""
    if not QUESTIONS_FILE.exists():
        print(f"Questions file not found: {QUESTIONS_FILE}")
        return

    with open(QUESTIONS_FILE, "r") as f:
        data = json.load(f)

    print("\nAvailable Categories:")
    print(f"{'Category':<30} {'Slug':<25} {'Questions':<10} {'Priority'}")
    print("-" * 80)

    for key, val in sorted(data.items(), key=lambda x: x[1].get("priority", 99)):
        name = val.get("category_name", key)
        slug = val.get("category_slug", key)
        count = len(val.get("questions", []))
        priority = val.get("priority", "-")
        print(f"{name:<30} {slug:<25} {count:<10} {priority}")


def validate_existing():
    """Validate existing articles"""
    articles = list(OUTPUT_DIR.glob("*.json"))
    validator = ContentValidator()

    if not articles:
        print("No articles found in output directory")
        return

    print(f"\nValidating {len(articles)} articles...\n")

    issues = []

    for f in articles:
        with open(f) as fp:
            try:
                article = json.load(fp)
                is_valid, messages = validator.validate_all(article)
                if not is_valid:
                    issues.append((f.stem, messages))
            except json.JSONDecodeError:
                issues.append((f.stem, ["Invalid JSON"]))

    if issues:
        print(f"Found {len(issues)} articles with issues:\n")
        for slug, msgs in issues:
            print(f"  {slug}:")
            for msg in msgs:
                print(f"    - {msg}")
    else:
        print("All articles passed validation!")


def main():
    parser = argparse.ArgumentParser(
        description="Generate content with validation",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument("--category", "-c", help="Category slug to generate")
    parser.add_argument("--limit", "-n", type=int, help="Limit number of articles")
    parser.add_argument("--list", "-l", action="store_true", help="List categories")
    parser.add_argument("--validate", "-v", action="store_true", help="Validate existing articles")
    parser.add_argument("--model", default="grok-4-fast", help="Model to use")

    args = parser.parse_args()

    api_key = os.getenv("VECTORENGINE_API_KEY")
    if not api_key and not args.list and not args.validate:
        print("ERROR: VECTORENGINE_API_KEY not set")
        print("Set it with: export VECTORENGINE_API_KEY='your-key'")
        return 1

    if args.list:
        list_categories()
    elif args.validate:
        validate_existing()
    else:
        generate_batch(args.category, args.limit, api_key)

    return 0


if __name__ == "__main__":
    exit(main())
