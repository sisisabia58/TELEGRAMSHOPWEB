function summarizeStock(variants) {
  const list = Array.isArray(variants) ? variants : []
  const outOfStock = list.filter((v) => (v.stok_count || 0) <= 0)
  const lowStock = list.filter((v) => {
    const c = v.stok_count || 0
    const t = v.threshold == null ? 5 : Number(v.threshold)
    return c > 0 && c <= t
  })
  return { outOfStock, lowStock }
}

function pickRecent(rows, n) {
  return (rows || []).slice(0, n)
}

function buildOverviewModel(input) {
  const stock = summarizeStock(input.variants || [])
  const draftNotice = input.flowDraftUpdatedAt
    ? `Flow draft saved ${input.flowDraftUpdatedAt} — open Bot Flow to review/publish.`
    : null
  return {
    pendingDeposits: input.pendingDeposits || [],
    outOfStock: stock.outOfStock,
    lowStock: stock.lowStock,
    todayRevenue: input.todayRevenue || 0,
    todayTxnCount: input.todayTxnCount || 0,
    recentTxns: pickRecent(input.recentTxns || [], 5),
    draftNotice,
  }
}

module.exports = { summarizeStock, pickRecent, buildOverviewModel }
