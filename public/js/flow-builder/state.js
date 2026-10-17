/* Flow builder editor session: snapshot undo/redo (Phase 14 PR2 / M4). */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root && typeof root === 'object') {
    root.FlowBuilderState = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const HISTORY_LIMIT = 50

  function cloneDraft(x) {
    return JSON.parse(JSON.stringify(x))
  }

  function draftsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function createEditorState(options) {
    options = options || {}
    const historyLimit = options.historyLimit || HISTORY_LIMIT
    let draft = null
    const undoStack = []
    const redoStack = []

    function replaceDraft(next) {
      draft = next == null ? null : cloneDraft(next)
      undoStack.length = 0
      redoStack.length = 0
      return draft
    }

    function applyCommand(mutator) {
      if (draft == null) return draft
      if (typeof mutator !== 'function') {
        throw new TypeError('applyCommand requires a mutator function')
      }
      const before = cloneDraft(draft)
      const after = mutator(cloneDraft(draft))
      if (draftsEqual(before, after)) return draft
      undoStack.push(before)
      if (undoStack.length > historyLimit) undoStack.shift()
      redoStack.length = 0
      draft = after
      return draft
    }

    function undo() {
      if (!undoStack.length) return draft
      redoStack.push(cloneDraft(draft))
      draft = undoStack.pop()
      return draft
    }

    function redo() {
      if (!redoStack.length) return draft
      undoStack.push(cloneDraft(draft))
      draft = redoStack.pop()
      return draft
    }

    return {
      applyCommand: applyCommand,
      undo: undo,
      redo: redo,
      replaceDraft: replaceDraft,
      getDraft: function () { return draft },
      canUndo: function () { return undoStack.length > 0 },
      canRedo: function () { return redoStack.length > 0 },
      historyLimit: historyLimit,
    }
  }

  function shouldIgnoreShortcut(target) {
    if (!target) return false
    if (target.isContentEditable) return true
    const tag = String(target.tagName || '').toLowerCase()
    if (tag === 'textarea' || tag === 'select') return true
    if (tag === 'input') {
      const type = String(target.type || 'text').toLowerCase()
      if (['button', 'submit', 'checkbox', 'radio', 'file', 'reset', 'hidden', 'image'].indexOf(type) !== -1) {
        return false
      }
      return true
    }
    return false
  }

  function shortcutFromEvent(event) {
    if (!event) return null
    if (shouldIgnoreShortcut(event.target)) return null
    if (!(event.ctrlKey || event.metaKey)) return null
    const key = String(event.key || '').toLowerCase()
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    return null
  }

  return {
    HISTORY_LIMIT: HISTORY_LIMIT,
    cloneDraft: cloneDraft,
    draftsEqual: draftsEqual,
    createEditorState: createEditorState,
    shouldIgnoreShortcut: shouldIgnoreShortcut,
    shortcutFromEvent: shortcutFromEvent,
  }
})
