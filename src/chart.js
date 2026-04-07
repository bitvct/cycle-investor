import * as echarts from 'echarts'
import Sortable from 'sortablejs'

const ORDER_STORAGE_KEY = 'cycle-investor-order'

function loadSavedOrder() {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveOrder(names) {
  try { localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(names)) } catch {}
}

/**
 * Render all swim lane charts into the #app container.
 * Returns array of chart instances for cleanup.
 */
export function renderLanes(processedAssets, cycleMode = 'bull') {
  const app = document.getElementById('app')

  // Apply saved order if any
  const savedOrder = loadSavedOrder()
  if (savedOrder && savedOrder.length) {
    processedAssets = [...processedAssets].sort((a, b) => {
      const ai = savedOrder.indexOf(a.name)
      const bi = savedOrder.indexOf(b.name)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  // Keep original order (grouped by category)
  const sorted = processedAssets

  // All unique dates across assets for shared x-axis
  const allDatesSet = new Set()
  for (const a of sorted) {
    for (const d of a.data) allDatesSet.add(d.date)
  }
  const allDates = [...allDatesSet].sort()

  // Build date→index map for each asset
  const assetMaps = sorted.map(a => {
    const map = new Map()
    for (const d of a.data) map.set(d.date, d)
    return map
  })

  // Build DOM
  app.innerHTML = `
    <div class="lanes" id="lanes"></div>
  `

  const lanesEl = document.getElementById('lanes')
  const charts = []

  // Check if asset should be excluded from a cycle
  // Excluded if: no data for that cycle, OR the cycle duration is too short (< 180 days, e.g. just IPO'd)
  function isExcluded(asset, mode) {
    const minDays = 180
    if (mode === 'prevBull') {
      if (!asset.prevBottomDate || !asset.prevTopDate) return true
      const days = (new Date(asset.prevTopDate) - new Date(asset.prevBottomDate)) / (1000*60*60*24)
      return days < minDays
    }
    if (mode === 'prevBear') {
      if (!asset.prevTopDate) return true
      const days = (new Date(asset.bottomDate) - new Date(asset.prevTopDate)) / (1000*60*60*24)
      return days < minDays
    }
    return false
  }

  sorted.forEach((asset, idx) => {
    const map = assetMaps[idx]
    const bottomTime = new Date(asset.bottomDate).getTime()
    const topTime = asset.topDate ? new Date(asset.topDate).getTime() : Date.now()

    // Check if this asset should be excluded from the current cycle
    const excluded = isExcluded(asset, cycleMode)

    const formatDate = (d) => {
      if (!d) return '?'
      const [y, m, dd] = d.split('-')
      return `${m}/${dd}/${y.slice(2)}`
    }

    // Calculate days and label depending on cycle mode
    const bottomMs = new Date(asset.bottomDate).getTime()
    const topMs = asset.topDate ? new Date(asset.topDate).getTime() : Date.now()

    let gainText, daysText, gainColor
    if (excluded) {
      gainText = 'N/A'
      daysText = 'not listed'
      gainColor = '#555'
    } else if (cycleMode === 'prevBull') {
      const pbMs = asset.prevBottomDate ? new Date(asset.prevBottomDate).getTime() : 0
      const ptMs = asset.prevTopDate ? new Date(asset.prevTopDate).getTime() : 0
      const days = ptMs && pbMs ? Math.round((ptMs - pbMs) / (1000 * 60 * 60 * 24)) : 0
      gainText = `+${(asset.prevBullGain ?? 0).toFixed(0)}%`
      daysText = `${days} days`
      gainColor = asset.color
    } else if (cycleMode === 'bull') {
      const days = Math.round((topMs - bottomMs) / (1000 * 60 * 60 * 24))
      gainText = `+${(asset.topPct ?? 0).toFixed(0)}%`
      daysText = `${days} days`
      gainColor = asset.color
    } else if (cycleMode === 'bear') {
      const days = Math.round((Date.now() - topMs) / (1000 * 60 * 60 * 24))
      gainText = `${(asset.currentDrawdown ?? 0).toFixed(0)}%`
      daysText = `${days} days`
      gainColor = '#ef5350'
    } else {
      // prevBear
      const prevTopMs = asset.prevTopDate ? new Date(asset.prevTopDate).getTime() : bottomMs
      const days = Math.round((bottomMs - prevTopMs) / (1000 * 60 * 60 * 24))
      gainText = `${(asset.prevBearDrawdown ?? 0).toFixed(0)}%`
      daysText = `${days} days`
      gainColor = '#ef5350'
    }

    // Lane element
    const lane = document.createElement('div')
    lane.className = 'lane'
    lane.dataset.assetName = asset.name
    lane.innerHTML = `
      <div class="lane-handle" title="Drag to reorder">
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="2" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
          <circle cx="2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/>
          <circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/>
        </svg>
      </div>
      <div class="lane-label">
        <div class="name" style="color:${asset.color}">${asset.name}</div>
        <div class="gain" style="color:${gainColor}">${gainText}</div>
        <div class="dates">${daysText}</div>
      </div>
      <div class="lane-chart" id="lane-${idx}"></div>
    `
    lanesEl.appendChild(lane)

    // Find bottom and top data points for annotations
    const bottomPoint = map.get(asset.bottomDate)
    const topPoint = asset.topDate ? map.get(asset.topDate) : null

    // Format price for labels
    const fmtPrice = (p) => {
      if (p == null) return ''
      if (p >= 10000) return '$' + (p / 1000).toFixed(1) + 'k'
      if (p >= 100) return '$' + Math.round(p)
      return '$' + p.toFixed(2)
    }
    const fmtDate = (d) => {
      if (!d) return ''
      const [y, m, dd] = d.split('-')
      return `${y}-${m}-${dd}`
    }

    // Choose which pct field to use based on cycle mode
    const prevTopTime = asset.prevTopDate ? new Date(asset.prevTopDate).getTime() : 0
    const prevBottomTime = asset.prevBottomDate ? new Date(asset.prevBottomDate).getTime() : 0
    const pctField = cycleMode === 'bear' ? 'bearPct'
      : cycleMode === 'prevBear' ? 'prevBearPct'
      : cycleMode === 'prevBull' ? 'prevBullPct'
      : 'pct'

    // Build series data aligned to allDates (forward-fill gaps for non-crypto assets)
    // For excluded assets, fall back to 'pct' so the line still renders
    const displayField = excluded ? 'pct' : pctField
    let lastPct = null
    let lastPrice = null
    const fullData = allDates.map(date => {
      const d = map.get(date)
      if (d) { lastPct = d[displayField]; lastPrice = d.price }
      return lastPct
    })
    // Reset for highlight data pass (excluded assets get no highlight)
    lastPct = null
    const bullData = excluded ? allDates.map(() => null) : allDates.map(date => {
      const d = map.get(date)
      const t = new Date(date).getTime()
      if (d) lastPct = d[pctField]
      if (lastPct === null) return null
      if (cycleMode === 'bear') {
        return t >= topTime ? lastPct : null
      }
      if (cycleMode === 'prevBear') {
        return (t >= prevTopTime && t <= bottomTime) ? lastPct : null
      }
      if (cycleMode === 'prevBull') {
        return (t >= prevBottomTime && t <= prevTopTime) ? lastPct : null
      }
      return (t >= bottomTime && t <= topTime) ? lastPct : null
    })

    // ECharts
    const chartDom = document.getElementById(`lane-${idx}`)
    const chart = echarts.init(chartDom, null, { renderer: 'canvas' })

    // Gradient
    const hex = asset.color
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 0, right: 60, top: 28, bottom: 32 },
      dataZoom: [{
        type: 'inside',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        disabled: true, // disable user interaction; only programmatic sync from time axis
      }],
      xAxis: {
        type: 'category',
        data: allDates,
        show: false,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        show: false,
        min: (v) => v.min - (v.max - v.min) * 0.1,
        max: (v) => v.max + (v.max - v.min) * 0.1,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 20, 30, 0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        textStyle: { color: '#e0e0e0', fontSize: 12 },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(255,255,255,0.15)', width: 1 },
        },
        formatter(params) {
          const p = params[0]
          if (!p) return ''
          const d = map.get(p.axisValue)
          if (!d) return ''
          const pctVal = d[pctField] ?? d.pct
          const pctColor = pctVal >= 0 ? '#66bb6a' : '#ef5350'
          const priceStr = d.price >= 10000
            ? '$' + (d.price / 1000).toFixed(1) + 'k'
            : d.price >= 100
              ? '$' + d.price.toFixed(0)
              : '$' + d.price.toFixed(2)
          return `<div style="font-size:11px;color:#888">${p.axisValue}</div>
                  <div style="margin-top:4px">
                    <span style="color:${asset.color}">${asset.name}</span>
                    <span style="color:${pctColor};margin-left:8px">${pctVal >= 0 ? '+' : ''}${pctVal.toFixed(1)}%</span>
                    <span style="color:#666;margin-left:8px">${priceStr}</span>
                  </div>`
        },
      },
      series: [
        // Dimmed full line
        {
          type: 'line',
          data: fullData,
          symbol: 'none',
          smooth: 0.3,
          lineStyle: { width: 1.5, color: asset.color, opacity: 0.35 },
          areaStyle: { color: asset.color, opacity: 0.05 },
          silent: true,
        },
        // Bright bull period
        {
          type: 'line',
          data: bullData,
          symbol: 'none',
          smooth: 0.3,
          connectNulls: false,
          lineStyle: { width: 2, color: (cycleMode === 'bear' || cycleMode === 'prevBear') ? '#ef5350' : asset.color },
          areaStyle: (cycleMode === 'bear' || cycleMode === 'prevBear') ? {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(239,83,80,0.02)' },
              { offset: 1, color: 'rgba(239,83,80,0.25)' },
            ]),
          } : {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `rgba(${r},${g},${b},0.3)` },
              { offset: 1, color: `rgba(${r},${g},${b},0.02)` },
            ]),
          },
          markLine: excluded ? { data: [] } : {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: asset.color, type: 'dashed', opacity: 0.3, width: 1 },
            label: { show: false },
            data: cycleMode === 'bear'
              ? [...(asset.topDate ? [{ xAxis: asset.topDate }] : [])]
              : cycleMode === 'prevBear'
                ? [...(asset.prevTopDate ? [{ xAxis: asset.prevTopDate }] : []), { xAxis: asset.bottomDate }]
                : cycleMode === 'prevBull'
                  ? [...(asset.prevBottomDate ? [{ xAxis: asset.prevBottomDate }] : []), ...(asset.prevTopDate ? [{ xAxis: asset.prevTopDate }] : [])]
                  : [{ xAxis: asset.bottomDate }, ...(asset.topDate ? [{ xAxis: asset.topDate }] : [])],
          },
          markPoint: excluded ? { data: [] } : {
            symbol: 'circle',
            symbolSize: 6,
            itemStyle: { color: (cycleMode === 'bear' || cycleMode === 'prevBear') ? '#ef5350' : asset.color, borderColor: '#0a0a0f', borderWidth: 1 },
            label: {
              show: true,
              fontSize: 10,
              padding: [3, 6],
              borderRadius: 3,
              backgroundColor: 'rgba(20,20,30,0.85)',
              borderColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
            },
            data: cycleMode === 'prevBull' ? [
              // PrevBull: Bottom annotation
              ...(asset.prevBottomDate ? (() => {
                const pt = map.get(asset.prevBottomDate)
                return pt ? [{
                  coord: [asset.prevBottomDate, pt.prevBullPct ?? 0],
                  label: {
                    position: 'bottom',
                    offset: [0, 8],
                    formatter: `{a|Bottom}  {b|${fmtDate(asset.prevBottomDate)}}  {c|${fmtPrice(asset.prevBottomPrice)}}`,
                    rich: {
                      a: { color: asset.color, fontSize: 10, fontWeight: 'bold' },
                      b: { color: '#888', fontSize: 9 },
                      c: { color: '#aaa', fontSize: 9 },
                    },
                  },
                }] : []
              })() : []),
              // PrevBull: Top annotation
              ...(asset.prevTopDate ? (() => {
                const pt = map.get(asset.prevTopDate)
                return pt ? [{
                  coord: [asset.prevTopDate, pt.prevBullPct ?? 0],
                  label: {
                    position: 'top',
                    offset: [0, -8],
                    formatter: `{a|Top}  {b|${fmtDate(asset.prevTopDate)}}  {c|${fmtPrice(asset.prevTopPrice)}}`,
                    rich: {
                      a: { color: asset.color, fontSize: 10, fontWeight: 'bold' },
                      b: { color: '#888', fontSize: 9 },
                      c: { color: '#aaa', fontSize: 9 },
                    },
                  },
                }] : []
              })() : []),
            ] : cycleMode === 'prevBear' ? [
              // PrevBear: Top annotation (peak before crash)
              ...(asset.prevTopDate ? (() => {
                const pt = map.get(asset.prevTopDate)
                return pt ? [{
                  coord: [asset.prevTopDate, pt.prevBearPct ?? 0],
                  label: {
                    position: 'top',
                    offset: [0, -8],
                    formatter: `{a|Top}  {b|${fmtDate(asset.prevTopDate)}}  {c|${fmtPrice(asset.prevTopPrice)}}`,
                    rich: {
                      a: { color: '#ef5350', fontSize: 10, fontWeight: 'bold' },
                      b: { color: '#888', fontSize: 9 },
                      c: { color: '#aaa', fontSize: 9 },
                    },
                  },
                }] : []
              })() : []),
              // PrevBear: Bottom annotation
              ...(bottomPoint ? [{
                coord: [asset.bottomDate, bottomPoint.prevBearPct ?? 0],
                label: {
                  position: 'bottom',
                  offset: [0, 8],
                  formatter: `{a|Bottom}  {b|${fmtDate(asset.bottomDate)}}  {c|${fmtPrice(asset.bottomPrice)}}  {d|${asset.prevBearDrawdown.toFixed(0)}%}`,
                  rich: {
                    a: { color: '#ef5350', fontSize: 10, fontWeight: 'bold' },
                    b: { color: '#888', fontSize: 9 },
                    c: { color: '#aaa', fontSize: 9 },
                    d: { color: '#ef5350', fontSize: 9 },
                  },
                },
              }] : []),
            ] : cycleMode === 'bear' ? [
              // Bear: Top annotation
              ...(asset.topDate && topPoint ? [{
                coord: [asset.topDate, topPoint.bearPct ?? 0],
                label: {
                  position: 'top',
                  offset: [0, -8],
                  formatter: `{a|Top}  {b|${fmtDate(asset.topDate)}}  {c|${fmtPrice(asset.topPrice)}}`,
                  rich: {
                    a: { color: '#ef5350', fontSize: 10, fontWeight: 'bold' },
                    b: { color: '#888', fontSize: 9 },
                    c: { color: '#aaa', fontSize: 9 },
                  },
                },
              }] : []),
              // Bear: Current price annotation
              ...(asset.data.length ? [{
                coord: [asset.data[asset.data.length - 1].date, asset.data[asset.data.length - 1].bearPct],
                label: {
                  position: 'bottom',
                  offset: [0, 8],
                  formatter: `{a|Now}  {c|${fmtPrice(asset.data[asset.data.length - 1].price)}}  {d|${asset.currentDrawdown.toFixed(1)}%}`,
                  rich: {
                    a: { color: '#ef5350', fontSize: 10, fontWeight: 'bold' },
                    c: { color: '#aaa', fontSize: 9 },
                    d: { color: '#ef5350', fontSize: 9 },
                  },
                },
              }] : []),
            ] : [
              // Bull: Bottom annotation (below the point)
              ...(bottomPoint ? [{
                coord: [asset.bottomDate, bottomPoint.pct],
                label: {
                  position: 'bottom',
                  offset: [0, 8],
                  formatter: `{a|Bottom}  {b|${fmtDate(asset.bottomDate)}}  {c|${fmtPrice(asset.bottomPrice)}}`,
                  rich: {
                    a: { color: asset.color, fontSize: 10, fontWeight: 'bold' },
                    b: { color: '#888', fontSize: 9 },
                    c: { color: '#aaa', fontSize: 9 },
                  },
                },
              }] : []),
              // Bull: Top annotation (above the point)
              ...(asset.topDate && topPoint ? [{
                coord: [asset.topDate, topPoint.pct],
                label: {
                  position: 'top',
                  offset: [0, -8],
                  formatter: `{a|Top}  {b|${fmtDate(asset.topDate)}}  {c|${fmtPrice(asset.topPrice)}}`,
                  rich: {
                    a: { color: asset.color, fontSize: 10, fontWeight: 'bold' },
                    b: { color: '#888', fontSize: 9 },
                    c: { color: '#aaa', fontSize: 9 },
                  },
                },
              }] : []),
            ],
          },
        },
      ],
    })

    charts.push(chart)
  })

  // ========== Sortable: drag to reorder lanes ==========
  Sortable.create(lanesEl, {
    animation: 150,
    handle: '.lane-handle',
    ghostClass: 'lane-ghost',
    onEnd: () => {
      const order = Array.from(lanesEl.querySelectorAll('.lane')).map(el => el.dataset.assetName)
      saveOrder(order.filter(Boolean))
      // Resize charts in case layout shifted
      charts.forEach(c => c.resize())
    },
  })

  // ========== Time axis with bottom/top markers + dataZoom ==========
  const timeAxisDom = document.getElementById('timeAxis')
  // Dispose previous instance if exists
  const existingAxis = echarts.getInstanceByDom(timeAxisDom)
  if (existingAxis) existingAxis.dispose()
  const axisChart = echarts.init(timeAxisDom, null, { renderer: 'canvas' })

  // Collect ALL bottom and top dates from ALL cycles
  const bottomMarkers = []
  const topMarkers = []
  sorted.forEach(a => {
    if (a.prevBottomDate) bottomMarkers.push({ date: a.prevBottomDate, name: a.name })
    if (a.bottomDate) bottomMarkers.push({ date: a.bottomDate, name: a.name })
    if (a.prevTopDate) topMarkers.push({ date: a.prevTopDate, name: a.name })
    if (a.topDate) topMarkers.push({ date: a.topDate, name: a.name })
  })

  // Show ALL bottoms and tops from ALL cycles
  // Skip markers from cycles where the asset is excluded (e.g., just IPO'd, didn't really participate)
  const bottomScatter = []
  const topScatter = []

  sorted.forEach(a => {
    const excludedPrevBull = isExcluded(a, 'prevBull')
    const excludedPrevBear = isExcluded(a, 'prevBear')

    // prevBottom only shown if the prevBull cycle is valid
    if (a.prevBottomDate && !excludedPrevBull) {
      const idx = allDates.indexOf(a.prevBottomDate)
      if (idx >= 0) bottomScatter.push({ value: [idx, 0], name: a.name, itemStyle: { color: '#ef5350' } })
    }
    // bottom is always shown (current bull cycle bottom)
    if (a.bottomDate) {
      const idx = allDates.indexOf(a.bottomDate)
      if (idx >= 0) bottomScatter.push({ value: [idx, 0], name: a.name, itemStyle: { color: '#ef5350' } })
    }
    // prevTop only shown if either prevBull or prevBear cycle is valid
    if (a.prevTopDate && (!excludedPrevBull || !excludedPrevBear)) {
      const idx = allDates.indexOf(a.prevTopDate)
      if (idx >= 0) topScatter.push({ value: [idx, 0], name: a.name, itemStyle: { color: '#66bb6a' } })
    }
    // top is always shown (current bull cycle top)
    if (a.topDate) {
      const idx = allDates.indexOf(a.topDate)
      if (idx >= 0) topScatter.push({ value: [idx, 0], name: a.name, itemStyle: { color: '#66bb6a' } })
    }
  })

  axisChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 0, right: 60, top: 22, bottom: 32 },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(20,20,30,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0', fontSize: 11 },
      formatter: (p) => {
        if (!p.name) return ''
        const date = allDates[p.value[0]]
        return `<span style="color:#ddd">${p.name}</span><br><span style="color:#888">${date}</span>`
      },
    },
    xAxis: {
      type: 'category',
      data: allDates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#555', width: 1.5 } },
      axisTick: { show: true, lineStyle: { color: '#555' }, length: 5 },
      axisLabel: {
        color: '#aaa',
        fontSize: 12,
        margin: 10,
        hideOverlap: true,
        interval: (() => {
          // Pre-compute: for each month, find the first bar index
          const seen = new Set()
          const monthStarts = new Set()
          allDates.forEach((date, i) => {
            const key = date.substring(0, 7) // "YYYY-MM"
            if (!seen.has(key)) {
              seen.add(key)
              monthStarts.add(i)
            }
          })
          return (idx) => monthStarts.has(idx)
        })(),
        formatter(value) {
          const d = new Date(value)
          if (isNaN(d.getTime())) return ''
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const yr = d.getFullYear().toString().slice(2)
          if (d.getMonth() === 0) {
            // Highlight January with full year
            return `{mon|${months[d.getMonth()]}}\n{year|${d.getFullYear()}}`
          }
          return `{mon|${months[d.getMonth()]}}\n{yr|'${yr}}`
        },
        rich: {
          mon: { color: '#ccc', fontSize: 12, fontWeight: 600, lineHeight: 16 },
          year: { color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 14 },
          yr: { color: '#666', fontSize: 10, lineHeight: 14 },
        },
      },
    },
    yAxis: {
      type: 'value',
      show: false,
      min: -1,
      max: 1,
    },
    dataZoom: [{
      type: 'inside',
      xAxisIndex: 0,
      start: 0,
      end: 100,
      zoomOnMouseWheel: false,
      moveOnMouseMove: false,
      moveOnMouseWheel: false,
      preventDefaultMouseMove: false,
    }],
    series: [
      // Bottom markers — red circles
      {
        type: 'scatter',
        data: bottomScatter,
        symbol: 'circle',
        symbolSize: 10,
        label: { show: false },
        emphasis: {
          scale: 2,
          itemStyle: { borderColor: '#fff', borderWidth: 2, shadowColor: '#ef5350', shadowBlur: 10 },
          label: {
            show: true,
            position: 'bottom',
            offset: [0, 6],
            color: '#ef5350',
            fontWeight: 'bold',
            fontSize: 11,
            backgroundColor: 'rgba(20,20,30,0.9)',
            padding: [3, 8],
            borderRadius: 4,
            formatter: (p) => p.name,
          },
        },
      },
      // Top markers — green circles
      {
        type: 'scatter',
        data: topScatter,
        symbol: 'circle',
        symbolSize: 10,
        label: { show: false },
        emphasis: {
          scale: 2,
          itemStyle: { borderColor: '#fff', borderWidth: 2, shadowColor: '#66bb6a', shadowBlur: 10 },
          label: {
            show: true,
            position: 'top',
            offset: [0, -6],
            color: '#66bb6a',
            fontWeight: 'bold',
            fontSize: 11,
            backgroundColor: 'rgba(20,20,30,0.9)',
            padding: [3, 8],
            borderRadius: 4,
            formatter: (p) => p.name,
          },
        },
      },
    ],
  })
  charts.push(axisChart)

  // ========== Zoom sync infrastructure ==========
  let isSyncing = false
  let isPanning = false

  function syncAllZoom(start, end) {
    if (isSyncing) return
    isSyncing = true
    charts.forEach(c => {
      c.dispatchAction({ type: 'dataZoom', start, end })
    })
    isSyncing = false
  }

  // Sync dataZoom from time axis to all lane charts
  axisChart.on('dataZoom', () => {
    if (isSyncing) return
    const opt = axisChart.getOption()
    const dz = opt.dataZoom[0]
    syncAllZoom(dz.start, dz.end)
  })

  // ========== Drag on X axis labels to zoom (bottom 25px only) ==========
  let isDragging = false
  let dragStartX = 0
  let dragStartZoom = { start: 0, end: 100 }

  timeAxisDom.addEventListener('pointerdown', (e) => {
    // Only trigger in the bottom axis label area (bottom 25px)
    const rect = timeAxisDom.getBoundingClientRect()
    if (e.clientY - rect.top < rect.height - 25) return
    isDragging = true
    dragStartX = e.clientX
    const opt = axisChart.getOption()
    dragStartZoom = { start: opt.dataZoom[0].start, end: opt.dataZoom[0].end }
    timeAxisDom.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  document.addEventListener('pointermove', (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartX
    const width = timeAxisDom.clientWidth
    const sensitivity = 200
    const delta = (dx / width) * sensitivity
    const center = (dragStartZoom.start + dragStartZoom.end) / 2
    const halfRange = (dragStartZoom.end - dragStartZoom.start) / 2
    const newHalf = Math.max(3, Math.min(50, halfRange + delta))
    const newStart = Math.max(0, center - newHalf)
    const newEnd = Math.min(100, center + newHalf)
    axisChart.dispatchAction({ type: 'dataZoom', start: newStart, end: newEnd })
  })

  document.addEventListener('pointerup', () => { isDragging = false })

  // Scroll wheel on time axis → zoom
  timeAxisDom.addEventListener('wheel', (e) => {
    e.preventDefault()
    const opt = axisChart.getOption()
    const { start, end } = opt.dataZoom[0]
    const center = (start + end) / 2
    const halfRange = (end - start) / 2
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
    const newHalf = Math.max(3, Math.min(50, halfRange * zoomFactor))
    const newStart = Math.max(0, center - newHalf)
    const newEnd = Math.min(100, center + newHalf)
    axisChart.dispatchAction({ type: 'dataZoom', start: newStart, end: newEnd })
  }, { passive: false })

  // ========== Hover sync (manual, throttled) ==========
  let lastSyncTime = 0
  const laneCharts = charts.filter(c => c !== axisChart)

  laneCharts.forEach((c) => {
    c.getZr().on('mousemove', (e) => {
      const now = Date.now()
      if (now - lastSyncTime < 50) return // throttle to 20fps
      lastSyncTime = now
      laneCharts.forEach((other) => {
        if (other === c) return
        other.dispatchAction({ type: 'showTip', seriesIndex: 0, x: e.offsetX })
      })
      axisChart.dispatchAction({ type: 'showTip', seriesIndex: 0, x: e.offsetX })
    })
    c.getZr().on('mouseout', () => {
      laneCharts.forEach((other) => {
        if (other === c) return
        other.dispatchAction({ type: 'hideTip' })
      })
      axisChart.dispatchAction({ type: 'hideTip' })
    })
  })

  // ========== Drag-to-pan on lane charts ==========
  let panStartX = 0
  let panStartZoom = { start: 0, end: 100 }

  laneCharts.forEach((c) => {
    // Sync scroll-wheel zoom from this lane to all charts
    c.on('dataZoom', () => {
      if (isSyncing || isPanning) return
      const opt = c.getOption()
      const dz = opt.dataZoom[0]
      syncAllZoom(dz.start, dz.end)
    })

    const zr = c.getZr()

    zr.on('mousedown', (e) => {
      isPanning = true
      panStartX = e.offsetX
      const opt = c.getOption()
      panStartZoom = { start: opt.dataZoom[0].start, end: opt.dataZoom[0].end }
    })

    zr.on('mousemove', (e) => {
      if (!isPanning) return
      const dx = e.offsetX - panStartX
      const chartWidth = c.getWidth()
      const range = panStartZoom.end - panStartZoom.start
      // Convert pixel delta to percentage delta
      const pctDelta = -(dx / chartWidth) * range

      let newStart = panStartZoom.start + pctDelta
      let newEnd = panStartZoom.end + pctDelta
      // Clamp
      if (newStart < 0) { newEnd -= newStart; newStart = 0 }
      if (newEnd > 100) { newStart -= (newEnd - 100); newEnd = 100 }
      newStart = Math.max(0, newStart)
      newEnd = Math.min(100, newEnd)

      syncAllZoom(newStart, newEnd)
    })

    zr.on('mouseup', () => { isPanning = false })
    zr.on('globalout', () => { isPanning = false })
  })

  // Resize
  window.addEventListener('resize', () => charts.forEach(c => c.resize()))

  return charts
}
