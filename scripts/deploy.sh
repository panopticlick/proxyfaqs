#!/bin/bash
# ============================================================
# ProxyFAQs Production Deployment Script
# Server: 107.174.42.198
# Last updated: 2026-02-06
# ============================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
ENV_FILE="$PROJECT_DIR/.env"
BACKUP_DIR="$PROJECT_DIR/backups"
LOG_FILE="$PROJECT_DIR/deploy.log"

# Service names
APP_SERVICE="app"
PGBOUNCER_SERVICE="pgbouncer"

# Deployment settings
HEALTH_CHECK_RETRIES=30
HEALTH_CHECK_INTERVAL=2
ROLLBACK_ON_FAILURE=true

# ============================================================
# Utility Functions
# ============================================================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case "$level" in
        INFO)  echo -e "${BLUE}[INFO]${NC} $message" ;;
        OK)    echo -e "${GREEN}[OK]${NC} $message" ;;
        WARN)  echo -e "${YELLOW}[WARN]${NC} $message" ;;
        ERROR) echo -e "${RED}[ERROR]${NC} $message" ;;
    esac

    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

die() {
    log ERROR "$1"
    exit 1
}

check_prerequisites() {
    log INFO "Checking prerequisites..."

    # Check Docker
    command -v docker &> /dev/null || die "Docker is not installed"
    command -v docker-compose &> /dev/null || die "Docker Compose is not installed"

    # Check compose file
    [[ -f "$COMPOSE_FILE" ]] || die "docker-compose.yml not found"

    # Check env file
    [[ -f "$ENV_FILE" ]] || die ".env file not found"

    # Check required env vars
    source "$ENV_FILE"
    [[ -n "${POSTGRES_PASSWORD:-}" ]] || die "POSTGRES_PASSWORD not set in .env"
    [[ -n "${PUBLIC_SUPABASE_ANON_KEY:-}" ]] || die "PUBLIC_SUPABASE_ANON_KEY not set in .env"

    log OK "Prerequisites check passed"
}

# ============================================================
# Backup Functions
# ============================================================

create_backup() {
    log INFO "Creating backup..."

    mkdir -p "$BACKUP_DIR"
    local backup_name="backup_$(date '+%Y%m%d_%H%M%S')"
    local backup_path="$BACKUP_DIR/$backup_name"

    mkdir -p "$backup_path"

    # Backup current image tag
    local current_image=$(docker-compose -f "$COMPOSE_FILE" images -q "$APP_SERVICE" 2>/dev/null || echo "")
    if [[ -n "$current_image" ]]; then
        echo "$current_image" > "$backup_path/image_id"
        log OK "Backed up image ID: $current_image"
    fi

    # Backup compose file
    cp "$COMPOSE_FILE" "$backup_path/docker-compose.yml"

    # Backup env file (without secrets)
    grep -v "PASSWORD\|KEY\|SECRET" "$ENV_FILE" > "$backup_path/env.backup" 2>/dev/null || true

    echo "$backup_name" > "$BACKUP_DIR/latest"
    log OK "Backup created: $backup_name"
}

rollback() {
    log WARN "Rolling back to previous version..."

    local latest_backup=$(cat "$BACKUP_DIR/latest" 2>/dev/null || echo "")
    if [[ -z "$latest_backup" ]]; then
        die "No backup found for rollback"
    fi

    local backup_path="$BACKUP_DIR/$latest_backup"
    local image_id=$(cat "$backup_path/image_id" 2>/dev/null || echo "")

    if [[ -n "$image_id" ]]; then
        log INFO "Restoring image: $image_id"
        docker tag "$image_id" proxyfaqs-app:rollback 2>/dev/null || true
    fi

    # Restart with previous config
    docker-compose -f "$COMPOSE_FILE" up -d --no-build

    log OK "Rollback completed"
}

# ============================================================
# Health Check Functions
# ============================================================

wait_for_healthy() {
    local service="$1"
    local retries="${2:-$HEALTH_CHECK_RETRIES}"
    local interval="${3:-$HEALTH_CHECK_INTERVAL}"

    log INFO "Waiting for $service to be healthy..."

    for ((i=1; i<=retries; i++)); do
        local status=$(docker-compose -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null | \
            grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

        if [[ "$status" == "healthy" ]]; then
            log OK "$service is healthy"
            return 0
        fi

        echo -n "."
        sleep "$interval"
    done

    echo ""
    log ERROR "$service failed to become healthy after $((retries * interval)) seconds"
    return 1
}

check_app_health() {
    log INFO "Checking application health..."

    local health_url="http://localhost:3000/api/health"
    local response=$(curl -sf "$health_url" 2>/dev/null || echo "")

    if [[ -z "$response" ]]; then
        log ERROR "Health check failed - no response"
        return 1
    fi

    local status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [[ "$status" == "ok" ]] || [[ "$status" == "degraded" ]]; then
        log OK "Application health: $status"
        return 0
    else
        log ERROR "Application health: $status"
        return 1
    fi
}

# ============================================================
# Deployment Functions
# ============================================================

build_image() {
    log INFO "Building Docker image..."

    docker-compose -f "$COMPOSE_FILE" build --no-cache "$APP_SERVICE"

    log OK "Image built successfully"
}

deploy_services() {
    log INFO "Deploying services..."

    # Start PgBouncer first
    docker-compose -f "$COMPOSE_FILE" up -d "$PGBOUNCER_SERVICE"
    wait_for_healthy "$PGBOUNCER_SERVICE" 15 2 || die "PgBouncer failed to start"

    # Deploy app with zero-downtime (if possible)
    docker-compose -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

    log OK "Services deployed"
}

zero_downtime_deploy() {
    log INFO "Starting zero-downtime deployment..."

    # Build new image
    build_image

    # Create backup before deployment
    create_backup

    # Deploy services
    deploy_services

    # Wait for health
    if ! wait_for_healthy "$APP_SERVICE" "$HEALTH_CHECK_RETRIES" "$HEALTH_CHECK_INTERVAL"; then
        if [[ "$ROLLBACK_ON_FAILURE" == "true" ]]; then
            rollback
            die "Deployment failed, rolled back to previous version"
        else
            die "Deployment failed"
        fi
    fi

    # Final health check
    if ! check_app_health; then
        if [[ "$ROLLBACK_ON_FAILURE" == "true" ]]; then
            rollback
            die "Health check failed, rolled back to previous version"
        else
            die "Health check failed"
        fi
    fi

    log OK "Zero-downtime deployment completed successfully"
}

# ============================================================
# Maintenance Functions
# ============================================================

run_db_maintenance() {
    log INFO "Running database maintenance..."

    docker exec supabase-db psql -U postgres -d postgres -c \
        "SELECT * FROM proxyfaqs.run_maintenance();" 2>/dev/null || \
        log WARN "Database maintenance skipped (function may not exist)"

    log OK "Database maintenance completed"
}

cleanup_old_images() {
    log INFO "Cleaning up old Docker images..."

    # Remove dangling images
    docker image prune -f

    # Keep only last 3 backups
    local backup_count=$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -c "^backup_" || echo "0")
    if [[ "$backup_count" -gt 3 ]]; then
        ls -1t "$BACKUP_DIR" | grep "^backup_" | tail -n +4 | \
            xargs -I {} rm -rf "$BACKUP_DIR/{}"
        log OK "Cleaned up old backups"
    fi

    log OK "Cleanup completed"
}

show_status() {
    log INFO "Current deployment status:"
    echo ""
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""

    log INFO "Container resource usage:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
        proxyfaqs-app proxyfaqs-pgbouncer 2>/dev/null || true
    echo ""

    log INFO "Recent logs:"
    docker-compose -f "$COMPOSE_FILE" logs --tail=20 "$APP_SERVICE"
}

# ============================================================
# Main
# ============================================================

usage() {
    cat << EOF
ProxyFAQs Deployment Script

Usage: $0 <command>

Commands:
    deploy      Full deployment (build + deploy + health check)
    build       Build Docker image only
    start       Start services
    stop        Stop services
    restart     Restart services
    status      Show deployment status
    logs        Show application logs
    health      Check application health
    rollback    Rollback to previous version
    maintenance Run database maintenance
    cleanup     Clean up old images and backups

Options:
    --no-rollback   Disable automatic rollback on failure

Examples:
    $0 deploy           # Full deployment
    $0 status           # Check status
    $0 logs             # View logs
    $0 rollback         # Rollback to previous version
EOF
}

main() {
    cd "$PROJECT_DIR"

    # Parse options
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-rollback)
                ROLLBACK_ON_FAILURE=false
                shift
                ;;
            deploy)
                check_prerequisites
                zero_downtime_deploy
                cleanup_old_images
                show_status
                ;;
            build)
                check_prerequisites
                build_image
                ;;
            start)
                check_prerequisites
                docker-compose -f "$COMPOSE_FILE" up -d
                wait_for_healthy "$APP_SERVICE"
                show_status
                ;;
            stop)
                docker-compose -f "$COMPOSE_FILE" down
                log OK "Services stopped"
                ;;
            restart)
                docker-compose -f "$COMPOSE_FILE" restart
                wait_for_healthy "$APP_SERVICE"
                show_status
                ;;
            status)
                show_status
                ;;
            logs)
                docker-compose -f "$COMPOSE_FILE" logs -f --tail=100 "$APP_SERVICE"
                ;;
            health)
                check_app_health
                ;;
            rollback)
                rollback
                wait_for_healthy "$APP_SERVICE"
                show_status
                ;;
            maintenance)
                run_db_maintenance
                ;;
            cleanup)
                cleanup_old_images
                ;;
            help|--help|-h)
                usage
                exit 0
                ;;
            *)
                log ERROR "Unknown command: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    if [[ $# -eq 0 ]] && [[ "${1:-}" == "" ]]; then
        usage
        exit 0
    fi
}

# Run main with all arguments
main "$@"
