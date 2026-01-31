# Post For Me - Instagram Reels Automation

Automated Instagram Reels posting service that selects videos from Google Cloud Storage, adds text overlays, and posts directly via Instagram Graph API.

## Features

- HTTP API endpoint for triggering posts via curl
- Random video selection from Google Cloud Storage
- Automatic text overlay on videos using ffmpeg
- Direct Instagram Graph API integration for posting Reels
- Built with Bun and TypeScript

## Prerequisites

- [Bun](https://bun.sh/) installed
- Google Cloud Storage bucket (public read/write)
- Instagram Business or Creator account with Meta App
- ffmpeg installed (for video processing)

## Installation

```bash
# Install dependencies
bun install

# Copy environment variables template
cp .env.example .env

# Edit .env with your credentials
```

## Configuration

Create a `.env` file with the following variables:

```env
PORT=3000
NODE_ENV=development

GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=your-video-bucket-name
# Note: Bucket must be publicly readable AND writable

INSTAGRAM_ACCESS_TOKEN=your-instagram-access-token
INSTAGRAM_USER_ID=your-instagram-user-id

TEMP_DIR=./tmp
```

## Usage

### Start the server

```bash
# Development mode (with hot reload)
bun run dev

# Production mode
bun start
```

### Make a request

```bash
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Your main caption here",
    "hookText": "Text to overlay on video",
    "hashtags": ["reel", "content", "viral"]
  }'
```

### Health check

```bash
curl http://localhost:3000/health
```

## API Reference

### POST /api/post-reel

Create and post an Instagram Reel.

**Request Body:**

```json
{
  "caption": "Main caption text (max 2200 chars)",
  "hookText": "Text to overlay on video (max 100 chars)",
  "hashtags": ["array", "of", "hashtags"]
}
```

**Response:**

```json
{
  "success": true,
  "postId": "instagram-media-id",
  "videoUsed": "gs://bucket/video-name.mp4"
}
```

**Validation Rules:**

- `caption`: Required, 1-2200 characters
- `hookText`: Required, 1-100 characters
- `hashtags`: Array of 1-30 hashtags, alphanumeric and underscore only

## Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch
```

## Project Structure

```
post-for-me/
├── src/
│   ├── index.ts              # Main HTTP server
│   ├── routes/
│   │   └── post-reel.ts      # POST endpoint handler
│   ├── services/
│   │   ├── video-selector.ts   # GCS video selection
│   │   ├── video-editor.ts     # ffmpeg text overlay
│   │   └── instagram-client.ts # Instagram Graph API
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   ├── utils/
│   │   ├── validation.ts     # Zod schemas
│   │   └── logger.ts         # Logging utility
│   └── config/
│       └── index.ts          # Configuration management
├── tests/
│   ├── integration/
│   └── unit/
└── README.md
```

## Development Phases

This project was built incrementally in phases:

1. ✅ Basic HTTP server with validation
2. ✅ Google Cloud Storage integration
3. ✅ Video editing with ffmpeg
4. ✅ Instagram Graph API integration
5. ✅ End-to-end integration
6. ✅ Deployment configuration

## Local Development

### Running the Server

```bash
# Start in development mode with hot reload
bun run dev

# Or start normally
bun start
```

### Testing with Docker

```bash
# Build and test locally with Docker
./scripts/test-docker.sh

# Or manually
docker build -t post-for-me .
docker run -p 3000:3000 --env-file .env post-for-me
```

### Example Requests

See `examples/curl-examples.sh` for various test requests, or try:

```bash
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Amazing content here!",
    "hookText": "Watch this!",
    "hashtags": ["reel", "viral"]
  }'
```

## Deployment

This service is designed to run on Digital Ocean App Platform.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment instructions.

Quick start:

1. Push code to GitHub
2. Connect to Digital Ocean App Platform
3. Configure environment variables (see DEPLOYMENT.md)
4. Deploy!

The app will automatically:
- Build with Docker
- Install ffmpeg
- Set up health checks
- Scale based on your configuration

## Architecture

```
┌─────────────┐
│   cURL      │
│   Request   │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│   Bun Server     │
│   (Validation)   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Video Selector  │
│  (GCS Random)    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Video Editor    │
│  (ffmpeg Text)   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  GCS Upload      │
│  (edited/ folder)│
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Instagram Client │
│  (Graph API)     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│    Instagram     │
│      Reels       │
└──────────────────┘
```

## Project Highlights

- **Type-safe**: Full TypeScript with strict mode
- **Fast**: Built with Bun for maximum performance
- **Tested**: Comprehensive unit and integration tests
- **Production-ready**: Docker, health checks, error handling
- **Scalable**: Designed for Digital Ocean App Platform
- **Clean code**: Modular services, logging, validation

## Troubleshooting

### ffmpeg not found
Install ffmpeg: `brew install ffmpeg` (macOS) or see Dockerfile for Linux

### GCS authentication errors
- Check your bucket is publicly readable
- Verify bucket name is correct
- Ensure videos are uploaded

### Instagram API errors
- Verify your access token is valid (tokens expire after 60 days)
- Ensure your Instagram account is a Business or Creator account
- Check that your Meta App has `instagram_content_publish` permission
- Verify the User ID matches your Instagram Business Account ID

### Video processing slow
- Use smaller videos (< 60 seconds, < 50MB)
- Ensure consistent format (1080x1920, H.264, 30fps)
- Consider upgrading instance size in production

## Future Enhancements

- [ ] Analytics and performance tracking via Instagram Insights API
- [ ] Webhook support for post status updates
- [ ] Video format auto-conversion
- [ ] Scheduled posting support
- [ ] Multiple text overlays
- [ ] Custom fonts and styling
- [ ] Rate limiting and authentication

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit a pull request

## License

MIT
