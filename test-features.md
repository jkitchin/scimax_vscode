# Scimax VS Code Markdown Feature Test

This file tests markdown features in the Scimax VS Code extension.

## Text Formatting

Here are examples of **bold**, *italic*, ~~strikethrough~~, and `inline code`.

You can combine them: ***bold italic***, ~~*strikethrough italic*~~.

## Links

- [Package JSON](./package.json)
- [GitHub](https://github.com/jkitchin/scimax)
- <https://example.com> (auto-link)

## Task Management

### Today's Tasks

- [ ] Review pull requests @due(2026-01-11) @priority(A) #work
- [ ] Write documentation @due(2026-01-11) @priority(B) #docs #work
- [x] Morning standup @due(2026-01-11) #meeting

### This Week

- [ ] Implement new feature @due(2026-01-15) @priority(A) @project(scimax-vscode) #feature
- [ ] Fix bug in parser @due(2026-01-13) @priority(B) @project(scimax-vscode) #bug
- [ ] Update dependencies @scheduled(2026-01-14) @priority(C) #maintenance

### Recurring Tasks

- [ ] Weekly review @due(2026-01-12) @priority(B) #review
- [ ] Monthly report @due(2026-01-31) @priority(A) #report

### Project: scimax-vscode

- [ ] Add timestamp support @due(2026-01-11) @priority(A) @project(scimax-vscode) #feature
- [ ] Test folding in LaTeX @due(2026-01-12) @priority(B) @project(scimax-vscode) #testing
- [x] Fix minimatch import @project(scimax-vscode) #bug

### By Priority

#### High Priority (A)
- [ ] Critical security update @due(2026-01-11) @priority(A) #security
- [ ] Customer demo preparation @due(2026-01-12) @priority(A) #demo

#### Medium Priority (B)
- [ ] Refactor database module @priority(B) @project(scimax-vscode) #refactor
- [ ] Add unit tests @priority(B) #testing

#### Low Priority (C)
- [ ] Update README @priority(C) #docs
- [ ] Clean up old branches @priority(C) #maintenance

## Timestamps to Test

Try shift-up/down on these dates:

- Due date: @due(2026-01-11)
- Scheduled: @scheduled(2026-01-15)
- ISO date: 2026-01-11
- Another date: 2026-02-28

## Checkboxes

Use `C-c C-c` to toggle these:

- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked
  - [ ] Nested unchecked
  - [x] Nested checked
- [ ] Final item

## Code Blocks

### Python

```python
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2*np.pi, 100)
y = np.sin(x)

plt.plot(x, y)
plt.title("Sine Wave")
plt.show()
```

### JavaScript

```javascript
const fetchData = async (url) => {
    const response = await fetch(url);
    const data = await response.json();
    return data;
};

fetchData('https://api.example.com/data')
    .then(data => console.log(data))
    .catch(err => console.error(err));
```

### Bash

```bash
#!/bin/bash

for file in *.md; do
    echo "Processing: $file"
    wc -l "$file"
done
```

### JSON

```json
{
    "name": "scimax-vscode",
    "version": "0.1.0",
    "description": "Scimax features for VS Code",
    "features": [
        "org-mode support",
        "citations",
        "task management"
    ]
}
```

## Tables

| Feature | Status | Priority |
|---------|--------|----------|
| Folding | Done | High |
| Citations | Done | High |
| Tasks | In Progress | Medium |
| Timestamps | Done | Medium |

## Blockquotes

> This is a blockquote.
> It can span multiple lines.
>
> > Nested blockquotes are also supported.

## Lists

### Unordered

- Item 1
  - Nested item 1.1
  - Nested item 1.2
- Item 2
- Item 3

### Ordered

1. First step
2. Second step
   1. Sub-step 2.1
   2. Sub-step 2.2
3. Third step

### Mixed

1. First ordered item
   - Unordered sub-item
   - Another sub-item
2. Second ordered item

## Horizontal Rules

Content above

---

Content below

***

More content

## Images

![Alt text](./icon.png "Optional title")

## Footnotes

Here is a sentence with a footnote[^1].

Another sentence with a different footnote[^note].

[^1]: This is the footnote content.
[^note]: This is a named footnote with more details.

## Math (if supported)

Inline math: $E = mc^2$

Display math:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

## HTML (inline)

<details>
<summary>Click to expand</summary>

This content is hidden by default.

- Hidden item 1
- Hidden item 2

</details>

## Tags Demo

Tasks can have multiple tags:

- [ ] Multi-tag task @due(2026-01-15) #tag1 #tag2 #tag3 @project(demo)

## Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `C-c C-c` | Toggle checkbox |
| `C-c C-d` | Insert due date |
| `C-c C-s` | Insert scheduled date |
| `C-c .` | Insert timestamp |
| `Shift+Up/Down` | Adjust timestamp |
| `C-c ]` | Insert citation |
| `Ctrl+Cmd+V` | Database menu |

---

*End of test file*
