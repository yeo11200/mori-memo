# CLI task requirements

Own only Sources/WikiCLI/, Tests/CLIChecks/, Docs/cli-report.md. Other workers edit other files; never revert their changes. Do not spawn agents. Do not commit files outside your ownership.

Build a Foundation Swift module for macOS14+, Swift6 compiler in Swift5 language mode, no package dependencies. Package manifest already defines WikiCLI and executable CLIChecks. Use standalone async @main assertion harness (Foundation, exit) rather than XCTest because only Command Line Tools are installed. Run via swift run CLIChecks with caches under /private/tmp if needed. Coordinate build commands; use --scratch-path /private/tmp/personal-wiki-cli-build to avoid contention.

Public contract (all public initializers required):
- enum AIProvider: String, CaseIterable, Codable, Sendable { case codex, claude }
- struct CLIConfiguration: Sendable { provider: AIProvider; executablePath: String; model: String; timeout: TimeInterval = 180 }
- struct AIRequest: Sendable { instruction: String; content: String }
- final class CLIRunner: @unchecked Sendable { init(); func run(_ request: AIRequest, configuration: CLIConfiguration) async throws -> String; func cancel() }
- static func CLIRunner.discoverExecutable(_ provider: AIProvider) -> String? (known install paths and PATH without shell, no credentials printed).

Requirements: no shell command interpolation. stdin carries untrusted note. Dedicated empty temporary cwd. One active task per runner; reject overlaps. Concurrent stdout/stderr drain or files to avoid pipe deadlock. Limit result/error size and timeout. Cancel must stop child and cleanup, races between start and cancellation safe; no orphan child when possible. No actual paid AI call during your tests. Read local codex exec --help / claude --help for supported flags.

Codex local help: exec -, --sandbox read-only, --skip-git-repo-check, --ephemeral, --ignore-user-config (auth still uses CODEX_HOME), --color never, --output-last-message FILE. Do not bypass sandbox/approvals. Disable exec tools via available supported configuration if verified from local codex source/schema; otherwise report exact boundary (read-only not zero read). Claude help: -p, --tools "" disables builtin tools, --strict-mcp-config, --mcp-config JSON, --setting-sources, --no-session-persistence, --safe-mode disables customizations but preserves auth. Avoid --bare because it disables OAuth/keychain authentication. Ensure predictable text-only editing, no project hooks or configured MCP services. Model empty uses provider default; never silently force GPT6 for Claude.

Create meaningful tests for literal shell metacharacters preserved on stdin, no unrequested process execution, error exit propagation, empty output rejection, output bounds, timeout, immediate/in-flight cancellation, reused runner after cancellation, whitespace model, executable missing. Fixture scripts in temporary folders are okay; do not test live AI. First write failing tests, run, implement, then pass. Do not modify manifest unless first coordinate.

Record supported CLI versions, flags, test command/output, precise limitations and public API in Docs/cli-report.md. Return short status and any concerns.
