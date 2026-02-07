#!/usr/bin/env python3
import subprocess
import json
import os
import sys
import time

ARTICLES_DIR = "output/articles"
QUESTIONS_FILE = "output/batch1_questions.jsonl"
CODEX_BIN = os.path.expanduser("~/.claude/bin/codex_router.sh")

def get_existing_slugs():
    existing = set()
    for f in os.listdir(ARTICLES_DIR):
        if f.endswith('.json'):
            # Check if file is complete (word_count >= 1200)
            try:
                with open(os.path.join(ARTICLES_DIR, f)) as fp:
                    data = json.load(fp)
                    if data.get('word_count', 0) >= 1200:
                        existing.add(f.replace('.json', ''))
            except:
                # Incomplete or empty file - don't add to existing
                pass
    return existing

def get_pending_questions(count=5):
    existing = get_existing_slugs()
    pending = []

    with open(QUESTIONS_FILE) as fp:
        for line in fp:
            q = json.loads(line)
            slug = q.get('slug', '')
            if slug and slug not in existing:
                pending.append(q)
                if len(pending) >= count:
                    break

    return pending

def launch_task(question):
    slug = question.get('slug', '')
    q_text = question.get('question', '')
    volume = question.get('volume', 0)

    prompt = f'''Generate article for "{q_text}" for ProxyFAQs.com. Volume: {volume}. Requirements: Quick Answer (200 words) + Detailed Answer (1000+ words). Output ONLY valid JSON: {{"title":"[2025]","meta_description":"150-160c","quick_answer":"...","detailed_answer":"...","tags":[],"word_count":N}}'''

    output_file = f"{ARTICLES_DIR}/{slug}.json"

    # Use script to create a pseudo-terminal for codex
    # This works around the "stdin is not a terminal" error
    cmd = [
        "script",
        "-q", "/dev/null",
        CODEX_BIN,
        prompt,
        output_file,
        "silent",
        "high"
    ]

    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return slug

if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2

    pending = get_pending_questions(count)
    print(f"Launching {len(pending)} tasks:")

    for q in pending:
        slug = launch_task(q)
        print(f"  -> {slug}")
        time.sleep(2)
