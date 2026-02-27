# Setup Guide

Complete guide to setting up the Instagram Reels automation service from scratch.

## Prerequisites

Before you begin, ensure you have:

- [ ] Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- [ ] ffmpeg installed (`brew install ffmpeg` on macOS)
- [ ] Google Cloud account with a project
- [ ] Instagram Business or Creator account
- [ ] Meta Developer account with an app
- [ ] Digital Ocean account (for deployment)
- [ ] Git and GitHub account

## Step 1: Local Development Setup

### 1.1 Clone and Install

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/post-for-me.git
cd post-for-me

# Install dependencies
bun install
```

### 1.2 Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your actual credentials
nano .env
```

Required environment variables:
```bash
PORT=3000
NODE_ENV=development

# Google Cloud Storage (Public Bucket)
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=your-video-bucket-name
# Note: Bucket must be publicly readable AND writable for edited videos

# Instagram Graph API
INSTAGRAM_ACCESS_TOKEN=your-instagram-access-token
INSTAGRAM_USER_ID=your-instagram-user-id

# Temp directory
TEMP_DIR=./tmp
```

### 1.3 Run Tests

```bash
# Run all tests
bun test

# Expected output: All tests pass
```

### 1.4 Start Development Server

```bash
# Start with hot reload
bun run dev

# Server should start on http://localhost:3000
```

## Step 2: Google Cloud Storage Setup

### 2.1 Create GCS Project and Bucket

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing one
3. Enable Cloud Storage API
4. Create a new bucket:
   - Name: `my-instagram-videos` (or your choice)
   - Location: Multi-region (or nearest region)
   - Storage class: Standard
   - Access control: Uniform

### 2.2 Upload Videos

1. Navigate to your bucket
2. Upload video files (MP4 format recommended)
3. Recommended specs:
   - Aspect ratio: 9:16 (1080x1920)
   - Duration: 3-60 seconds
   - Format: H.264, AAC audio
   - Frame rate: 30fps

### 2.3 Make Bucket Publicly Readable

**Important**: The service now uses public bucket access (no JSON key required).

1. Go to your bucket in Google Cloud Console
2. Click the **Permissions** tab
3. Click **Grant Access**
4. New principals: `allUsers`
5. Role: **Storage Object Viewer**
6. Click **Save**

**Security Note**: Your videos will be publicly accessible via URL. Use non-obvious filenames (UUIDs) for better security.

### 2.4 Test GCS Connection

```bash
# Start the server
bun run dev

# In another terminal, test listing videos
# This should work once the service is integrated
```

## Step 3: Instagram Graph API Setup

### 3.1 Prerequisites

1. **Instagram Business or Creator Account**: Convert your personal Instagram account to a Business or Creator account
2. **Facebook Page**: Your Instagram account must be connected to a Facebook Page

### 3.2 Create Meta App

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app (select "Business" type)
3. Add the "Instagram Graph API" product to your app
4. Configure Instagram Business Login or Facebook Login

### 3.3 Get Access Token

1. In the Meta App Dashboard, go to Tools > Graph API Explorer
2. Select your app
3. Add the following permissions:
   - `instagram_content_publish`
   - `instagram_basic`
4. Generate an access token
5. For production, convert to a long-lived token (valid for 60 days)

To get a long-lived token:
```bash
curl -X GET "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN"
```

### 3.4 Get Instagram User ID

Get your Instagram Business Account ID:

```bash
curl -X GET "https://graph.facebook.com/v18.0/me/accounts?access_token=YOUR_ACCESS_TOKEN"
```

Then get the Instagram account ID connected to your page:

```bash
curl -X GET "https://graph.facebook.com/v18.0/PAGE_ID?fields=instagram_business_account&access_token=YOUR_ACCESS_TOKEN"
```

The `instagram_business_account.id` is your Instagram User ID.

### 3.5 Update Environment Variables

Add to your `.env` file:
```bash
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=your-video-bucket-name
INSTAGRAM_ACCESS_TOKEN=your_long_lived_token_here
INSTAGRAM_USER_ID=your_instagram_user_id_here
```

## Step 4: Test End-to-End

### 4.1 Verify Setup

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected: {"status":"ok","timestamp":"..."}
```

### 4.2 Test with Mock Data

If you don't have real credentials yet:

```bash
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Test caption",
    "hookText": "Test hook",
    "hashtags": ["test"]
  }'

# Expected: Error response (credentials not valid)
# This is OK for testing validation
```

### 4.3 Test with Real Credentials

Once you have all credentials configured:

```bash
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "My first automated Instagram Reel! 🚀",
    "hookText": "Check this out!",
    "hashtags": ["automation", "instagram", "reels"]
  }'

# Expected: {"success":true,"postId":"...","videoUsed":"gs://..."}
```

## Step 5: Deploy to Digital Ocean

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment instructions.

Quick steps:

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/post-for-me.git
   git push -u origin main
   ```

2. **Create Digital Ocean App**
   - Go to [DO App Platform](https://cloud.digitalocean.com/apps)
   - Connect your GitHub repo
   - Configure environment variables
   - Deploy!

3. **Configure Secrets**
   - Add all environment variables as encrypted secrets
   - For GCS key, base64 encode and add as `GCS_KEY_BASE64`

4. **Test Production**
   ```bash
   curl https://your-app.ondigitalocean.app/health
   ```

## Troubleshooting

### Common Issues

#### "bun: command not found"
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Reload shell
exec $SHELL
```

#### "ffmpeg: command not found"
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install ffmpeg
```

#### GCS Authentication Errors
- Verify bucket is publicly readable (see Step 2.3)
- Check bucket name is correct
- Ensure videos are in the bucket root or accessible paths

#### Instagram API Errors
- Verify access token is valid (not expired - tokens last 60 days)
- Ensure your Instagram account is a Business or Creator account
- Check that the User ID matches your Instagram Business Account ID
- Verify your app has `instagram_content_publish` permission

#### Tests Failing
```bash
# Clean install
rm -rf node_modules bun.lockb
bun install

# Run tests again
bun test
```

### Getting Help

1. Check the logs:
   ```bash
   # Local
   Check console output
   
   # Docker
   docker logs post-for-me-test
   
   # Digital Ocean
   View in App Platform dashboard
   ```

2. Common log messages:
   - "Failed to list videos from storage" → GCS issue
   - "Failed to create media container on Instagram" → Instagram API issue
   - "Failed to upload edited video to storage" → GCS upload permission issue
   - "Error editing video" → ffmpeg issue

## Next Steps

After successful setup:

1. **Automate Posting**: Set up a cron job or scheduler to call the API
2. **Monitor**: Set up logging and monitoring (DataDog, LogDNA, etc.)
3. **Scale**: Increase instance size if needed
4. **Analytics**: Use Instagram Graph API for insights and analytics
5. **Enhance**: Add features like scheduled posts, multiple text styles, etc.

## Security Checklist

- [ ] `.env` file is in `.gitignore`
- [ ] GCS bucket has appropriate access controls
- [ ] Instagram access token is encrypted in DO
- [ ] API endpoint has rate limiting (optional but recommended)
- [ ] Secrets are rotated regularly (Instagram tokens expire every 60 days)

## Development Workflow

```bash
# Daily workflow
1. git pull                      # Get latest changes
2. bun install                   # Update dependencies if needed
3. bun run dev                   # Start dev server
4. # Make changes
5. bun test                      # Run tests
6. git add .                     # Stage changes
7. git commit -m "Description"   # Commit
8. git push                      # Push (auto-deploys if configured)
```

Congratulations! Your Instagram Reels automation service is ready to use! 🎉
