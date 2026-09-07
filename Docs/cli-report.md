# CLI integration report

Implemented `electron/cli/cli-runner.ts` with the requested public `AIProvider`, `CLIConfig`, `CLIRequest`, `CLIRunner.handleRun`, `CLIRunner.handleCancel`, and `handleDiscoverExecutable` API.

## Execution and privacy

- Spawns the explicitly selected absolute executable with `shell: false`; instruction and note are written only to stdin, never argv.
- Creates a private temporary working directory for every request. Deletes it after child `close`, including failure/cancellation paths. Immediate cancellation during asynchronous preparation prevents spawn.
- One request per runner, 120-second default timeout (configurable up to 10 minutes), 1 MiB combined input limit, 2 MiB combined stdout/stderr limit. UTF-8 buffers are decoded after collection to preserve multibyte characters. Codex final response file is separately bounded before reading and rejects symlinks/non-files.
- Cancellation/timeout sends SIGTERM to the detached process group on macOS/Linux, escalating to SIGKILL after 250 ms. The run remains active until streams close and cleanup finishes. Windows fallback terminates the immediate child only; macOS is the target platform.
- Removes inherited `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, and Claude nested-session markers. Preserves existing CLI authentication without reading token files. Diagnostic errors omit stdout/stderr and note text.
- Discovery checks home `.local/bin`, `.npm-global/bin`, `.npm/bin`, `.volta/bin`, Homebrew paths, NVM versions, and absolute PATH entries; it does not execute a shell or the discovered program. Missing discovery returns an empty string.

## Locally verified command capabilities

Read local command help/version without model calls on 2026-09-07:

- `codex --version`: `codex-cli 0.153.4`.
- `codex exec --help`: verified stdin `-`, `--sandbox read-only`, `--skip-git-repo-check`, `--ephemeral`, `--ignore-user-config` (auth retained), `--ignore-rules`, `--color never`, `--output-last-message`.
- `codex features list`: verified `shell_tool`, `unified_exec`, `hooks`, `plugins`, `apps`, `multi_agent`, `browser_use`, `in_app_browser`, `image_generation`; each is passed with `--disable`. Web search is also configured disabled. No sandbox bypass flags.
- `claude --version`: `2.1.258 (Claude Code)`.
- `claude --help`: verified `-p`, `--output-format text`, `--tools ""`, `--strict-mcp-config`, `--mcp-config '{"mcpServers":{}}'`, `--no-session-persistence`, `--safe-mode`, `--disable-slash-commands`. These are all passed. `--bare` is deliberately omitted because its help says it prevents OAuth/keychain authentication.
- Optional `--model` is passed only for a nonblank configured model.

## Verification

Tests were written before implementation; the initial API stub failed 10 behavioral cases. After implementation, canonical `npm run test -- tests/cli.test.ts` passes all 13 tests on project Vitest 5.0.0. Tests use temporary Node fixture executables, never the live AI service.

Covered: literal shell metacharacters and Korean input, argv exclusion, isolated cwd cleanup, environment removal, Codex final-message selection and read-only flags, exit failure, empty result, private diagnostics, missing executable, oversized input, stdout/stderr limits, final-file limit, timeout, immediate/running cancellation, runner reuse, directory retention during termination, concurrent rejection, and executable discovery from a fixture installation.

Isolated strict TypeScript check runs with the project's compiler and `--ignoreConfig` for this module and its test.

## Remaining limitations

- No paid/live AI calls or login actions were performed. End-to-end provider behavior requires the user's existing CLI login and an explicit button click. Older CLI versions may reject verified flags; errors instruct users to check configuration.
- CLI authentication, model availability, provider retention, and administrator-managed policy remain outside this module. A read-only sandbox is not a full confidentiality boundary for the host CLI itself; the chosen executable must be trusted. This module provides no API-key integration.
- Final output file size is checked after process completion; stdout/stderr are capped while streaming. A misbehaving executable could consume temporary disk before exit/timeout.
- Process-group cancellation cannot control processes that deliberately detach into another group.
