// Pre-generate static data.json by fetching from Yahoo Finance.
// Runs at build time (or via GitHub Actions on a schedule).
//
// Usage:  node scripts/fetch-data.js

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YahooFinance from 'yahoo-finance2'
import { assets, DATA_START, DATA_END } from '../src/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(__dirname, '..', 'public', 'data.json')

const yahooFinance = new YahooFinance()

// Round numbers based on magnitude (large prices need fewer decimals)
function round(n) {
  if (n == null) return null
  if (n >= 1000) return Math.round(n * 100) / 100   // 2 decimals
  if (n >= 10) return Math.round(n * 1000) / 1000   // 3 decimals
  return Math.round(n * 10000) / 10000               // 4 decimals
}

async function fetchSymbol(symbol) {
  const result = await yahooFinance.chart(symbol, {
    period1: DATA_START,
    period2: DATA_END,
    interval: '1d',
  })
  const quotes = result.quotes || []
  // Compact format: [date, high, low, close] — drop open since we don't use it
  const data = []
  for (const q of quotes) {
    if (q.close == null) continue
    data.push([
      q.date.toISOString().split('T')[0],
      round(q.high),
      round(q.low),
      round(q.close),
    ])
  }
  return data
}

async function main() {
  const result = {}
  for (const asset of assets) {
    process.stdout.write(`Fetching ${asset.name} (${asset.symbol})... `)
    try {
      result[asset.symbol] = await fetchSymbol(asset.symbol)
      console.log(`✓ ${result[asset.symbol].length} bars`)
    } catch (err) {
      console.error(`✗ ${err.message}`)
      throw err
    }
    // Small stagger
    await new Promise(r => setTimeout(r, 300))
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dataStart: DATA_START,
    dataEnd: DATA_END,
    bySymbol: result,
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
  await fs.writeFile(OUT_PATH, JSON.stringify(payload))
  const size = (await fs.stat(OUT_PATH)).size
  console.log(`\nWrote ${OUT_PATH} (${(size / 1024).toFixed(1)} KB)`)
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
