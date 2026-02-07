# ProxyFAQs Production Dockerfile
# Multi-stage build for optimal image size and security
# Last updated: 2026-02-07

# ============================================================
# Stage 1: Dependencies
# ============================================================
FROM node:20-slim AS deps

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

WORKDIR /app/front

# Copy package files for dependency caching
COPY front/package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci --prefer-offline && \
    npm cache clean --force

# ============================================================
# Stage 2: Builder
# ============================================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/front/node_modules ./front/node_modules

# Copy source code
COPY front ./front
COPY data ./data

WORKDIR /app/front

# Set build-time environment variables
ARG SITE_URL=https://proxyfaqs.com
ARG BUILD_CHUNK_SIZE=5000
ARG BUILD_PARALLEL=true

ENV SITE_URL=${SITE_URL}
ENV BUILD_CHUNK_SIZE=${BUILD_CHUNK_SIZE}
ENV BUILD_PARALLEL=${BUILD_PARALLEL}
ENV NODE_ENV=production

# Build the application
RUN npm run build

# ============================================================
# Stage 3: Production
# ============================================================
FROM node:20-slim AS production

# Security labels
LABEL maintainer="ProxyFAQs <hello@proxyfaqs.com>"
LABEL org.opencontainers.image.title="ProxyFAQs"
LABEL org.opencontainers.image.description="Vendor-neutral Q&A platform for proxies"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="ProxyFAQs"

# Install runtime dependencies only
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        dumb-init \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean && \
    # Create non-root user for security
    groupadd -r proxyfaqs && \
    useradd -r -g proxyfaqs -d /app -s /sbin/nologin proxyfaqs

WORKDIR /app/front

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY --from=builder /app/front/package*.json ./

# Copy node_modules and prune dev dependencies
COPY --from=builder /app/front/node_modules ./node_modules
RUN npm prune --omit=dev && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/front/dist ./dist
COPY --from=builder /app/front/server.mjs ./server.mjs

# Set ownership to non-root user
RUN chown -R proxyfaqs:proxyfaqs /app

# Switch to non-root user
USER proxyfaqs

# Expose port
EXPOSE 3000

# Health check with comprehensive options
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:3000/api/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.mjs"]
