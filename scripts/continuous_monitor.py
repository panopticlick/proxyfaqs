#!/usr/bin/env python3
import os
import sys
import time
import subprocess
import json
from datetime import datetime
from pathlib import Path

ARTICLES_DIR = Path("output/articles")
QUESTIONS_FILE = "output/batch1_questions.jsonl"
CODEX_BIN = os.path.expanduser("~/.claude/bin/codex_router.sh")
MAX_PARALLEL = 5
LOG_FILE = open("output/monitor.log", "a", buffering=1)

def log(msg):
    print(msg, flush=True)
    LOG_FILE.write(msg + "\n")
    LOG_FILE.flush()

def get_status():
    complete = 0
    processing = 0
    existing = set()

    for f in ARTICLES_DIR.glob("*.json"):
        try:
            with open(f) as fp:
                data = json.load(fp)
                wc = data.get('word_count', 0)
                slug = data.get('slug', f.stem)
                existing.add(slug)
                if wc >= 1200:
                    complete += 1
                else:
                    processing += 1
        except:
            processing += 1
            existing.add(f.stem)

    return complete, processing, existing

def launch_tasks(count, existing):
    launched = 0
    with open(QUESTIONS_FILE) as fp:
        for line in fp:
            if launched >= count:
                break
            q = json.loads(line)
            slug = q.get('slug', '')
            if slug and slug not in existing:
                q_text = q.get('question', '')
                volume = q.get('volume', 0)
                prompt = f'Generate article for "{q_text}" for ProxyFAQs.com. Volume: {volume}. Requirements: Quick Answer (200 words) + Detailed Answer (1000+ words). Output ONLY valid JSON: {{"title":"[2025]","meta_description":"150-160c","quick_answer":"...","detailed_answer":"...","tags":[],"word_count":N}}'

                # Use script to create a pseudo-terminal for codex
                cmd = ["script", "-q", "/dev/null", CODEX_BIN, prompt, f"{ARTICLES_DIR}/{slug}.json", "silent", "high"]
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                log(f"  Launched: {slug}")
                existing.add(slug)
                launched += 1
                time.sleep(2)

    return launched

def monitor():
    log("=== ProxyFAQs Continuous Monitor ===")
    log(f"Max parallel: {MAX_PARALLEL}")
    log("Press Ctrl+C to stop\n")

    while True:
        complete, processing, existing = get_status()
        now = datetime.now().strftime("%H:%M:%S")

        log(f"[{now}] Complete: {complete} | Processing: {processing}")

        available_slots = MAX_PARALLEL - processing
        if available_slots > 0:
            log(f"  Launching {available_slots} new tasks...")
            launch_tasks(available_slots, existing)

        time.sleep(80)

if __name__ == "__main__":
    os.chdir("/Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs")
    monitor()
