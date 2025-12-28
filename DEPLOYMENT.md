# Deployment Guide

Complete step-by-step guide to deploy the production-ready interview transcription system.

## Prerequisites

- [ ] Cloudflare account
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] OpenAI API key
- [ ] Repository cloned and dependencies installed

## Step 1: Install Dependencies

```bash
cd whisper-tutorial
yarn install
```

## Step 2: Login to Cloudflare

```bash
npx wrangler login
```

This will open a browser window for authentication.

## Step 3: Create Cloudflare Resources

### Option A: Automated Setup (Recommended)

```bash
chmod +x scripts/setup-cloudflare.sh
./scripts/setup-cloudflare.sh
```

This script will:
1. Create D1 database
2. Run migrations
3. Create R2 bucket
4. Create KV namespace  
5. Create queues
6. Prompt for OpenAI API key

### Option B: Manual Setup

#### 3.1 Create D1 Database

```bash
npx wrangler d1 create whisper-db
```

Copy the `database_id` from the output and update both `wrangler.jsonc` and `wrangler-analysis.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "whisper-db",
    "database_id": "YOUR_DATABASE_ID_HERE"  // ← Update this
  }
]
```

#### 3.2 Run Database Migrations

```bash
npx wrangler d1 execute whisper-db --file=migrations/0001_initial_schema.sql
```

Verify:
```bash
npx wrangler d1 execute whisper-db --command "SELECT name FROM sqlite_master WHERE type='table';"
```

#### 3.3 Create R2 Bucket

```bash
npx wrangler r2 bucket create whisper-audio-files
```

#### 3.4 Create KV Namespace

```bash
npx wrangler kv:namespace create CACHE
```

Copy the `id` and update both wrangler configs:

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE",
    "id": "YOUR_KV_ID_HERE"  // ← Update this
  }
]
```

#### 3.5 Create Queues

```bash
npx wrangler queues create analysis-queue
npx wrangler queues create analysis-dlq
```

#### 3.6 Set OpenAI API Key

```bash
# For transcription worker
npx wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key when prompted

# For analysis worker
npx wrangler secret put OPENAI_API_KEY --config wrangler-analysis.jsonc
# Paste the same key
```

## Step 4: Test Locally

### 4.1 Start Transcription Worker

```bash
npm run dev
```

In another terminal:

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "transcription"
}
```

### 4.2 Test Upload (Optional)

```bash
curl -X POST http://localhost:8787/upload \
  -F "file=@test_file/zoom.us (2025-10-31 10.26.28).m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Test User"}'
```

## Step 5: Deploy to Production

### 5.1 Deploy Transcription Worker

```bash
npm run deploy
```

Output will show your worker URL:
```
Published whisper-transcription (X.XX sec)
  https://whisper-transcription.YOUR-SUBDOMAIN.workers.dev
```

### 5.2 Deploy Analysis Worker

```bash
npm run deploy:analysis
```

### 5.3 Verify Deployment

```bash
curl https://whisper-transcription.YOUR-SUBDOMAIN.workers.dev/health
```

## Step 6: Production Testing

### 6.1 Upload Test File

```bash
curl -X POST https://whisper-transcription.YOUR-SUBDOMAIN.workers.dev/upload \
  -F "file=@test_file/audio.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Jane Doe","position":"Senior Engineer"}'
```

Save the `jobId` from the response.

### 6.2 Check Status

```bash
curl https://whisper-transcription.YOUR-SUBDOMAIN.workers.dev/status/YOUR_JOB_ID
```

Wait ~30-60 seconds and check again. Status should progress:
1. `transcription: processing` → `transcription: completed`
2. `analysis: processing` → `analysis: completed`

## Step 7: Monitor & Debug

### View Logs

```bash
# Real-time logs for transcription worker
npx wrangler tail

# Real-time logs for analysis worker
npx wrangler tail --config wrangler-analysis.jsonc
```

### Check Queue Stats

```bash
npx wrangler queues list
```

### Database Queries

```bash
# Check recent transcriptions
npx wrangler d1 execute whisper-db \
  --command "SELECT id, status, context, created_at FROM transcriptions ORDER BY created_at DESC LIMIT 5;"

# Check recent analyses
npx wrangler d1 execute whisper-db \
  --command "SELECT id, transcription_id, status, sentiment FROM analyses ORDER BY created_at DESC LIMIT 5;"
```

### Check R2 Storage

```bash
npx wrangler r2 object list whisper-audio-files
```

## Step 8: Set Up Custom Domain (Optional)

### 8.1 Add Custom Domain

```bash
npx wrangler domains add api.yourdomain.com
```

### 8.2 Update DNS

Add CNAME record in your DNS provider:
```
Type: CNAME
Name: api
Value: YOUR-SUBDOMAIN.workers.dev
```

### 8.3 Verify

```bash
curl https://api.yourdomain.com/health
```

## Troubleshooting

### Issue: "Database not found"

```bash
# List databases
npx wrangler d1 list

# Check if database exists
npx wrangler d1 info whisper-db
```

### Issue: "Queue not found"

```bash
# List queues
npx wrangler queues list

# Recreate queue
npx wrangler queues create analysis-queue
```

### Issue: "Secret not found"

```bash
# List secrets
npx wrangler secret list

# Recreate secret
npx wrangler secret put OPENAI_API_KEY
```

### Issue: "R2 bucket not found"

```bash
# List buckets
npx wrangler r2 bucket list

# Recreate bucket
npx wrangler r2 bucket create whisper-audio-files
```

### Issue: Analysis not running

1. Check queue is created:
   ```bash
   npx wrangler queues list
   ```

2. Check analysis worker is deployed:
   ```bash
   npx wrangler deployments list --config wrangler-analysis.jsonc
   ```

3. Check queue consumer is configured in `wrangler-analysis.jsonc`

4. View analysis worker logs:
   ```bash
   npx wrangler tail --config wrangler-analysis.jsonc
   ```

## Post-Deployment Checklist

- [ ] Both workers deployed successfully
- [ ] Health endpoints responding
- [ ] Test upload completes
- [ ] Transcription completes
- [ ] Analysis completes
- [ ] Status endpoint returns full results
- [ ] Logs are viewable
- [ ] Database has records
- [ ] R2 has files

## Cost Estimation

For **1,000 interviews/month** (avg 10 min each):

| Service | Usage | Cost |
|---------|-------|------|
| Workers AI (Whisper) | 10,000 minutes | $0 (free tier) |
| OpenAI (GPT-4o-mini) | 1,000 analyses | ~$0.15 |
| R2 Storage | ~10GB | ~$0.15 |
| D1 Database | Within free tier | $0 |
| Workers Requests | ~3,000 requests | $0 (free tier) |
| **Total** | | **~$0.30/month** |

## Scaling Considerations

### Current Setup Handles:
- Up to 100 concurrent uploads
- ~1,000 transcriptions/day
- Automatic queue scaling

### To Scale Beyond:
1. **Increase queue batch size** in wrangler configs
2. **Deploy multiple analysis workers** in different regions
3. **Add rate limiting** to prevent abuse
4. **Implement caching** for frequently accessed results
5. **Add CDN** for transcript downloads

## Security Recommendations

- [ ] Enable rate limiting
- [ ] Add authentication (JWT, API keys)
- [ ] Configure CORS properly
- [ ] Monitor for abuse
- [ ] Rotate secrets regularly
- [ ] Set up alerts for errors

## Next Steps

1. **Add Authentication**: Implement API key or JWT authentication
2. **Add Rate Limiting**: Prevent abuse
3. **Set Up Monitoring**: Use Cloudflare Analytics
4. **Configure Alerts**: Email/Slack notifications for errors
5. **Documentation**: API documentation with examples
6. **Client SDK**: Create SDK for easy integration

---

🎉 **Congratulations! Your system is now deployed and ready for production use.**

For API usage examples, see [README-PRODUCTION.md](./README-PRODUCTION.md)

