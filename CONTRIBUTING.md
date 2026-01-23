# Contributing to Scimax VS Code

Thank you for your interest in contributing to Scimax VS Code! This document provides guidelines and requirements for contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Commit Messages](#commit-messages)
- [Documentation](#documentation)
- [Reporting Issues](#reporting-issues)

## Development Setup

### Prerequisites

- Node.js 18+
- npm
- VS Code 1.85+

### Getting Started

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   make compile   # TypeScript compilation only
   # or
   make           # Full build including VSIX packaging
   ```
4. Run tests to verify setup:
   ```bash
   npm run test
   ```

### Development Workflow

1. Make your changes in `src/`
2. Rebuild and install the extension:
   ```bash
   make
   code --install-extension scimax-vscode-*.vsix --force
   ```
3. Reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window")
4. Test your changes manually and with automated tests

### Useful Commands

```bash
make              # Full build: install deps, compile TypeScript, package VSIX
make compile      # TypeScript compilation only
make package      # Build VSIX (runs compile first)
make clean        # Remove out/, node_modules/, and *.vsix files

npm run compile   # Direct TypeScript compilation
npm run watch     # Watch mode for development
npm run lint      # ESLint
npm run test      # Run all tests with Vitest
```

## Testing Requirements

All contributions must include appropriate tests and pass the existing test suite.

### For Bug Fixes

1. **Write a failing test** that reproduces the bug
2. **Fix the bug** so the test passes
3. **Verify all other tests still pass**: `npm run test`
4. The test serves as both verification and regression prevention

### For New Features

1. **Write tests** that cover the new functionality
2. **Implement the feature** to pass the tests
3. **Verify all tests pass**: `npm run test`
4. Tests should cover:
   - Happy path (expected usage)
   - Edge cases
   - Error conditions where appropriate

### Running Tests

```bash
# Run all tests
npm run test

# Run tests matching a pattern
npm run test -- --testNamePattern="citation"

# Run a specific test file
npm run test src/parser/__tests__/orgParser.test.ts

# Run performance baseline tests
npm run test -- --testNamePattern="baseline"
```

### Performance Testing

Before committing parser or database changes, run performance baseline tests:

```bash
npm run test -- --testNamePattern="baseline"
```

Key metrics to watch:
- Parse time for 1000-line files: < 50ms
- Heading extraction: < 10ms
- Source block detection: < 15ms

If performance degrades significantly, investigate before committing.

## Code Style

### TypeScript

- Use TypeScript for all new code
- Run ESLint before committing: `npm run lint`
- Follow existing code patterns in the codebase

### Naming Conventions

**Database fields** (in `OrgDbSqlite` and CLI): Use snake_case
```typescript
SearchResult.file_path    // not filePath
SearchResult.line_number  // not lineNumber
AgendaItem.days_until     // not daysUntil
```

**TypeScript code**: Use camelCase for variables/functions, PascalCase for types/classes

### Module Structure

Follow the Manager + Commands + Providers pattern:
- `*Manager.ts` - Core logic, state management
- `commands.ts` - VS Code command registrations
- `providers.ts` - VS Code language providers

## Pull Request Process

1. **Create a branch** from `main` for your changes
2. **Make your changes** following the guidelines in this document
3. **Run the full test suite**: `npm run test`
4. **Run linting**: `npm run lint`
5. **Update documentation** if needed (see [Documentation](#documentation))
6. **Create a pull request** with:
   - Clear description of the changes
   - Reference to any related issues
   - Summary of test coverage added

### PR Checklist

- [ ] Tests added/updated for the changes
- [ ] All tests pass (`npm run test`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Documentation updated if needed
- [ ] Code follows existing patterns and style

## Commit Messages

Write clear, descriptive commit messages:

```
Add citation support for HTML export

- Implement CitationProcessor class using citation-js
- Add CSL style support for bibliography formatting
- Update HTML export to process citation links

Fixes #123
```

Guidelines:
- Use present tense ("Add feature" not "Added feature")
- First line is a brief summary (50 chars or less ideal)
- Add detail in the body if needed
- Reference issues when applicable

## Documentation

When adding or changing features, update the relevant documentation in `docs/`.

### What to Update

| Change Type | Files to Update |
|-------------|-----------------|
| New command | `docs/keybindings.org`, feature-specific doc |
| New keybinding | `docs/keybindings.org`, `docs/speed-commands.org` |
| New setting | `docs/configuration.org`, `package.json` |
| New feature | Create/update feature doc in `docs/` |
| Database changes | `docs/18-database-search.org` |
| Any doc change | Update `docs/00-index.org` TOC |

### Documentation Guidelines

- Include command names (e.g., `scimax.org.cycleTodo`)
- Include keybindings with proper format (`Ctrl+C Ctrl+T`)
- Add examples showing usage
- Cross-link to related documentation with a "Related Topics" section

### Keybinding Conflicts

Before adding keybindings, check for conflicts:

```bash
# Check for existing uses of a key sequence
grep -n "ctrl+c ctrl+p" package.json
grep -r "C-c C-p\|Ctrl+C Ctrl+P" docs/
```

## Reporting Issues

### Bug Reports

Include:
- VS Code version
- Extension version
- Steps to reproduce
- Expected vs actual behavior
- Sample file content if relevant (minimal reproduction)

### Feature Requests

Include:
- Clear description of the feature
- Use case explaining why it's needed
- Examples of how it would work

## Questions?

If you have questions about contributing, feel free to:
- Open an issue with your question
- Check existing issues and documentation

Thank you for contributing!
