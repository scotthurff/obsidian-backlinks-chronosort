import { App, Plugin, PluginSettingTab, Setting, MarkdownView, TFile } from 'obsidian';

interface ChronoSortSettings {
    enableInDocument: boolean;
    enableSidebar: boolean;
    sortDescending: boolean;
    debugMode: boolean;
}

const DEFAULT_SETTINGS: ChronoSortSettings = {
    enableInDocument: true,
    enableSidebar: true,
    sortDescending: true,  // newest first
    debugMode: false  // Disable console logging by default
};

export default class BacklinksChronoSortPlugin extends Plugin {
    settings: ChronoSortSettings;
    private pendingSort: NodeJS.Timeout | null = null;
    private styleEl: HTMLStyleElement | null = null;

    async onload() {
        await this.loadSettings();

        console.log('[ChronoSort] Plugin loaded');

        // Style element (not used for flex anymore, kept for potential future use)
        this.styleEl = document.createElement('style');
        this.styleEl.id = 'chronosort-styles';
        this.styleEl.textContent = '';
        document.head.appendChild(this.styleEl);

        // Register for active leaf changes (when user switches notes)
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                if (this.settings.debugMode) {
                    console.log('[ChronoSort] active-leaf-change event');
                }
                this.scheduleSortBacklinks();
            })
        );

        // Register for layout changes (panes opening/closing)
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (this.settings.debugMode) {
                    console.log('[ChronoSort] layout-change event');
                }
                this.scheduleSortBacklinks();
            })
        );

        // Initial setup when layout is ready
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] Layout ready');
            }
            this.scheduleSortBacklinks();
        });

        // Add a command to manually re-sort backlinks
        this.addCommand({
            id: 'sort-backlinks-now',
            name: 'Sort backlinks chronologically now',
            callback: () => {
                this.sortAllBacklinks();
            }
        });

        // Add settings tab
        this.addSettingTab(new ChronoSortSettingTab(this.app, this));
    }

    onunload() {
        console.log('[ChronoSort] Plugin unloaded');
        if (this.pendingSort) {
            clearTimeout(this.pendingSort);
        }
        // Remove our style element
        if (this.styleEl) {
            this.styleEl.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Schedule a sort operation with debouncing
     */
    private scheduleSortBacklinks() {
        if (this.pendingSort) {
            clearTimeout(this.pendingSort);
        }

        // Wait 500ms for backlinks to render, then sort
        this.pendingSort = setTimeout(() => {
            this.sortAllBacklinks();
            this.pendingSort = null;
        }, 500);
    }

    /**
     * Sort all backlink containers
     */
    private sortAllBacklinks() {
        if (this.settings.debugMode) {
            console.log('[ChronoSort] Running sortAllBacklinks');
        }

        if (this.settings.enableInDocument) {
            this.sortInDocumentBacklinks();
            // Also sort Daily Notes Editor backlinks (uses in-document setting)
            this.sortDailyNotesEditorBacklinks();
        }

        if (this.settings.enableSidebar) {
            this.sortSidebarBacklinks();
        }
    }

    /**
     * Sort in-document backlinks (at bottom of note)
     */
    private sortInDocumentBacklinks() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No active markdown view');
            }
            return;
        }

        // Try multiple selectors for the backlinks container
        const selectors = [
            '.backlink-pane .search-result-container',
            '.backlink-pane',
            '.embedded-backlinks .search-result-container',
            '.embedded-backlinks'
        ];

        let backlinksContainer: HTMLElement | null = null;
        for (const selector of selectors) {
            backlinksContainer = activeView.containerEl.querySelector(selector) as HTMLElement;
            if (backlinksContainer) {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Found in-document backlinks with selector: ${selector}`);
                }
                break;
            }
        }

        if (!backlinksContainer) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No in-document backlinks container found');
            }
            return;
        }

        this.applySortOrder(backlinksContainer, 'in-document');
    }

    /**
     * Sort sidebar backlinks pane
     */
    private sortSidebarBacklinks() {
        const selectors = [
            'div[data-type="backlink"] .search-result-container',
            '.workspace-leaf-content[data-type="backlink"] .search-result-container'
        ];

        let backlinkPane: HTMLElement | null = null;
        for (const selector of selectors) {
            backlinkPane = document.querySelector(selector) as HTMLElement;
            if (backlinkPane) {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Found sidebar backlinks with selector: ${selector}`);
                }
                break;
            }
        }

        if (!backlinkPane) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No sidebar backlinks pane found');
            }
            return;
        }

        this.applySortOrder(backlinkPane, 'sidebar');
    }

    /**
     * Sort backlinks in Daily Notes Editor view
     * The Daily Notes Editor plugin shows multiple daily notes stacked,
     * each with their own .embedded-backlinks section
     */
    private sortDailyNotesEditorBacklinks() {
        // Find all Daily Notes Editor containers in the document
        // The plugin uses .daily-note-editor class (not .daily-note-view)
        const dailyNotesViews = document.querySelectorAll('.daily-note-editor');

        if (dailyNotesViews.length === 0) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No Daily Notes Editor views found');
            }
            return;
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Found ${dailyNotesViews.length} Daily Notes Editor view(s)`);
        }

        // For each Daily Notes Editor view, find all backlinks containers
        dailyNotesViews.forEach((view, viewIndex) => {
            const backlinksContainers = view.querySelectorAll('.embedded-backlinks .search-result-container');

            if (backlinksContainers.length === 0) {
                // Try fallback selector
                const fallbackContainers = view.querySelectorAll('.embedded-backlinks');
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Daily Notes Editor view ${viewIndex}: ${fallbackContainers.length} embedded-backlinks found (fallback)`);
                }
                fallbackContainers.forEach((container, containerIndex) => {
                    this.applySortOrder(container as HTMLElement, `daily-notes-editor-${viewIndex}-${containerIndex}`);
                });
            } else {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Daily Notes Editor view ${viewIndex}: ${backlinksContainers.length} backlinks containers found`);
                }
                backlinksContainers.forEach((container, containerIndex) => {
                    this.applySortOrder(container as HTMLElement, `daily-notes-editor-${viewIndex}-${containerIndex}`);
                });
            }
        });
    }

    /**
     * Sort backlinks by moving DOM elements on every navigation.
     */
    private applySortOrder(container: HTMLElement, type: string) {
        // Find the actual parent of backlink items
        // Obsidian structure: .search-result-container > .search-results-children > .tree-item.search-result
        let itemsParent: HTMLElement = container;
        const childrenWrapper = container.querySelector(':scope > .search-results-children') as HTMLElement;
        if (childrenWrapper) {
            itemsParent = childrenWrapper;
        }

        // Only select DIRECT children to avoid grabbing nested match previews
        const resultItems = itemsParent.querySelectorAll(':scope > .tree-item.search-result');

        if (resultItems.length === 0) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] No backlink items found in ${type}`);
            }
            return;
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Found ${resultItems.length} items in ${type}`);
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Sorting ${resultItems.length} backlinks in ${type}`);
        }

        // Collect items with timestamps
        const itemsWithTimestamps: { element: HTMLElement; timestamp: number; filename: string }[] = [];

        resultItems.forEach(item => {
            const filename = this.extractFilename(item);
            const timestamp = this.getTimestamp(filename);
            itemsWithTimestamps.push({
                element: item as HTMLElement,
                timestamp,
                filename
            });
        });

        // Sort by timestamp
        itemsWithTimestamps.sort((a, b) => {
            const comparison = a.timestamp - b.timestamp;
            return this.settings.sortDescending ? -comparison : comparison;
        });

        if (this.settings.debugMode) {
            console.log('[ChronoSort] Sorted order:',
                itemsWithTimestamps.slice(0, 10).map(i =>
                    `${i.filename} (${new Date(i.timestamp).toISOString().split('T')[0]})`
                )
            );
        }

        // Move elements in DOM order (appendChild moves, doesn't clone)
        itemsWithTimestamps.forEach((item) => {
            itemsParent.appendChild(item.element);
        });

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Sorted ${itemsWithTimestamps.length} items in ${type}`);
        }
    }

    /**
     * Extract filename from a backlink tree item
     */
    private extractFilename(item: Element): string {
        // First, try the self container
        const selfContainer = item.querySelector(':scope > .tree-item-self .tree-item-inner');
        if (selfContainer) {
            const text = selfContainer.textContent?.trim() || '';
            if (this.settings.debugMode && text) {
                console.log(`[ChronoSort] Extracted from tree-item-self: "${text}"`);
            }
            if (text) return text;
        }

        // Try search-result-file-title
        const fileTitle = item.querySelector('.search-result-file-title');
        if (fileTitle) {
            const text = fileTitle.textContent?.trim() || '';
            if (this.settings.debugMode && text) {
                console.log(`[ChronoSort] Extracted from file-title: "${text}"`);
            }
            if (text) return text;
        }

        // Try the first .tree-item-inner that's NOT inside .search-result-file-matches
        const allInners = item.querySelectorAll('.tree-item-inner');
        for (const inner of Array.from(allInners)) {
            if (inner.closest('.search-result-file-matches')) continue;

            const text = inner.textContent?.trim() || '';
            if (text) {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Extracted from filtered tree-item-inner: "${text}"`);
                }
                return text;
            }
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Could not extract filename from item`);
        }
        return '';
    }

    /**
     * Get timestamp for a filename
     */
    private getTimestamp(filename: string): number {
        // Try to parse as Roam-format daily note
        const roamTimestamp = this.parseRoamDate(filename);
        if (roamTimestamp !== null) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] Parsed Roam date for "${filename}": ${new Date(roamTimestamp).toISOString()}`);
            }
            return roamTimestamp;
        }

        // Try standard YYYY-MM-DD format
        const isoTimestamp = this.parseISODate(filename);
        if (isoTimestamp !== null) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] Parsed ISO date for "${filename}": ${new Date(isoTimestamp).toISOString()}`);
            }
            return isoTimestamp;
        }

        // For regular notes: try to get 'edited' from frontmatter
        const file = this.app.vault.getAbstractFileByPath(filename + '.md') ||
                     this.app.vault.getAbstractFileByPath(filename);

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] File lookup for "${filename}":`, {
                foundFile: !!file,
                isFile: file instanceof TFile,
                filePath: file?.path
            });
        }

        if (file && file instanceof TFile) {
            const frontmatterTimestamp = this.getFrontmatterDate(file);
            if (frontmatterTimestamp !== null) {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Using frontmatter 'edited' for "${filename}": ${new Date(frontmatterTimestamp).toISOString()}`);
                }
                return frontmatterTimestamp;
            }

            if (this.settings.debugMode) {
                console.log(`[ChronoSort] Using mtime for "${filename}": ${new Date(file.stat.mtime).toISOString()}`);
            }
            return file.stat.mtime;
        }

        // Try searching in Daily Notes folder
        const dailyNotePath = `Daily Notes/${filename}.md`;
        const dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
        if (dailyNoteFile && dailyNoteFile instanceof TFile) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] Using Daily Notes mtime for "${filename}": ${new Date(dailyNoteFile.stat.mtime).toISOString()}`);
            }
            return dailyNoteFile.stat.mtime;
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] No timestamp found for "${filename}", returning 0`);
        }
        return 0;
    }

    /**
     * Get 'edited' date from file frontmatter
     */
    private getFrontmatterDate(file: TFile): number | null {
        const cache = this.app.metadataCache.getFileCache(file);

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] getFrontmatterDate for "${file.path}":`, {
                hasCache: !!cache,
                hasFrontmatter: !!cache?.frontmatter,
                frontmatterKeys: cache?.frontmatter ? Object.keys(cache.frontmatter) : [],
                editedValue: cache?.frontmatter?.['edited'],
                createdValue: cache?.frontmatter?.['created']
            });
        }

        if (!cache?.frontmatter) {
            return null;
        }

        const dateStr = cache.frontmatter['edited'] || cache.frontmatter['created'];
        if (!dateStr) {
            return null;
        }

        const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] Date format mismatch for "${file.path}": "${dateStr}"`);
            }
            return null;
        }

        const [, year, month, day] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        return date.getTime();
    }

    /**
     * Parse Roam-format date: "December 4th, 2025" -> timestamp
     */
    private parseRoamDate(filename: string): number | null {
        const months: Record<string, number> = {
            'January': 0, 'February': 1, 'March': 2, 'April': 3,
            'May': 4, 'June': 5, 'July': 6, 'August': 7,
            'September': 8, 'October': 9, 'November': 10, 'December': 11
        };

        let match = filename.match(/^(\w+)\s+(\d+)(?:st|nd|rd|th),\s+(\d{4})$/);

        if (!match) {
            const bracketMatch = filename.match(/\[\[(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)(?:st|nd|rd|th),\s+(\d{4})\]\]/);
            if (bracketMatch) {
                match = bracketMatch;
            }
        }

        if (!match) {
            if (this.settings.debugMode && filename.match(/january|february|march|april|may|june|july|august|september|october|november|december/i)) {
                console.log(`[ChronoSort] Roam date regex FAILED for "${filename}" (looks like a date but didn't match)`);
            }
            return null;
        }

        const [, monthName, day, year] = match;
        const month = months[monthName];
        if (month === undefined) return null;

        const date = new Date(parseInt(year), month, parseInt(day));

        if (date.getFullYear() !== parseInt(year) ||
            date.getMonth() !== month ||
            date.getDate() !== parseInt(day)) {
            return null;
        }

        return date.getTime();
    }

    /**
     * Parse ISO date: "2025-12-04" -> timestamp
     */
    private parseISODate(filename: string): number | null {
        const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;

        const [, year, month, day] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

        if (date.getFullYear() !== parseInt(year) ||
            date.getMonth() !== parseInt(month) - 1 ||
            date.getDate() !== parseInt(day)) {
            return null;
        }

        return date.getTime();
    }
}

/**
 * Settings Tab
 */
class ChronoSortSettingTab extends PluginSettingTab {
    plugin: BacklinksChronoSortPlugin;

    constructor(app: App, plugin: BacklinksChronoSortPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Backlinks Chronological Sort' });

        new Setting(containerEl)
            .setName('Enable for in-document backlinks')
            .setDesc('Sort backlinks shown at the bottom of notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableInDocument)
                .onChange(async (value) => {
                    this.plugin.settings.enableInDocument = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable for sidebar backlinks')
            .setDesc('Sort backlinks shown in the sidebar pane')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSidebar)
                .onChange(async (value) => {
                    this.plugin.settings.enableSidebar = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Sort descending (newest first)')
            .setDesc('When enabled, most recent dates appear at the top')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sortDescending)
                .onChange(async (value) => {
                    this.plugin.settings.sortDescending = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Log sorting information to console')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));
    }
}
