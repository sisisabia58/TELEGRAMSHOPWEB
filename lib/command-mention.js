// Telegram group commands can name a bot: /cmd@SomeBot. node-telegram-bot-api
// onText only runs the caller regex, and /cmd(?:@\w+)? also matches another
// bot's mention. With privacy mode off, that message is delivered here.
// One guard in front of every onText handler compares the optional mention
// with this process's own username (getMe, cached) and skips the rest.

function commandMention(text) {
  const match = /^\/\w+@(\w+)/.exec(String(text || ''))
  return match ? match[1] : null
}

function commandAddressesBot(text, botUsername) {
  const mention = commandMention(text)
  if (!mention) return true
  const own = String(botUsername || '').replace(/^@/, '').trim()
  if (!own) return false
  return mention.toLowerCase() === own.toLowerCase()
}

function createBotUsernameCache(getMe) {
  let cached
  let inflight
  return function getCachedBotUsername() {
    if (cached !== undefined) return Promise.resolve(cached)
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => getMe())
        .then((me) => {
          const name = me && me.username ? String(me.username).replace(/^@/, '').trim() : ''
          if (name) cached = name
          return name
        })
        .catch(() => '')
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }
}

function installCommandMentionGuard(bot, getCachedUsername) {
  if (!bot || typeof bot.onText !== 'function') {
    throw new TypeError('installCommandMentionGuard requires a bot with onText')
  }
  if (typeof getCachedUsername !== 'function') {
    throw new TypeError('installCommandMentionGuard requires getCachedUsername')
  }
  const rawOnText = bot.onText.bind(bot)
  bot.onText = function onText(regexp, callback) {
    return rawOnText(regexp, async (msg, match) => {
      const text = msg && msg.text
      if (commandMention(text)) {
        let username = ''
        try {
          username = await getCachedUsername()
        } catch {
          username = ''
        }
        if (!commandAddressesBot(text, username)) return
      }
      return callback(msg, match)
    })
  }
  return bot
}

module.exports = {
  commandMention,
  commandAddressesBot,
  createBotUsernameCache,
  installCommandMentionGuard,
}
