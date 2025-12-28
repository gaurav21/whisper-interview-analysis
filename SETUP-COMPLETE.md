# Setup Complete Guide

## ✅ What's Already Done

- ✅ **D1 Database** created and migrated (ID: `8b0870f8-d275-470d-ac98-c6d5e7982f29`)
- ✅ **KV Namespace** created (ID: `1ab4b592909d4fa1806273e6e47c020b`)
- ✅ **3 Database Tables** created:
  - `audio_files`
  - `transcriptions`
  - `analyses`

## 🎯 Choose Your Deployment Option

### Option A: Free Tier (Simplified) - **RECOMMENDED TO START**

**Cost:** FREE  
**Processing:** Synchronous (results returned immediately)  
**Limitations:** No R2 storage, no async queues

**What You Get:**
- ✅ Audio transcription (Whisper AI)
- ✅ Interview/meeting analysis (OpenAI)
- ✅ Results stored in D1
- ✅ Full API access

**Setup Steps:**

1. **Set OpenAI API Key:**
   ```bash
   npx wrangler secret put OPENAI_API_KEY --config wrangler-free.jsonc
   # Paste your OpenAI API key when prompted
   ```

2. **Deploy:**
   ```bash
   npm run deploy:free
   ```

3. **Test:**
   ```bash
   curl -X POST https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/upload \
     -F "file=@test_file/zoom.us (2025-10-31 10.26.28).m4a" \
     -F "context=candidate_interview" \
     -F 'metadata={"candidateName":"Test User"}'
   ```

**Response:** Returns complete results immediately (transcription + analysis).

---

### Option B: Production (Multi-Worker) - Requires Paid Plan

**Cost:** $5/month Workers Paid  
**Processing:** Async (scalable)  
**Features:** R2 storage, queue-based processing, separate workers

**What You Need:**

1. **Enable R2:**
   - Go to https://dash.cloudflare.com
   - Navigate to R2
   - Click "Purchase R2"
   - Then run:
     ```bash
     npx wrangler r2 bucket create whisper-audio-files
     ```

2. **Upgrade to Workers Paid:**
   - Go to https://dash.cloudflare.com/workers/plans
   - Upgrade to Workers Paid ($5/month)
   - Then run:
     ```bash
     npx wrangler queues create analysis-queue
     npx wrangler queues create analysis-dlq
     ```

3. **Set OpenAI API Keys:**
   ```bash
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put OPENAI_API_KEY --config wrangler-analysis.jsonc
   ```

4. **Deploy Both Workers:**
   ```bash
   npm run deploy:all
   ```

## 🚀 Quick Start - Free Tier

Since your database is already set up, here's what to do:

### 1. Set Your OpenAI API Key

```bash
npx wrangler secret put OPENAI_API_KEY --config wrangler-free.jsonc
```

When prompted, paste your OpenAI API key (get one at https://platform.openai.com/api-keys)

### 2. Deploy

```bash
npm run deploy:free
```

### 3. Test Upload

```bash
curl -X POST https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/upload \
  -F "file=@test_file/zoom.us (2025-10-31 10.26.28).m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"John Doe","position":"Senior Engineer"}'
```

The response will include:
- Full transcript
- AI analysis (summary, pros, cons, recommendations)
- Job ID (to retrieve results later)

### 4. Retrieve Results Later

```bash
curl https://whisper-transcription-free.YOUR-SUBDOMAIN.workers.dev/status/{jobId}
```

## 📊 Comparison

| Feature | Free Tier | Production (Paid) |
|---------|-----------|-------------------|
| **Cost** | FREE | $5/month |
| **Transcription** | ✅ Yes | ✅ Yes |
| **AI Analysis** | ✅ Yes | ✅ Yes |
| **Processing** | Synchronous | Async (Queue-based) |
| **Response Time** | Immediate | Statuscheck |
| **File Storage** | D1 only | R2 + D1 |
| **Scalability** | Good | Excellent |
| **Max File Size** | 25MB | 25MB |
| **Timeout Risk** | Medium | Low |
| **Best For** | Testing, Small teams | Production, High volume |

## 💡 Recommendations

### Start with Free Tier If:
- ✅ You're testing the system
- ✅ You process < 100 files/day
- ✅ File sizes are under 10MB
- ✅ You don't mind synchronous processing

### Upgrade to Paid If:
- 📈 Processing > 100 files/day
- 📈 Need async processing
- 📈 Want separate storage (R2)
- 📈 Need scalability for growth
- 📈 Processing very large files

## 🎓 Next Steps

1. **Deploy Free Tier** (fastest way to get started)
2. **Test with your audio files**
3. **Review results**
4. **Decide if you need paid features**
5. **Upgrade if needed**

## 🛠️ Local Development

### Free Tier:
```bash
npm run dev:free
```

Then test locally:
```bash
curl -X POST http://localhost:8787/upload \
  -F "file=@audio.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test"}'
```

### Production (Paid):
```bash
# Terminal 1: Transcription worker
npm run dev

# Terminal 2: Analysis worker
npm run dev:analysis
```

## 📝 API Usage - Free Tier

### Upload & Analyze

```bash
curl -X POST https://your-worker.workers.dev/upload \
  -F "file=@interview.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Jane Doe","position":"Engineer"}'
```

**Response (immediate):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "audioId": "550e8400-e29b-41d4-a716-446655440000",
  "context": "candidate_interview",
  "transcription": {
    "status": "completed",
    "text": "Full transcript here..."
  },
  "analysis": {
    "status": "completed",
    "summary": "The candidate demonstrated...",
    "keyTakeaways": ["Strong technical skills", "Good communication"],
    "pros": ["5+ years experience", "Led projects"],
    "cons": ["Limited cloud experience"],
    "recommendations": ["Recommend for hire"],
    "sentiment": "positive"
  },
  "createdAt": "2025-12-27T02:00:00.000Z",
  "updatedAt": "2025-12-27T02:00:30.000Z"
}
```

### Check Health

```bash
curl https://your-worker.workers.dev/health
```

## 🔧 Troubleshooting

### "OpenAI API key not set"

```bash
npx wrangler secret put OPENAI_API_KEY --config wrangler-free.jsonc
```

### "Database not found"

Your database is already created. Check the IDs match in `wrangler-free.jsonc`:
- database_id: `8b0870f8-d275-470d-ac98-c6d5e7982f29`
- kv id: `1ab4b592909d4fa1806273e6e47c020b`

### "Request timeout"

Free tier processes synchronously. If files are > 15MB or take > 30s:
1. Compress audio first: `./scripts/prepare-audio.sh compress file.m4a`
2. Or upgrade to paid plan for async processing

## 💰 Cost Estimates

### Free Tier (Option A)
- Workers: FREE (100k requests/day)
- Workers AI (Whisper): FREE (10k Neurons/day = ~10 min audio)
- OpenAI (GPT-4o-mini): ~$0.15 per 1000 analyses
- D1: FREE (5M reads/day, 100k writes/day)
- **Total: ~$0.15/month for 1,000 interviews**

### Paid Plan (Option B)
- Workers Paid: $5/month
- R2 Storage: ~$0.15/month (10GB)
- Workers AI: FREE
- OpenAI: ~$0.15/1000 analyses
- D1: FREE
- **Total: ~$5.30/month for 1,000 interviews**

## ✨ You're Ready!

Your database is set up and configured. Just:

1. Run: `npx wrangler secret put OPENAI_API_KEY --config wrangler-free.jsonc`
2. Deploy: `npm run deploy:free`
3. Test it!

---

**Questions?** Check:
- [README-PRODUCTION.md](./README-PRODUCTION.md) - Full API docs
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Detailed deployment guide
- [SUMMARY.md](./SUMMARY.md) - Project overview

