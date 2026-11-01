import { LogixIcon } from './LogixIcon'
import { APP_NAME, AUTHOR, AUTHOR_TITLE } from '../config'

/**
 * Center "view box" marketing screen.
 */
export function MarketingScreen() {
  return (
    <section className="marketing" aria-label="Logix Assistant">
      <LogixIcon size={128} />
      <h1 className="marketing-title">{APP_NAME}</h1>
      <p className="marketing-sub">
        developed by <strong>{AUTHOR}</strong>, {AUTHOR_TITLE}
      </p>
      <p className="marketing-hint">
        Select a PDF or program file in the Explorer to preview it here, or use
        the <strong>LA</strong> badge in the top bar to open your Rockwell &amp;
        program-file library in VS Code.
      </p>
    </section>
  )
}
