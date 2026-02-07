#!/bin/bash
# BigModel 批量生成文章 - 自动备份

set -e

ARTICLES_DIR="output/articles"
QUESTIONS_FILE="output/batch1_questions.jsonl"
BIGMODEL_BIN="$HOME/.claude/bin/bigmodel_router.sh"
BACKUP_DIR="output/backups/$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"
mkdir -p "$ARTICLES_DIR"

echo "=== BigModel 批量文章生成 ==="
echo "备份目录: $BACKUP_DIR"

# 备份现有文章
cp -r "$ARTICLES_DIR" "$BACKUP_DIR/" 2>/dev/null || true
echo "✓ 已备份现有文章"

# 获取已完成的文章
get_existing_slugs() {
    python3 << 'PYEOF'
import json, os, sys
existing = set()
for f in os.listdir('output/articles'):
    if f.endswith('.json'):
        try:
            with open(os.path.join('output/articles', f)) as fp:
                data = json.load(fp)
                if data.get('word_count', 0) >= 1000:
                    existing.add(f.replace('.json', ''))
        except:
            pass
for slug in sorted(existing):
    print(slug)
PYEOF
}

# 生成单篇文章
generate_article() {
    local slug="$1"
    local question="$2"
    local volume="$3"

    local prompt="Generate an article about \"${question}\" for ProxyFAQs.com. Requirements: Quick Answer ~200 words, Detailed Answer 1000+ words. Output ONLY valid JSON: {\"title\":\"[2025]\",\"meta_description\":\"150-160c\",\"quick_answer\":\"...\",\"detailed_answer\":\"...\",\"tags\":[],\"word_count\":N}"

    echo "  -> $slug"

    # 调用 bigmodel 生成
    local output_json
    output_json=$($BIGMODEL_BIN "$prompt" 2>&1)

    # 提取 JSON 内容
    local json_content
    json_content=$(echo "$output_json" | sed -n '/```json/,/```/p' | sed '1d;$d' | tr -d '`')

    if [ -z "$json_content" ]; then
        # 尝试直接提取 JSON
        json_content=$(echo "$output_json" | grep -o '{[^}]*"title"' | head -1 | sed 's/"title".*/}/' | sed 's/^\({[^}]*\).*/\1/')
    fi

    if [ -n "$json_content" ] && [ ${#json_content} -gt 500 ]; then
        echo "$json_content" > "$ARTICLES_DIR/${slug}.json"
        echo "     ✓ 保存成功"
        return 0
    else
        echo "     ✗ 生成失败"
        return 1
    fi
}

# 主循环
echo ""
echo "开始批量生成..."
echo ""

count=0
max_parallel=3
pids=()

while IFS= read -r line; do
    slug=$(echo "$line" | jq -r '.slug' 2>/dev/null)
    question=$(echo "$line" | jq -r '.question' 2>/dev/null)
    volume=$(echo "$line" | jq -r '.volume // 0' 2>/dev/null)

    [ -z "$slug" ] && continue

    # 检查是否已存在
    if [ -f "$ARTICLES_DIR/${slug}.json" ]; then
        wc=$(jq -r '.word_count // 0' "$ARTICLES_DIR/${slug}.json" 2>/dev/null || echo "0")
        if [ "$wc" -ge 1000 ]; then
            continue
        fi
    fi

    # 等待空槽
    while [ ${#pids[@]} -ge $max_parallel ]; do
        for i in "${!pids[@]}"; do
            if ! kill -0 ${pids[$i]} 2>/dev/null; then
                unset 'pids[$i]'
            fi
        done
        sleep 2
    done

    # 后台生成
    (
        generate_article "$slug" "$question" "$volume"
    ) &
    pids+=($!)
    sleep 3

    count=$((count + 1))
    if [ $((count % 10)) -eq 0 ]; then
        complete=$(get_existing_slugs | wc -l | tr -d ' ')
        echo ""
        echo "[$(date +%H:%M:%S)] 已完成: $complete 篇"
        echo ""
    fi

done < "$QUESTIONS_FILE"

# 等待所有任务完成
for pid in "${pids[@]}"; do
    wait $pid 2>/dev/null || true
done

# 最终统计
echo ""
echo "=== 生成完成 ==="
complete=$(get_existing_slugs | wc -l | tr -d ' ')
echo "总共完成: $complete 篇文章"
echo "备份位置: $BACKUP_DIR"
