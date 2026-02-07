# ProxyFAQs Security Enhancements Summary

## Overview

This document summarizes the security enhancements implemented for the ProxyFAQs project.

## Files Created

### 1. `/front/src/lib/rate-limit.ts`

In-memory rate limiting middleware for API endpoints.

**Features:**

- IP-based rate limiting with configurable windows
- Automatic cleanup of expired entries
- Support for Cloudflare Workers (cf-connecting-ip header)
- Fallback for local development

**Configuration:**

- Chat: 20 requests per minute
- Search: 60 requests per minute
- Default: 30 requests per minute

**Usage:**

```typescript
import { getClientIp, checkRateLimit, RATE_LIMITS } from "./lib/rate-limit";

const clientIp = getClientIp(request);
const result = checkRateLimit(`chat:${clientIp}`, RATE_LIMITS.chat);
if (!result.allowed) {
  return rateLimitResponse(result.resetAt);
}
```

### 2. `/front/src/lib/security.ts`

Security utilities including CORS, input sanitization, and validation.

**Features:**

- CORS configuration with allowed origins whitelist
- Input sanitization to prevent XSS
- Parameter validation (slugs, session IDs, limits, messages)
- Security headers builder

**Allowed Origins:**

- https://proxyfaqs.com
- https://www.proxyfaqs.com
- http://localhost:4321
- http://127.0.0.1:4321
- http://localhost:3000

**Security Headers:**

- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: geolocation=(), microphone=(), camera=()

### 3. `/backend/security-migration.sql`

Comprehensive database security migration.

**Contents:**

- Row Level Security (RLS) policies for all tables
- Rate limits table with indexes
- Rate limit checking function
- Cleanup function for expired entries
- Permission restrictions

## Files Modified

### `/front/src/pages/api/chat.ts`

**Changes:**

- Added rate limiting with 20 req/min limit
- Added CORS preflight handling
- Added input sanitization for messages
- Added session ID validation
- Added security headers
- Added OPTIONS handler

### `/front/src/pages/api/search.ts`

**Changes:**

- Added rate limiting with 60 req/min limit
- Added query sanitization
- Added limit parameter validation
- Added CORS support
- Added security headers
- Added OPTIONS handler

### `/front/src/pages/api/health.ts`

**Changes:**

- Added CORS support
- Added security headers
- Added OPTIONS handler

### `/front/src/lib/env.ts`

**Changes:**

- Added RATE_LIMIT_ENABLED configuration
- Added RATE_LIMIT_CHAT_REQUESTS (default: 20)
- Added RATE_LIMIT_CHAT_WINDOW (default: 60 seconds)
- Added RATE_LIMIT_SEARCH_REQUESTS (default: 60)
- Added RATE_LIMIT_SEARCH_WINDOW (default: 60 seconds)
- Added ALLOWED_ORIGINS configuration

### `/backend/db-setup.sql`

**Changes:**

- Added `rate_limits` table
- Added indexes for rate limit queries
- Added Row Level Security (RLS) to all tables
- Added read-only policies for public access
- Added restrictive policies for write operations
- Updated permissions (SELECT only for anon/authenticated)

## Database RLS Policies

### Public Read-Only Access

- `categories`: SELECT only
- `questions`: SELECT only
- `providers`: SELECT only
- `keywords`: SELECT only

### Session Tracking

- `chat_sessions`: SELECT, INSERT, UPDATE allowed (no DELETE)

### Service Role

- Full access for admin operations and import scripts

## Environment Variables (Optional)

```bash
# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_CHAT_REQUESTS=20
RATE_LIMIT_CHAT_WINDOW=60
RATE_LIMIT_SEARCH_REQUESTS=60
RATE_LIMIT_SEARCH_WINDOW=60

# CORS
ALLOWED_ORIGINS=https://proxyfaqs.com,https://www.proxyfaqs.com,http://localhost:4321
```

## Deployment Steps

### 1. Apply Database Migration

```bash
psql -h 107.174.42.198 -U postgres -d postgres -f backend/security-migration.sql
```

### 2. Or Re-run Full Schema Setup

```bash
psql -h 107.174.42.198 -U postgres -d postgres -f backend/db-setup.sql
```

### 3. Deploy Frontend

```bash
cd front
bun run build
npx wrangler pages deploy dist --project-name proxyfaqs
```

## Verification

### Check RLS Status

```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'proxyfaqs';
```

### Check Policies

```sql
SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'proxyfaqs';
```

### Check Permissions

```sql
SELECT grantee, privilege, table_name FROM information_schema.role_table_grants WHERE table_schema = 'proxyfaqs';
```

## Security Notes

1. **SQL Injection Prevention**: All queries use the Supabase REST API which provides automatic parameterization.

2. **XSS Prevention**: User inputs are sanitized to remove:
   - Null bytes
   - Control characters
   - Script tags
   - Event handlers
   - Dangerous HTML elements

3. **Rate Limiting**: In-memory rate limiting is suitable for single-instance deployments. For multi-instance deployments, consider:
   - Cloudflare Workers KV
   - Redis
   - Database-backed rate limiting (see `security-migration.sql`)

4. **CORS**: Origins are explicitly whitelisted. The wildcard is NOT used.

5. **Security Headers**: All API responses include security headers to prevent:
   - MIME type sniffing
   - Clickjacking
   - Unauthorized cross-origin requests
