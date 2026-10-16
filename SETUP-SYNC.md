# Turn on sync (about 10 minutes, free)

After this, your phone, laptop and any other device show the same data once you enter your passcode.
This is a private setup: nobody without the passcode can read or change your finances.

## 1. Upload to GitHub
Your repo's top level must contain:
- index.html
- style.css
- script.js
- api/finance.js   (a folder named `api` with this one file inside)

Use **Add file > Upload files**, drag in the three files and the `api` folder, then **Commit changes**.

## 2. Create a free database in Vercel
1. Open the project on vercel.com, click the **Storage** tab.
2. Choose **Upstash for Redis** (free plan), create it, and connect it to the project for all environments.
   (Check Settings > Environment Variables: you should now see `KV_REST_API_URL` and `KV_REST_API_TOKEN`.)

## 3. Choose a passcode
Settings > Environment Variables > add `FINANCE_PASSCODE` with a long passphrase only you know (Sensitive/Secret is fine).
If this project already has `PLANNER_PASSCODE`, the finance app uses that when FINANCE_PASSCODE is missing.

## 4. Redeploy
Environment variables only apply to new deployments: Deployments tab > three dots on the latest > **Redeploy**.

## 5. Use it
Open your Vercel link > **Settings & Tools > Sync** > type the passcode > **Turn on sync**.
- Device with data first: choose it and it uploads.
- A new empty device: it downloads your data.
- If both have data, you choose which to keep (they are never merged silently).
Repeat on each device.

## Good to know
- Changes upload within ~2 seconds; other devices check every 20 seconds and when you return to the tab.
- Works offline: changes are kept on the device and upload later.
- If two devices change data at the same time, you get a "Sync conflict" choice.
- Sync is not a backup: deleting something on one device deletes it everywhere. Download backups sometimes.
- Limit: about 4 MB of data (roughly 15,000+ transactions).
- Sync only works on the Vercel (https) site, not when opening index.html as a file.
