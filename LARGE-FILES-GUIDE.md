# Handling Large Audio Files (15MB+)

## The Problem

Your 19MB file was **timing out** because:
- Workers on free tier have a **30-second CPU time limit**
- Large files take **30-60 seconds** to transcribe + analyze
- Synchronous processing couldn't complete in time

## The Solution ✅

I've updated the worker to automatically detect file size:

### Small Files (<15MB)
- ✅ **Immediate results** - Returns complete transcription + analysis
- ⚡ Response time: ~10-30 seconds

### Large Files (15-25MB)
- ✅ **Background processing** - Uses `waitUntil` to process async
- 📨 Returns job ID immediately
- ⏱️ Check status after 30-60 seconds

## How To Use

### Option 1: Let the Worker Handle It (Automatic)

```bash
# Upload your 19MB file
curl -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
  -F "file=@test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test User"}'
```

**Response (immediate):**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Large file queued for processing. Check /status/{jobId} in 30-60 seconds.",
  "statusUrl": "/status/550e8400-e29b-41d4-a716-446655440000",
  "estimatedTime": "30-60 seconds",
  "fileSizeMB": 19
}
```

**Then check status:**
```bash
# Wait 30-60 seconds, then check
curl https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/status/550e8400-e29b-41d4-a716-446655440000
```

**Status will show:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "transcription": {
    "status": "completed",  // or "processing"
    "text": "Full transcript..."
  },
  "analysis": {
    "status": "completed",
    "summary": "...",
    "keyTakeaways": [...],
    "pros": [...],
    "cons": [...]
  }
}
```

### Option 2: Compress First (Faster + More Reliable)

**Reduce your 19MB file to ~2-5MB:**

```bash
# Install ffmpeg if not already installed
brew install ffmpeg

# Compress the file (reduces size by 80-90%)
./scripts/prepare-audio.sh compress "test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a"

# This creates: 7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2_compressed.mp3
# Size: ~2-5MB (perfect for immediate processing)

# Now upload the compressed version
curl -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
  -F "file=@test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2_compressed.mp3" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test User"}'

# Get results IMMEDIATELY (no waiting!)
```

**Why compress?**
- ✅ **Faster processing** (~10s vs 60s)
- ✅ **Immediate results** (no status checking needed)
- ✅ **Same quality** (Whisper optimized for 16kHz audio anyway)
- ✅ **Cheaper** (less OpenAI tokens, less compute time)

## Manual Compression

If you don't have the helper script:

```bash
# Compress to optimal format for Whisper (16kHz, mono, 32kbps)
ffmpeg -i "test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -ar 16000 -ac 1 -b:a 32k \
  "test_file/7BADE5D6-compressed.mp3"

# Check the new size
ls -lh "test_file/7BADE5D6-compressed.mp3"
# Should be ~2-5MB
```

## Testing Your 19MB File Now

### Test 1: Background Processing

```bash
curl -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
  -F "file=@test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test Candidate"}'

# Save the jobId from the response
# Wait 60 seconds
sleep 60

# Check status
curl https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/status/{YOUR_JOB_ID}
```

### Test 2: With Compression (Recommended)

```bash
# Compress first
ffmpeg -i "test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -ar 16000 -ac 1 -b:a 32k \
  "test_file/7BADE5D6-compressed.mp3"

# Upload compressed version
curl -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
  -F "file=@test_file/7BADE5D6-compressed.mp3" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test Candidate"}'

# Results returned IMMEDIATELY!
```

## File Size Reference

| Size | Processing | Response Time | Recommendation |
|------|------------|---------------|----------------|
| <5MB | ⚡ Immediate | ~10-20s | Upload as-is |
| 5-15MB | ⚡ Immediate | ~20-30s | Upload as-is |
| 15-25MB | 🔄 Background | ~30-60s | Compress OR wait |
| >25MB | ❌ Rejected | N/A | Must compress |

## Batch Processing Multiple Files

If you have many large files:

```bash
#!/bin/bash
# batch-process.sh

for file in test_file/*.m4a; do
  echo "Processing: $file"
  
  # Compress
  compressed="${file%.m4a}_compressed.mp3"
  ffmpeg -i "$file" -ar 16000 -ac 1 -b:a 32k "$compressed" -y
  
  # Upload
  response=$(curl -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
    -F "file=@$compressed" \
    -F "context=candidate_interview" \
    -F 'metadata={"filename":"'$(basename "$file")'"}'
  )
  
  echo "Response: $response"
  echo "---"
  
  # Small delay between uploads
  sleep 2
done
```

## Troubleshooting

### "Still getting timeout"
- **Solution**: The file might be >25MB after headers. Check actual size.
- **Or**: Compress to <10MB for guaranteed immediate response.

### "Processing takes forever"
- **Check**: `curl https://your-worker.workers.dev/status/{jobId}`
- **Wait**: Large files can take up to 90 seconds
- **Better**: Compress first for 10-20s processing

### "Want faster processing?"
1. **Compress all files first** (80-90% size reduction)
2. **Use 16kHz mono** (optimal for Whisper)
3. **Batch process overnight** if you have many files

## Best Practices

✅ **DO:**
- Compress files over 10MB before uploading
- Use 16kHz, mono, 32kbps for optimal results
- Check status endpoint for large files
- Batch process multiple files with delays

❌ **DON'T:**
- Upload uncompressed WAV files (massive size)
- Expect immediate results for 19MB+ files
- Upload >25MB files (will be rejected)
- Spam the API without delays

## Your Specific File

**File:** `7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a`  
**Size:** 19MB  
**Recommendation:** 

**Option A - Best:** Compress first
```bash
ffmpeg -i "test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -ar 16000 -ac 1 -b:a 32k \
  "test_file/7BADE5D6-compressed.mp3"

# Then upload - get immediate results!
```

**Option B - Works:** Use background processing
```bash
# Upload, get jobId, wait 60s, check status
```

---

**The worker is now deployed and ready to handle your 19MB file!**

Try it now: https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload

