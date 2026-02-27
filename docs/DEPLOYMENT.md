# Deployment Guide for Digital Ocean App Platform

This guide walks you through deploying the Instagram Reels automation service to Digital Ocean App Platform.

## Prerequisites

- Digital Ocean account
- GitHub repository with this code
- Google Cloud Storage bucket with videos (public read/write)
- Instagram Business or Creator account with Meta App

## Step 1: Prepare Your Repository

1. Push your code to a GitHub repository:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/post-for-me.git
git push -u origin main
```

2. Ensure your `.gitignore` excludes sensitive files:
   - `.env`
   - `*.json` (GCS keys)
   - `tmp/` directory

## Step 2: Set Up Google Cloud Storage

1. Create a GCS bucket for your videos:
   - Go to Google Cloud Console
   - Create a new bucket (e.g., `my-instagram-videos`)
   - Upload your video files (MP4 format recommended)

2. **Make bucket publicly readable**:
   - Go to bucket **Permissions** tab
   - Click **Grant Access**
   - New principals: `allUsers`
   - Role: **Storage Object Viewer**
   - Click **Save**

**Security Note**: Videos will be publicly accessible. Use non-obvious filenames (UUIDs) for security.

## Step 3: Set Up Instagram Graph API

1. Go to [Meta for Developers](https://developers.facebook.com) and create a Business-type app
2. Add the "Instagram Graph API" product to your app
3. Get your access token with `instagram_content_publish` permission
4. Get your Instagram User ID (see SETUP.md for detailed instructions)

## Step 4: Deploy to Digital Ocean

### Option A: Using the Web UI

1. Go to [Digital Ocean App Platform](https://cloud.digitalocean.com/apps)
2. Click "Create App"
3. Connect your GitHub repository
4. Select the repository and branch (`main`)
5. Digital Ocean will auto-detect the Dockerfile
6. Configure environment variables (see below)
7. Click "Next" through the remaining steps
8. Click "Create Resources"

### Option B: Using the CLI

1. Install `doctl`:

```bash
# macOS
brew install doctl

# Authenticate
doctl auth init
```

2. Create app from spec file:

```bash
doctl apps create --spec .do/app.yaml
```

## Step 5: Configure Environment Variables

In the Digital Ocean App Platform dashboard, add these environment variables as **encrypted**:

| Variable Name | Value | Type |
|--------------|--------|------|
| `PORT` | `3000` | Plain |
| `NODE_ENV` | `production` | Plain |
| `GCS_PROJECT_ID` | Your GCP project ID | Secret |
| `GCS_BUCKET_NAME` | Your GCS bucket name | Secret |
| `INSTAGRAM_ACCESS_TOKEN` | Your Instagram API token | Secret |
| `INSTAGRAM_USER_ID` | Your Instagram User ID | Secret |
| `TEMP_DIR` | `/app/tmp` | Plain |

**Note**: No GCS key file needed - bucket uses public access.

## Step 6: Test Your Deployment

Once deployed, you'll get a URL like: `https://post-for-me-xxxxx.ondigitalocean.app`

Test the health endpoint:

```bash
curl https://post-for-me-xxxxx.ondigitalocean.app/health
```

Test creating a post:

```bash
curl -X POST https://post-for-me-xxxxx.ondigitalocean.app/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Check out this amazing content!",
    "hookText": "Watch this! 👀",
    "hashtags": ["reel", "content", "viral", "instagram"]
  }'
```

## Step 7: Monitor Your Application

1. View logs in the Digital Ocean dashboard:
   - Go to your app
   - Click on the "Runtime Logs" tab

2. Set up alerts:
   - Configure notifications for app crashes
   - Monitor resource usage

## Scaling Considerations

### Performance

- **Instance Size**: Start with `basic-xxs` ($5/month)
- **Scaling**: Increase instance size if video processing is slow
- **Multiple Instances**: Enable if you need higher throughput

### Costs

- App Platform: $5-12/month (depending on instance size)
- Outbound bandwidth: Free up to 1TB/month
- GCS storage: ~$0.02/GB/month
- GCS data transfer: ~$0.12/GB

### Optimization Tips

1. **Video Processing**: 
   - Keep videos under 60 seconds for faster processing
   - Use consistent formats (1080x1920, 30fps, H.264)

2. **Temporary Storage**:
   - Files are automatically cleaned up after processing
   - Monitor disk usage in DO dashboard

3. **Rate Limiting**:
   - Consider adding rate limiting if exposing publicly
   - Instagram API has rate limits (check Meta docs)

## Troubleshooting

### Common Issues

**ffmpeg not found**
- Ensure the Dockerfile installs ffmpeg correctly
- Check build logs in DO dashboard

**GCS authentication failed**
- Verify your bucket is publicly readable
- Check that bucket name is correct
- Ensure videos are uploaded to the bucket

**Instagram API errors**
- Verify your access token is valid (expires after 60 days)
- Check that the User ID is correct
- Ensure your account is a Business or Creator account

**Video processing timeout**
- Increase instance size for more CPU
- Optimize video files before uploading to GCS

### Viewing Logs

```bash
# Using doctl
doctl apps logs YOUR_APP_ID --follow
```

## Security Best Practices

1. **Never commit secrets** to your repository
2. **Use encrypted environment variables** in Digital Ocean
3. **Rotate API keys** regularly
4. **Add authentication** if exposing the API publicly
5. **Set up rate limiting** to prevent abuse

## Future Enhancements

1. Add Instagram Insights API for analytics tracking
2. Implement webhook handlers for post status updates
3. Add support for scheduled posting
4. Implement token refresh automation

## Support

For issues:
- Check Digital Ocean logs
- Review this documentation
- Check GCS and Instagram Graph API documentation
