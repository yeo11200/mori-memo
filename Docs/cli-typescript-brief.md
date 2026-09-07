# CLI integration task

Own electron/cli/, tests/cli.test.ts, Docs/cli-report.md only. You are not alone in this codebase. Do not revert others' edits or alter package/shared files. Do not spawn agents. Do not commit (root coordinates final state).

User wants a macOS personal wiki using existing local Claude/Codex CLI, manual button-triggered AI, no API key integration. Tech changed from Swift to Electron+React+TypeScript. Node24, vitest tests. Dependencies installing now, wait for root's ready message or use existing node tooling until ready. Write failing test then implement. No paid live calls in tests.

Public API in electron/cli/cli-runner.ts:
export type AIProvider = 'codex' | 'claude';
export interface CLIConfig { provider: AIProvider; executablePath: string; model?: string; timeoutMs?: number; }
export interface CLIRequest { instruction: string; content: string; }
export class CLIRunner { handleRun(request: CLIRequest, config: CLIConfig): Promise<string>; handleCancel(): void; }
export function handleDiscoverExecutable(provider: AIProvider): string;

Use Node child_process.spawn with shell:false, note on stdin, dedicated empty temp cwd; bounded UTF8 output, timeout, cancellation, process group termination on macOS, one active request per runner, cleanup even failures. Reject missing executable, input oversize, empty successful output, nonzero exit, overlaps. Don't delete active request directory until child closes. Don't inherit NODE_OPTIONS/ELECTRON_RUN_AS_NODE into child. Discover home .local/bin, npm dirs, /opt/homebrew/bin, /usr/local/bin and PATH (no shell).

Read actual local codex exec --help and claude --help. Codex currently supports exec -, --sandbox read-only, --skip-git-repo-check, --ephemeral, --ignore-user-config (auth retained), --color never, --output-last-message FILE. Disable tool capabilities/config if supported and verified, never bypass sandbox. Claude has -p, --tools "" (no builtins), --strict-mcp-config, --mcp-config JSON, --no-session-persistence, --safe-mode; avoid --bare (disables OAuth). CLI auth should use existing user login, no need to read/print tokens. Leave model unspecified if empty.

Tests: fixture executable scripts in temp dirs; literal shell metacharacters stay stdin and cause no extra files; success text; nonzero/empty output; max output; timeout; cancellation immediate and running; reuse after cancellation; concurrent runs rejected. Output diagnostics short and don't expose note body. Use npm run test -- tests/cli.test.ts when installed. Root is implementing renderer, vault and IPC concurrently.

Write report with API, command flags, version evidence, tests and remaining limitations. Return concise status only.
