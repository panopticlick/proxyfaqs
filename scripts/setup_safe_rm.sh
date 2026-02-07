#!/bin/bash
# setup_safe_rm.sh - Install safe_rm as a system alias
# Run this script to add safe_rm protection to your shell

SAFE_RM_SCRIPT="$HOME/.safe_rm.sh"
ALIAS_INSTALL='alias rm="$HOME/.safe_rm.sh"'

echo "=== Installing safe_rm ==="
echo ""

# Check if safe_rm.sh exists in home directory
if [[ ! -f "$SAFE_RM_SCRIPT" ]]; then
    echo "Installing safe_rm.sh to $HOME"
    cat > "$SAFE_RM_SCRIPT" <<'EOF'
#!/bin/bash
# safe_rm.sh - Safe replacement for rm command
# Moves files to trash instead of deleting them

TRASH_DIR="$HOME/.trash"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create trash directory if not exists
mkdir -p "$TRASH_DIR"

# Log file
LOG_FILE="$TRASH_DIR/.trash_log"

# Process each file
for arg in "$@"; do
    # Skip flags
    if [[ "$arg" == -* ]]; then
        continue
    fi

    # Expand wildcards and process files
    for file in $arg; do
        if [[ -e "$file" ]]; then
            local file_name=$(basename "$file")
            local trash_path="$TRASH_DIR/${file_name}_${TIMESTAMP}"
            mv "$file" "$trash_path"
            echo "[$(date)] Moved to trash: $file -> $trash_path" >> "$LOG_FILE"
        fi
    done
done
EOF
    chmod +x "$SAFE_RM_SCRIPT"
fi

# Add to .zshrc if not already present
if ! grep -q "safe_rm" "$HOME/.zshrc" 2>/dev/null; then
    echo ""
    echo "Adding safe_rm alias to ~/.zshrc"
    echo "" >> "$HOME/.zshrc"
    echo "# Safe rm - moves files to ~/.trash instead of deleting" >> "$HOME/.zshrc"
    echo "$ALIAS_INSTALL" >> "$HOME/.zshrc"
    echo "safe_rm() { command rm \"\$@\"; }  # Use original rm when needed" >> "$HOME/.zshrc"
    echo ""
    echo "✓ Added to ~/.zshrc"
else
    echo "✓ safe_rm already configured in ~/.zshrc"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "To activate immediately, run:"
echo "  source ~/.zshrc"
echo ""
echo "Commands:"
echo "  rm <file>      - Moves file to ~/.trash (safe)"
echo "  command rm <file> - Original rm (use with caution)"
echo "  ls ~/.trash/   - View trashed files"
echo "  cat ~/.trash/.trash_log - View deletion log"
echo ""
