# Personal Finance Tracker

A working finance app in three files: `index.html`, `style.css`, `script.js`. No build step, no server.

## Run it
- Quick try: double-click `index.html`.
- Online: upload the 3 files (plus the `api` folder if you want sync) to a GitHub repo, then import the repo in Vercel (Framework: Other, no build command). Done.

## Where your data is stored (important)
Data is saved in **your browser (localStorage)** on the device you use. There is no cloud account and no server, so:
- Phone and laptop do NOT share data. Move it with Settings > Backup & Restore (download on one, restore on the other).
- Clearing browser/site data deletes your records. Download a backup now and then.
- Opening `index.html` as a file and opening the Vercel link are two separate storages.
- To sync across devices, follow SETUP-SYNC.md (free Upstash database + passcode on Vercel), then Settings > Sync.

## What's inside
- Records: Daily, Calendar, Monthly, Summary (filters), Description (grouped, searchable).
- Statistics: 8 charts (bar, line, doughnut), Day/Week/Month/Year/Custom, hover or tap for exact values, "View exact values" tables.
- Accounts: groups, add/edit/archive/delete (restorable), per-account history with running balance, transfers with fees, assets, liabilities, net worth.
- Settings & Tools: calculators (standard, scientific, units, currency, percentage), transaction settings, 3 themes, help, currency settings, backup/restore, CSV import/export, reports.

## Money rules used
Amounts are stored as whole centavos (no rounding errors).
Balance = opening + income - expenses + transfers in - transfers out. Net cash flow = income - expenses.
Transfers are never income/expense. Fees are separate expenses. Credit-card purchases are expenses; card payments are transfers into the card (liability settlement).

## Limits
- Exchange rates are manual (or fetched from open.er-api.com if online). Not live market rates. The online fetch could not be tested from the build environment.
- Transfers only between accounts of the same currency.
