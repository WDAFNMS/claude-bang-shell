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
- Because the rows are TUI-shaped, a session continued in the terminal (`claude --resume`) draws each command and
  its output like a native one (`!  cmd` / `⎿ …`) instead of raw tags.
- **Transcript patch.** The host marks the `<bash-input>` row it lets a plugin append as a meta row, which the TUI does
  not draw. Right after appending, the plugin therefore blanks that row's `"isMeta":true` marker in the session file,
  in place and byte for byte (the marker is replaced by the same number of spaces; the file is never rewritten, so
  Claude's own appends are not disturbed). It needs `python3` (on macOS it is skipped unless the Xcode command line tools
  are installed, so no install dialog appears). If anything is off — file or row not found, no Python, a different
  file layout in a future Claude Code — it does nothing and you get the older behaviour (output drawn, `! cmd` line
  missing). It only ever touches rows the plugin itself appended.
- The plugin writes no files and keeps no state.

Differences from the TUI: no live output or interrupt while the command runs; `respondToBashCommands: false` is not honoured (Claude always answers).

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

## A bash-mode button for Orca

Typing the leading `!` by hand works everywhere. In Orca you can also get a real **bash mode** (a `bash` button in
the composer, a tinted box, the `!` added for you on send) with the companion Orca plugin
[orca-bash-mode](https://github.com/WDAFNMS/orca-bash-mode):

```
orca plugin install WDAFNMS/orca-bash-mode
```

That plugin only draws the mode and sends `!command`; this one runs the command. Install both.
给 Orca 用的配套插件 orca-bash-mode 提供输入框里的 bash 模式按钮；它只负责界面，命令仍由本插件执行。

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
(0.1.x, 0.2.x). Shell state (`!cd`) is shared with Claude's own Bash tool in Orca chat. A session written by 0.4.0
was resumed in the terminal TUI and each command and output rendered like a native one; the file stayed valid JSON on every line. **Not verified:** how Orca's chat view
renders the rows, and a TUI resume of a session that mixes native and plugin-written rows beyond the single case tried.

## License

MIT
