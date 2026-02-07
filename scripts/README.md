# ProxyFAQs - Data Processing Scripts

This directory contains Python scripts for building and processing the ProxyFAQs knowledge base.

## Scripts Overview

### 1. `1_build_knowledge_base.py`

**Purpose**: Integrate all raw data sources into a unified, deduplicated knowledge base.

**Input Files** (from `data/` directory):

- `google-paa-proxy-level8-25-12-2025.csv` - PAA questions about proxies
- `google-paa-proxies-level8-26-12-2025.csv` - PAA questions about proxies
- `google-paa-residential-proxy-level8-25-12-2025.csv` - PAA about residential proxies
- `google-paa-web-scraping-level8-25-12-2025.csv` - PAA about web scraping
- `google-paa-scraper-api-level8-26-12-2025.csv` - PAA about scraper APIs
- `proxy_faqs_all.csv` - FAQ keyword collection
- `proxy_broad-match_us_2025-12-26.csv` - Broad match keywords with metadata

**Output**:

- `output/knowledge_base.jsonl` - Deduplicated knowledge entries in JSON Lines format

**Usage**:

```bash
cd /Volumes/SSD/skills/server-ops/vps/107.174.42.198/Standalone-Apps/proxyfaqs
python3 scripts/1_build_knowledge_base.py
```

**Features**:

- Automatic encoding detection (UTF-8, UTF-16)
- Deduplication based on normalized text
- Progress tracking with visual progress bars
- Structured Q&A format preservation
- Source attribution for each entry
- Comprehensive statistics reporting

**Output Format** (JSONL):

```json
{"text": "Q: What is a proxy?\nA: ...", "source": "paa_proxy-level8-25-12-2025", "id": 1}
{"text": "Keyword: proxy | Intent: Informational | Volume: 201000", "source": "broad_match_keywords", "id": 2}
```

**Statistics** (Latest Run):

- Total raw entries: 90,765
- Duplicates removed: 2,056
- Unique entries: 88,709
- Deduplication rate: 2.3%
- Output file size: 9.1 MB

**Breakdown by Source**:
| Source | Entries |
|--------|---------|
| broad_match_keywords | 50,003 |
| faq_collection | 35,080 |
| paa_web-scraping | 1,291 |
| paa_residential-proxy | 788 |
| paa_proxies | 619 |
| paa_proxy | 577 |
| paa_scraper-api | 351 |

---

### 3. `3_generate_answers_rag.py`

**Purpose**: Generate high-quality answers to SEO questions using Retrieval-Augmented Generation (RAG).

**Input Files**:

- `output/knowledge_base.jsonl` - Knowledge base (88,709 entries)
- `data/google_proxy_question.csv` - SEO questions (3,057 questions)
- `data/google_proxies_question.csv` - SEO questions (983 questions)

**Output**:

- `output/qa_pairs.jsonl` - Generated Q&A pairs with metadata

**Usage**:

```bash
# Set API key
export VECTORENGINE_API_KEY='your-api-key'

# Generate all answers (4,040 questions)
python3 scripts/3_generate_answers_rag.py

# Generate first 100 answers
python3 scripts/3_generate_answers_rag.py --end 100

# Generate answers 100-200
python3 scripts/3_generate_answers_rag.py --start 100 --end 200

# Use different model
python3 scripts/3_generate_answers_rag.py --model grok-2-latest

# Customize retrieval
python3 scripts/3_generate_answers_rag.py --top-k 10 --max-tokens 1000
```

**Features**:

- TF-IDF based retrieval for context selection
- VectorEngine API (grok-4-fast) for answer generation
- Automatic retry with exponential backoff
- Resume capability (skips existing Q&A pairs)
- Checkpoint saving every 10 questions
- Real-time progress tracking with tqdm
- Comprehensive statistics and error handling

**Options**:

| Flag            | Default     | Description                           |
| --------------- | ----------- | ------------------------------------- |
| `--start`       | 0           | Start index for batch processing      |
| `--end`         | all         | End index for batch processing        |
| `--model`       | grok-4-fast | VectorEngine model to use             |
| `--top-k`       | 8           | Number of context entries to retrieve |
| `--max-tokens`  | 800         | Maximum tokens per answer             |
| `--temperature` | 0.7         | Temperature for generation            |

**Output Format** (JSONL):

```json
{
  "id": "a3f2b8c1d4e5",
  "question": "what is a proxy",
  "answer": "A proxy server is an intermediary...",
  "volume": 13000,
  "difficulty": 39,
  "sources": [123, 456, 789, 101, 112],
  "tokens_used": 543,
  "generated_at": "2025-12-28T21:00:00"
}
```

**RAG Pipeline**:

1. **Load Knowledge Base**: 88,709 entries loaded into memory
2. **Build TF-IDF Index**: Create retrieval index for similarity search
3. **For Each Question**:
   - Retrieve top-8 relevant knowledge entries
   - Format context with relevance scores
   - Generate answer via VectorEngine API
   - Save Q&A pair to JSONL file
4. **Progress Tracking**: Real-time stats on generated/failed/skipped

**API Configuration**:

- Base URL: `https://api.vectorengine.ai/v1`
- Model: `grok-4-fast` (or specify with `--model`)
- Max tokens: 800 (adjustable)
- Temperature: 0.7 (adjustable)
- Retry logic: 3 attempts with exponential backoff
- Rate limiting: 0.5s delay between requests

**Performance Estimates**:

- Questions to process: 4,040
- Estimated time: 2-3 hours (avg 2-3s per question)
- Estimated tokens: ~2.2M tokens total (~550 per Q&A)
- Output file size: ~8-10 MB

**Dependencies**:

```bash
pip install pandas openai scikit-learn tqdm
```

**Error Handling**:

- API failures: Automatic retry (3 attempts)
- Interrupted generation: Resume from last checkpoint
- Missing dependencies: Clear error messages
- Invalid API key: Early validation

---

## Requirements

**Script 1 (Knowledge Base)**:

- Python 3.7+
- Standard library only (no external dependencies)

**Script 3 (Answer Generation)**:

- Python 3.7+
- pandas
- openai (for VectorEngine API)
- scikit-learn (TfidfVectorizer)
- tqdm
- VECTORENGINE_API_KEY environment variable

Install dependencies:

```bash
pip install pandas openai scikit-learn tqdm
```

---

## Data Processing Pipeline

```
Raw CSV Files (7 files + 2 SEO question files)
    ↓
1_build_knowledge_base.py
    ↓
knowledge_base.jsonl (88,709 entries)
    ↓
3_generate_answers_rag.py (RAG pipeline)
    ├─ Load SEO questions (4,040 questions)
    ├─ Build TF-IDF retrieval index
    ├─ For each question:
    │   ├─ Retrieve top-8 context entries
    │   ├─ Generate answer via VectorEngine API
    │   └─ Save Q&A pair
    ↓
qa_pairs.jsonl (4,040 Q&A pairs)
    ↓
[Future: 4_import_to_db.py]
    ↓
PostgreSQL Database (Supabase)
```

---

## Workflow

### Phase 1: Build Knowledge Base (5 minutes)

```bash
python3 scripts/1_build_knowledge_base.py
```

- Integrates all raw data sources
- Deduplicates content
- Creates 88,709 knowledge entries
- Output: `output/knowledge_base.jsonl`

### Phase 2: Generate Answers (2-3 hours)

```bash
export VECTORENGINE_API_KEY='your-key'
python3 scripts/3_generate_answers_rag.py
```

- Loads SEO questions (4,040 questions)
- Uses RAG to generate high-quality answers
- Progress saved continuously (resume capable)
- Output: `output/qa_pairs.jsonl`

**Batch Processing** (recommended for large datasets):

```bash
# Batch 1: First 1000 questions
python3 scripts/3_generate_answers_rag.py --end 1000

# Batch 2: Questions 1000-2000
python3 scripts/3_generate_answers_rag.py --start 1000 --end 2000

# Batch 3: Questions 2000-3000
python3 scripts/3_generate_answers_rag.py --start 2000 --end 3000

# Batch 4: Remaining questions
python3 scripts/3_generate_answers_rag.py --start 3000
```

### Phase 3: Import to Database (future)

```bash
python3 scripts/4_import_to_db.py
```

- Connects to PostgreSQL/Supabase
- Imports Q&A pairs
- Creates categories and tags
- Sets up full-text search

---

## Notes

- All scripts handle UTF-8 and UTF-16 encoding automatically
- Progress bars show real-time processing status
- Deduplication uses MD5 hashing of normalized text
- Minimum text length: 20 characters (shorter entries are filtered)
- All output files use UTF-8 encoding
- RAG answers prioritize high search volume questions first

---

## Troubleshooting

### Script 1 (Knowledge Base)

**Issue**: Script fails with encoding error
**Solution**: The script auto-detects encoding. If issues persist, check if CSV files are corrupted.

**Issue**: Low deduplication rate
**Solution**: This is expected. Our data sources have minimal overlap (2.3% duplicates).

**Issue**: Missing input files
**Solution**: The script will warn and skip missing files. Ensure all CSV files are in `data/` directory.

### Script 3 (Answer Generation)

**Issue**: API key error
**Solution**:

```bash
export VECTORENGINE_API_KEY='your-api-key'
```

**Issue**: API rate limit errors
**Solution**: The script includes automatic retry and rate limiting. If issues persist, increase delay or use batch processing.

**Issue**: Generation interrupted
**Solution**: The script saves progress continuously. Simply re-run with the same command to resume.

**Issue**: Out of memory
**Solution**: Use batch processing with `--start` and `--end` flags:

```bash
python3 scripts/3_generate_answers_rag.py --start 0 --end 500
```

**Issue**: Poor answer quality
**Solution**: Adjust parameters:

```bash
python3 scripts/3_generate_answers_rag.py --top-k 10 --temperature 0.8 --max-tokens 1000
```

---

## Example Output

### Knowledge Base Entry

```json
{
  "text": "Q: What is a proxy?\nA: A proxy server is an intermediary between your device and the internet...",
  "source": "paa_proxy-level8-25-12-2025",
  "id": 1
}
```

### Generated Q&A Pair

```json
{
  "id": "a3f2b8c1d4e5",
  "question": "what is a proxy",
  "answer": "A proxy server is an intermediary server that sits between your device and the internet. When you send a request through a proxy, it forwards your request to the target server and returns the response to you. This provides several benefits:\n\n1. Privacy: Masks your IP address\n2. Security: Acts as a firewall\n3. Access: Bypass geo-restrictions\n4. Performance: Can cache content\n\nProxies are commonly used for web scraping, privacy protection, and accessing region-locked content.",
  "volume": 13000,
  "difficulty": 39,
  "sources": [1, 45, 78, 123, 456],
  "tokens_used": 543,
  "generated_at": "2025-12-28T21:00:00"
}
```
