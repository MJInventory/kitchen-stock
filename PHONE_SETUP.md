# Phone Frontend Setup

This folder contains the simple online phone frontend for kitchen users.

## What Users Get

- A phone-friendly request form
- Recent request list
- Android and iPhone home-screen install support
- No Airtable token in the browser
- Server-side cache to reduce Airtable API calls

## Local Test

Run from this folder:

```powershell
$env:AIRTABLE_TOKEN="pat_your_token_here"
$env:PORT="3000"
node server.js
```

Open:

```text
http://localhost:3000
```

## Online Deployment

Use any Node.js host that supports environment variables. Render and Koyeb both document Node.js deployments and environment variables.

Recommended settings:

```text
Root directory: kitchen-web
Build command: npm install
Start command: npm start
Environment variable: AIRTABLE_TOKEN=your_new_airtable_token
Environment variable: ITEM_CACHE_MS=600000
Environment variable: REQUEST_CACHE_MS=20000
```

After deployment, share the provided HTTPS URL with kitchen staff.

## Android

1. Open the app URL in Chrome.
2. Tap the menu.
3. Tap Add to Home screen.

## iPhone

1. Open the app URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.

## Token Safety

Rotate the Airtable token that was pasted in chat. Put the new token only in the host's environment variables and in the Access frontend as needed.

## Useful Check

Open this URL after deployment:

```text
/api/health
```

It shows whether the server is running and whether cache hits are reducing Airtable calls.
