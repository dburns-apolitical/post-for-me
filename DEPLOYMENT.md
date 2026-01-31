# Deployment Guide for Digital Ocean App Platform

This guide walks you through deploying the Instagram Reels automation service to Digital Ocean App Platform.

## Prerequisites

- Digital Ocean account
- GitHub repository with this code
- Google Cloud Storage bucket with videos
- Buffer API access
- GCS service account JSON key

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

## Step 3: Set Up Buffer API

1. Create a Buffer account and go to [https://buffer.com/developers](https://buffer.com/developers)
2. Create a new app to get your API credentials
3. Generate an access token
4. Get your Instagram profile ID from the Buffer API

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
| `BUFFER_ACCESS_TOKEN` | Your Buffer API token | Secret |
| `BUFFER_PROFILE_ID` | Your Buffer profile ID | Secret |
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
   - Buffer API has rate limits (check their docs)

## Troubleshooting

### Common Issues

**ffmpeg not found**
- Ensure the Dockerfile installs ffmpeg correctly
- Check build logs in DO dashboard

**GCS authentication failed**
- Verify your bucket is publicly readable
- Check that bucket name is correct
- Ensure videos are uploaded to the bucket

**Buffer API errors**
- Verify your access token is valid
- Check that the profile ID is correct
- Ensure Buffer subscription supports video uploads

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

When ready to migrate to Instagram Graph API:

1. Create a Facebook App
2. Get Instagram Business Account access
3. Replace Buffer API calls with Instagram Graph API
4. Add analytics tracking
5. Implement webhook handlers for post status updates

## Support

For issues:
- Check Digital Ocean logs
- Review this documentation
- Check GCS and Buffer API documentation
