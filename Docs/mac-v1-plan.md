# Mac v1 execution plan

Scope: user authorized a working Mac-only first version. The implementation is Electron + React + TypeScript. iPhone, CloudKit, Developer ID distribution and purchases are outside this implementation pass.

- [x] Core: local Markdown notes, atomic writes, recoverable trash, explicit save error reporting, revision history, export, links and backlinks, related notes.
- [x] CLI: Codex and Claude adapters, process I/O, safe argument handling, timeout, cancellation, manual-only execution; tests against fixture executables.
- [x] App: Electron three-pane React editor, recent/pinned notes, search, preview, links, graph, manual summary and rewrite results with original preservation.
- [x] Mac integration: quick note, screenshot attachment, configurable registered global shortcut and collision feedback.
- [x] Packaging: reproducible local arm64 .app, app smoke checks, meaningful core/CLI tests, code review.

Ruling: use Electron + Vite + React to build a native macOS app bundle; iOS targets stay in the future plan. No cloud dependency for Mac v1.
Ruling: Markdown is canonical. A derived in-memory index is sufficient for first local release; durable SQLite indexing stays in the scaling plan.
Ruling: tests are standalone executable checks so they run with Command Line Tools without XCTest installation.
Ruling: local development app is ad-hoc signed, not notarized. Do not claim distributable Developer ID release.

Task interface review:
| Producer | Consumer | Contract |
|---|---|---|
| WikiCore | App | Note ID and persisted revisions; pure link index; main UI owns state |
| WikiCLI | App | AIProvider, CLIConfiguration, AIRequest, CLIRunner async output and cancellation |
| App platform services | App | Callbacks for shortcut actions; screenshot URL |
| Build script | User | dist/PersonalWiki.app, no writes outside the project |

Progress: Mac v1 implementation and local arm64 packaging complete; notarization and iPhone remain future work.
