// Browser and server share one checker in public/js/flow-builder/validation.js
// so the flow canvas and validateDraft reject the same Markdown.
module.exports = {
  validateTelegramMarkdown: require('../public/js/flow-builder/validation').validateTelegramMarkdown,
}
