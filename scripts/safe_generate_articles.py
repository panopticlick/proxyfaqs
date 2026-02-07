#!/usr/bin/env python3
"""
Safe Article Generator with Automatic Backup
Prevents data loss through:
1. Automatic backup before each batch
2. Immediate save on completion
3. Git-style commit tracking
4. Recovery mode
"""

import json
import os
import sys
import shutil
from pathlib import Path
from datetime import datetime
from subprocess import run, PIPE
import argparse

# Configuration
PROJECT_DIR = Path("/Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs")
OUTPUT_DIR = PROJECT_DIR / "output/articles"
BACKUP_DIR = PROJECT_DIR / "output/backups"
CATALOG_FILE = BACKUP_DIR / "catalog.jsonl"
STATE_FILE = BACKUP_DIR / "generation_state.json"

# Colors
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"


def log_info(msg):
    print(f"{GREEN}[INFO]{NC} {msg}")


def log_warn(msg):
    print(f"{YELLOW}[WARN]{NC} {msg}")


def log_error(msg):
    print(f"{RED}[ERROR]{NC} {msg}")


def init_directories():
    """Initialize backup directories"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log_info(f"Initialized: {OUTPUT_DIR}, {BACKUP_DIR}")


def backup_current_state():
    """Backup all current articles with timestamp"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"backup_{timestamp}"
    backup_path = BACKUP_DIR / backup_name
    backup_path.mkdir(exist_ok=True)

    articles = list(OUTPUT_DIR.glob("*.json"))
    count = 0

    for article_file in articles:
        try:
            shutil.copy2(article_file, backup_path / article_file.name)
            count += 1
        except Exception as e:
            log_error(f"Failed to backup {article_file.name}: {e}")

    if count > 0:
        log_info(f"Backed up {count} articles to {backup_name}")

        # Update catalog
        entry = {
            "timestamp": timestamp,
            "backup_name": backup_name,
            "count": count,
            "articles": [f.stem for f in articles]
        }
        with open(CATALOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        # Clean old backups (keep last 10)
        clean_old_backups(keep=10)

    return backup_path


def clean_old_backups(keep=10):
    """Remove old backups, keeping only the most recent N"""
    backups = sorted(BACKUP_DIR.glob("backup_*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_backup in backups[keep:]:
        try:
            shutil.rmtree(old_backup)
            log_info(f"Removed old backup: {old_backup.name}")
        except Exception as e:
            log_error(f"Failed to remove {old_backup.name}: {e}")


def save_article_safe(slug: str, content: dict) -> bool:
    """Save article with safety checks and immediate backup"""
    # Validate content
    required_fields = ['title', 'question', 'quick_answer', 'detailed_answer']
    for field in required_fields:
        if field not in content:
            log_error(f"Missing field '{field}' in {slug}")
            return False

    # Add metadata
    content['generated_at'] = datetime.now().isoformat()
    content['slug'] = slug

    # Check file size (prevent empty saves)
    if content.get('word_count', 0) < 100:
        log_warn(f"Article {slug} has low word count: {content.get('word_count', 0)}")

    # Write to temp first
    temp_file = OUTPUT_DIR / f".tmp_{slug}.json"
    target_file = OUTPUT_DIR / f"{slug}.json"

    try:
        with open(temp_file, 'w') as f:
            json.dump(content, f, indent=2, ensure_ascii=False)

        # Verify JSON is valid
        with open(temp_file) as f:
            json.load(f)

        # Backup existing file if present
        if target_file.exists():
            shutil.copy2(target_file, f"{target_file}.bak")

        # Atomic move
        temp_file.replace(target_file)

        log_info(f"Saved: {slug} ({content.get('word_count', 0)} words)")

        # Update state
        update_generation_state(slug, content)

        return True

    except Exception as e:
        log_error(f"Failed to save {slug}: {e}")
        if temp_file.exists():
            temp_file.unlink()
        return False


def update_generation_state(slug: str, content: dict):
    """Track generation progress"""
    state = load_generation_state()
    state['last_update'] = datetime.now().isoformat()
    state['generated'].append({
        'slug': slug,
        'question': content.get('question', ''),
        'word_count': content.get('word_count', 0),
        'timestamp': datetime.now().isoformat()
    })
    state['generated'] = state['generated'][-100:]  # Keep last 100

    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def load_generation_state():
    """Load generation state"""
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        'started_at': datetime.now().isoformat(),
        'generated': [],
        'last_update': None
    }


def list_backups():
    """List all available backups"""
    backups = sorted(BACKUP_DIR.glob("backup_*"), key=lambda p: p.stat().st_mtime, reverse=True)

    if not backups:
        log_warn("No backups found")
        return

    print(f"\n{'Backup Name':<30} {'Date':<20} {'Articles':<10}")
    print("-" * 60)

    for backup in backups:
        count = len(list(backup.glob("*.json")))
        mtime = datetime.fromtimestamp(backup.stat().st_mtime)
        print(f"{backup.name:<30} {mtime.strftime('%Y-%m-%d %H:%M'):<20} {count:<10}")


def restore_backup(backup_name: str, dry_run: bool = False):
    """Restore articles from backup"""
    backup_path = BACKUP_DIR / backup_name

    if not backup_path.exists():
        log_error(f"Backup not found: {backup_name}")
        return False

    articles = list(backup_path.glob("*.json"))
    log_warn(f"Restoring {len(articles)} articles from {backup_name}")

    if dry_run:
        print("Dry run - would restore:")
        for f in articles:
            print(f"  - {f.stem}")
        return True

    # Backup current state first
    backup_current_state()

    # Restore
    for article_file in articles:
        target = OUTPUT_DIR / article_file.name
        shutil.copy2(article_file, target)
        log_info(f"Restored: {article_file.name}")

    return True


def get_generated_slugs():
    """Get list of already generated article slugs"""
    return {f.stem for f in OUTPUT_DIR.glob("*.json") if not f.name.startswith('.')}


def get_progress():
    """Show generation progress"""
    state = load_generation_state()
    generated = get_generated_slugs()

    print(f"\n=== Generation Progress ===")
    print(f"Started: {state.get('started_at', 'Unknown')}")
    print(f"Last update: {state.get('last_update', 'Never')}")
    print(f"Articles in output: {len(generated)}")

    if state.get('generated'):
        print(f"\nRecent (last 10):")
        for item in state['generated'][-10:]:
            print(f"  - {item['slug']}: {item.get('word_count', 0)} words")


def main():
    parser = argparse.ArgumentParser(description="Safe article generator with backup")
    subparsers = parser.add_subparsers(dest='command', help='Command')

    # Backup command
    subparsers.add_parser('backup', help='Backup current articles')

    # Restore command
    restore_parser = subparsers.add_parser('restore', help='Restore from backup')
    restore_parser.add_argument('backup_name', nargs='?', help='Backup name (omit to list)')
    restore_parser.add_argument('--dry-run', action='store_true', help='Show what would be restored')

    # List command
    subparsers.add_parser('list', help='List backups')

    # Status command
    subparsers.add_parser('status', help='Show generation status')

    # Init command
    subparsers.add_parser('init', help='Initialize directories')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    if args.command == 'init':
        init_directories()

    elif args.command == 'backup':
        init_directories()
        backup_current_state()

    elif args.command == 'list':
        list_backups()

    elif args.command == 'restore':
        if args.backup_name:
            restore_backup(args.backup_name, args.dry_run)
        else:
            list_backups()

    elif args.command == 'status':
        get_progress()

    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
