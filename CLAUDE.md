# House Hunter Repliers Prototype — Claude Code Context

## What this is
A mobile-first home search prototype for a family buyer group.
Stdlib Python server (server.py) proxies the Repliers real-estate API.
Frontend is vanilla HTML/CSS/JS (static/) using Leaflet for maps.

## Current problem to solve
The Leaflet map is rendering as a broken tile grid on mobile Chrome (Android).
The map container is sized correctly via flexbox but Leaflet is not picking up
the real pixel dimensions before it initializes.

Layout structure (body is a flex column, height:100%):
  .topbar        flex: 0 0 52px
  .filterbox     flex: 0 0 auto
  .status-bar    flex: 0 0 auto
  #viewMap       flex: 1 1 0; min-height: 0; position: relative; overflow: hidden
    #map         position: absolute; inset: 0   ← Leaflet target

A ResizeObserver calling invalidateSize is already wired up but the tiles
still split on first load on mobile.

## What we need
1. Fix the Leaflet mobile tile split definitively.
2. Map view: full remaining viewport height, pins for all 104 POC listings.
3. List view: scrollable cards with commute, ratings, financial, features.
4. Dark mode: follows system preference (prefers-color-scheme) with manual toggle.
5. Settings panel: toggle card sections on/off, saved to localStorage.
6. DO NOT use Flask, FastAPI, or any pip dependencies for the server layer.
7. DO NOT expose the Repliers API key in browser JS.

## Data
- POC data: data/poc_listings.json (104 Ontario listings, gitignored)
- Repliers sample: via /api/listings proxy (US sample, no Canadian data yet)
- Key POC fields: address, price, beds, baths, goStation, goMin, goTrain,
  goTotal, markRank, katieRank, markComments, katieComments, realtorComments,
  pit, pitNum, dueClosing, features, fit, poc.link, poc.doc, lat, lon

## Repo
/Users/markgarrett/Galleon/house-hunter-repliers-prototype
Git remote: https://github.com/GalleonAILabs/house-hunter-repliers-prototype

## Server
Running on port 8787 (python3.11 server.py)
Endpoints: /api/health, /api/listings, /api/poc-listings
Phone test tunnel: https://house-hunter-repliers-mark.loca.lt

## Constraints
- No em dashes in any output or comments
- No Flask/FastAPI/pip deps
- API key stays server-side only
- data/ folder is gitignored, never commit poc_listings.json
