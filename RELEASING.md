# Releasing scimax-vscode

Checklist and process for cutting a new release and publishing to the VS Code
Marketplace.

## Pre-release checklist

Work top to bottom. Don't tag until every box is checked.

### 0. Repository state

- [ ] You are on `main` and it is up to date with `origin/main`
      (`git fetch && git status -sb`).
- [ ] Working tree is clean — no uncommitted changes, no untracked files you
      intended to include (`git status` shows nothing).

### 1. Tests

- [ ] `npm test` passes locally on your primary platform.
- [ ] `npm run lint` is clean.
- [ ] CI is green on `main` — check the latest
      [Tests workflow](../../actions/workflows/test.yml) run.
- [ ] Parser benchmarks still hold:
      `npm run test -- --testNamePattern="Parser Benchmark Suite"`
      (see `src/parser/__tests__/orgParserBenchmark.test.ts` for thresholds).
- [ ] New features added in this release have tests. If you skipped tests for
      a feature, note the reason in the CHANGELOG entry so it is not forgotten.

### 2. Documentation

- [ ] Every new command is listed in `docs/25-commands.org`.
- [ ] Every new keybinding is listed in `docs/24-keybindings.org` and has a
      `when` context that avoids conflicts.
- [ ] Every new setting is described in `docs/26-configuration.org` with its
      default value, and the JSON schema in `package.json` matches.
- [ ] Run the audit script and fix any discrepancies it reports:
      `npx ts-node scripts/audit-keybindings.ts`
- [ ] `docs/00-index.org` Topic Index references any new feature docs.
- [ ] `README.md` "Codebase Statistics" section is refreshed if counts moved
      meaningfully (new modules, large refactors).
- [ ] Any `⚠️` / `👀` status emoji on new/changed headings have been reviewed
      and promoted to `✅`.

### 2a. Docs site and "Ask the docs" index

The hosted docs (GitHub Pages) and the WebLLM chat's search index
(`_static/chat-index.json`) are built from `docs/` by `scimax publish`. Only
pages listed in `docs/_toc.yml` are published *or* indexed for the chat.

- [ ] Every user-facing page in `docs/` is listed in `docs/_toc.yml`. This
      prints any that are missing (`00-index` is the `root:`; internal files such as
      `DOCUMENTATION_PLAN`, `index`, `review-agenda` and `sitemap` are expected):
      ```bash
      comm -23 <(ls docs/*.org | xargs -n1 basename | sed 's/\.org$//' | sort) \
               <(grep -o 'file: [^ ]*' docs/_toc.yml | cut -d' ' -f2 | sort)
      ```
- [ ] Rebuild the site and chat index locally; every page publishes with
      `Errors: 0`:
      ```bash
      npm run compile && node out/cli/index.js publish --force
      ```
- [ ] Check that the index covers every page and the new docs:
      ```bash
      node -e "const c=JSON.parse(require('fs').readFileSync('docs-html/_static/chat-index.json')).chunks; console.log(c.length, 'chunks,', new Set(c.map(x => x.page || x.url)).size, 'pages')"
      ```
- [ ] Open a page from `docs-html/` (e.g. `python3 -m http.server --directory docs-html`)
      and ask the chat a question about a feature in this release; the
      matching section should be in the results.
- [ ] If the WebLLM / transformers.js versions or model IDs in
      `book-chat.js` / `themeTypes.ts` were changed, check that the models
      still download and answer in the browser.
- [ ] After pushing, confirm the **Build and Deploy Documentation** workflow
      ran and the live site has the new pages. It runs on pushes to `main`
      that touch `docs/**`, `_config.yml`, the HTML exporter, the CLI or
      `src/publishing/**`; otherwise trigger it by hand:
      `gh workflow run docs.yml`

### 3. Changelog & version

- [ ] `## [Unreleased]` in `CHANGELOG.md` is **not empty** and accurately
      reflects the commits since the last release. Spot-check with
      `git log --oneline vX.Y.Z..HEAD` against the last released tag. Every
      user-visible change should have an entry.
- [ ] Move everything under `## [Unreleased]` in `CHANGELOG.md` into a new
      versioned section with today's date.
      Keep the empty `## [Unreleased]` header in place for the next cycle.
- [ ] Bump `version` in `package.json` following semver:
      - patch (`0.4.0` → `0.4.1`) — bug fixes only
      - minor (`0.4.0` → `0.5.0`) — new features, backwards-compatible
      - major (`0.4.0` → `1.0.0`) — breaking changes
- [ ] Commit the version bump and changelog as a single commit:
      `Release vX.Y.Z`.

### 4. Build smoke test

- [ ] `make` (or `npm run compile && npx vsce package`) succeeds with no
      TypeScript errors and no unexpected `vsce` warnings.
- [ ] Install the generated VSIX in a clean VS Code window and confirm the
      feature you released actually works end-to-end — type-check and test
      suites verify code correctness, not feature correctness.

## Release process

Once the checklist is clean:

```bash
# 1. Tag the release commit
git tag -a v0.4.1 -m "Release v0.4.1"
git push origin main --follow-tags

# 2. Create the GitHub release from the tag
gh release create v0.4.1 \
    --title "v0.4.1" \
    --notes-from-tag
```

The `notes-from-tag` flag uses the annotated tag message as the release body,
so keep the tag message short and point at the CHANGELOG entry. An alternative
is `--notes-file CHANGELOG.md` if you prefer pasting the full section.

Once the GitHub release is published, the **Publish** workflow (see below)
takes over and pushes the VSIX to the Marketplace automatically.

## Automated Marketplace publishing

The intended flow: pushing a GitHub release fires a workflow that builds the
extension and runs `vsce publish --packagePath`. This avoids manual `vsce`
invocations from developer machines and keeps the Marketplace token off local
disks.

### Required secrets

Add one repository secret under *Settings → Secrets and variables → Actions*:

| Secret | Purpose |
| --- | --- |
| `VSCE_PAT` | Azure DevOps PAT with `Marketplace (Manage)` scope for the `jkitchin` publisher |

Generate the PAT from <https://dev.azure.com> → *User Settings → Personal
Access Tokens*, scoped to *Marketplace (Manage)*. Rotate annually.

### Workflow

The automated publish lives in
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). It fires on
`release: published`, verifies that the release tag matches
`package.json` version, runs the test suite, packages the VSIX, pushes it to
the Marketplace with `vsce publish`, and attaches the VSIX to the GitHub
release as a downloadable asset.

The version guard means: if you push a tag `v0.4.1` but forgot to bump
`package.json` from `0.4.0`, the workflow fails before publishing — no stale
Marketplace builds.

### First-time setup

The first automated publish will fail without the `VSCE_PAT` secret. Steps to
bootstrap:

1. Create the Azure DevOps PAT described above.
2. Add `VSCE_PAT` as a repository secret.
3. Manually run `npx vsce login jkitchin` once locally so the publisher is
   verified on your machine. This is not required for the workflow but makes
   local emergency publishes possible.
4. Cut a patch release (e.g., `0.4.0 → 0.4.1`) with a trivial changelog entry
   to test the full pipeline end-to-end.

## Rolling back

If a release ships a regression:

1. `vsce unpublish jkitchin.scimax-vscode <version>` — removes that specific
   version from the Marketplace. Only available within a short window.
2. Otherwise, cut a new patch release with the fix. The Marketplace does not
   allow republishing a tag, so you cannot overwrite a broken build.
3. Yank the GitHub release (convert to draft) so users are not pointed at a
   broken VSIX while you work on the fix.
