#!/usr/bin/env python3
"""从 all_questions_deduped.jsonl 提取未生成文章的问题"""
import json
from pathlib import Path

# 配置
ALL_QUESTIONS_FILE = "output/all_questions_deduped.jsonl"
ARTICLES_DIR = Path("output/articles")
BATCH_SIZE = 30

# 获取已生成的 slug
existing_slugs = set()
for f in ARTICLES_DIR.glob("*.json"):
    existing_slugs.add(f.stem)

print(f"✓ 已生成文章: {len(existing_slugs)} 篇")

# 加载所有问题
all_questions = []
with open(ALL_QUESTIONS_FILE, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            q = json.loads(line.strip())
            all_questions.append(q)
        except:
            pass

print(f"✓ 问题总数: {len(all_questions):,}")

# 筛选未生成的问题
questions = []
for q in all_questions:
    slug = q.get('slug')
    if slug and slug not in existing_slugs:
        questions.append(q)

print(f"✓ 待生成问题数: {len(questions):,}")

if len(questions) == 0:
    print("\n🎉 所有问题已生成完毕！")
    exit(0)

# 取前 N 个问题
batch_questions = questions[:BATCH_SIZE]
batch_num = len(list(Path("output").glob("batch*_questions.jsonl"))) + 1
output_file = Path(f"output/batch{batch_num}_questions.jsonl")

# 保存批次文件
with open(output_file, 'w', encoding='utf-8') as f:
    for q in batch_questions:
        f.write(json.dumps(q, ensure_ascii=False) + '\n')

print(f"\n✓ 新批次文件: {output_file}")
print(f"✓ 本批次问题数: {len(batch_questions)}")
print(f"✓ 剩余问题数: {len(questions) - len(batch_questions):,}")

# 更新 bigmol_rag_batch.py 使用新批次
print(f"\n📝 自动更新 bigmol_rag_batch.py...")

batch_py = Path("scripts/bigmol_rag_batch.py")
content = batch_py.read_text()

# 查找并替换 QUESTIONS_FILE 行
import re
pattern = r'QUESTIONS_FILE = "output/batch\d+_questions\.jsonl"'
replacement = f'QUESTIONS_FILE = "output/batch{batch_num}_questions.jsonl"'
content = re.sub(pattern, replacement, content)

batch_py.write_text(content)

print(f"✓ 已更新: QUESTIONS_FILE = \"output/batch{batch_num}_questions.jsonl\"")

# 显示前3个问题
print(f"\n📋 本批次问题预览:")
for i, q in enumerate(batch_questions[:3], 1):
    print(f"  [{i}] {q.get('question')} ({q.get('slug')})")

print(f"\n✅ 准备就绪！可以运行: python3 scripts/bigmol_rag_batch.py")
