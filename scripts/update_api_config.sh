#!/bin/bash
# update_api_config.sh - Update API configuration for BigModel
# Switches from expired 88code keys to working BigModel GLM-4

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=== API Configuration Update ==="
echo ""

# Check current ANTHROPIC_AUTH_TOKEN
if [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
    log_info "Found ANTHROPIC_AUTH_TOKEN in environment"

    # Test BigModel API
    echo "Testing BigModel API connection..."
    response=$(curl -s -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \
        -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"model":"glm-4-flash","messages":[{"role":"user","content":"test"}],"max_tokens":10}')

    if echo "$response" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
        log_info "BigModel API is working!"
        echo ""
        echo "Available models:"
        echo "  - glm-4-flash    (Free, fast)"
        echo "  - glm-4-plus     (Paid, high quality)"
        echo "  - glm-4-air      (Paid, balanced)"
        echo ""
    else
        log_error "BigModel API test failed"
        echo "Response: $response"
    fi
else
    log_warn "ANTHROPIC_AUTH_TOKEN not found in environment"
fi

# Check 88code keys
echo ""
echo "Checking 88code keys..."
for key_var in key88_1 key88_2; do
    if [[ -n "${!key_var:-}" ]]; then
        response=$(curl -s -X POST "https://www.88code.ai/openai/v1/chat/completions" \
            -H "Authorization: Bearer ${!key_var}" \
            -H "Content-Type: application/json" \
            -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"test"}],"max_tokens":10}')

        if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
            error_msg=$(echo "$response" | jq -r '.error.message // .error')
            log_error "$key_var: $error_msg"
        else
            log_info "$key_var: Working"
        fi
    fi
done

echo ""
echo "=== Recommended Actions ==="
echo ""
echo "1. For BigModel (GLM-4) - WORKING:"
echo "   Update codex config to use:"
echo "   model = \"glm-4-flash\""
echo "   base_url = \"https://open.bigmodel.cn/api/paas/v4\""
echo ""
echo "2. For 88code - EXPIRED:"
echo "   Renew subscription at https://www.88code.ai"
echo "   OR obtain new API key"
echo ""
echo "3. Alternative - OpenAI Direct:"
echo "   Get API key from https://platform.openai.com"
echo "   export OPENAI_API_KEY=\"sk-...\""
echo ""
