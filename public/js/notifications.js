// Notification center — bell panel + SSE (no toast stack)
class NotificationCenter {
  constructor() {
    this.items = []
    this.actionableTotal = 0
    this.inboxReady = false
    this.pendingLive = []
    this.panelOpen = false
    this.eventSource = null
    this.badgeElements = {}
    this.els = {
      bell: document.getElementById('notificationBell'),
      panel: document.getElementById('notificationPanel'),
      list: document.getElementById('notificationList'),
      badge: document.getElementById('notificationBadge'),
      empty: document.getElementById('notificationEmpty'),
      markAll: document.getElementById('notificationMarkAll'),
    }
    if (!this.els.bell) return // pages without topbar
    this.setupBadgeUpdates()
    this.bindUi()
    this.loadInbox()
    this.connectSSE()
    this.loadNotificationCounts()
    setInterval(() => this.loadNotificationCounts(), 30000)
  }

  bindUi() {
    this.els.bell.addEventListener('click', (e) => {
      e.stopPropagation()
      this.togglePanel()
    })

    this.els.panel.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        this.togglePanel(false)
      } else {
        e.stopPropagation()
      }
    })

    // Capture phase listeners so canvas or widgets calling stopPropagation cannot block closing
    document.addEventListener('pointerdown', (e) => {
      if (this.panelOpen && !this.els.panel.contains(e.target) && !this.els.bell.contains(e.target)) {
        this.togglePanel(false)
      }
    }, true)

    document.addEventListener('click', (e) => {
      if (this.panelOpen && !this.els.panel.contains(e.target) && !this.els.bell.contains(e.target)) {
        this.togglePanel(false)
      }
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panelOpen) this.togglePanel(false)
    })

    if (this.els.markAll) {
      this.els.markAll.addEventListener('click', () => this.markAllRead())
    }
  }

  async markAllRead() {
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' })
      await this.loadInbox()
    } catch (error) {
      console.error('Error marking notifications read:', error)
    }
  }

  async loadInbox() {
    try {
      const res = await fetch('/api/notifications/inbox')
      const data = await res.json()
      if (!data.success) return
      this.items = data.items || []
      this.actionableTotal = data.counts?.total ?? 0
      this.render()
      this.updateHeaderBadge(this.actionableTotal)
      this.inboxReady = true
      const buffered = this.pendingLive.splice(0)
      for (const notification of buffered) {
        this.applyLiveNotification(notification)
      }
    } catch (error) {
      console.error('Error loading notification inbox:', error)
      this.inboxReady = true
    }
  }

  itemKey(item) {
    if (!item) return ''
    if (item.type === 'deposit_pending') {
      if (item.data?.deposit_id) return `deposit-${item.data.deposit_id}`
      return 'deposit-pending'
    }
    if (item.type === 'low_stock') {
      return item.id || `low-stock-${item.data?.varian_id || ''}`
    }
    if (item.type === 'large_transaction') {
      return item.id || `trx-${item.data?.trx_uuid || ''}`
    }
    return String(item.id || '')
  }

  render() {
    const { list, empty } = this.els
    list.replaceChildren()
    if (!this.items.length) {
      empty.hidden = false
      return
    }
    empty.hidden = true
    for (const item of this.items) {
      const li = document.createElement('li')
      li.className = `notification-item notification-item--${item.type}`
      const link = document.createElement('a')
      link.href = item.href || '/'
      const titleEl = document.createElement('div')
      titleEl.className = 'notification-item-title'
      titleEl.textContent = item.title || ''
      const messageEl = document.createElement('div')
      messageEl.className = 'notification-item-message'
      messageEl.textContent = item.message || ''
      link.append(titleEl, messageEl)
      li.append(link)
      list.append(li)
    }
  }

  hrefFor(notification) {
    const type = notification.type
    const data = notification.data || {}
    if (type === 'deposit_pending' && data.deposit_id) {
      return `/deposit/${data.deposit_id}`
    }
    if (type === 'deposit_pending') return '/deposit?status=pending'
    if (type === 'low_stock' && data.produk_id && data.varian_id) {
      return `/produk/${data.produk_id}/varian/${data.varian_id}/stok`
    }
    if (type === 'large_transaction' && data.trx_uuid) {
      return `/transaksi/${data.trx_uuid}`
    }
    return '/'
  }

  mergeLiveRow(row) {
    const key = this.itemKey(row)
    const existed = this.items.some((item) => this.itemKey(item) === key)
    this.items = [row, ...this.items.filter((item) => this.itemKey(item) !== key)].slice(0, 50)
    if (!existed) {
      this.actionableTotal += 1
    }
    this.render()
    this.updateHeaderBadge(this.actionableTotal)
  }

  handleLiveNotification(notification) {
    if (!notification || notification.type === 'connected') return
    if (!this.inboxReady) {
      this.pendingLive.push(notification)
      return
    }
    this.applyLiveNotification(notification)
  }

  applyLiveNotification(notification) {
    if (Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/logo.jpg',
        tag: notification.type,
      })
    }

    const row = {
      id: notification.data?.deposit_id
        || notification.data?.trx_uuid
        || (notification.data?.varian_id ? `low-stock-${notification.data.varian_id}` : null)
        || Date.now(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      href: this.hrefFor(notification),
      priority: notification.priority || 'medium',
      created_at: notification.timestamp || new Date().toISOString(),
      data: notification.data || {},
    }
    this.mergeLiveRow(row)
  }

  togglePanel(open) {
    this.panelOpen = open ?? !this.panelOpen
    this.els.panel.hidden = !this.panelOpen
    this.els.bell.setAttribute('aria-expanded', String(this.panelOpen))
  }

  updateHeaderBadge(count) {
    const { badge } = this.els
    if (!badge) return
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count)
      badge.hidden = false
    } else {
      badge.hidden = true
    }
  }

  connectSSE() {
    if (typeof EventSource === 'undefined') {
      console.warn('SSE not supported')
      return
    }

    this.eventSource = new EventSource('/api/notifications/stream')

    this.eventSource.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data)
        this.handleLiveNotification(notification)
      } catch (error) {
        console.error('Error parsing notification:', error)
      }
    }

    this.eventSource.onerror = () => {
      setTimeout(() => {
        if (this.eventSource) this.eventSource.close()
        this.connectSSE()
      }, 5000)
    }
  }

  async loadNotificationCounts() {
    try {
      const response = await fetch('/api/notifications/counts')
      const data = await response.json()
      if (data.success) {
        this.updateAllBadges(data.counts)
      }
    } catch (error) {
      console.error('Error loading notification counts:', error)
    }
  }

  updateAllBadges(counts) {
    if (this.badgeElements['deposit-badge']) {
      if (counts.deposit_pending > 0) {
        this.badgeElements['deposit-badge'].textContent = counts.deposit_pending
        this.badgeElements['deposit-badge'].style.display = 'inline-block'
      } else {
        this.badgeElements['deposit-badge'].style.display = 'none'
      }
    }

    if (this.badgeElements['stock-badge']) {
      if (counts.low_stock > 0) {
        this.badgeElements['stock-badge'].textContent = counts.low_stock
        this.badgeElements['stock-badge'].style.display = 'inline-block'
      } else {
        this.badgeElements['stock-badge'].style.display = 'none'
      }
    }
  }

  setupBadgeUpdates() {
    const depositLink = document.querySelector('a[href="/deposit"]')
    if (depositLink && !document.getElementById('deposit-badge')) {
      const badge = document.createElement('span')
      badge.id = 'deposit-badge'
      badge.className = 'notification-badge'
      badge.style.cssText = `
        display: none;
        background: #dc3545;
        color: white;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 11px;
        margin-left: 5px;
        font-weight: bold;
      `
      depositLink.appendChild(badge)
      this.badgeElements['deposit-badge'] = badge
    }

    const produkLink = document.querySelector('a[href="/produk"]')
    if (produkLink && !document.getElementById('stock-badge')) {
      const badge = document.createElement('span')
      badge.id = 'stock-badge'
      badge.className = 'notification-badge'
      badge.style.cssText = `
        display: none;
        background: #ffc107;
        color: #000;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 11px;
        margin-left: 5px;
        font-weight: bold;
      `
      produkLink.appendChild(badge)
      this.badgeElements['stock-badge'] = badge
    }
  }
}

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log('Browser notifications enabled')
    }
  })
}

let notificationCenter
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    notificationCenter = new NotificationCenter()
  })
} else {
  notificationCenter = new NotificationCenter()
}
