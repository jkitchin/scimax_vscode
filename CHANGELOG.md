# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-02-14

### Fixed

- **LaTeX export: duplicate packages** - Hardcoded "essential packages" (inputenc, fontenc, graphicx, hyperref, natbib) were duplicating packages from the `defaultPreamble` setting. All default packages now come solely from the user-configurable `scimax.export.latex.defaultPreamble` setting.
- **LaTeX export: org-ref v3 citations** - `cite:&key` was exporting as `\cite{&key}` instead of `\cite{key}`. Now correctly strips `&` prefixes and converts `;` separators to `,` for all citation commands.
- **LaTeX export: `bibliographystyle:` links** - `bibliographystyle:unsrtnat` was passing through as plain text. Now recognized by both parsers and correctly exports as `\bibliographystyle{unsrtnat}`.
- **Rectangle mark mode operation switching** - Invoking a different rectangle command while in mark mode (e.g., copy while in open mode) now executes the new operation instead of the old one
- **Rectangle mark mode immediate execution** - Rectangle commands execute immediately when invoked during mark mode, no double-Enter needed

### Added

- **Rectangle kill/copy to system clipboard** - Kill (`C-x r k`) and copy (`C-x r M-w`) now write rectangle contents to the system clipboard in addition to the internal rectangle register

### Changed

- `scimax.export.latex.defaultPreamble` default now includes `fontenc`, `hyperref`, and `natbib`

## [0.3.0] - 2026-02-04

### Added

#### Core Features
- **Link graph visualization** - Interactive graph view showing connections between org files
- **Plugin extension architecture** - Extensible system for Babel executors, export hooks, and block extensions
- **Calendar date picker** - Visual calendar for inserting deadlines and scheduling timestamps
- **Dired file manager** - Full Emacs-style file manager with standard keybindings
- **Find-file command** (C-x C-f) - Quick file navigation with create-new-file option
- **Space-separated fuzzy matching** in project picker for better file discovery

#### Export System
- **Custom exporter system** with Handlebars template support
- **Jupyter Notebook (ipynb) export** - Convert org files to Jupyter notebooks
- **DOCX export** via Pandoc integration
- **LaTeX manuscript flattening** for journal submission (single-file output)
- **Document template system** for consistent document creation

#### Reference Management
- **Zotero citation support** - Integration with Zotero library
- **CrossRef search command** - Search and insert citations from CrossRef
- **SOTA search** with query expansion and reranking for literature discovery

#### Integrations
- **Excalidraw integration** - Embed and edit Excalidraw diagrams
- **Database extension points** for knowledge graph applications

#### CLI
- `scimax db scan` - Batch scan and index directories
- `scimax db publish` - Publish org projects to static sites
- `scimax agenda` - View agenda from command line
- `scimax export` - Export files from command line

### Fixed

#### Security
- Parser crash vulnerabilities from malformed input (heading recursion, unclosed blocks)
- XSS vulnerabilities in HTML export (proper content escaping)
- Command injection in PDF export (removed shell: true)
- Predictable temp file names (now using crypto.randomBytes)

#### Stability
- Memory leaks and OOM crashes during large file indexing
- Database locking issues with concurrent access
- Windows path handling in multiple modules

#### Parser
- Heading extraction edge cases
- Source block detection with unusual delimiters
- Table formula evaluation errors
- Link parsing with special characters

### Changed

- Unified navigation keybindings across org/markdown/LaTeX modes
- Improved table formula system with better error messages
- Centralized logging system with module-specific loggers
- Database operations now use retry logic for transient failures
- Better error handling throughout with detailed logging

### Deprecated

- None

### Removed

- None

### Security

- API keys now stored in OS credential manager via SecretStorage
- LaTeX compilation uses `-shell-restricted` by default
- Parser has built-in limits to prevent DoS from malformed input
- SQL queries use parameterized statements throughout

## [0.2.0] - Previous Release

Initial tracked release with core org-mode features, Babel execution, journal system, and database-backed search.
