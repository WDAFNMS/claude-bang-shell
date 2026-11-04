# claude-bang-shell

A Claude Code plugin (a "mod") that gives chats driven through the Agent SDK — for example
Orca's structured chat — the TUI's `!` shell mode. 在 SDK 宿主(如 Orca 的 structured chat)里,
让输入框里的 `!命令` 像终端版 Claude Code 那样执行。

In the Claude Code TUI, typing `!ls` runs `ls` yourself and shows the result to Claude. SDK
hosts send `!ls` to the model as plain text, so nothing runs. This plugin hooks `prompt.submit`,
runs the command, and passes the result to Claude as `<bash-input>/<bash-stdout>/<bash-stderr>`,
so Claude answers right after the command, as in the TUI.

## Behaviour

- Only prompts whose first character is `!` and whose origin is the user (`composer`) or the SDK
  host (`sdk`) are handled. Messages from peer sessions, schedules, channels or other plugins are never executed.
- The command runs the way Claude Code's Bash tool runs commands: `$SHELL -c`, the newest shell
  snapshot in `~/.claude/shell-snapshots/` is sourced (your aliases, functions, PATH), stdin is empty.
- The working directory persists between `!` commands of one session (kept in memory only).
- Output is cut at 30,000 characters per stream; the command is stopped after 120 s.
- The plugin writes no files and keeps no state.

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
`!git push` and `!rm -rf` all just run. Do not install it where others can type into your session.

## Status

Experimental. Built against Claude Code 2.1.317 and its mod API (`claude-code` types), which has no
published stability promise. Verified: the hook fires on stream-json input, runs the command with
the same shell environment as the Bash tool, and keeps the working directory between commands.
**Not verified:** how a given host displays the rewritten message, and the model's behaviour on it
with a live login.

## License

MIT
