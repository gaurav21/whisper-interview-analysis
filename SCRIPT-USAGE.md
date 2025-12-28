# Interview Analysis Script - Quick Reference

## 🚀 Quick Start

Process an interview in one command:

```bash
./scripts/process-interview.sh <audio_file> "<candidate_name>" "<role>"
```

## 📝 Examples

### Basic Usage

```bash
./scripts/process-interview.sh interview.m4a "Jane Smith" "Senior DevOps Engineer"
```

### With Spaces in Filename

```bash
./scripts/process-interview.sh "recordings/interview with john.m4a" "John Doe" "Backend Developer"
```

### Different Roles

```bash
# Technical roles
./scripts/process-interview.sh audio.m4a "Sarah Chen" "Cloud Architect"
./scripts/process-interview.sh audio.m4a "Mike Ross" "Frontend Engineer"
./scripts/process-interview.sh audio.m4a "Lisa Park" "DevOps/SRE"

# Non-technical roles
./scripts/process-interview.sh audio.m4a "Tom Wilson" "Product Manager"
./scripts/process-interview.sh audio.m4a "Amy Lee" "Engineering Manager"
```

## 🔧 Configuration

### Custom Worker URL

```bash
export WORKER_URL="https://your-custom-domain.com"
./scripts/process-interview.sh audio.m4a "Name" "Role"
```

### Local Testing

```bash
# Make sure dev server is running
npm run dev:free

# Use localhost
export WORKER_URL="http://localhost:8787"
./scripts/process-interview.sh audio.m4a "Test User" "Test Role"
```

## 📊 Output

The script generates:

1. **Console Output**: Beautifully formatted analysis with:
   - Executive summary
   - Key takeaways (bullet points)
   - Strengths (✓ marked)
   - Areas for improvement (⚠ marked)
   - Recommendations (💡 marked)
   - Transcript preview (first 500 chars)
   - Timing information

2. **JSON File**: `results/YYYYMMDD_HHMMSS_Candidate_Name.json`
   - Complete analysis data
   - Full transcript
   - Metadata
   - Job IDs

3. **Transcript File**: `results/YYYYMMDD_HHMMSS_Candidate_Name_transcript.txt`
   - Plain text transcript
   - Easy to copy/paste

## ⏱️ Timing

### Small Files (<25MB)

| Step | Time | Description |
|------|------|-------------|
| Upload | ~5-10s | Uploads audio to KV storage |
| Processing | ~30-60s | Transcription + AI analysis |
| **Total** | **~45-70s** | For 15-20 minute interviews |

### Large Files (>25MB) - Auto-Split Mode

| Step | Time | Description |
|------|------|-------------|
| Splitting | ~5-10s | FFmpeg splits locally |
| Chunk Processing | ~20-30s per chunk | Each chunk transcribed |
| Analysis | ~10-15s | Complete transcript analyzed |
| **Total** | **~1-3 minutes** | Depends on file size |

**Example:** 42MB file (30 min audio) = 3 chunks = ~1.5 minutes total

## 📁 File Requirements

- **Format**: M4A, MP3, WAV, FLAC, OGG
- **Size**: **Unlimited!** (auto-splits files >25MB)
- **Duration**: Any length (tested with hours-long recordings)
- **Quality**: Any (script works with phone recordings)

### Auto-Split Feature (NEW!)

Files **over 25MB** are automatically processed in chunks:

1. **Auto-Detection**: Script detects file size
2. **FFmpeg Splitting**: Splits into 10-minute chunks (requires FFmpeg)
3. **Parallel Transcription**: Each chunk transcribed via Cloudflare Workers AI
4. **Smart Merging**: Transcripts combined intelligently
5. **Unified Analysis**: Complete transcript analyzed as one

**Example:**
- 42MB file (30 minutes) → 3 chunks → 1-2 minutes total processing
- 100MB file (70 minutes) → 7 chunks → 3-4 minutes total processing

**No additional setup required!** Just make sure FFmpeg is installed.

## 🔁 Batch Processing

Process multiple interviews:

```bash
#!/bin/bash
for file in interviews/*.m4a; do
    # Extract name from filename (customize as needed)
    name=$(basename "$file" .m4a)
    
    echo "Processing: $name"
    ./scripts/process-interview.sh "$file" "$name" "Software Engineer"
    
    echo "---"
    sleep 2  # Rate limiting
done
```

## 🐛 Troubleshooting

### Script Not Executable

```bash
chmod +x scripts/process-interview.sh
```

### "jq: command not found"

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

### "ffmpeg: command not found" (for large files)

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Verify installation
ffmpeg -version
```

### Large File Processing Fails

If auto-split fails:
1. **Check FFmpeg**: `which ffmpeg`
2. **Check disk space**: Need temp space for chunks
3. **Check file format**: Must be valid audio file
4. **Try manual compression**: See LARGE-FILES-GUIDE.md

### "Audio file not found"

Check the path is correct:
```bash
ls -la path/to/audio.m4a
```

### Upload Fails

1. Check file size: `du -h audio.m4a`
2. Verify worker URL: `curl $WORKER_URL/health`
3. Test connectivity: `ping workers.dev`

### Processing Timeout

For very large files (>20MB, >1 hour audio):
```bash
# Compress first
ffmpeg -i large.m4a -ar 16000 -ac 1 -b:a 32k compressed.mp3

# Then process
./scripts/process-interview.sh compressed.mp3 "Name" "Role"
```

## 🎨 Customization

### Change Context

Edit the script to use `team_meeting` instead of `candidate_interview`:

```bash
# Line 12 in process-interview.sh
CONTEXT="team_meeting"
```

### Add Custom Metadata

Edit line ~65:

```bash
METADATA=$(jq -n \
    --arg name "$CANDIDATE_NAME" \
    --arg role "$ROLE" \
    --arg dept "Engineering" \
    --arg level "Senior" \
    '{candidateName: $name, role: $role, department: $dept, level: $level}')
```

### Change Output Directory

Edit line ~297:

```bash
OUTPUT_DIR="my-results"  # Instead of "results"
```

## 📖 Script Output Sections

### 1. Configuration
Shows input parameters and settings

### 2. Upload (Step 1)
- Uploads file to worker
- Returns Job ID
- Files expire after 1 hour

### 3. Processing (Step 2)
- Transcribes audio (Whisper)
- Analyzes with GPT-4o-mini
- Returns results

### 4. Analysis Results
- **Candidate Info**: Name, role, sentiment
- **Executive Summary**: Overview paragraph
- **Key Takeaways**: 4-5 main points
- **Strengths**: Positive observations
- **Areas for Improvement**: Development areas
- **Recommendations**: Actionable next steps
- **Transcript**: Full conversation text

### 5. File Saving (Step 4)
Saves JSON + TXT to `results/` folder

### 6. Summary
Shows timing and file locations

## 🔗 Related Commands

```bash
# View saved results
cat results/YYYYMMDD_HHMMSS_Name.json | jq

# Search results
grep -r "specific_skill" results/

# Count interviews processed
ls -1 results/*.json | wc -l

# View just the summary from saved file
cat results/FILE.json | jq '.analysis.summary'

# Export to CSV
cat results/*.json | jq -r '[.analysis.sentiment, .transcription.createdAt] | @csv'
```

## 💰 Cost Estimate

Using Cloudflare Free Tier + OpenAI:

- **Cloudflare**: Free (Workers AI + D1 + KV)
- **OpenAI**: ~$0.01-0.03 per interview (GPT-4o-mini)
  - Input: ~$0.01 for 15-min transcript
  - Output: ~$0.005 for analysis

**~100 interviews per $1 on OpenAI** 🎉

## 🆘 Support

If the script fails:

1. Run with verbose output:
   ```bash
   bash -x ./scripts/process-interview.sh audio.m4a "Name" "Role"
   ```

2. Test the API manually:
   ```bash
   curl $WORKER_URL/health
   ```

3. Check worker logs:
   ```bash
   npx wrangler tail --config wrangler-free.jsonc
   ```

## ✨ Tips

1. **Use descriptive role names** - Better analysis context
2. **Process in batches** - Add 2-3s delay between runs
3. **Keep metadata** - Archive JSON files for records
4. **Compress audio** - Faster uploads, same quality
5. **Name files clearly** - Makes batch processing easier

---

**Happy Interviewing! 🎯**

