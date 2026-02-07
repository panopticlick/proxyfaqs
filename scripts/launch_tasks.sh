#!/bin/bash
cd /Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs

SLOTS=${1:-2}

cat output/batch1_questions.jsonl | python3 << 'PYEOF'
import sys, json, os
existing = set(f.replace('.json', '') for f in os.listdir('output/articles') if f.endswith('.json'))
count = 0
for line in sys.stdin:
    q = json.loads(line)
    slug = q.get('slug', '')
    if slug and slug not in existing:
        print(f'{slug}|{q.get("question", "")}|{q.get("volume", 0)}')
        count += 1
PYEOF
| head -${SLOTS} | while IFS='|' read -r slug question volume; do
    echo "  -> $slug"
    ~/.claude/bin/codex_router.sh "Generate article for \"$question\" for ProxyFAQs.com. Volume: $volume. Requirements: Quick Answer (200 words) + Detailed Answer (1000+ words). Output ONLY valid JSON: {\"title\":\"[2025]\",\"meta_description\":\"150-160c\",\"quick_answer\":\"...\",\"detailed_answer\":\"...\",\"tags\":[],\"word_count\":N}" "output/articles/${slug}.json" silent high &
    sleep 2
done
