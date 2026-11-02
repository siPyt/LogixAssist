import type { ChatMessage } from './bridge'

const KEY = 'logix.chat'
const DRAFT_KEY = 'logix.chat.draft'

/** Conversation saved in this browser so a reload doesn't erase it. */
export function loadChat(): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
  } catch {
    return []
  }
}

export function saveChat(messages: ChatMessage[]): void {
  try {
    if (messages.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(messages))
  } catch {
    // storage full or unavailable
  }
}

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // storage unavailable
  }
}
