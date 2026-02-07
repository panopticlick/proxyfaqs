#!/usr/bin/env python3
"""
ProxyFAQs - Codex Batch Content Generator
使用 Codex CLI 并行批量生成高质量答案
"""

import json
import os
import sys
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

# TF-IDF for retrieval
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

def load_knowledge_base(jsonl_path):
    """Load knowledge base entries"""
    print(f"Loading knowledge base from {jsonl_path}...")
    entries = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in tqdm(f, desc="Loading knowledge base"):
            entry = json.loads(line.strip())
            entries.append(entry)
    print(f"Loaded {len(entries):,} knowledge entries\n")
    return entries

def build_tfidf_index(entries):
    """Build TF-IDF index for retrieval"""
    print("Building TF-IDF retrieval index...")
    texts = []
    for entry in entries:
        text = f"{entry.get('question', '')} {entry.get('answer', '')} {entry.get('snippet', '')}"
        texts.append(text)

    vectorizer = TfidfVectorizer(max_features=5000, stop_words='english')
    tfidf_matrix = vectorizer.fit_transform(texts)
    print(f"TF-IDF index built: {tfidf_matrix.shape}\n")
    return vectorizer, tfidf_matrix

def retrieve_context(question, knowledge_entries, vectorizer, tfidf_matrix, top_k=8):
    """Retrieve top-k most relevant knowledge entries"""
    question_vec = vectorizer.transform([question])
    similarities = cosine_similarity(question_vec, tfidf_matrix).flatten()
    top_indices = similarities.argsort()[-top_k:][::-1]

    context_entries = []
    for idx in top_indices:
        entry = knowledge_entries[idx]
        context_entries.append({
            'question': entry.get('question', ''),
            'answer': entry.get('answer', ''),
            'snippet': entry.get('snippet', ''),
            'score': float(similarities[idx])
        })

    return context_entries

def generate_answer_with_codex(question_data, context_entries, output_file):
    """Generate answer using Codex CLI"""
    question = question_data['question']
    volume = question_data.get('volume', 0)
    difficulty = question_data.get('difficulty', 0)

    # Format context
    context_text = ""
    for i, ctx in enumerate(context_entries[:5], 1):
        if ctx['question']:
            context_text += f"{i}. Q: {ctx['question']}\n   A: {ctx.get('answer', ctx.get('snippet', ''))[:200]}...\n\n"
        elif ctx['snippet']:
            context_text += f"{i}. {ctx['snippet'][:200]}...\n\n"

    # Create prompt for Codex
    prompt = f"""You are an expert in proxy servers and web scraping. Generate a comprehensive, SEO-friendly answer for the following question.

Question: {question}
Search Volume: {volume}
SEO Difficulty: {difficulty}

Reference Knowledge:
{context_text}

Requirements:
- Write a comprehensive answer (300-600 words)
- Use proper markdown formatting with headers (###)
- Include technical details and practical examples
- Make it SEO-friendly with natural keyword usage
- Be accurate and authoritative
- Focus on practical value for users

Generate ONLY the answer content in markdown format, nothing else:"""

    # Save prompt to temp file
    temp_dir = Path("/tmp/codex_prompts")
    temp_dir.mkdir(exist_ok=True)
    prompt_file = temp_dir / f"prompt_{hash(question)}.txt"

    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(prompt)

    try:
        # Call codex CLI
        result = subprocess.run(
            ['claude', 'code', 'codex', '--input', str(prompt_file)],
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode == 0:
            answer = result.stdout.strip()

            # Save to output file
            qa_pair = {
                'question': question,
                'answer': answer,
                'volume': volume,
                'difficulty': difficulty,
                'generated_by': 'codex-cli'
            }

            with open(output_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(qa_pair, ensure_ascii=False) + '\n')

            return True, len(answer.split())
        else:
            print(f"❌ Codex failed for '{question}': {result.stderr}")
            return False, 0

    except subprocess.TimeoutExpired:
        print(f"⏱️ Timeout for '{question}'")
        return False, 0
    except Exception as e:
        print(f"❌ Error for '{question}': {e}")
        return False, 0
    finally:
        # Cleanup temp file
        if prompt_file.exists():
            prompt_file.unlink()

def process_batch(batch_questions, knowledge_entries, vectorizer, tfidf_matrix, output_file):
    """Process a batch of questions"""
    results = []
    for q_data in batch_questions:
        # Retrieve context
        context = retrieve_context(
            q_data['question'],
            knowledge_entries,
            vectorizer,
            tfidf_matrix,
            top_k=8
        )

        # Generate answer
        success, word_count = generate_answer_with_codex(q_data, context, output_file)
        results.append((success, word_count))

    return results

def main():
    base_dir = Path("/opt/docker-projects/standalone-apps/proxyfaqs-import")
    output_dir = base_dir / "output"

    kb_file = output_dir / "knowledge_base.jsonl"
    questions_file = output_dir / "seo_questions.jsonl"
    output_file = output_dir / "codex_qa_pairs.jsonl"

    # Load data
    knowledge_entries = load_knowledge_base(kb_file)

    print("Loading SEO questions...")
    questions = []
    with open(questions_file, 'r', encoding='utf-8') as f:
        for line in f:
            questions.append(json.loads(line.strip()))
    print(f"Loaded {len(questions)} questions\n")

    # Build TF-IDF index
    vectorizer, tfidf_matrix = build_tfidf_index(knowledge_entries)

    # Clear output file
    if output_file.exists():
        output_file.unlink()

    # Split into batches for parallel processing
    batch_size = 10
    batches = [questions[i:i+batch_size] for i in range(0, len(questions), batch_size)]

    print(f"Processing {len(questions)} questions in {len(batches)} batches")
    print(f"Batch size: {batch_size}")
    print(f"Parallel workers: {min(5, len(batches))}\n")

    # Process batches in parallel
    total_success = 0
    total_failed = 0
    total_words = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = []
        for batch in batches:
            future = executor.submit(
                process_batch,
                batch,
                knowledge_entries,
                vectorizer,
                tfidf_matrix,
                output_file
            )
            futures.append(future)

        # Track progress
        with tqdm(total=len(questions), desc="Generating answers") as pbar:
            for future in as_completed(futures):
                results = future.result()
                for success, word_count in results:
                    if success:
                        total_success += 1
                        total_words += word_count
                    else:
                        total_failed += 1
                    pbar.update(1)

    # Print statistics
    print("\n" + "="*60)
    print("CODEX BATCH GENERATION STATISTICS")
    print("="*60)
    print(f"Total questions:     {len(questions)}")
    print(f"Successfully generated: {total_success}")
    print(f"Failed:              {total_failed}")
    print(f"Total words:         {total_words:,}")
    print(f"Avg words per answer: {total_words // max(total_success, 1)}")
    print(f"\nOutput file: {output_file}")
    print("="*60)

if __name__ == "__main__":
    main()
