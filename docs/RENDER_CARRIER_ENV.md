# Render environment variables for Carrier mode

Add these in **Render → smartwalker-backend → Environment**.  
Use the **Key** as the variable name and the **Value** as the value (copy-paste the value as-is for CARRIER_CONTACTS).

---

## CARRIER_CONTACTS (copy-paste this entire line as the value)

```
{"physical therapist":"calvintonson@gmail.com","daughter":"calvinthomasmathew@gmail.com"}
```

---

## Other variables (set these in Render; do not commit secrets)

| Key | Example / notes |
|-----|------------------|
| `ZOOM_ACCOUNT_ID` | Your Zoom Server-to-Server app account ID |
| `ZOOM_CLIENT_ID` | Your Zoom Server-to-Server app client ID |
| `ZOOM_CLIENT_SECRET` | Your Zoom Server-to-Server app client secret |
| `CARRIER_EMAIL_FROM` | `calvinthomasmathew@gmail.com` (Gmail that sends invites) |
| `CARRIER_EMAIL_APP_PASSWORD` | Gmail app password for that account |

Optional: `ZOOM_SECRET_TOKEN` if you add Zoom webhooks later.
