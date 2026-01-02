# Obsidian Backlinks Chronological Sort

A custom Obsidian plugin that sorts backlinks chronologically (newest first) instead of alphabetically.

## What It Does

- Sorts backlinks in both **in-document backlinks** (at bottom of notes) and **sidebar backlinks pane**
- Parses dates from daily note filenames in Roam format (`December 4th, 2025`)
- Parses dates embedded in brackets (`# [[August 12th, 2025]] leadership call`)
- Reads `edited` or `created` frontmatter dates for regular notes
- Falls back to file modification time (mtime) if no other date is available
- All items are interleaved chronologically with newest first

## Installation

1. Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/backlinks-chronosort/` folder
2. Enable the plugin in Obsidian Settings → Community Plugins

## Settings

- **Enable for in-document backlinks**: Sort backlinks shown at the bottom of notes
- **Enable for sidebar backlinks**: Sort backlinks shown in the sidebar pane
- **Sort descending (newest first)**: When enabled, most recent dates appear at the top
- **Debug mode**: Log sorting information to console

## How It Works

### Technical Implementation

1. **MutationObserver Pattern**: The plugin uses `MutationObserver` to detect when Obsidian renders backlinks in the DOM, then re-sorts them after a 150ms debounce delay.

2. **Infinite Loop Prevention**: A `isSorting` flag prevents the observer from triggering during DOM manipulation.

3. **Date Priority**:
   - First tries to parse Roam-format dates from the filename (`MMMM Do, YYYY`)
   - Then tries to find dates inside `[[...]]` brackets in the text
   - Then tries ISO format (`YYYY-MM-DD`)
   - For regular notes, reads frontmatter `edited` or `created` field
   - Falls back to file mtime

4. **Frontmatter Format**:
   ```yaml
   ---
   created: 2025-10-02
   edited: 2025-10-07
   ---
   ```

## Background: Why This Plugin Was Created

This plugin was built to solve a specific problem after migrating from Roam Research to Obsidian:

1. **Roam's daily notes** use the format `December 4th, 2025` which sorts alphabetically in Obsidian (all "August" notes together, all "December" notes together, etc.)

2. **Bulk import corrupted mtimes**: When importing ~3,200 notes from Roam, all files got the same modification timestamp (the import date), making mtime useless for sorting.

3. **Solution**: Extract original timestamps from Roam's JSON export and store them as YAML frontmatter, then build a plugin to sort by these dates.

## Frontmatter Migration

The frontmatter was migrated from Roam's JSON export using a Node.js script that:

1. Parsed the Roam JSON export to extract `create-time` and `edit-time` for each page
2. Matched pages to existing markdown files
3. Prepended YAML frontmatter with `created` and `edited` dates
4. Migrated 1,619 files total

**Important**: After modifying files externally, you must restart Obsidian completely (not just reload) for the metadata cache to pick up the new frontmatter.

## Files

```
obsidian-backlinks-chronosort/
├── main.ts              # Main plugin source code
├── main.js              # Compiled plugin (what Obsidian loads)
├── manifest.json        # Plugin manifest
├── package.json         # Node.js dependencies
├── tsconfig.json        # TypeScript configuration
├── esbuild.config.mjs   # Build configuration
└── README.md            # This file
```

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Copy to your vault
cp main.js ~/.obsidian/plugins/backlinks-chronosort/
```

## Known Limitations

- Only sorts top-level backlink items (the file names), not nested content within each backlink
- Items without parseable dates or frontmatter sort to the bottom (timestamp 0)
- Some heading content may be extracted instead of filenames in certain edge cases

## License

MIT
