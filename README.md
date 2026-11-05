# claude-bang-shell

A Claude Code plugin (a "mod") that gives chats driven through the Agent SDK — for example
Orca's structured chat — the TUI's `!` shell mode. 在 SDK 宿主(如 Orca 的 structured chat)里,
让输入框里的 `!命令` 像终端版 Claude Code 那样执行。

In the Claude Code TUI, typing `!ls` runs `ls` yourself and shows the result to Claude. SDK
hosts send `!ls` to the model as plain text, so nothing runs. This plugin hooks `prompt.submit`,
runs the command, and passes the result to Claude as `<bash-input>/<bash-stdout>/<bash-stderr>`,
so Claude answers right after the command, as in the TUI.

## Behaviour

Equivalent to the TUI's `!` mode. The TUI runs a typed `!cmd` through Claude Code's own Bash tool with
the permission check and the sandbox skipped, records `<bash-input>` / `<bash-stdout>` / `<bash-stderr>`
and lets Claude answer. This plugin does the same through `$.tool.call`:

- Only prompts whose first character is `!` and whose origin is the user (`composer`) or the SDK
  host (`sdk`) are handled. Messages from peer sessions, schedules, channels or other plugins never run.
- The command runs in the **same Bash tool** Claude uses: same shell snapshot (aliases, functions, PATH),
  same working-directory tracking (`!cd sub` carries over, `cd` outside the project is reset), same output
  limits and timeout.
- A `tool.check` hook allows exactly the command a person just typed, only while it runs. Any other
  Bash call is judged by the normal permission rules.
- The result is written the way the TUI writes it: a `<bash-input> cmd` row and then a `<bash-stdout>…<bash-stderr>…`
  row, and Claude answers right after. A non-zero exit shows `Exit code N` in the stderr block.
- Because the rows are TUI-shaped, a session continued in the terminal (`claude --resume`) draws each output
  as ordinary bash output (`⎿ …`) instead of raw tags.
- The plugin writes no files and keeps no state.

Differences from the TUI: the `<bash-input>` row is added by the plugin and the host marks it as a meta row, so a
resumed TUI draws the output but not the `! cmd` line; no live output or interrupt while the command runs; `respondToBashCommands: false` is not honoured (Claude always answers).

## Install

```
claude plugin marketplace add WDAFNMS/claude-bang-shell
claude plugin install bang-shell@claude-bang-shell
```

Uninstall:

```
claude plugin uninstall bang-shell@claude-bang-shell
claude plugin marketplace remove claude-bang-shell
```

Claude Code leaves an empty `enabledPlugins` / `extraKnownMarketplaces` object in `settings.json`
and a cache copy marked `.orphaned_at` under `~/.claude/plugins/cache/`; both are harmless.

## Security — read this

`!cmd` runs **any** command you type, as you, with no permission prompt and no sandbox — the same
as the TUI's `!` mode. It bypasses Claude's permission rules and tool allow-lists. `!git commit`,
`!git push` and `!rm -rf` all just run. Project rules such as "Claude must not commit" are instructions to
the model; they do not stop a command you type yourself. In an SDK host every chat message arrives with
origin `sdk`, so the plugin cannot tell your typing from another program feeding the same session.
Do not install it where others can type into your session.

## Status

Experimental. Built against Claude Code 2.1.317 and its mod API (`claude-code` types), which has no
published stability promise. Verified in isolated `claude -p` runs with stream-json input: the hook fires,
commands that the default permission mode refuses (`cd … && …`, `git -C …`, `$(…)`) run, the working
directory carries over and is reset outside the project, exit codes are reported, the allowance ends when
the command ends, and ordinary prompts pass through untouched. Used for real in Orca's structured chat
(0.1.x, 0.2.x). Shell state (`!cd`) is shared with Claude's own Bash tool in Orca chat. A session written by 0.3.0
was resumed in the terminal TUI and each output rendered as bash output. **Not verified:** how Orca's chat view
renders the rows, and a TUI resume of a session that mixes native and plugin-written rows beyond the single case tried.

## License

MIT
