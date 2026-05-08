// ═══════════════════════════════════════════════════════════════════════════════
//                         XYLO-MD  —  Bot Settings
//   Fill in your details below, then run:   node launcher.js
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {

  // ── REQUIRED ──────────────────────────────────────────────────────────────
  // Your session ID from https://session.davidxtech.de
  // Format:  XYLO-MD++xxxxxxxx   or   DAVE-S*F=xxxxxxxx
  SESSION_ID: process.env.SESSION_ID || '',

  // ── OPTIONAL ──────────────────────────────────────────────────────────────
  // These override the defaults set inside the bot.
  // Leave a value as '' or null to use the bot's built-in default.

  // Bot command prefix (e.g. '.' or '!' or '/')
  PREFIX: process.env.PREFIX || '.',

  // 'public'  → anyone can use the bot
  // 'private' → only the owner can use the bot
  MODE: process.env.MODE || 'public'

}
