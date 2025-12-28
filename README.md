# Whisper Transcription & AI Analysis System

> **⚡ Interview Analysis with Cloudflare Workers + OpenAI**  
> Transcribe audio and analyze interviews/meetings using Cloudflare Workers AI, OpenAI GPT-4o-mini, and D1 database.

## 📚 Documentation

This repository contains three implementations:

### **🆓 Free Tier System (Recommended for Getting Started)**
Single-worker system with manual trigger - works on Cloudflare Free Plan!

**Features:**
- ✅ **Zero Cost**: No paid Cloudflare features required
- ✅ **Unlimited File Size**: Auto-splits large files (>25MB) automatically
- ✅ **AI-Powered Analysis**: OpenAI GPT-4o-mini for interview/meeting insights
- ✅ **Manual Trigger**: 2-step process (upload → process) for reliable execution
- ✅ **Structured Storage**: D1 database + KV for temporary file storage
- ✅ **Context-Aware**: Different analysis for interviews vs meetings
- ✅ **Production-Ready**: Comprehensive error handling, logging, validation
- ✅ **Automated Script**: One command to process interviews of ANY size

🎯 **[Quick Start Guide Below ↓](#-quick-start-free-tier)**

### **🚀 Production System (Multi-Worker)**
Multi-worker architecture with queue processing for high-volume use cases.

📖 **[Read Production Documentation →](./README-PRODUCTION.md)**  
📖 **[Deployment Guide →](./DEPLOYMENT.md)**

**Features:**
- ✅ **Multi-Worker Pipeline**: Separate workers for transcription and analysis
- ✅ **Async Queue Processing**: Scalable with automatic retries (requires paid plan)
- ✅ **R2 Storage**: Large file support with object storage
- ✅ **Auto-scaling**: Handles high traffic automatically
- ✅ **Background Processing**: Fire-and-forget uploads

### **🎯 Simple Transcription (Legacy)**
Basic single-worker transcription-only system.

**Features:**
- ✅ **Multiple upload methods**: URL, raw binary POST, or multipart form-data
- ✅ **Smart file handling**: Automatically detects compressed formats
- ✅ **Transcription only**: No AI analysis

## 🚀 Quick Start (Free Tier)

### Prerequisites

1. **Cloudflare Account** (free tier is fine)
2. **OpenAI API Key** ([Get one here](https://platform.openai.com/api-keys))
3. **Node.js** and **npm** installed
4. **FFmpeg** (for large files >25MB): `brew install ffmpeg` (macOS) or `sudo apt-get install ffmpeg` (Linux)

### One-Time Setup

```bash
# 1. Clone and install dependencies
git clone <your-repo>
cd whisper-tutorial
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create D1 database
npx wrangler d1 create whisper-db

# 4. Copy the database ID and update wrangler-free.jsonc
# Replace the database_id value with your new database ID

# 5. Run migrations
npx wrangler d1 execute whisper-db --file=migrations/0001_initial_schema.sql --remote

# 6. Create KV namespace
npx wrangler kv:namespace create CACHE

# 7. Update the KV namespace ID in wrangler-free.jsonc

# 8. Set your OpenAI API key
echo "your-openai-api-key" | npx wrangler secret put OPENAI_API_KEY --config wrangler-free.jsonc

# 9. Deploy
npm run deploy:free
```

### Using the Automated Script (Easiest!)

Process an interview in one command:

```bash
./scripts/process-interview.sh \
  path/to/interview.m4a \
  "Jane Smith" \
  "Senior DevOps Engineer"
```

**Output:** Beautiful formatted console output + saved JSON/TXT files in `results/` folder!

📖 **[Complete Script Documentation →](./SCRIPT-USAGE.md)**  
📖 **[Auto-Split for Large Files →](./AUTO-SPLIT-GUIDE.md)** 🆕

### Manual API Usage

If you prefer to use the API directly:

```bash
# Step 1: Upload audio file
RESPONSE=$(curl -X POST https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/upload \
  -F "file=@interview.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Jane Smith","role":"DevOps Engineer"}')

# Extract job ID
JOB_ID=$(echo $RESPONSE | jq -r '.jobId')

# Step 2: Trigger processing (takes 30-60 seconds)
curl -X POST https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/process/$JOB_ID

# Step 3: View results
curl https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/status/$JOB_ID | jq
```

### Local Development

```bash
# Start local dev server
npm run dev:free

# Use localhost:8787 for testing
./scripts/process-interview.sh \
  interview.m4a \
  "Test Candidate" \
  "Software Engineer"
```

---

## 🏢 Production System (Paid Plan)

For high-volume use cases with background processing:

**📖 Full instructions:** [DEPLOYMENT.md](./DEPLOYMENT.md)

```bash
# 1. Install dependencies
yarn install

# 2. Run automated setup
./scripts/setup-cloudflare.sh

# 3. Deploy
npm run deploy:all
```

## 📖 How It Works (Free Tier System)

### Two-Step Workflow

The free tier system uses a manual trigger approach to work within Cloudflare's execution limits:

**Small Files (<25MB):**
```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Upload    │─────▶│   Store in   │─────▶│   Process   │
│  Audio File │ ~8s  │  KV (1 hour) │ ~50s │  & Analyze  │
└─────────────┘      └──────────────┘      └─────────────┘
     Step 1              Temporary              Step 2
                         Storage
```

**Large Files (>25MB) - Auto-Split Mode:**
```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐      ┌─────────────┐
│  Large File │─────▶│   Split to   │─────▶│  Transcribe │─────▶│   Analyze   │
│   (42MB)    │ ~5s  │  10min chunks│ ~60s │   Each Chunk│ ~10s │   Merged    │
└─────────────┘      └──────────────┘      └─────────────┘      └─────────────┘
   Auto-detected      FFmpeg (local)      Cloudflare AI       Worker /analyze
```

### API Endpoints

1. **Upload** (`POST /upload`): Validates and stores audio in KV namespace (instant)
2. **Process** (`POST /process/{jobId}`): Transcribes audio + runs AI analysis (30-60s)
3. **Analyze** (`POST /analyze`): Analyze existing transcript (no audio needed) - NEW! 🎉
4. **Status** (`GET /status/{jobId}`): Check results anytime

### Auto-Split for Large Files

Files over 25MB are automatically:
- ✅ Split into 10-minute chunks using FFmpeg (locally)
- ✅ Each chunk transcribed via Cloudflare Workers AI (FREE)
- ✅ Transcripts merged automatically
- ✅ Analysis run via `/analyze` endpoint (uses Cloudflare-stored OpenAI key)

**No size limit!** Process hours-long recordings with zero additional configuration.

## 📋 Script Output Example

```bash
$ ./scripts/process-interview.sh interview.m4a "Jane Smith" "Senior DevOps Engineer"

═══════════════════════════════════════════════════════════════
  INTERVIEW ANALYSIS PIPELINE
═══════════════════════════════════════════════════════════════

Configuration:
  Audio File:    interview.m4a
  File Size:     18M
  Candidate:     Jane Smith
  Role:          Senior DevOps Engineer
  Context:       candidate_interview

▶ STEP 1: Uploading audio file...
✓ Upload completed in 8s

  Job ID:    abc123...
  Audio ID:  xyz789...
  Expires:   1 hour

▶ STEP 2: Triggering transcription and analysis...
 [⠋] Processing...
✓ Processing completed in 52s

═══════════════════════════════════════════════════════════════
  ANALYSIS RESULTS
═══════════════════════════════════════════════════════════════

👤 CANDIDATE INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: Jane Smith
Role: Senior DevOps Engineer
Sentiment: POSITIVE

📋 EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Jane demonstrated strong technical expertise in cloud infrastructure...

🎯 KEY TAKEAWAYS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • 5+ years experience with Kubernetes and Docker
  • Proven track record managing high-traffic systems
  • Strong communication and leadership skills
  ...

✓ STRENGTHS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Deep expertise in cloud platforms (AWS, GCP, Azure)
  ✓ Experience with observability tools (Datadog, Prometheus)
  ...

⚠ AREAS FOR IMPROVEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠ Could improve conciseness in technical explanations
  ...

💡 RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💡 Strong hire for senior role with system architecture focus
  ...

▶ STEP 4: Saving detailed results...
✓ Results saved to: results/20251227_120345_Jane_Smith.json
✓ Transcript saved to: results/20251227_120345_Jane_Smith_transcript.txt

═══════════════════════════════════════════════════════════════
  PIPELINE COMPLETED
═══════════════════════════════════════════════════════════════

Timing Summary:
  Upload:        8s
  Processing:    52s
  Total:         1m 0s

✓ Interview analysis complete! 🎉
```

## 🔧 Advanced Usage

### Custom Worker URL

```bash
export WORKER_URL="https://your-custom-domain.com"
./scripts/process-interview.sh interview.m4a "John Doe" "Backend Engineer"
```

### Meeting Analysis

The system also supports team meeting analysis:

```bash
# Change context to "team_meeting" in the script or API call
curl -X POST $WORKER_URL/upload \
  -F "file=@meeting.m4a" \
  -F "context=team_meeting" \
  -F 'metadata={"meetingTitle":"Sprint Planning","participants":"5"}'
```

### Batch Processing

Process multiple interviews:

```bash
for file in interviews/*.m4a; do
  name=$(basename "$file" .m4a)
  ./scripts/process-interview.sh "$file" "$name" "Software Engineer"
  echo "---"
done
```

## File Size Limits

- **Maximum**: 25MB per file
- **Recommended**: Under 20MB for best performance

### Handling Large Files

If your audio file exceeds 25MB, you have several options:

#### Option 1: Compress the Audio (Recommended)

Install FFmpeg if you haven't already:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg
```

Then use our helper script:
```bash
./scripts/prepare-audio.sh compress your-large-file.m4a
```

This creates an optimized file at 16kHz mono, 32kbps - perfect for Whisper transcription and significantly smaller.

#### Option 2: Split into Segments

```bash
./scripts/prepare-audio.sh split your-large-file.m4a ./segments
```

This splits your audio into 5-minute segments, then transcribe each:
```bash
for file in segments/*.mp3; do
  echo "Transcribing: $file"
  curl -X POST --data-binary @"$file" http://localhost:8787 >> full_transcript.txt
  echo -e "\n---\n" >> full_transcript.txt
done
```

#### Option 3: Manual FFmpeg Commands

**Compress audio:**
```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 -b:a 32k output.mp3
```

**Split into segments:**
```bash
ffmpeg -i input.m4a -f segment -segment_time 300 -ar 16000 -ac 1 -b:a 32k output_%03d.mp3
```

## How It Works

### Smart File Processing

The worker automatically detects the audio format and chooses the best processing strategy:

1. **Compressed formats** (MP3, M4A, AAC, OGG): Sent as a whole file to the API
2. **Raw formats** (WAV): Can be chunked if needed
3. **Detection**: Uses both Content-Type header and file magic numbers

### Why Not Chunk Everything?

Compressed audio formats like MP3 and M4A cannot be split arbitrarily. Splitting them mid-stream breaks the format and the Whisper API will reject them with "Invalid input" errors.

Only raw/uncompressed formats (like WAV) can be safely chunked at arbitrary byte boundaries.

## API Response Headers

The worker returns helpful headers with each response:

- `X-File-Size`: Original file size in bytes
- `X-Processing-Mode`: Either `whole-file` or `chunked`

## Development

### Running Tests

```bash
yarn test
```

The test suite includes:
- GET/POST request handling
- File upload validation
- Chunking behavior
- Error handling
- AI binding integration

### Project Structure

```
whisper-tutorial/
├── src/
│   └── index.ts           # Main worker code
├── test/
│   └── index.spec.ts      # Test suite
├── scripts/
│   └── prepare-audio.sh   # Audio preprocessing helper
├── test_file/
│   └── *.m4a              # Test audio files
├── wrangler.jsonc         # Cloudflare Workers configuration
└── vitest.config.mts      # Test configuration
```

## Deployment

### Deploy to Production

```bash
# Deploy to Cloudflare
npx wrangler deploy

# Your worker will be available at:
# https://whisper-tutorial.<your-subdomain>.workers.dev
```

### Environment Setup

The worker requires:
- Cloudflare account with Workers AI enabled
- AI binding configured in `wrangler.jsonc`

### Check Your Setup

```bash
# Verify you're logged in
npx wrangler whoami

# Check your configuration
npx wrangler deploy --dry-run
```

## Troubleshooting

### Error: "Binding AI needs to be run remotely"

**Solution**: Don't use `--local` flag. The AI binding must run in remote mode:
```bash
npx wrangler dev  # ✅ Correct
npx wrangler dev --local  # ❌ Won't work
```

### Error: "5006: Invalid input"

**Cause**: Trying to transcribe a file that's been improperly chunked or has an invalid format.

**Solution**: 
1. Ensure you're using the latest code (it sends compressed files whole)
2. Try compressing your file first
3. Check the file isn't corrupted

### Error: "File size exceeds 25MB"

**Solution**: Use the preprocessing script to compress or split your file:
```bash
./scripts/prepare-audio.sh compress your-file.m4a
```

### Slow Upload Speed

**Solution**: Compress your audio first. Whisper works great with lower bitrates:
```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 -b:a 32k output.mp3
```

This can reduce file size by 80-90% with minimal quality impact for transcription.

## Performance Tips

1. **Use 16kHz mono audio**: Whisper is trained on 16kHz audio
2. **Lower bitrate**: 32kbps is sufficient for speech transcription
3. **Compress before upload**: Saves time and bandwidth
4. **Split very long recordings**: Easier to manage and process

## Costs

Cloudflare Workers AI charges for:
- **Whisper model usage**: Per second of audio transcribed
- **Workers requests**: First 100k requests/day are free
- **Bandwidth**: First 10GB/month are free

Check current pricing at: https://developers.cloudflare.com/workers-ai/platform/pricing/

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `yarn test`
5. Submit a pull request

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Cloudflare Workers AI documentation
3. Open an issue on GitHub

