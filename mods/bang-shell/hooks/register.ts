import type { Register } from 'claude-code'

// What a person typing at the prompt (TUI) or an SDK host (Orca chat) looks like. Nothing else may run a command.
const HUMAN_ORIGINS = new Set(['composer', 'sdk'])

// Blank the "isMeta":true marker of rows this plugin appended, in place and without changing a single byte count,
// so the terminal UI draws them like the rows it writes itself. Never rewrites the file; any problem = do nothing.
const PATCH_PY = String.raw`
import sys, os, json, glob, time, re
sid, uuids = sys.argv[1], set(sys.argv[2:])
cfg = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
deadline = time.time() + 12
done = set()
while uuids - done and time.time() < deadline:
    files = glob.glob(os.path.join(cfg, "projects", "*", sid + ".jsonl"))
    if files:
        f = files[0]
        try:
            with open(f, "r+b") as fh:
                size = os.fstat(fh.fileno()).st_size
                start = max(0, size - 4 * 1024 * 1024)
                fh.seek(start); buf = fh.read()
                pos = 0
                for line in buf.split(b"\n"):
                    n = len(line)
                    for u in list(uuids - done):
                        if b'"uuid":"' + u.encode() + b'"' in line and b'"isMeta":true' in line:
                            m = re.search(rb'"isMeta":true,|,"isMeta":true', line)
                            if m:
                                new = line[:m.start()] + b" " * (m.end() - m.start()) + line[m.end():]
                                if len(new) == n and json.loads(new) is not None:
                                    fh.seek(start + pos + m.start()); fh.write(b" " * (m.end() - m.start())); fh.flush()
                                    done.add(u)
                        elif b'"uuid":"' + u.encode() + b'"' in line:
                            done.add(u)          # row found and not meta (nothing to do)
                    pos += n + 1
        except Exception:
            pass
    if uuids - done: time.sleep(0.4)
`

// On macOS without the Xcode command line tools, `python3` opens an install dialog: skip instead of asking.
const RUN_PY = 'if [ "$(uname)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then exit 0; fi; command -v python3 >/dev/null 2>&1 || exit 0; exec python3 -c "$0" "$@"'

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
      const ap = (await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `<bash-input> ${command}</bash-input>` }] } } as never)) as { uuid?: string }
      if (ap?.uuid) {
        // Fire and forget: best effort, never delays or breaks the turn.
        const sid = await $.session.id()
        void $.process.run(['sh', '-c', RUN_PY, PATCH_PY, sid, ap.uuid], { timeoutMs: 20000 }).catch(() => undefined)
      }
      return next({ ...e, text: stdoutRow })
    } catch {
      // Could not append: fall back to one combined row that still starts with <bash-input>.
      return next({ ...e, text: `<bash-input>${command}</bash-input>\n${stdoutRow}` })
    }
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'bang-shell failed to run the command; nothing was sent.' }))
}
