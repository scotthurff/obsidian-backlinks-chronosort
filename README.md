# Backlinks Chronological Sort

An Obsidian plugin that sorts backlinks by modification date, with newest first.

## Features

- Sorts in-document backlinks (at the bottom of notes)
- Sorts sidebar backlinks pane
- Sorts backlinks in Daily Notes Editor plugin views
- Uses frontmatter `edited` or `created` fields when available
- Falls back to file modification time
- Parses Roam-style dates (e.g., "January 20th, 2026")
- Parses ISO dates (e.g., "2026-01-20")

## Installation

### Manual

1. Download `main.js` and `manifest.json` from the latest release
2. Create folder: `<vault>/.obsidian/plugins/backlinks-chronosort/`
3. Copy files into the folder
4. Enable the plugin in Obsidian settings

### From Source

```bash
git clone https://github.com/scotthurff/obsidian-backlinks-chronosort.git
cd obsidian-backlinks-chronosort
npm install
npm run build
```

Copy `main.js` and `manifest.json` to your vault's plugin folder.

## Settings

- **Enable for in-document backlinks** - Sort backlinks shown at the bottom of notes
- **Enable for sidebar backlinks** - Sort backlinks shown in the sidebar pane
- **Sort descending (newest first)** - When enabled, most recent dates appear at the top
- **Debug mode** - Log sorting information to console

## How It Works

The plugin listens for navigation events and sorts backlink items by:

1. Parsing the filename as a date (Roam-style or ISO format)
2. Reading `edited` or `created` from frontmatter
3. Using file modification time as fallback

Items are sorted in the DOM without affecting Obsidian's internal state.

## License

MIT
