import type { Register } from 'claude-code'

// What a person typing at the prompt (TUI) or an SDK host (Orca chat) looks like. Nothing else may run a command.
const HUMAN_ORIGINS = new Set(['composer', 'sdk'])

/**
 * Equivalent of the TUI's `!` mode, for hosts that send "!cmd" as plain text.
 *
 * The TUI runs the typed command through Claude Code's own Bash tool with the permission check and
 * the sandbox skipped, writes `<bash-input>` / `<bash-stdout>` / `<bash-stderr>` into the conversation
 * and lets the model answer. This does the same through `$.tool.call`:
 *  - same tool, so same shell snapshot, cwd tracking and reset rule, output limits and timeout;
 *  - `tool.check` allows exactly the command a person just typed, and nothing else.
 */
export const register: Register = (on) => {
  const typed = new Map<string, number>()      // commands typed by the person and currently running

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = (e.input as { command?: string } | undefined)?.command
    if (cmd !== undefined && (typed.get(cmd) ?? 0) > 0) return { decision: 'allow', reason: 'typed by the user with "!"' }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command || !HUMAN_ORIGINS.has(e.origin.kind) || !e.text.startsWith('!')) return next(e)
    const command = e.text.slice(1).trim()
    if (!command) return next(e)

    let stdout = '', stderr = ''
    typed.set(command, (typed.get(command) ?? 0) + 1)
    try {
      const r = (await $.tool.call({ tool: 'Bash', command, dangerouslyDisableSandbox: true } as never)) as {
        result?: unknown; text?: string; isError?: boolean
      }
      const res = r.result as { stdout?: string; stderr?: string } | string | undefined
      if (r.isError) stderr = r.text ?? String(res ?? '')                // "Exit code N\n<output>"
      else if (res && typeof res === 'object') { stdout = res.stdout ?? ''; stderr = res.stderr ?? '' }
      else stdout = r.text ?? ''
    } catch (x) {
      stderr = `bang-shell: ${(x as Error).message}`
    } finally {
      const n = (typed.get(command) ?? 1) - 1
      if (n <= 0) typed.delete(command); else typed.set(command, n)
    }
    // The TUI stores two rows: <bash-input> and then <bash-stdout>. Do the same, so a session resumed in the
    // TUI renders the output as bash output. The first row can only be appended (the host marks it as a meta
    // row, which the TUI does not draw); the prompt itself becomes the second, visible row.
    const stdoutRow = `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>`
    try {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `<bash-input> ${command}</bash-input>` }] } } as never)
      return next({ ...e, text: stdoutRow })
    } catch {
      // Could not append: fall back to one combined row that still starts with <bash-input>.
      return next({ ...e, text: `<bash-input>${command}</bash-input>\n${stdoutRow}` })
    }
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'bang-shell failed to run the command; nothing was sent.' }))
}
