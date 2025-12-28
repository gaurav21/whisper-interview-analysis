# Quick Start Guide

## Running the Service

```bash
# Start the development server
npx wrangler dev

# The server starts at http://localhost:8787
```

## Transcribe Your Audio

```bash
# Simple upload
curl -X POST --data-binary @audio.m4a http://localhost:8787

# Save to file
curl -X POST --data-binary @audio.m4a http://localhost:8787 > transcript.txt
```

## Your Test File

Your 17MB M4A file works perfectly:

```bash
curl -X POST --data-binary @"test_file/zoom.us (2025-10-31 10.26.28).m4a" http://localhost:8787
```

## For Larger Files (>25MB)

### Option 1: Install FFmpeg and Compress

```bash
# Install FFmpeg
brew install ffmpeg

# Compress your audio
./scripts/prepare-audio.sh compress your-large-file.m4a
```

### Option 2: Split into Segments

```bash
./scripts/prepare-audio.sh split your-large-file.m4a ./segments
```

Then transcribe each segment:

```bash
for file in segments/*.mp3; do
  curl -X POST --data-binary @"$file" http://localhost:8787 >> transcript.txt
done
```

## Manual FFmpeg Commands

```bash
# Compress (reduces size by 80-90%)
ffmpeg -i input.m4a -ar 16000 -ac 1 -b:a 32k output.mp3

# Split into 5-minute segments
ffmpeg -i input.m4a -f segment -segment_time 300 -ar 16000 -ac 1 -b:a 32k output_%03d.mp3
```

## What Changed

### Before (❌ Failed)
- Tried to split M4A files into arbitrary byte chunks
- Resulted in "Invalid input" errors
- Compressed formats can't be split mid-stream

### Now (✅ Works)
- Sends compressed files (MP3, M4A) as whole files
- Validates file size upfront (25MB limit)
- Provides clear error messages with solutions
- Your 17MB file transcribes successfully

## Performance Tips

1. **Optimal format**: 16kHz mono, 32kbps MP3
2. **File size**: Under 20MB for best performance
3. **Long recordings**: Split into 5-10 minute segments
4. **Bandwidth**: Compress before upload

## Common Issues

| Issue | Solution |
|-------|----------|
| File too large | Use `./scripts/prepare-audio.sh compress` |
| Slow upload | Compress audio first |
| Invalid input | Ensure you're using latest code |
| Server not starting | Use `npx wrangler dev` (not `--local`) |

## Deploy to Production

```bash
npx wrangler deploy
```

Your worker will be available at:
`https://whisper-tutorial.<your-subdomain>.workers.dev`

## Costs

- **Free tier**: 10,000 Neurons/day (Workers AI)
- **Typical usage**: ~1,000 Neurons per minute of audio
- **Example**: 10 minutes of audio/day = free tier

Check pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/

