# Cycle Investor

Market-cycle comparison dashboard for crypto, tech stocks, China tech, metals, and consumer assets.

## Setup

```sh
npm install
npm run dev
```

The app runs on `http://localhost:5173`.

## Data

Price data is generated into `public/data.json` from Yahoo Finance:

```sh
npm run fetch-data
```

The GitHub Actions workflow in `.github/workflows/refresh-data.yml` refreshes this file daily and commits it when data changes.

## Build

```sh
npm run build
npm run preview
```

Vercel serves the `dist` directory and caches `/data.json` according to `vercel.json`.
