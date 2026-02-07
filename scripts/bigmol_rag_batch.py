#!/usr/bin/env python3
"""
BigModel 批量文章生成器 + RAG
- 使用知识库 (knowledge_base.jsonl) 进行 RAG 检索
- 并发生成
- 自动备份
- 错误重试
"""
import os
import json
import time
import subprocess
import shutil
import re
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Tuple

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    print("⚠️ scikit-learn not available, RAG disabled")

ARTICLES_DIR = Path("output/articles")
QUESTIONS_FILE = "output/batch86_questions.jsonl"
KNOWLEDGE_BASE = "output/knowledge_base.jsonl"
BIGMODEL_BIN = os.path.expanduser("~/.claude/bin/bigmodel_router.sh")
BACKUP_DIR = Path(f"output/backups/{datetime.now().strftime('%Y%m%d_%H%M%S')}")

MAX_PARALLEL = 2  # BigModel 并发限制
MAX_RETRIES = 2
TOP_K = 12  # RAG 检索数量


class RAGRetriever:
    """RAG 知识检索器"""

    def __init__(self, knowledge_base_path: str, top_k: int = TOP_K):
        self.knowledge_base_path = Path(knowledge_base_path)
        self.top_k = top_k
        self.knowledge_entries: List[Dict] = []
        self.vectorizer = None
        self.tfidf_matrix = None
        self.loaded = False

    def load(self):
        """加载知识库"""
        if not self.knowledge_base_path.exists():
            print(f"⚠️ 知识库不存在: {self.knowledge_base_path}")
            return False

        if not SKLEARN_AVAILABLE:
            print("⚠️ scikit-learn 未安装，跳过 RAG")
            return False

        print(f"加载知识库: {self.knowledge_base_path}")

        with open(self.knowledge_base_path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    if entry.get('text'):
                        self.knowledge_entries.append(entry)
                except:
                    pass

        if len(self.knowledge_entries) == 0:
            print("⚠️ 知识库为空")
            return False

        print(f"  ✓ 加载 {len(self.knowledge_entries):,} 条知识")

        # 构建 TF-IDF 索引
        print("  构建 RAG 索引...")
        texts = [entry.get('text', '') for entry in self.knowledge_entries]

        self.vectorizer = TfidfVectorizer(
            max_features=10000,
            stop_words='english',
            ngram_range=(1, 2),
            min_df=2,
            max_df=0.85
        )

        self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        print(f"  ✓ 索引形状: {self.tfidf_matrix.shape}")
        self.loaded = True
        return True

    def retrieve(self, question: str, top_k: int = None) -> str:
        """检索相关上下文"""
        if not self.loaded:
            return ""

        if top_k is None:
            top_k = self.top_k

        # 向量化问题
        q_vec = self.vectorizer.transform([question])
        similarities = cosine_similarity(q_vec, self.tfidf_matrix).flatten()

        # 获取 top-k
        top_indices = similarities.argsort()[-top_k:][::-1]

        # 格式化上下文
        context_parts = []
        for idx in top_indices:
            if similarities[idx] > 0.03:
                text = self.knowledge_entries[idx].get('text', '')
                text = re.sub(r'\s+', ' ', text).strip()
                if len(text) > 250:
                    text = text[:250] + "..."
                context_parts.append(f"• {text}")

        return '\n'.join(context_parts) if context_parts else ""


def setup_backup():
    """创建备份目录并备份现有文章"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if ARTICLES_DIR.exists():
        shutil.copytree(ARTICLES_DIR, BACKUP_DIR / "articles", dirs_exist_ok=True)
    print(f"✓ 备份目录: {BACKUP_DIR}")


def get_existing_slugs() -> set:
    """获取已完成的文章 slug"""
    existing = set()
    for f in ARTICLES_DIR.glob("*.json"):
        try:
            with open(f) as fp:
                data = json.load(fp)
                if data.get('word_count', 0) >= 1000:
                    existing.add(data.get('slug', f.stem))
        except:
            pass
    return existing


def generate_article(slug: str, question: str, volume: int, category: str,
                    context: str, retry: int = 0) -> Tuple[bool, str]:
    """生成单篇文章"""

    # 构建带 RAG 的 prompt
    context_section = f"\n## 参考知识 (来自 Google PAA 数据)\n{context}\n" if context else ""

    prompt = f'''You are a senior proxy and web scraping expert writing for ProxyFAQs.com.

## Question
{question}

## Search Volume: {volume:,} monthly searches
## Category: {category}{context_section}

---

## REQUIREMENTS

Generate a comprehensive article with EXACTLY this structure:

### Part 1: Quick Answer (200 words)
- Direct, concise answer to the question
- Key takeaways in 2-3 sentences
- Perfect for featured snippets

### Part 2: Detailed Answer (1000+ words minimum)
- In-depth explanation with technical details
- Real-world examples and use cases
- Python code snippets when relevant
- Comparison tables where appropriate
- SEO-optimized with semantic keywords

## OUTPUT FORMAT

Return valid JSON only:
```json
{{
  "title": "SEO H1 title with main keyword [2025]",
  "meta_description": "150-160 char compelling description",
  "quick_answer": "200 word quick answer here...",
  "detailed_answer": "1000+ word detailed answer in markdown...",
  "tags": ["tag1", "tag2", "tag3"],
  "word_count": 1234
}}
```

IMPORTANT:
- Minimum total 1200 words (quick + detailed)
- Be technical and authoritative
- Include practical examples
- NO fluff - every sentence adds value
- Year should be 2025

Generate now:'''

    cmd = [BIGMODEL_BIN, prompt]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)

    if result.returncode != 0:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, category, context, retry + 1)
        return False, f"Command failed: {result.stderr[:200]}"

    output = result.stdout

    # 提取 JSON
    json_content = extract_json(output)
    if not json_content:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, category, context, retry + 1)
        return False, "No JSON found in output"

    # 验证并保存
    try:
        data = json.loads(json_content)
        data['slug'] = slug
        data['volume'] = volume

        # 确保 word_count 字段
        if 'word_count' not in data:
            qa_words = len(data.get('quick_answer', '').split())
            da_words = len(data.get('detailed_answer', '').split())
            data['word_count'] = qa_words + da_words

        output_file = ARTICLES_DIR / f"{slug}.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        wc = data.get('word_count', 0)
        return True, f"{wc} words"
    except Exception as e:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, category, context, retry + 1)
        return False, str(e)


def extract_json(text: str) -> str:
    """从输出中提取 JSON - 更强的解析"""
    # 首先尝试提取 ```json...``` 块
    match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        json_str = match.group(1).strip()
        try:
            json.loads(json_str)  # 验证
            return json_str
        except:
            pass

    # 尝试提取从第一个 { 到最后一个 } 的内容
    start = text.find('{')
    if start == -1:
        return ""

    # 找到匹配的结束括号（处理嵌套）
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                json_str = text[start:i+1]
                try:
                    json.loads(json_str)  # 验证
                    return json_str
                except:
                    break

    # 尝试直接解析整个输出
    try:
        data = json.loads(text.strip())
        return json.dumps(data)
    except:
        pass

    return ""


def main():
    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print(" BigModel 批量文章生成 + RAG")
    print("=" * 60)

    setup_backup()

    # 初始化 RAG
    rag = RAGRetriever(KNOWLEDGE_BASE, top_k=TOP_K)
    rag.load()

    # 读取问题列表
    questions = []
    with open(QUESTIONS_FILE) as fp:
        for line in fp:
            try:
                q = json.loads(line)
                questions.append(q)
            except:
                pass

    print(f"\n✓ 共 {len(questions)} 个问题")

    # 获取已完成的
    existing = get_existing_slugs()
    print(f"✓ 已完成: {len(existing)} 篇\n")

    # 过滤未完成的
    pending = [q for q in questions if q.get('slug') not in existing]
    print(f"✓ 待生成: {len(pending)} 篇\n")

    if not pending:
        print("🎉 所有文章已完成！")
        return

    # 批量生成 (每次最多30篇)
    batch_size = 30
    pending_batch = pending[:batch_size]

    print(f"开始生成批次 1 (最多 {batch_size} 篇)...\n")

    completed = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
        futures = {}

        for q in pending_batch:
            slug = q.get('slug')
            question = q.get('question')
            volume = q.get('volume', 0)
            category = q.get('category_name', 'General')

            # RAG 检索
            context = rag.retrieve(question) if rag.loaded else ""

            future = executor.submit(
                generate_article,
                slug, question, volume, category, context
            )
            futures[future] = slug

        for future in as_completed(futures):
            slug = futures[future]
            try:
                success, result = future.result()
                if success:
                    completed += 1
                    total = len(existing) + completed
                    print(f"  [{total}/{len(questions)}] ✓ {slug} - {result}")
                else:
                    failed += 1
                    print(f"  ✗ {slug}: {result}")
            except Exception as e:
                failed += 1
                print(f"  ✗ {slug}: {e}")

    print(f"\n" + "=" * 60)
    print(f" 本批次完成:")
    print(f"   新增: {completed} 篇")
    print(f"   失败: {failed} 篇")
    print(f"   总计: {len(get_existing_slugs())} 篇")
    print("=" * 60)

    if len(pending) > batch_size:
        print(f"\n还有 {len(pending) - batch_size} 篇待生成，请重新运行脚本")


if __name__ == "__main__":
    main()
