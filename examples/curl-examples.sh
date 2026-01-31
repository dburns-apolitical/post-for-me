# Example curl commands for testing the API

## Health Check
curl http://localhost:3000/health

## Valid Post Request
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Check out this amazing content! Perfect for your feed.",
    "hookText": "Watch this! 👀",
    "hashtags": ["reel", "content", "viral", "instagram", "trending"]
  }'

## Test Validation - Empty Body
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{}'

## Test Validation - Invalid Hashtag
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Test caption",
    "hookText": "Hook",
    "hashtags": ["valid", "invalid-tag!"]
  }'

## Test Validation - Caption Too Long
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d "{
    \"caption\": \"$(printf 'a%.0s' {1..2201})\",
    \"hookText\": \"Hook\",
    \"hashtags\": [\"test\"]
  }"

## Test Validation - Empty Caption
curl -X POST http://localhost:3000/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "",
    "hookText": "Hook",
    "hashtags": ["test"]
  }'

## Production Example (replace URL)
curl -X POST https://your-app.ondigitalocean.app/api/post-reel \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "Sharing some incredible moments! Follow for more ✨",
    "hookText": "Wait for it... 🔥",
    "hashtags": ["reels", "viral", "trending", "explore", "fyp"]
  }'
