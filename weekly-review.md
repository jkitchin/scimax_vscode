# Weekly Code Review Guide

This document provides instructions for conducting a weekly code review of the scimax_vscode codebase. The goal is to identify issues and create GitHub issues for tracking, rather than making direct changes.

## Prerequisites

```bash
# Ensure you're on a clean branch
git checkout main
git pull origin main

# Install dependencies if needed
npm install
```

## 1. Documentation Audit

### Check for Undocumented Commands

Run the audit script to find commands missing from documentation:

```bash
npx ts-node --project scripts/tsconfig.json scripts/audit-keybindings.ts
```

**What to look for:**
- Commands in `package.json` but not in `docs/25-commands.org`
- Commands in docs but removed from `package.json`
- Keybinding conflicts (same key, overlapping contexts)

**If issues found, create a GitHub issue:**

```bash
gh issue create --title "Documentation: Missing command documentation" --body "$(cat <<'EOF'
## Summary
The following commands are missing from documentation:

- [ ] `scimax.example.command1`
- [ ] `scimax.example.command2`

## Files to update
- `docs/25-commands.org`
- `docs/24-keybindings.org`

## How to verify
Run: `npx ts-node --project scripts/tsconfig.json scripts/audit-keybindings.ts`
EOF
)" --label "documentation"
```

### Check Documentation Accuracy

```bash
# Count commands in package.json
grep -c '"command":' package.json

# Count documented commands
grep -c '\[\[cmd:scimax\.' docs/25-commands.org
```

## 2. Security Audit

### Check for Shell Injection Vulnerabilities

```bash
# Look for shell: true in spawn calls (CRITICAL)
grep -rn "shell:\s*true" src/ --include="*.ts"

# Look for exec() calls (potential injection)
grep -rn "\.exec(" src/ --include="*.ts" | grep -v "db.execute"
```

**If issues found:**

```bash
gh issue create --title "Security: Potential shell injection vulnerability" --body "$(cat <<'EOF'
## Summary
Found potentially unsafe shell execution patterns.

## Locations
- `src/file.ts:123` - `spawn(..., { shell: true })`

## Recommended Fix
Use array-based arguments instead of shell: true

## References
See CLAUDE.md security section
EOF
)" --label "security,high-priority"
```

### Check for XSS Vulnerabilities

```bash
# Look for innerHTML without escaping
grep -rn "innerHTML\s*=" src/ --include="*.ts" | grep -v "escapeHtml"

# Look for template literals in HTML context
grep -rn '\${.*}.*innerHTML' src/ --include="*.ts"
```

### Check for Hardcoded Secrets

```bash
# Look for API keys or tokens
grep -rni "api.key\|apikey\|api_key\|secret\|token" src/ --include="*.ts" | grep -v "SecretStorage\|getSecret"
```

### Check for Predictable Temp Files

```bash
# Look for Date.now() in temp file names (should use crypto.randomBytes)
grep -rn "Date.now()" src/ --include="*.ts" | grep -i "tmp\|temp"
```

## 3. Performance Audit

### Check for Synchronous File Operations

```bash
# Find sync file operations (should be async in most cases)
grep -rn "Sync(" src/ --include="*.ts" | grep -E "(readFile|writeFile|mkdir|readdir|stat|exists)" | grep -v "test\|__tests__"
```

**If issues found:**

```bash
gh issue create --title "Performance: Synchronous file operations" --body "$(cat <<'EOF'
## Summary
Found synchronous file operations that may block the UI.

## Locations
- `src/file.ts:123` - `fs.readFileSync()`

## Recommended Fix
Convert to async using `fs.promises` or callback-based API

## Impact
May cause UI freezes on large files or slow file systems
EOF
)" --label "performance"
```

### Check for Sequential Awaits in Loops

```bash
# Look for await inside for/while loops
grep -rn -A2 "for\s*(" src/ --include="*.ts" | grep -B2 "await "
```

### Check for Regex in Loops

```bash
# Look for new RegExp inside loops
grep -rn -B5 "new RegExp" src/ --include="*.ts" | grep -E "(for|while|forEach|map)"
```

### Check for String Concatenation in Streams

```bash
# Look for += with strings in data handlers
grep -rn "+=" src/ --include="*.ts" | grep -E "(stdout|stderr|data)"
```

## 4. Redundancy Audit

### Check for Duplicate Constants

```bash
# Find duplicate day-of-week arrays
grep -rn "Sun.*Mon.*Tue" src/ --include="*.ts" | grep -v "dateConstants"

# Find duplicate month arrays
grep -rn "Jan.*Feb.*Mar" src/ --include="*.ts" | grep -v "dateConstants"
```

**If duplicates found:**

```bash
gh issue create --title "Code Quality: Duplicate constants found" --body "$(cat <<'EOF'
## Summary
Found duplicate constant definitions that should use shared utilities.

## Locations
- `src/file1.ts:123` - Duplicate days array
- `src/file2.ts:456` - Duplicate days array

## Recommended Fix
Import from `src/utils/dateConstants.ts`:
\`\`\`typescript
import { DAY_NAMES_SHORT } from '../utils/dateConstants';
\`\`\`
EOF
)" --label "code-quality,tech-debt"
```

### Check for Duplicate Escape Functions

```bash
# Find duplicate escapeHtml implementations
grep -rn "function escapeHtml" src/ --include="*.ts" | grep -v "escapeUtils"
grep -rn "escapeHtml\s*=" src/ --include="*.ts" | grep -v "escapeUtils\|import"
```

### Check for Duplicate Timestamp Formatting

```bash
# Find timestamp formatting functions
grep -rn "formatTimestamp\|formatDate.*org" src/ --include="*.ts"
```

## 5. Consistency Audit

### Check for Inconsistent Logging

```bash
# Count console.error vs centralized logger usage
echo "console.error usage:"
grep -rn "console.error" src/ --include="*.ts" | wc -l

echo "Centralized logger usage:"
grep -rn "log.error\|databaseLogger\|parserLogger" src/ --include="*.ts" | wc -l
```

### Check for Naming Convention Violations

```bash
# Find async methods with "Async" suffix (should be avoided)
grep -rn "Async\s*(" src/ --include="*.ts" | grep "async\|Promise"
```

## 6. Type Safety Audit

### Check for 'any' Types

```bash
# Count explicit 'any' types
grep -rn ":\s*any" src/ --include="*.ts" | wc -l

# Find implicit any (from compile output)
npx tsc --noEmit 2>&1 | grep "implicitly has an 'any' type" | wc -l
```

## 7. Test Coverage Check

```bash
# Run tests and check for failures
npm test 2>&1 | tail -20

# Check test file count vs source file count
echo "Source files:"
find src -name "*.ts" ! -name "*.test.ts" ! -name "*.spec.ts" | wc -l

echo "Test files:"
find src -name "*.test.ts" -o -name "*.spec.ts" | wc -l
```

## Creating a Summary Issue

After completing all checks, create a summary issue:

```bash
gh issue create --title "Weekly Review: $(date +%Y-%m-%d)" --body "$(cat <<'EOF'
## Weekly Code Review Summary

**Date:** $(date +%Y-%m-%d)
**Reviewer:** [Your Name]

### Findings Summary

| Category | Issues Found | Severity |
|----------|-------------|----------|
| Security | 0 | - |
| Performance | 0 | - |
| Documentation | 0 | - |
| Redundancy | 0 | - |
| Consistency | 0 | - |

### Details

#### Security
- No issues found / [List issues]

#### Performance
- No issues found / [List issues]

#### Documentation
- No issues found / [List issues]

#### Code Quality
- No issues found / [List issues]

### Recommended Actions
1. [Action item 1]
2. [Action item 2]

### Notes
[Any additional observations]
EOF
)" --label "weekly-review"
```

## Automation Script

Save this as `scripts/weekly-review.sh`:

```bash
#!/bin/bash
# Weekly code review automation script

set -e

echo "=== Weekly Code Review ==="
echo "Date: $(date)"
echo ""

# Documentation audit
echo "### Documentation Audit ###"
npx ts-node --project scripts/tsconfig.json scripts/audit-keybindings.ts 2>/dev/null || echo "Audit script not available"

echo ""
echo "### Security Audit ###"

echo "Checking for shell: true..."
SHELL_TRUE=$(grep -rn "shell:\s*true" src/ --include="*.ts" 2>/dev/null | wc -l)
echo "  Found: $SHELL_TRUE instances"

echo "Checking for innerHTML without escaping..."
INNER_HTML=$(grep -rn "innerHTML\s*=" src/ --include="*.ts" 2>/dev/null | grep -v "escapeHtml" | wc -l)
echo "  Found: $INNER_HTML instances"

echo ""
echo "### Performance Audit ###"

echo "Checking for sync file operations..."
SYNC_OPS=$(grep -rn "Sync(" src/ --include="*.ts" 2>/dev/null | grep -E "(readFile|writeFile|mkdir|readdir)" | grep -v "test" | wc -l)
echo "  Found: $SYNC_OPS instances"

echo ""
echo "### Redundancy Audit ###"

echo "Checking for duplicate day arrays..."
DAY_ARRAYS=$(grep -rn "Sun.*Mon.*Tue" src/ --include="*.ts" 2>/dev/null | grep -v "dateConstants" | wc -l)
echo "  Found: $DAY_ARRAYS duplicates"

echo ""
echo "### Consistency Audit ###"

echo "console.error usage:"
CONSOLE_ERR=$(grep -rn "console.error" src/ --include="*.ts" 2>/dev/null | wc -l)
echo "  Found: $CONSOLE_ERR instances"

echo ""
echo "=== Review Complete ==="
```

Make it executable:

```bash
chmod +x scripts/weekly-review.sh
```

## Schedule

Run this review:
- **When:** Every Monday morning
- **Duration:** ~30 minutes
- **Output:** GitHub issues for any findings

## References

- `CLAUDE.md` - Development guidelines and security rules
- `CODE_REVIEW_AUDIT.md` - Previous audit findings and fixes
- `SECURITY_AUDIT_REPORT.md` - Security audit details
