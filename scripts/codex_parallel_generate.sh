#!/bin/bash
# ProxyFAQs - Codex Parallel Content Generator
# 使用 codex_router.sh 并行批量生成高质量答案

set -euo pipefail

BASE_DIR="/opt/docker-projects/standalone-apps/proxyfaqs-import"
OUTPUT_DIR="$BASE_DIR/output"
QUESTIONS_FILE="$OUTPUT_DIR/seo_questions.jsonl"
RESULTS_FILE="$OUTPUT_DIR/codex_qa_pairs.jsonl"
TEMP_DIR="$BASE_DIR/temp_codex"
ROUTER="$HOME/.claude/bin/codex_router.sh"

# 检查路由器是否存在
if [[ ! -x "$ROUTER" ]]; then
    echo "❌ Codex router not found: $ROUTER"
    exit 1
fi

# 创建临时目录
mkdir -p "$TEMP_DIR"
rm -f "$TEMP_DIR"/*.json 2>/dev/null || true

# 清空结果文件
> "$RESULTS_FILE"

echo "============================================================"
echo "ProxyFAQs Codex Parallel Content Generation"
echo "============================================================"
echo "Questions file: $QUESTIONS_FILE"
echo "Output file: $RESULTS_FILE"
echo ""

# 读取问题总数
TOTAL=$(wc -l < "$QUESTIONS_FILE")
echo "Total questions: $TOTAL"
echo ""

# 并行批次大小（每批 10 个问题，使用 key1 和 key2 交替）
BATCH_SIZE=10
PARALLEL_WORKERS=2  # key1 和 key2

# 生成答案的函数
generate_answer() {
    local question="$1"
    local volume="$2"
    local difficulty="$3"
    local output_file="$4"
    local key="$5"

    local prompt="You are an expert in proxy servers and web scraping. Generate a comprehensive, SEO-friendly answer for the following question.

Question: $question
Search Volume: $volume
SEO Difficulty: ${difficulty:-N/A}

Requirements:
- Write a comprehensive answer (400-600 words)
- Use proper markdown formatting with headers (###)
- Include technical details and practical examples
- Make it SEO-friendly with natural keyword usage
- Be accurate and authoritative
- Focus on practical value for users

Generate ONLY the answer content in markdown format, nothing else:"

    # 调用 codex router（使用 json 模式获取结构化输出）
    local result=$("$ROUTER" "$key" "$prompt" "" "json" 2>/dev/null || echo '{"success":false}')

    # 检查是否成功
    if echo "$result" | jq -e '.success == true' > /dev/null 2>&1; then
        local answer=$(echo "$result" | jq -r '.content')

        # 构建 Q&A JSON
        jq -n \
            --arg q "$question" \
            --arg a "$answer" \
            --argjson v "$volume" \
            --arg d "$difficulty" \
            '{question: $q, answer: $a, volume: $v, difficulty: ($d | if . == "" then null else tonumber end), generated_by: "codex-cli"}' \
            >> "$output_file"

        echo "✓ Generated: $question (Vol: $volume)"
        return 0
    else
        echo "✗ Failed: $question"
        return 1
    fi
}

export -f generate_answer
export ROUTER RESULTS_FILE

# 处理问题
echo "Starting parallel generation..."
echo ""

success_count=0
failed_count=0
current=0

# 使用 GNU parallel 或简单的后台进程
while IFS= read -r line; do
    current=$((current + 1))

    question=$(echo "$line" | jq -r '.question')
    volume=$(echo "$line" | jq -r '.volume')
    difficulty=$(echo "$line" | jq -r '.difficulty // empty')

    # 选择 key (交替使用 1 和 2)
    key=$(( (current % 2) + 1 ))

    # 后台执行
    (
        if generate_answer "$question" "$volume" "$difficulty" "$RESULTS_FILE" "$key"; then
            echo "1" > "$TEMP_DIR/success_${current}"
        else
            echo "1" > "$TEMP_DIR/failed_${current}"
        fi
    ) &

    # 控制并发数
    if (( current % PARALLEL_WORKERS == 0 )); then
        wait  # 等待当前批次完成
    fi

    # 每批显示进度
    if (( current % (BATCH_SIZE * PARALLEL_WORKERS) == 0 )); then
        echo ""
        echo "Progress: $current / $TOTAL questions processed"
        echo ""
    fi

done < "$QUESTIONS_FILE"

# 等待所有后台任务完成
wait

# 统计结果
success_count=$(ls "$TEMP_DIR"/success_* 2>/dev/null | wc -l)
failed_count=$(ls "$TEMP_DIR"/failed_* 2>/dev/null | wc -l)

echo ""
echo "============================================================"
echo "CODEX PARALLEL GENERATION COMPLETE"
echo "============================================================"
echo "Total questions:     $TOTAL"
echo "Successfully generated: $success_count"
echo "Failed:              $failed_count"
echo ""
echo "Output file: $RESULTS_FILE"
echo "File size: $(du -h "$RESULTS_FILE" | cut -f1)"
echo "Total entries: $(wc -l < "$RESULTS_FILE")"
echo "============================================================"

# 清理临时文件
rm -rf "$TEMP_DIR"
