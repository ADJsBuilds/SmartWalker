# HeyGen Avatar Selection Guide for Physical Therapist Coach

## Quick Recommendation

For a **physical therapist coach** application, I recommend selecting an avatar with these characteristics:

### Ideal Avatar Profile
- **Appearance**: Professional, approachable, trustworthy
- **Age**: 30-50 years (conveys experience without being too young or too old)
- **Gender**: Consider diverse options - both male and female avatars can work well
- **Attire**: Business casual or professional medical attire
- **Demeanor**: Warm, encouraging, but authoritative
- **Speech**: Clear, articulate, with good pacing for instructions

## How to Find Your Avatar

### Step 1: Access HeyGen Dashboard
1. Go to https://app.heygen.com
2. Log into your account
3. Navigate to **"Avatars"** in the sidebar

### Step 2: Search/Filter Options
In the HeyGen dashboard, try these search terms:
- `professional`
- `coach`
- `therapist`
- `healthcare`
- `medical`
- `instructor`
- `fitness`
- `wellness`

### Step 3: Preview Avatars
For each candidate avatar:
1. **Watch the demo video** - Check speech clarity and naturalness
2. **Assess appearance** - Does it look professional and approachable?
3. **Check expressions** - Does it convey warmth and encouragement?
4. **Test speech** - Is the voice clear and easy to understand?

### Step 4: Get the Avatar ID
Once you've selected an avatar:
1. Click on the avatar to open details
2. Look for **"Avatar ID"** in the details panel
3. It will look something like: `avatar_abc123xyz` or `abc123xyz-def456`
4. Copy this ID

### Step 5: Configure
Add the Avatar ID to your environment variables:
```bash
HEYGEN_AVATAR_ID=your_copied_avatar_id_here
```

## Specific Recommendations by Type

### Option 1: Professional Female Coach (Recommended)
**Why**: Often perceived as more approachable in healthcare settings
- Look for: Professional business attire, warm smile, clear speech
- Good for: Building trust with patients, encouraging tone

### Option 2: Professional Male Coach
**Why**: Can convey authority and expertise
- Look for: Professional appearance, confident demeanor
- Good for: Patients who prefer male authority figures

### Option 3: Medical Professional Avatar
**Why**: Directly relates to healthcare context
- Look for: Medical attire or scrubs (if available)
- Good for: Immediate recognition of healthcare context

### Option 4: Fitness/Wellness Coach
**Why**: Relates to physical activity and movement
- Look for: Athletic or casual professional attire
- Good for: Exercise and movement instruction context

## Testing Your Selection

After setting `HEYGEN_AVATAR_ID`, test it:

```bash
curl -X POST http://localhost:8000/api/heygen/speak \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! I am your physical therapy coach. Let us begin your walking exercise. Remember to keep a steady pace and maintain good posture.",
    "residentId": "test"
  }'
```

**What to check:**
- ✅ Does the avatar look professional?
- ✅ Is the speech clear and natural?
- ✅ Does it convey the right tone (encouraging, professional)?
- ✅ Are the facial expressions appropriate?

## Alternative: List Avatars via API

You can also try to fetch avatars programmatically (if HeyGen API supports it):

```bash
# Make sure HEYGEN_API_KEY is set first
curl -X GET http://localhost:8000/api/heygen/avatars
```

This endpoint will attempt to fetch available avatars from HeyGen's API.

## Default Recommendation

If you're unsure, I recommend:
1. **Start with a professional female avatar** (often works best for healthcare coaching)
2. **Age range: 35-45 years** (experienced but not too old)
3. **Professional business attire** (conveys expertise)
4. **Clear, articulate voice** (important for instructions)

You can always change the `HEYGEN_AVATAR_ID` later if you want to try a different avatar!

## Need Help?

If you're having trouble finding the right avatar:
1. Check HeyGen's documentation: https://docs.heygen.com
2. Contact HeyGen support for avatar recommendations
3. Try the `/api/heygen/avatars` endpoint to see if it lists available options
4. Test multiple avatars and see which works best for your use case

