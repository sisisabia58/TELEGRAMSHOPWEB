require('dotenv').config()

const TokenBot = process.env.TOKEN_BOT || ""
const NamaBot = process.env.NAMA_BOT || "Knightz Store"
const OwnerID = parseInt(process.env.OWNER_ID) || 0
const ImagePath = process.env.IMAGE_PATH || "./logo.jpg"
const ChannelLog = process.env.CHANNEL_LOG || ""
const ChannelStore = process.env.CHANNEL_STORE || ""
const CS = process.env.CS || ""
const FeedChannel = process.env.FEED_CHANNEL || ""
const FeedStockEnabled = process.env.FEED_STOCK_ENABLED !== "false"
const FeedPurchaseEnabled = process.env.FEED_PURCHASE_ENABLED !== "false"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_KEY = process.env.SUPABASE_KEY || ""
const Pakasir = {
  project: process.env.PAKASIR_PROJECT || "",
  apiKey: process.env.PAKASIR_API_KEY || "",
  baseUrl: process.env.PAKASIR_BASE_URL || "https://app.pakasir.com"
}
const JamBackup = parseInt(process.env.JAM_BACKUP) || 5

module.exports = { TokenBot, NamaBot, OwnerID, ImagePath, Pakasir, ChannelStore, CS, ChannelLog, FeedChannel, FeedStockEnabled, FeedPurchaseEnabled, JamBackup, SUPABASE_URL, SUPABASE_KEY }
