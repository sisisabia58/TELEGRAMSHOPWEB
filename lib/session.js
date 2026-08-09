const supabase = require('./supabase')

const TABLE = 'BotSession'
const NAV_CAP = 20

function emptyNav() {
  return { screen_key: null, nav_stack: [], banner_msg_id: null }
}

async function getNav(userId) {
  if (!userId) return emptyNav()
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('screen_key, nav_stack, banner_msg_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[session] getNav:', error.message)
      return emptyNav()
    }
    if (!data) return emptyNav()
    return {
      screen_key: data.screen_key ?? null,
      nav_stack: Array.isArray(data.nav_stack) ? data.nav_stack : [],
      banner_msg_id: data.banner_msg_id ?? null,
    }
  } catch (e) {
    console.error('[session] getNav:', e.message)
    return emptyNav()
  }
}

async function setScreen(userId, screenKey, opts = {}) {
  if (!userId) return false
  const push = !!opts.push
  try {
    const current = await getNav(userId)
    let nav_stack = Array.isArray(current.nav_stack) ? [...current.nav_stack] : []
    if (push && current.screen_key) {
      nav_stack.push(current.screen_key)
      if (nav_stack.length > NAV_CAP) nav_stack = nav_stack.slice(-NAV_CAP)
    } else if (!push) {
      nav_stack = []
    }
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      screen_key: screenKey,
      nav_stack,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] setScreen:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[session] setScreen:', e.message)
    return false
  }
}

async function setBanner(userId, messageId) {
  if (!userId) return false
  try {
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      banner_msg_id: messageId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] setBanner:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[session] setBanner:', e.message)
    return false
  }
}

async function popScreen(userId) {
  if (!userId) return null
  try {
    const current = await getNav(userId)
    const nav_stack = Array.isArray(current.nav_stack) ? [...current.nav_stack] : []
    const prev = nav_stack.pop()
    if (!prev) return null
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      screen_key: prev,
      nav_stack,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] popScreen:', error.message)
      return null
    }
    return prev
  } catch (e) {
    console.error('[session] popScreen:', e.message)
    return null
  }
}

module.exports = { getNav, setScreen, setBanner, popScreen }
