#!/bin/bash
# Security Check Script
# Scans codebase for potential security issues before commit

set -e

echo "🔒 Security Check"
echo "================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo "📋 Checking for sensitive files..."

# Check if wrangler.toml is in git
if git ls-files | grep -q "^wrangler.toml$"; then
    echo -e "${RED}✗ CRITICAL: wrangler.toml is tracked by git!${NC}"
    echo "  Run: git rm --cached wrangler.toml"
    ((ERRORS++))
else
    echo -e "${GREEN}✓ wrangler.toml not in git${NC}"
fi

# Check for .env files
if git ls-files | grep -q "\.env$"; then
    echo -e "${RED}✗ CRITICAL: .env file is tracked by git!${NC}"
    echo "  Run: git rm --cached .env"
    ((ERRORS++))
else
    echo -e "${GREEN}✓ .env files not in git${NC}"
fi

echo ""
echo "🔍 Scanning for hardcoded secrets..."

# Patterns to search for
PATTERNS=(
    "password.*=.*['\"][^'\"]{8,}['\"]"
    "api[_-]?key.*=.*['\"][^'\"]{20,}['\"]"
    "secret.*=.*['\"][^'\"]{20,}['\"]"
    "token.*=.*['\"][^'\"]{20,}['\"]"
    "ghp_[A-Za-z0-9]{36}"
    "sk-[A-Za-z0-9]{20,}"
)

for pattern in "${PATTERNS[@]}"; do
    if git grep -i -E "$pattern" -- '*.ts' '*.js' '*.astro' '*.json' 2>/dev/null; then
        echo -e "${RED}✗ WARNING: Potential secret found matching: $pattern${NC}"
        ((WARNINGS++))
    fi
done

if [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ No hardcoded secrets found${NC}"
fi

echo ""
echo "📁 Checking .gitignore coverage..."

# Files that should be ignored
SHOULD_IGNORE=(
    ".env"
    ".env.local"
    "wrangler.toml"
    ".wrangler"
    "node_modules"
    "dist"
)

for file in "${SHOULD_IGNORE[@]}"; do
    if grep -q "^$file$" .gitignore; then
        echo -e "${GREEN}✓ $file in .gitignore${NC}"
    else
        echo -e "${YELLOW}⚠ WARNING: $file not in .gitignore${NC}"
        ((WARNINGS++))
    fi
done

echo ""
echo "🔐 Checking GitHub Secrets configuration..."

# Check if required secrets are documented
if [ -f "DEPLOYMENT.md" ]; then
    echo -e "${GREEN}✓ DEPLOYMENT.md exists${NC}"
else
    echo -e "${YELLOW}⚠ WARNING: DEPLOYMENT.md not found${NC}"
    ((WARNINGS++))
fi

if [ -f "wrangler.toml.example" ]; then
    echo -e "${GREEN}✓ wrangler.toml.example exists${NC}"
else
    echo -e "${RED}✗ ERROR: wrangler.toml.example not found${NC}"
    ((ERRORS++))
fi

echo ""
echo "📊 Security Check Summary"
echo "========================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo "  Review warnings before committing"
    exit 0
else
    echo -e "${RED}❌ $ERRORS critical error(s) found${NC}"
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo ""
    echo "Fix critical errors before committing!"
    exit 1
fi
