#!/bin/bash

# Startup script for Digital Ocean App Platform

set -e

echo "Starting post-for-me service..."

# Ensure temp directory exists
mkdir -p /app/tmp

echo "Starting Bun server..."
exec bun run src/index.ts
