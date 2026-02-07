#!/bin/bash
# ProxyFAQs Batch Content Generation
# Usage: ./scripts/generate_all.sh [category] [batch_size]

set -e

PROJECT_DIR="/Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs"
OUTPUT_DIR="$PROJECT_DIR/output/articles"
QUESTIONS_FILE="$PROJECT_DIR/output/batch1_questions.jsonl"
KB_FILE="$PROJECT_DIR/output/knowledge_base.jsonl"
CODEX_ROUTER="$HOME/.claude/bin/codex_router.sh"

CATEGORY="${1:-all}"
BATCH_SIZE="${2:-5}"
YEAR=2025

mkdir -p "$OUTPUT_DIR"

echo "=============================================="
echo "ProxyFAQs Batch Generation"
echo "=============================================="
echo "Category: $CATEGORY"
echo "Batch Size: $BATCH_SIZE"
echo "Output: $OUTPUT_DIR"
echo ""

# Filter questions by category
if [ "$CATEGORY" == "all" ]; then
    QUESTIONS=$(cat "$QUESTIONS_FILE")
else
    QUESTIONS=$(cat "$QUESTIONS_FILE" | python3 -c "
import sys, json
for line in sys.stdin:
    q = json.loads(line)
    if q.get('category') == '$CATEGORY':
        print(line.strip())
")
fi

TOTAL=$(echo "$QUESTIONS" | wc -l | tr -d ' ')
echo "Total questions: $TOTAL"
echo ""

# Process in batches
COUNTER=0
PROCESSED=0
SKIPPED=0

echo "$QUESTIONS" | head -n "$BATCH_SIZE" | while IFS= read -r line; do
    COUNTER=$((COUNTER + 1))

    SLUG=$(echo "$line" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['slug'])")
    QUESTION=$(echo "$line" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['question'])")
    VOLUME=$(echo "$line" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('volume', 0))")
    CAT_NAME=$(echo "$line" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('category_name', 'General'))")

    OUTPUT_FILE="$OUTPUT_DIR/${SLUG}.json"

    # Skip if exists
    if [ -f "$OUTPUT_FILE" ]; then
        echo "[$COUNTER/$BATCH_SIZE] SKIP: $SLUG (exists)"
        continue
    fi

    echo "[$COUNTER/$BATCH_SIZE] Generating: $QUESTION"

    # Build prompt
    PROMPT="Generate a comprehensive article for \"$QUESTION\" for ProxyFAQs.com.

Search Volume: $VOLUME monthly searches
Category: $CAT_NAME

Requirements:
1. Quick Answer (200 words) - direct, concise
2. Detailed Answer (1000+ words) - technical depth, Python code examples

Output ONLY valid JSON:
{
  \"title\": \"SEO title [$YEAR]\",
  \"meta_description\": \"150-160 chars\",
  \"quick_answer\": \"200 word answer...\",
  \"detailed_answer\": \"1000+ word markdown article...\",
  \"tags\": [\"tag1\", \"tag2\"],
  \"word_count\": 1234
}"

    # Call Codex
    RESULT=$("$CODEX_ROUTER" "$PROMPT" "" json high 2>/dev/null || echo '{"success":false}')

    SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('success', False))" 2>/dev/null || echo "False")

    if [ "$SUCCESS" == "True" ]; then
        # Extract and save content
        echo "$RESULT" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
try:
    content = json.loads(data['content'])
    content['slug'] = '$SLUG'
    content['question'] = '$QUESTION'
    content['volume'] = $VOLUME
    content['category'] = '$CAT_NAME'
    content['generated_by'] = 'codex'
    with open('$OUTPUT_FILE', 'w') as f:
        json.dump(content, f, indent=2, ensure_ascii=False)
    print('  Saved: $OUTPUT_FILE')
    print(f'  Words: {content.get(\"word_count\", \"N/A\")}')
except Exception as e:
    print(f'  ERROR: {e}')
"
    else
        echo "  FAILED: Codex error"
    fi

    # Rate limit
    sleep 2
done

echo ""
echo "=============================================="
echo "Batch complete!"
echo "=============================================="
