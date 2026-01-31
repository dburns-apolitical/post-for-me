FROM oven/bun:1

# Install fonts for video text overlay (ffmpeg is bundled via @ffmpeg-installer/ffmpeg)
RUN apt-get update && apt-get install -y \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY scripts ./scripts

# Create temp directory for video processing
RUN mkdir -p /app/tmp

# Make startup script executable
RUN chmod +x /app/scripts/startup.sh

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application using startup script
CMD ["/app/scripts/startup.sh"]
