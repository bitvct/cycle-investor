import { assets } from './config.js'
import { fetchAllPrices, processAsset } from './data.js'
import { renderLanes } from './chart.js'

let cachedResults = null
let currentCycle = 'bull'

async function init() {
  const app = document.getElementById('app')
  app.innerHTML = '<div class="loading">Loading data from Yahoo Finance...</div>'

  try {
    const fetched = await fetchAllPrices(assets)
    cachedResults = fetched.map(({ asset, raw }) => processAsset(asset, raw))

    renderLanes(cachedResults, currentCycle)
  } catch (err) {
    console.error(err)
    app.innerHTML = `<div class="loading" style="color:#ef5350">
      Error loading data: ${err.message}<br>
      <span style="font-size:12px;color:#666;margin-top:8px;display:block">
        Make sure the dev server is running (npm run dev) for the Yahoo Finance proxy to work.
      </span>
    </div>`
  }
}

// Tab switching — preserve scroll position
function switchCycle(cycle) {
  if (!cachedResults || cycle === currentCycle) return
  const scrollY = window.scrollY
  currentCycle = cycle
  document.querySelectorAll('.cycle-tab').forEach(t => t.classList.remove('active'))
  document.querySelector(`.cycle-tab[data-cycle="${cycle}"]`)?.classList.add('active')
  renderLanes(cachedResults, currentCycle)
  // Restore scroll after re-render (next frame so layout settles)
  requestAnimationFrame(() => window.scrollTo(0, scrollY))
}
window.switchCycle = switchCycle

init()
