#!/bin/bash
# safe_article_generator.sh
# Production-safe article generator with automatic backups and recovery

set -euo pipefail

# Configuration
PROJECT_DIR="/Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs"
OUTPUT_DIR="$PROJECT_DIR/output/articles"
BACKUP_DIR="$PROJECT_DIR/output/backups"
STATE_FILE="$BACKUP_DIR/generation_state.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
log_info() { echo -e "${GREEN}[INFO]${NC} $(date '+%H:%M:%S') $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Initialize directories
init() {
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$BACKUP_DIR"
    log_info "Initialized directories"
}

# Backup current articles
backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/backup_${timestamp}"

    mkdir -p "$backup_path"

    local count=0
    for f in "$OUTPUT_DIR"/*.json 2>/dev/null; do
        if [[ -f "$f" ]]; then
            cp "$f" "$backup_path/"
            ((count++))
        fi
    done

    log_info "Backed up $count articles to backup_${timestamp}"

    # Keep only last 10 backups
    ls -t "$BACKUP_DIR"/backup_* 2>/dev/null | tail -n +11 | xargs -r rm -rf

    echo "$backup_path"
}

# List available backups
list_backups() {
    echo ""
    printf "%-30s %-20s %-10s\n" "Backup Name" "Date" "Articles"
    printf "%-30s %-20s %-10s\n" "------------" "----" "--------"

    for backup_dir in $(ls -td "$BACKUP_DIR"/backup_* 2>/dev/null); do
        local name=$(basename "$backup_dir")
        local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$backup_dir" 2>/dev/null || stat -c "%y" "$backup_dir" 2>/dev/null | cut -d'.' -f1)
        local count=$(ls -1 "$backup_dir"/*.json 2>/dev/null | wc -l | tr -d ' ')
        printf "%-30s %-20s %-10s\n" "$name" "$date" "$count"
    done
    echo ""
}

# Restore from backup
restore() {
    local backup_name="${1:-}"

    if [[ -z "$backup_name" ]]; then
        log_warn "Usage: $0 restore <backup_name>"
        echo ""
        list_backups
        return 1
    fi

    local backup_path="$BACKUP_DIR/$backup_name"

    if [[ ! -d "$backup_path" ]]; then
        log_error "Backup not found: $backup_name"
        list_backups
        return 1
    fi

    log_warn "Restoring from $backup_name"
    log_warn "Current articles will be backed up first"

    # Backup current state
    backup

    # Restore
    local count=0
    for f in "$backup_path"/*.json; do
        cp "$f" "$OUTPUT_DIR/"
        ((count++))
    done

    log_info "Restored $count articles"
}

# Generate article with safety checks
generate_article() {
    local slug="$1"
    local prompt="$2"
    local output_file="$OUTPUT_DIR/${slug}.json"
    local temp_file="/tmp/${slug}_$$.json"

    # Check if already exists
    if [[ -f "$output_file" ]]; then
        log_warn "Skipping $slug (already exists)"
        return 0
    fi

    log_step "Generating: $slug"

    # Call generation (placeholder for actual API call)
    local result=$(call_api "$prompt")

    # Validate JSON
    if ! echo "$result" | jq empty 2>/dev/null; then
        log_error "Invalid JSON response for $slug"
        return 1
    fi

    # Check word count
    local word_count=$(echo "$result" | jq -r '.word_count // 0')
    if [[ $word_count -lt 100 ]]; then
        log_warn "Low word count for $slug: $word_count"
    fi

    # Write to temp file first
    echo "$result" > "$temp_file"

    # Add metadata
    echo "$result" | jq --arg slug "$slug" --arg generated_at "$(date -Iseconds)" '
        .slug = $slug |
        .generated_at = $generated_at
    ' > "${temp_file}.final"

    # Atomic move
    mv "${temp_file}.final" "$output_file"
    rm -f "$temp_file"

    log_info "Saved: $slug ($word_count words)"

    # Auto-backup every 10 articles
    local total=$(ls -1 "$OUTPUT_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
    if [[ $((total % 10)) -eq 0 ]]; then
        log_step "Auto-backup checkpoint (10 articles)"
        backup > /dev/null
    fi

    return 0
}

# Call API (placeholder - integrate with actual API)
call_api() {
    local prompt="$1"

    # TODO: Replace with actual API call
    # For now, return a template
    cat <<'EOF'
{
  "title": "Sample Article",
  "question": "Sample question",
  "quick_answer": "Sample quick answer",
  "detailed_answer": "Sample detailed answer with more content.",
  "tags": ["proxy", "tutorial"],
  "word_count": 150
}
EOF
}

# Batch generation with automatic backup
batch_generate() {
    local questions_file="$1"
    local batch_size="${2:-10}"

    log_step "Starting batch generation"
    log_info "Questions file: $questions_file"
    log_info "Batch size: $batch_size"

    # Initial backup
    backup > /dev/null

    local total=0
    local success=0
    local failed=0

    while IFS= read -r line; do
        ((total++))

        slug=$(echo "$line" | jq -r '.slug // empty')
        question=$(echo "$line" | jq -r '.question // empty')

        if [[ -z "$slug" ]] || [[ -z "$question" ]]; then
            log_warn "Skipping invalid entry line $total"
            continue
        fi

        if generate_article "$slug" "$question"; then
            ((success++))
        else
            ((failed++))
        fi

        # Rate limiting
        sleep 2

        # Batch checkpoint
        if [[ $((total % batch_size)) -eq 0 ]]; then
            log_step "Checkpoint: $total processed, $success success, $failed failed"
            backup > /dev/null
        fi

    done < "$questions_file"

    # Final backup
    backup > /dev/null

    echo ""
    log_step "Batch complete"
    log_info "Total: $total, Success: $success, Failed: $failed"
}

# Show status
status() {
    local total=$(ls -1 "$OUTPUT_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
    local backups=$(ls -1d "$BACKUP_DIR"/backup_* 2>/dev/null | wc -l | tr -d ' ')

    echo ""
    echo "=== Article Generator Status ==="
    echo "Output directory: $OUTPUT_DIR"
    echo "Total articles: $total"
    echo "Available backups: $backups"
    echo ""

    if [[ -f "$STATE_FILE" ]]; then
        echo "Last activity:"
        jq -r '.last_update // "Unknown"' "$STATE_FILE" 2>/dev/null
    fi
}

# Main
case "${1:-help}" in
    init)
        init
        ;;
    backup)
        init
        backup
        ;;
    restore)
        init
        restore "${2:-}"
        ;;
    list)
        list_backups
        ;;
    status)
        status
        ;;
    batch)
        init
        batch_generate "${2:-}" "${3:-10}"
        ;;
    *)
        echo "Usage: $0 {init|backup|restore|list|status|batch}"
        echo ""
        echo "Commands:"
        echo "  init              - Initialize directories"
        echo "  backup            - Backup current articles"
        echo "  restore <name>    - Restore from backup"
        echo "  list              - List available backups"
        echo "  status            - Show current status"
        echo "  batch <file> [N]  - Generate batch from file, checkpoint every N articles"
        exit 1
        ;;
esac
