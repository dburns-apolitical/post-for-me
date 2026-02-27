# Setting Up Public GCS Bucket (No Authentication Required)

This guide shows you how to configure your Google Cloud Storage bucket for public access, eliminating the need for JSON key files.

## Why Public Bucket?

✅ **Pros:**
- No JSON key management
- Simpler deployment (fewer secrets)
- Faster access (no authentication overhead)
- Works anywhere without credentials

⚠️ **Cons:**
- Videos are publicly accessible via URL
- No access control or audit logs
- Anyone with URL can view/download videos

## Step-by-Step Setup

### 1. Create Your Bucket

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **Cloud Storage > Buckets**
3. Click **Create Bucket**

**Configuration:**
```
Name: instagram-reels-videos-[random-string]
  Example: instagram-reels-videos-a8f3k2
  
Location: Multi-region or your nearest region
Storage Class: Standard
Access Control: Uniform
```

### 2. Make Bucket Publicly Readable

**Option A: Via Console (Easiest)**

1. Click on your bucket name
2. Go to **Permissions** tab
3. Click **Grant Access**
4. Enter the following:
   - New principals: `allUsers`
   - Role: **Storage Object Viewer**
5. Click **Save**
6. Confirm the warning about public access

**Option B: Via gcloud CLI**

```bash
gsutil iam ch allUsers:objectViewer gs://your-bucket-name
```

### 3. Upload Videos with Secure Naming

**Important**: Use non-obvious filenames for security through obscurity.

**Bad naming:**
```
vacation-beach-2024.mp4
funny-cat-video.mp4
my-first-reel.mp4
```

**Good naming (UUIDs or random strings):**
```
f47ac10b-58cc-4372-a567-0e02b2c3d479.mp4
8k2n5m9p1q4r7s0t.mp4
a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4
```

**Upload via Console:**
1. Click on your bucket
2. Click **Upload Files**
3. Select your videos (renamed with UUIDs)

**Upload via gcloud:**
```bash
# Rename and upload
for file in *.mp4; do
  uuid=$(uuidgen)
  gsutil cp "$file" "gs://your-bucket-name/${uuid}.mp4"
done
```

### 4. Verify Public Access

Test that your videos are publicly accessible:

```bash
# Replace with your actual bucket and file name
curl -I https://storage.googleapis.com/your-bucket-name/your-video.mp4

# Should return: HTTP/2 200
```

Or open in browser:
```
https://storage.googleapis.com/your-bucket-name/your-video.mp4
```

### 5. Configure Your Application

Update your `.env` file:

```bash
GCS_PROJECT_ID=your-project-id
GCS_BUCKET_NAME=instagram-reels-videos-a8f3k2
# No GCS_KEY_FILE_PATH needed!
```

### 6. Test the Integration

```bash
# Start your server
bun run dev

# Make a test request
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Test post",
    "hookText": "Testing!",
    "hashtags": ["test"]
  }'
```

Check logs for:
```
[INFO] Found X video files in bucket
[INFO] Selected random video
[INFO] Video downloaded successfully
```

## Security Best Practices

### 1. Obscure Filenames
Always use UUIDs or random strings, never descriptive names.

### 2. Don't Share Bucket Name
Keep your bucket name private. Don't commit it to public repos.

### 3. Rotate Videos Regularly
Periodically remove old videos and upload new ones with new UUIDs.

### 4. Monitor Access (Optional)
Enable logging to track who accesses your videos:

```bash
gsutil logging set on -b gs://logging-bucket gs://your-video-bucket
```

### 5. Consider CDN
Put Cloudflare or another CDN in front for:
- Additional URL obfuscation
- DDoS protection
- Analytics

## Alternative: Signed URLs (More Secure)

If you need better security but still want to avoid managing keys in your app, consider:

1. Keep bucket private
2. Use a separate microservice to generate signed URLs
3. Your main app requests signed URLs when needed

This is more complex but provides:
- Time-limited access
- Access control
- Audit trails

## Troubleshooting

### "Failed to list bucket contents: 403"
- Bucket is not publicly readable
- Add `allUsers` with `Storage Object Viewer` role

### "Failed to list bucket contents: 404"
- Bucket name is incorrect
- Check your `GCS_BUCKET_NAME` in `.env`

### "No videos found in storage bucket"
- Upload videos to your bucket
- Ensure files have video extensions (.mp4, .mov, etc.)

### Videos won't download
- Verify videos are in bucket root (not nested folders)
- Check video file permissions are set to public

## Cost Estimate

For a bucket with public read access:

**Storage**: $0.02/GB/month
- 10 videos × 50MB = 500MB = **~$0.01/month**

**Operations**: 
- Class A (list): First 5,000/month free
- Class B (read): First 50,000/month free
- Typical usage: **$0/month**

**Network**:
- First 1GB egress/month: Free
- After: $0.12/GB
- ~100 posts/month × 50MB = 5GB = **~$0.48/month**

**Total estimated cost**: **$0.50-1.00/month**

## Migration Path

If you later want to switch back to authenticated access:

1. Remove public access from bucket
2. Update `video-selector.ts` to use `@google-cloud/storage` SDK
3. Add JSON key back to environment
4. Update deployment configs

The service is designed to make this migration easy!

---

Your bucket is now ready to use with zero authentication! 🎉
