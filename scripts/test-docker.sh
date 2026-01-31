#!/bin/bash

# Local testing script for the service
# This simulates the production environment locally

set -e

echo "Building Docker image..."
docker build -t post-for-me:local .

echo "Starting container..."
docker run -d \
  --name post-for-me-test \
  -p 3000:3000 \
  -e NODE_ENV=development \
  -e PORT=3000 \
  -e GCS_PROJECT_ID="${GCS_PROJECT_ID:-test-project}" \
  -e GCS_BUCKET_NAME="${GCS_BUCKET_NAME:-test-bucket}" \
  -e GCS_KEY_FILE_PATH=/app/gcs-key.json \
  -e INSTAGRAM_ACCESS_TOKEN="${INSTAGRAM_ACCESS_TOKEN:-test-token}" \
  -e INSTAGRAM_USER_ID="${INSTAGRAM_USER_ID:-test-user-id}" \
  -e TEMP_DIR=/app/tmp \
  post-for-me:local

echo "Container started. Waiting for service to be ready..."
sleep 3

echo "Testing health endpoint..."
curl http://localhost:3000/health

echo ""
echo "Service is running!"
echo "View logs: docker logs -f post-for-me-test"
echo "Stop service: docker stop post-for-me-test && docker rm post-for-me-test"
