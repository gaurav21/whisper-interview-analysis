#!/bin/bash
# Setup script for Cloudflare resources
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Cloudflare resources for Whisper Transcription${NC}\n"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}Wrangler is not installed. Installing...${NC}"
    npm install -g wrangler
fi

# Login to Cloudflare
echo -e "${YELLOW}Step 1: Logging in to Cloudflare...${NC}"
npx wrangler login

# Create D1 database
echo -e "\n${YELLOW}Step 2: Creating D1 database...${NC}"
D1_OUTPUT=$(npx wrangler d1 create whisper-db 2>&1 || true)
echo "$D1_OUTPUT"

if echo "$D1_OUTPUT" | grep -q "database_id"; then
    DATABASE_ID=$(echo "$D1_OUTPUT" | grep "database_id" | sed -n 's/.*database_id = "\([^"]*\)".*/\1/p')
    echo -e "${GREEN}Database created with ID: $DATABASE_ID${NC}"
    
    # Update wrangler.jsonc with database ID
    sed -i.bak "s/\"database_id\": \"TBD\"/\"database_id\": \"$DATABASE_ID\"/" wrangler.jsonc
    sed -i.bak "s/\"database_id\": \"TBD\"/\"database_id\": \"$DATABASE_ID\"/" wrangler-analysis.jsonc
    
    echo -e "${GREEN}Updated wrangler configs with database ID${NC}"
else
    echo -e "${YELLOW}Database might already exist. Continuing...${NC}"
fi

# Run migrations
echo -e "\n${YELLOW}Step 3: Running database migrations...${NC}"
npx wrangler d1 execute whisper-db --file=migrations/0001_initial_schema.sql

# Create R2 bucket
echo -e "\n${YELLOW}Step 4: Creating R2 bucket...${NC}"
npx wrangler r2 bucket create whisper-audio-files 2>&1 || echo "Bucket might already exist"

# Create KV namespace
echo -e "\n${YELLOW}Step 5: Creating KV namespace...${NC}"
KV_OUTPUT=$(npx wrangler kv:namespace create CACHE 2>&1 || true)
echo "$KV_OUTPUT"

if echo "$KV_OUTPUT" | grep -q "id ="; then
    KV_ID=$(echo "$KV_OUTPUT" | grep "id =" | sed -n 's/.*id = "\([^"]*\)".*/\1/p')
    echo -e "${GREEN}KV namespace created with ID: $KV_ID${NC}"
    
    # Update wrangler.jsonc with KV ID
    sed -i.bak "s/\"id\": \"TBD\"/\"id\": \"$KV_ID\"/" wrangler.jsonc
    sed -i.bak "s/\"id\": \"TBD\"/\"id\": \"$KV_ID\"/" wrangler-analysis.jsonc
    
    echo -e "${GREEN}Updated wrangler configs with KV ID${NC}"
fi

# Create queue
echo -e "\n${YELLOW}Step 6: Creating queue...${NC}"
npx wrangler queues create analysis-queue 2>&1 || echo "Queue might already exist"
npx wrangler queues create analysis-dlq 2>&1 || echo "DLQ might already exist"

# Set OpenAI API key
echo -e "\n${YELLOW}Step 7: Setting OpenAI API key...${NC}"
echo -e "${GREEN}Please enter your OpenAI API key:${NC}"
read -s OPENAI_KEY

if [ -n "$OPENAI_KEY" ]; then
    echo "$OPENAI_KEY" | npx wrangler secret put OPENAI_API_KEY
    echo "$OPENAI_KEY" | npx wrangler secret put OPENAI_API_KEY --config wrangler-analysis.jsonc
    echo -e "${GREEN}OpenAI API key set successfully${NC}"
else
    echo -e "${YELLOW}Skipping OpenAI API key setup. You can set it later with:${NC}"
    echo "  wrangler secret put OPENAI_API_KEY"
fi

# Clean up backup files
rm -f wrangler.jsonc.bak wrangler-analysis.jsonc.bak

echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Review and update wrangler.jsonc and wrangler-analysis.jsonc if needed"
echo "2. Deploy transcription worker: npx wrangler deploy"
echo "3. Deploy analysis worker: npx wrangler deploy --config wrangler-analysis.jsonc"
echo "4. Test your API!"

