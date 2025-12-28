# Upload and automatically check status
RESPONSE=$(curl -s -X POST https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/upload \
  -F "file=@test_file/7BADE5D6-6D1A-491B-8E81-5FB5ED7836E8_app-audio_2D7B61B2.m4a" \
  -F "context=candidate_interview" \
  -F 'metadata={"candidateName":"Ericko","position":"Engineer"}')

echo "Upload response:"
echo $RESPONSE | jq .

# Extract jobId
JOB_ID=$(echo $RESPONSE | jq -r '.jobId')

if [ "$JOB_ID" != "null" ]; then
  echo ""
  echo "Job ID: $JOB_ID"
  echo "Waiting 60 seconds for processing..."
  sleep 60
  
  echo ""
  echo "Checking results..."
  curl https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev/status/$JOB_ID | jq .
else
  echo "Error: No jobId received. Check the response above."
fi