# Self-Hosting Guide

This guide walks you through running your own copy of **post-for-me** (the backend) and **admin-dashboard** (the web UI), from zero, assuming no developer experience.

Posting is handled by [Upload-Post](https://upload-post.com), which connects to Instagram, TikTok, YouTube and others on your behalf. You do **not** need to deal with Meta's Developer portal, Graph API tokens, or App Review.

**Time to set up:** roughly 1–2 hours, most of it waiting for accounts to verify.

---

## What you'll have at the end

- A backend server running on Digital Ocean that processes videos and posts them.
- A web dashboard Netlify where you sign in and see stats.
- Videos hosted in your own Google Cloud Storage bucket.
- A Postgres database hosted on Neon.
- One or more social accounts (Instagram, TikTok, etc.) connected through Upload-Post.

## What it will cost you per month

| Service | Tier | Cost |
|---|---|---|
| Digital Ocean App Platform | basic-xxs | ~$10/month |
| Neon Postgres | Free | $0 |
| Netlify (dashboard) | Free / Hobby | $0 |
| Google Cloud Storage | Pay-as-you-go | ~$0.02/GB stored, pennies if you have a few GB of videos |
| Upload-Post | Free tier | $0 — capped at **2 social accounts** and **10 posts/month** |
| Upload-Post | Paid | **$16/month** — unlimited posts and 5 social accounts |
| Anthropic API (Claude) | Pay-as-you-go | A few cents per week for the analysis job |

**Expect $10–$30/month total** depending on Upload-Post tier and how many videos you store.

---

# Part 1 — Create the accounts you need

Do these first. Several of them email-verify, so getting them out of the way upfront avoids waiting later. You'll come back to copy a value from each.

### 1.1 GitHub — [github.com](https://github.com)
You'll use GitHub to host your own copy of the code. Sign up, then **fork** both repositories to your account (click the **Fork** button in the top right of each):

- The backend repo (post-for-me)
- The dashboard repo (admin-dashboard)

### 1.2 Google Cloud — [console.cloud.google.com](https://console.cloud.google.com)
This is where your source videos live.

1. Sign up. Google requires a credit card, but new accounts get $300 free credit.
2. Create a new **Project**. Note the **Project ID** (looks like `my-project-12345`) — you'll paste this later.
3. In the left menu, go to **Cloud Storage → Buckets** and click **Create**.
4. Pick a name (e.g. `my-reels-videos`), region near you, and leave defaults.
5. After creation, open the bucket → **Permissions** tab → **Grant Access**:
   - New principals: type `allUsers`
   - Role: **Storage Object Viewer**
   - Save. (When it warns you the bucket is public — yes, that's intentional. Use random or UUID filenames so people can't guess the URLs.)
6. Upload a few MP4 video files into the bucket.

Write down: `GCS_PROJECT_ID` and `GCS_BUCKET_NAME`.

### 1.3 Neon — [neon.tech](https://neon.tech)
Neon gives you a free Postgres database and an email-OTP login system. You need both.

1. Sign up.
2. Create a **Project** (default settings are fine — pick the EU region if you're in Europe).
3. After creation you'll see a **connection string** like `postgresql://user:password@host/database?sslmode=require`. Copy it.
4. In the left menu, go to **Auth** → enable it → in the Auth settings, find the **Auth URL** (looks like `https://ep-something.neonauth.eu-west-2.aws.neon.tech/neondb/auth`). Copy it.

Write down: `DATABASE_URL` (the connection string) and `NEON_AUTH_URL` (the auth URL).

### 1.4 Upload-Post — [upload-post.com](https://upload-post.com)
This is what actually posts to Instagram, TikTok, etc.

1. Sign up.
2. In their dashboard, generate an **API key**. Copy it.
3. Note your **username** in their system (or the user identifier shown next to your API key) — Upload-Post calls this the `user`.
4. **Don't connect any social accounts yet** — we'll do that in Part 4 once everything is deployed.

Pricing reminder:
- **Free**: 2 social accounts, 10 posts/month total.
- **Paid ($16/month)**: 5 social accounts, unlimited posts.

Write down: `UPLOAD_POST_API_KEY` and `UPLOAD_POST_USER`.

### 1.5 Anthropic — [console.anthropic.com](https://console.anthropic.com)
The backend runs a weekly job that uses Claude to analyse which of your posts did well.

1. Sign up.
2. Add a small amount of credit ($5 is plenty for months of use).
3. Go to **API Keys** → create one. Copy it.

Write down: `ANTHROPIC_API_KEY`.

### 1.6 Digital Ocean — [cloud.digitalocean.com](https://cloud.digitalocean.com)
This will host the backend server. Sign up — they often have a $200 free-credit promo.

No values to copy yet — you'll come back here in Part 2.

### 1.7 Netlify — [netlify.com](https://netlify.com)
This will host the dashboard. Sign up using your GitHub account so it can read your forked repos.

No values to copy yet — you'll come back in Part 3.

---

# Part 2 — Deploy the backend

This puts the server online. The server is what receives "post this video" requests and talks to Upload-Post.

1. Go to [Digital Ocean App Platform](https://cloud.digitalocean.com/apps) → **Create App**.
2. **Source:** GitHub. Authorise Digital Ocean to read your account if prompted.
3. Pick your fork of the **post-for-me** repo, branch `main`.
4. Digital Ocean will detect the `Dockerfile` — leave the defaults.
5. On the **Environment Variables** screen, add these. Click the lock icon to mark sensitive ones as **encrypted**:

   | Variable | Value | Encrypted? |
   |---|---|---|
   | `PORT` | `3000` | No |
   | `NODE_ENV` | `production` | No |
   | `TEMP_DIR` | `/app/tmp` | No |
   | `GCS_PROJECT_ID` | (from step 1.2) | Yes |
   | `GCS_BUCKET_NAME` | (from step 1.2) | Yes |
   | `DATABASE_URL` | (from step 1.3) | Yes |
   | `NEON_AUTH_URL` | (from step 1.3) | Yes |
   | `UPLOAD_POST_API_KEY` | (from step 1.4) | Yes |
   | `UPLOAD_POST_USER` | (from step 1.4) | Yes |
   | `ANTHROPIC_API_KEY` | (from step 1.5) | Yes |
   | `DASHBOARD_PASSWORD` | Make up a strong password | Yes |

   You don't need the `INSTAGRAM_*` variables — Upload-Post handles posting.

6. Pick the **basic-xxs** instance ($5/month). Click **Create Resources**.
7. Wait 3–5 minutes for the first deploy. You'll get a public URL like `https://post-for-me-abcde.ondigitalocean.app`. **Copy this URL** — the dashboard needs it.
8. Verify it's alive: open `https://your-url.ondigitalocean.app/health` in a browser. You should see an OK response.

---

# Part 3 — Deploy the dashboard

This puts the UI online so you can sign in and see stats.

1. Go to [netlify.com/](https://netlify.com/).
2. Import your fork of **admin-dashboard**.
3. Netlify auto-detects Vite — leave the build settings as-is.
4. Expand **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE_URL` | The Digital Ocean URL from Part 2 step 7 |
   | `VITE_NEON_AUTH_URL` | The Neon Auth URL from step 1.3 |

5. Click **Deploy**. Wait ~1 minute.
6. Netlify gives you a URL like `https://admin-dashboard.netlify.app`. Open it.
7. You'll see an email sign-in screen. Enter your email → receive a one-time code → sign in.

If the dashboard shows "Failed to fetch" anywhere, the `VITE_API_BASE_URL` is probably wrong or the backend isn't reachable. Double-check Part 2 step 8.

---

# Part 4 — Connect your first social account

The backend is live but it doesn't know which Instagram/TikTok/etc. account to post to yet. That's done through Upload-Post.

1. Log into [upload-post.com](https://upload-post.com).
2. Go to **Connected Accounts** (or equivalent) and click **Connect Instagram** (or TikTok, YouTube, etc.).
3. Follow their OAuth flow — Upload-Post will redirect you to the social network's login, you approve, you come back.
4. Once connected, the account is available to post to via the API. No further config in your dashboard is required for posting — the backend uses your `UPLOAD_POST_API_KEY` to reach them.

Repeat for each social account, up to your Upload-Post plan limit.

---

# Part 5 — Test a post

The simplest test is to fire a single post via curl (you can also build a "Post now" button in the dashboard later).

```bash
curl -X POST https://your-do-url.ondigitalocean.app/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Testing my self-hosted setup",
    "hookText": "Watch this 👀",
    "hashtags": ["test", "selfhost"]
  }'
```

If it works, the video appears on your connected social account within a minute or two and shows up in your dashboard's recent-posts list shortly after.

---

# Ongoing — what to watch out for

- **Upload-Post free-tier cap.** 10 posts/month resets monthly. If you'll post more than that, upgrade to $16/month before you hit the limit.
- **Anthropic credit.** The Sunday-night analysis job uses a few cents of Claude credit. If your balance hits zero, the analysis stops but posting keeps working.
- **GCS storage cost.** Delete videos you no longer need. You're charged for what's stored.
- **Digital Ocean cost.** If the server feels slow when processing video, bump the instance size up one notch from the DO dashboard.

# Troubleshooting

**Dashboard sign-in code never arrives.** Check Neon Auth is enabled in your Neon project, and the email address you're using isn't in spam. Confirm `VITE_NEON_AUTH_URL` matches the URL shown in Neon's Auth settings exactly.

**Dashboard loads but shows no data.** Either the backend isn't reachable (open `https://your-do-url/health` directly) or `VITE_API_BASE_URL` is set wrong in Netlify. Fix it in Netlify's project settings, then redeploy.

**Posts never appear on social.** Check the backend logs in Digital Ocean → your app → **Runtime Logs**. Most failures show up there. Common causes: Upload-Post API key wrong, the connected social account got disconnected on Upload-Post's side, or you hit the 10-posts-per-month free cap.

**Backend won't start.** Check **Build Logs** in Digital Ocean. The most common cause is a typo in an environment variable name. Variables are case-sensitive.

**Something else.** Check Digital Ocean's runtime logs first — they show the exact error in most cases.
