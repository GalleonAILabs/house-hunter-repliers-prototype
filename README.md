# House Hunter Repliers Prototype

Working prototype for moving House Hunter off scraping and onto the Repliers API.

## What this proves

- Repliers free sample account works.
- API key is kept server-side, not exposed to the browser.
- Listings are fetched from Repliers and normalized into House Hunter-shaped cards.
- The UI shows map pins, listing cards, filters, sorting, images, fit-score tags, listing source proof, agent and brokerage data.
- The data model notes capture the alpha direction: Anees as first realtor-team workspace, dynamic buyer groups, dynamic people filters, and per-person feedback attribution.

## Run locally

```bash
cd /Users/markgarrett/Galleon/house-hunter-repliers-prototype
python3.11 server.py
open http://127.0.0.1:8787
```

The `.env` file contains the free Repliers sample API key. Do not commit `.env`.

## Files

- `server.py`, stdlib-only Python proxy/server.
- `static/index.html`, browser UI shell.
- `static/app.js`, map/cards/filter logic.
- `static/styles.css`, responsive styling.
- `DATA_MODEL_NOTES.md`, product/data-model decisions for the alpha.
- `.env.example`, environment template.

## Current limits

- Repliers free tier returns sample data, mostly US listings. This is enough to prove schema and workflow, not Ontario search quality.
- GO commute, Ontario zones, and buyer-specific consensus are documented but not implemented in this prototype yet.
- For alpha, use Postgres/PostGIS as source of truth and Repliers as the external feed.

## Product direction

Build around Anees as the first realtor-team workspace:

```text
Organization / Workspace
  Realtor Team
    Realtor Team Members
    Buyer Groups
      Buyer Group Members
      Preferences
      Listing feedback
      Notes
      Consensus
```

Buyer and realtor-team filters must be dynamic. If the group has two buyers, show two rows. If it has four, show four. Actions are attributed to the selected active member context, not a generic account.
