require('dotenv').config()

const TokenBot = process.env.TOKEN_BOT || ""
const NamaBot = process.env.NAMA_BOT || "Knightz Store"
const OwnerID = parseInt(process.env.OWNER_ID) || 0
const ImagePath = process.env.IMAGE_PATH || "./logo.jpg"
const ChannelLog = process.env.CHANNEL_LOG || ""
const ChannelStore = process.env.CHANNEL_STORE || ""
const CS = process.env.CS || ""
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_KEY = process.env.SUPABASE_KEY || ""
const Ariepulsa = {
  Apikey: process.env.ARIEPULSA_APIKEY || ""
}
const JamBackup = parseInt(process.env.JAM_BACKUP) || 5

module.exports = { TokenBot, NamaBot, OwnerID, ImagePath, Ariepulsa, ChannelStore, CS, ChannelLog, JamBackup, SUPABASE_URL, SUPABASE_KEY }