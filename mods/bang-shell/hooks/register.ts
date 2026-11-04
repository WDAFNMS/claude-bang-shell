import type { Register } from 'claude-code'

const MAX = 30000          // chars kept per stream, like a bounded Bash output
const RUN_TIMEOUT_MS = 120000
// Prompts typed by a person reach us as 'composer' (TUI) or 'sdk' (Orca/Agent SDK host). Nothing else may run a command.
const HUMAN_ORIGINS = new Set(['composer', 'sdk'])

// Same recipe as the Bash tool: $SHELL -c 'source <newest snapshot>; setopt ...; eval CMD </dev/null; record pwd'
const BODY = String.raw`
__k=zsh; [ -n "$BASH_VERSION" ] && __k=bash
__s=$(command ls -t "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/shell-snapshots/snapshot-$__k-*.sh 2>/dev/null | command head -1)
[ -n "$__s" ] && source "$__s" 2>/dev/null
setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || shopt -u extglob 2>/dev/null || true
eval "$BANG_CMD" < /dev/null
__rc=$?
printf '\n__BANG_END__%s\n%s\n' "$__rc" "$(pwd -P)"
exit $__rc
`.replace('\\${', '${')

const cut = (s: string) => (s.length > MAX ? s.slice(0, MAX) + `\n...[truncated ${s.length - MAX} chars]` : s)

export const register: Register = (on, options) => {
  let lastCwd: string | undefined          // persists across !cmds in this session (module variable)
  const mode = (options as { mode?: string })?.mode ?? 'respond'   // 'respond' | 'show'

  on('prompt.submit', async ($, e, next) => {
    const text = e.text
    if (e.isMeta || e.command || !HUMAN_ORIGINS.has(e.origin.kind) || !text.startsWith('!')) return next(e)
    const cmd = text.slice(1).trim()
    if (!cmd) return next(e)

    let out = '', err = '', code = -1
    try {
      const r = await $.process.run(
        ['/bin/sh', '-c', 'exec "${SHELL:-/bin/zsh}" -c "$1"', 'sh', BODY],
        { cwd: lastCwd, env: { BANG_CMD: cmd }, timeoutMs: RUN_TIMEOUT_MS },
      )
      const i = r.stdout.lastIndexOf('\n__BANG_END__')
      if (i >= 0) {
        const tail = r.stdout.slice(i + '\n__BANG_END__'.length).split('\n')
        code = Number(tail[0]); lastCwd = tail[1] || lastCwd
        out = r.stdout.slice(0, i)
      } else { out = r.stdout; code = r.exitCode }
      err = r.stderr
    } catch (x) {
      err = `bang-shell: ${(x as Error).message}`
    }
    const block = `<bash-input>${cmd}</bash-input>\n<bash-stdout>${cut(out)}</bash-stdout><bash-stderr>${cut(err)}</bash-stderr>`
    if (mode === 'show') return { drop: `$ ${cmd}\n${cut(out)}${err ? `\n[stderr]\n${cut(err)}` : ''}\n[exit ${code}]` }
    return next({ ...e, text: block })      // TUI default: the model answers right after the command
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'bang-shell failed to run the command; nothing was sent.' }))
}
