#!/bin/bash
# safe_rm.sh - Safe replacement for rm command
# Moves files to trash instead of deleting them

TRASH_DIR="$HOME/.trash"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create trash directory if not exists
mkdir -p "$TRASH_DIR"

# Log file
LOG_FILE="$TRASH_DIR/.trash_log"
echo "=== Trash operation at $(date) ===" >> "$LOG_FILE"

# Safe remove function
safe_rm() {
    local file_path="$1"
    local file_name=$(basename "$file_path")
    local trash_path="$TRASH_DIR/${file_name}_${TIMESTAMP}"

    if [[ -e "$file_path" ]]; then
        mv "$file_path" "$trash_path"
        echo "Moved to trash: $file_path -> $trash_path" | tee -a "$LOG_FILE"
    else
        echo "File not found: $file_path" | tee -a "$LOG_FILE"
    fi
}

# Process arguments
for arg in "$@"; do
    # Skip flags
    if [[ "$arg" == -* ]]; then
        continue
    fi

    # Expand wildcards
    for file in $arg; do
        if [[ -e "$file" ]]; then
            safe_rm "$file"
        fi
    done
done
