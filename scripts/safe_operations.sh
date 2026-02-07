#!/bin/bash
# safe_operations.sh - Safe wrapper for article generation operations
# Prevents data loss through multiple safety mechanisms

set -euo pipefail

# Configuration
PROJECT_DIR="/Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs"
OUTPUT_DIR="$PROJECT_DIR/output/articles"
BACKUP_DIR="$PROJECT_DIR/output/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create backup directory
init_backup() {
    mkdir -p "$BACKUP_DIR"
    log_info "Backup directory: $BACKUP_DIR"
}

# Backup all existing articles
backup_articles() {
    local backup_name="articles_backup_${TIMESTAMP}"
    local backup_path="$BACKUP_DIR/$backup_name"

    mkdir -p "$backup_path"

    if [ -d "$OUTPUT_DIR" ] && [ "$(ls -A $OUTPUT_DIR 2>/dev/null)" ]; then
        cp -r "$OUTPUT_DIR"/*.json "$backup_path/" 2>/dev/null || true
        local count=$(ls -1 "$backup_path"/*.json 2>/dev/null | wc -l)
        log_info "Backed up $count articles to $backup_name"

        # Create a catalog
        ls -1 "$backup_path"/*.json 2>/dev/null | xargs -I {} basename {} > "$backup_path/catalog.txt"

        # Clean old backups (keep last 10)
        ls -t "$BACKUP_DIR" | tail -n +11 | xargs -I {} rm -rf "$BACKUP_DIR/{}"
    else
        log_warn "No articles to backup"
    fi

    echo "$backup_path"
}

# Safe article write with immediate backup
safe_write_article() {
    local slug="$1"
    local content="$2"
    local temp_file="/tmp/article_${slug}_${TIMESTAMP}.json"

    # Write to temp first
    echo "$content" > "$temp_file"

    # Verify JSON is valid
    if ! jq empty "$temp_file" 2>/dev/null; then
        log_error "Invalid JSON for $slug"
        rm -f "$temp_file"
        return 1
    fi

    # Backup existing file if it exists
    local target_file="$OUTPUT_DIR/${slug}.json"
    if [ -f "$target_file" ]; then
        cp "$target_file" "${target_file}.bak_${TIMESTAMP}"
    fi

    # Move to final location
    mv "$temp_file" "$target_file"
    log_info "Saved: $slug"

    # Sync backup every N articles
    local article_count=$(ls -1 "$OUTPUT_DIR"/*.json 2>/dev/null | wc -l)
    if [ $((article_count % 10)) -eq 0 ]; then
        backup_articles
    fi

    return 0
}

# Recovery function
restore_from_backup() {
    local backup_name="$1"

    if [ -z "$backup_name" ]; then
        echo "Available backups:"
        ls -1 "$BACKUP_DIR" | grep "articles_backup"
        return 1
    fi

    local backup_path="$BACKUP_DIR/$backup_name"

    if [ ! -d "$backup_path" ]; then
        log_error "Backup not found: $backup_name"
        return 1
    fi

    log_warn "Restoring from $backup_name..."
    log_warn "This will overwrite existing articles!"
    read -p "Continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted"
        return 0
    fi

    # Backup current state first
    backup_articles

    # Restore
    cp "$backup_path"/*.json "$OUTPUT_DIR/"
    log_info "Restored $(ls -1 "$backup_path"/*.json | wc -l) articles"
}

# Statistics
show_stats() {
    echo "=== Article Statistics ==="
    echo "Output directory: $OUTPUT_DIR"
    echo "Total articles: $(ls -1 "$OUTPUT_DIR"/*.json 2>/dev/null | wc -l)"
    echo "Total backups: $(ls -1d "$BACKUP_DIR"/articles_backup_* 2>/dev/null | wc -l)"
    echo "Latest backup: $(ls -t "$BACKUP_DIR"/articles_backup_* 2>/dev/null | head -1 || echo 'None')"
}

# Main command dispatcher
case "${1:-}" in
    backup)
        init_backup
        backup_articles
        ;;
    restore)
        init_backup
        restore_from_backup "${2:-}"
        ;;
    stats)
        show_stats
        ;;
    init)
        init_backup
        mkdir -p "$OUTPUT_DIR"
        log_info "Initialized directories"
        ;;
    *)
        echo "Usage: $0 {backup|restore|stats|init}"
        echo ""
        echo "Commands:"
        echo "  backup     - Backup all articles"
        echo "  restore    - Restore from backup (lists available if no name given)"
        echo "  stats      - Show article statistics"
        echo "  init       - Initialize directories"
        exit 1
        ;;
esac
