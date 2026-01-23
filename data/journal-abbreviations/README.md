# Journal Abbreviation Data

This directory contains journal abbreviation data used by the Scimax VS Code extension to toggle between full journal names and their ISO 4 abbreviations.

## Data Sources

All abbreviation data is sourced from the **JabRef Abbreviation Repository**:
- **Repository**: https://github.com/JabRef/abbrv.jabref.org
- **Website**: https://abbrv.jabref.org/

The JabRef repository is a community-maintained collection of journal abbreviations following the ISO 4 standard and various discipline-specific conventions.

## Included Files

| File | Source | Description |
|------|--------|-------------|
| `journal_abbreviations_general.csv` | General | Cross-discipline abbreviations |
| `journal_abbreviations_acs.csv` | ACS | American Chemical Society journals |
| `journal_abbreviations_aea.csv` | AEA | American Economic Association journals |
| `journal_abbreviations_ams.csv` | AMS | American Mathematical Society journals |
| `journal_abbreviations_astronomy.csv` | Astronomy | Astronomy and astrophysics journals |
| `journal_abbreviations_entrez.csv` | Entrez/PubMed | Medline abbreviations (dotless) |
| `journal_abbreviations_geology_physics.csv` | Geology & Physics | Geology and physics journals |
| `journal_abbreviations_ieee.csv` | IEEE | IEEE journals and conferences |
| `journal_abbreviations_lifescience.csv` | Life Science | Biology and life science journals |
| `journal_abbreviations_mathematics.csv` | Mathematics | Math journals from MathSciNet |
| `journal_abbreviations_mechanical.csv` | Mechanical | Mechanical and biomechanical engineering |
| `journal_abbreviations_medicus.csv` | Index Medicus | NLM/Index Medicus abbreviations |
| `journal_abbreviations_meteorology.csv` | Meteorology | Atmospheric science journals |
| `journal_abbreviations_sociology.csv` | Sociology | Sociology journals |

## CSV Format

Files follow JabRef's CSV format:
```
"Full Journal Name","Abbreviation"[,"Shortest Abbreviation"]
```

The third column (shortest abbreviation) is optional.

## Updating the Data

Users can update the abbreviation data using the command:
- `Scimax: Update Journal Abbreviations` (`scimax.bibtex.updateAbbreviations`)

This downloads the latest versions from the JabRef repository.

## Custom Abbreviations

Users can add custom abbreviations that override the bundled data:
- Use `Scimax: Add Journal Abbreviation` (`scimax.bibtex.addAbbreviation`)
- Custom abbreviations are stored in the VS Code user storage directory
- Custom entries take priority over bundled data

## Related Standards

- **ISO 4**: International standard for abbreviating serial titles
- **ISSN LTWA**: List of Title Word Abbreviations maintained by the ISSN Network
- **CASSI**: Chemical Abstracts Service Source Index (chemistry-specific)

## License

The JabRef abbreviation data is available under the terms of the JabRef project's license.
See https://github.com/JabRef/abbrv.jabref.org for details.

## Last Updated

Data files bundled with extension: 2026-01-20
