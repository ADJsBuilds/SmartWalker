# HeyGen Avatar Integration Setup Guide

## Overview

The HeyGen integration has been refactored to properly support avatar video generation with better error handling, logging, and configuration options.

## Environment Variables

Add these to your `.env` file or Render environment variables:

### Required
```
HEYGEN_API_KEY=your_api_key_here
HEYGEN_BASE_URL=https://api.heygen.com/v1/video/generate
HEYGEN_AVATAR_ID=your_avatar_id_here
```

### Optional
```
HEYGEN_VOICE_ID=optional_voice_id  # If not set, uses avatar's default voice
HEYGEN_MODE=video  # 'video' for video generation, 'streaming' for real-time
```

## API Endpoints

### Video Generation Endpoints

**HeyGen uses different endpoints for different operations:**

1. **Video Generation** (recommended for this use case):
   ```
   HEYGEN_BASE_URL=https://api.heygen.com/v1/video/generate
   ```

2. **Streaming** (for real-time):
   ```
   HEYGEN_BASE_URL=https://api.heygen.com/v1/streaming.new
   ```

## Getting Your Avatar ID

> **📋 Need help choosing an avatar?** See [AVATAR_RECOMMENDATIONS.md](./AVATAR_RECOMMENDATIONS.md) for detailed guidance on selecting the best avatar for a physical therapist coach.

### Method 1: HeyGen Dashboard (Recommended)
1. Log into your HeyGen account at https://app.heygen.com
2. Navigate to **Avatars** section in the sidebar
3. Browse available avatars
4. Click on an avatar to view details
5. Copy the **Avatar ID** from the avatar details page or URL
6. Set it as `HEYGEN_AVATAR_ID` in your environment

### Method 2: API Endpoint
You can also try fetching avatars programmatically:
```bash
curl -X GET http://localhost:8000/api/heygen/avatars \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Recommended Avatar for Physical Therapist Coach

**Best Characteristics:**
- ✅ **Professional appearance** - Business casual or medical attire
- ✅ **Warm, approachable demeanor** - Friendly facial expressions
- ✅ **Clear speech** - Good articulation for instructions
- ✅ **Age range: 30-50** - Conveys experience and trustworthiness
- ✅ **Diverse representation** - Consider your patient demographics

**Suggested Avatar Types:**
- Professional female avatars (often perceived as more approachable in healthcare)
- Business professional avatars (convey expertise)
- Medical/healthcare themed avatars (if available)
- Coach/instructor avatars (fitness/wellness context)

**To Find the Right Avatar:**
1. In HeyGen dashboard, use search/filter for: `professional`, `coach`, `therapist`, `healthcare`, `medical`, `instructor`
2. Preview each avatar's speech demo
3. Look for avatars with:
   - Clear, articulate speech
   - Professional appearance
   - Warm, encouraging expressions
   - Natural movement and gestures

**Example Avatar IDs** (these are examples - use actual IDs from your account):
- Professional female coach: Look for IDs like `avatar_xxx_professional_female`
- Medical professional: Look for IDs like `avatar_xxx_medical_professional`
- Business coach: Look for IDs like `avatar_xxx_business_coach`

## API Payload Format

The refactored service now sends the correct payload format:

```json
{
  "avatar_id": "your_avatar_id",
  "text": "Text to speak",
  "voice_id": "optional_voice_id"
}
```

## Response Format

### Success Response
```json
{
  "mode": "heygen",
  "text": "Your text",
  "video_url": "https://...",
  "url": "https://...",
  "raw": { /* full HeyGen API response */ }
}
```

### Fallback Response
```json
{
  "mode": "fallback",
  "text": "Your text",
  "error": "Error message",
  "raw": {}
}
```

## Usage

### Backend Endpoint

```bash
POST /api/heygen/speak
Content-Type: application/json

{
  "text": "Hello, this is a test",
  "residentId": "r1",
  "voiceId": "optional_voice_override"
}
```

### Frontend Usage

The frontend automatically extracts the `video_url` from the response and displays it in a `<video>` element.

## Error Handling

The integration now includes:
- ✅ Proper error logging
- ✅ Graceful fallback to browser TTS
- ✅ Clear error messages
- ✅ Retry logic (3 attempts with 1s delay)

## Troubleshooting

### "HeyGen not configured" error
- Check that `HEYGEN_API_KEY`, `HEYGEN_BASE_URL`, and `HEYGEN_AVATAR_ID` are all set

### "No video URL in response"
- Check HeyGen API response format
- Verify your API key has proper permissions
- Check that the avatar_id is valid

### HTTP 401/403 errors
- Verify your `HEYGEN_API_KEY` is correct
- Check API key permissions in HeyGen dashboard

### HTTP 404 errors
- Verify `HEYGEN_BASE_URL` is correct
- Check HeyGen API documentation for current endpoints

## Logging

All HeyGen API calls are now logged with:
- Request details (endpoint, payload)
- Response status
- Extracted video URLs
- Error details

Check your application logs to debug issues.

## Testing

Test the integration:

```bash
curl -X POST http://localhost:8000/api/heygen/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is a test", "residentId": "test"}'
```

Expected response:
```json
{
  "mode": "heygen",
  "text": "Hello, this is a test",
  "video_url": "https://...",
  "url": "https://...",
  "raw": {...}
}
```

