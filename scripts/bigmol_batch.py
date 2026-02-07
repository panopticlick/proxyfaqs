#!/usr/bin/env python3
"""
BigModel 批量文章生成器
- 自动备份
- 并发生成
- 错误重试
"""
import os
import json
import time
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ARTICLES_DIR = Path("output/articles")
QUESTIONS_FILE = "output/batch1_questions.jsonl"
BIGMODEL_BIN = os.path.expanduser("~/.claude/bin/bigmodel_router.sh")
BACKUP_DIR = Path(f"output/backups/{datetime.now().strftime('%Y%m%d_%H%M%S')}")
MAX_PARALLEL = 2  # BigModel 并发限制
MAX_RETRIES = 2

def setup_backup():
    """创建备份目录并备份现有文章"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if ARTICLES_DIR.exists():
        shutil.copytree(ARTICLES_DIR, BACKUP_DIR / "articles")
    print(f"✓ 备份目录: {BACKUP_DIR}")

def get_existing_slugs():
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

def generate_article(slug, question, volume, retry=0):
    """生成单篇文章"""
    prompt = f'Generate an article about "{question}" for ProxyFAQs.com. Requirements: Quick Answer ~200 words, Detailed Answer 1000+ words. Output ONLY valid JSON: {{"title":"[2025]","meta_description":"150-160c","quick_answer":"...","detailed_answer":"...","tags\":[],"word_count":N}}'

    cmd = [BIGMODEL_BIN, prompt]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

    if result.returncode != 0:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, retry + 1)
        return False, f"Command failed: {result.stderr}"

    output = result.stdout

    # 提取 JSON
    json_content = extract_json(output)
    if not json_content:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, retry + 1)
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
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return True, data.get('word_count', 0)
    except Exception as e:
        if retry < MAX_RETRIES:
            time.sleep(5)
            return generate_article(slug, question, volume, retry + 1)
        return False, str(e)

def extract_json(text):
    """从输出中提取 JSON"""
    import re

    # 尝试提取 ```json...``` 块
    match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # 尝试提取 {...} 块
    match = re.search(r'\{[^{}]*"title"[^{}]*\}(?:\{[^{}]*\})*', text, re.DOTALL)
    if match:
        return match.group(0)

    # 尝试直接解析整个输出
    try:
        data = json.loads(text.strip())
        return json.dumps(data)
    except:
        pass

    return None

def main():
    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)

    print("=== BigModel 批量文章生成 ===")
    setup_backup()

    # 读取问题列表
    questions = []
    with open(QUESTIONS_FILE) as fp:
        for line in fp:
            try:
                q = json.loads(line)
                questions.append(q)
            except:
                pass

    print(f"✓ 共 {len(questions)} 个问题待生成")

    # 获取已完成的
    existing = get_existing_slugs()
    print(f"✓ 已完成: {len(existing)} 篇")

    # 过滤未完成的
    pending = [q for q in questions if q.get('slug') not in existing]
    print(f"✓ 待生成: {len(pending)} 篇\n")

    if not pending:
        print("所有文章已完成！")
        return

    # 批量生成
    completed = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
        futures = {}
        for q in pending[:50]:  # 每次最多50篇
            slug = q.get('slug')
            question = q.get('question')
            volume = q.get('volume', 0)
            future = executor.submit(generate_article, slug, question, volume)
            futures[future] = slug

        for future in as_completed(futures):
            slug = futures[future]
            try:
                success, result = future.result()
                if success:
                    completed += 1
                    print(f"  [{completed+len(existing)}/{len(questions)}] ✓ {slug} ({result} words)")
                else:
                    failed += 1
                    print(f"  ✗ {slug}: {result}")
            except Exception as e:
                failed += 1
                print(f"  ✗ {slug}: {e}")

    print(f"\n=== 生成完成 ===")
    print(f"新增: {completed} 篇")
    print(f"失败: {failed} 篇")
    print(f"总计: {len(get_existing_slugs())} 篇")

if __name__ == "__main__":
    main()
