# Quick Start Guide

Get up and running with the Instagram Reels automation in 5 minutes!

## Prerequisites

- Bun installed
- ffmpeg installed
- GCS bucket with videos
- Buffer API credentials

## 1. Install Dependencies

```bash
bun install
```

## 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required values:
- `GCS_PROJECT_ID` - Your Google Cloud project ID
- `GCS_BUCKET_NAME` - Your GCS bucket name (must be publicly readable)
- `BUFFER_ACCESS_TOKEN` - Your Buffer API token
- `BUFFER_PROFILE_ID` - Your Instagram profile ID on Buffer

## 3. Run Tests

```bash
bun test
```

Expected: All 28 tests pass ✅

## 4. Start Server

```bash
bun run dev
```

Server starts on http://localhost:3000

## 5. Test the API

```bash
# Health check
curl http://localhost:3000/health

# Post a reel
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "My first automated post! 🚀",
    "hookText": "Check this out!",
    "hashtags": ["automation", "instagram"]
  }'
```

## 6. Deploy (Optional)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full instructions.

Quick deploy to Digital Ocean:
1. Push to GitHub
2. Connect to DO App Platform
3. Add environment variables as secrets
4. Deploy!

## Need Help?

- **Full Setup**: See [SETUP.md](./SETUP.md)
- **Deployment**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Examples**: See [examples/curl-examples.sh](./examples/curl-examples.sh)
- **API Docs**: See [README.md](./README.md)

## Common Issues

**"bun: command not found"**
```bash
curl -fsSL https://bun.sh/install | bash
```

**"ffmpeg not found"**
```bash
brew install ffmpeg  # macOS
```

**GCS errors**
- Verify bucket is publicly readable (Permissions > allUsers > Storage Object Viewer)
- Check bucket name is correct

**Buffer API errors**
- Verify token is valid
- Check profile ID is for Instagram

---

That's it! You're ready to automate Instagram Reels posting! 🎉
