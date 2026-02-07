# ProxyFAQs Makefile
# Production deployment and maintenance commands
# Server: 107.174.42.198
# Last updated: 2026-02-06

.PHONY: help deploy build start stop restart logs status health rollback \
        db-optimization db-refresh db-stats db-maintenance \
        cleanup test lint typecheck

# Default target
help:
	@echo "ProxyFAQs Production Commands:"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy          - Full deployment (build + deploy + health check)"
	@echo "  make build           - Build Docker image only"
	@echo "  make start           - Start services"
	@echo "  make stop            - Stop services"
	@echo "  make restart         - Restart services"
	@echo "  make rollback        - Rollback to previous version"
	@echo ""
	@echo "Monitoring:"
	@echo "  make status          - Show deployment status"
	@echo "  make logs            - View application logs (follow)"
	@echo "  make health          - Check application health"
	@echo ""
	@echo "Database:"
	@echo "  make db-optimization - Apply database performance optimizations"
	@echo "  make db-refresh      - Refresh materialized views"
	@echo "  make db-stats        - Show database performance stats"
	@echo "  make db-maintenance  - Run full database maintenance"
	@echo ""
	@echo "Development:"
	@echo "  make test            - Run tests"
	@echo "  make lint            - Run linter"
	@echo "  make typecheck       - Run TypeScript type checking"
	@echo "  make cleanup         - Clean up old images and backups"

# ============================================================
# Deployment Commands
# ============================================================

deploy:
	@bash scripts/deploy.sh deploy

build:
	@bash scripts/deploy.sh build

start:
	@bash scripts/deploy.sh start

stop:
	@bash scripts/deploy.sh stop

restart:
	@bash scripts/deploy.sh restart

rollback:
	@bash scripts/deploy.sh rollback

# ============================================================
# Monitoring Commands
# ============================================================

status:
	@bash scripts/deploy.sh status

logs:
	@bash scripts/deploy.sh logs

health:
	@bash scripts/deploy.sh health

# ============================================================
# Database Commands
# ============================================================

db-optimization:
	@echo "Applying database performance optimizations..."
	@cat backend/003_production_optimizations.sql | docker exec -i supabase-db psql -U postgres -d postgres
	@echo "Optimizations applied successfully"

db-refresh:
	@echo "Refreshing materialized views..."
	@docker exec supabase-db psql -U postgres -d postgres -c \
		"REFRESH MATERIALIZED VIEW CONCURRENTLY proxyfaqs.popular_questions;" 2>/dev/null || \
		echo "Note: popular_questions view may not exist yet"
	@echo "Materialized views refreshed"

db-stats:
	@echo "=== Database Health Check ==="
	@docker exec supabase-db psql -U postgres -d postgres -c \
		"SELECT * FROM proxyfaqs.health_check();" 2>/dev/null || \
		echo "Health check function not available"
	@echo ""
	@echo "=== Table Statistics ==="
	@docker exec supabase-db psql -U postgres -d postgres -c \
		"SELECT * FROM proxyfaqs.get_table_stats();" 2>/dev/null || \
		docker exec supabase-db psql -U postgres -d postgres -c \
		"SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size \
		FROM pg_tables WHERE schemaname = 'proxyfaqs' \
		ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
	@echo ""
	@echo "=== Question Count ==="
	@docker exec supabase-db psql -U postgres -d postgres -c \
		"SELECT COUNT(*) as total_questions FROM proxyfaqs.questions;"

db-maintenance:
	@echo "Running full database maintenance..."
	@docker exec supabase-db psql -U postgres -d postgres -c \
		"SELECT * FROM proxyfaqs.run_maintenance();" 2>/dev/null || \
		echo "Maintenance function not available - run db-optimization first"
	@echo "Maintenance completed"

# ============================================================
# Development Commands
# ============================================================

test:
	cd front && bun test

lint:
	cd front && bun run lint

typecheck:
	cd front && bun run typecheck

cleanup:
	@bash scripts/deploy.sh cleanup
	@echo "Cleanup completed"

# ============================================================
# Quick Commands
# ============================================================

# Quick deploy without rebuild
quick-deploy:
	docker-compose up -d
	@sleep 5
	@make health

# View last 50 lines of logs
logs-short:
	docker-compose logs --tail=50 app

# Shell into app container
shell:
	docker exec -it proxyfaqs-app /bin/sh

# Shell into database
db-shell:
	docker exec -it supabase-db psql -U postgres -d postgres
