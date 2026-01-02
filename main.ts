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
    debugMode: true  // Enable for development
};

export default class BacklinksChronoSortPlugin extends Plugin {
    settings: ChronoSortSettings;
    private observers: MutationObserver[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private isSorting = false;  // Prevent infinite loop

    async onload() {
        await this.loadSettings();

        console.log('[ChronoSort] Plugin loaded');

        // Register for layout changes
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.setupObservers();
            })
        );

        // Register for active leaf changes
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.setupObservers();
            })
        );

        // Initial setup
        this.app.workspace.onLayoutReady(() => {
            this.setupObservers();
        });

        // Add settings tab
        this.addSettingTab(new ChronoSortSettingTab(this.app, this));
    }

    onunload() {
        console.log('[ChronoSort] Plugin unloaded');
        this.disconnectObservers();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private disconnectObservers() {
        this.observers.forEach(obs => obs.disconnect());
        this.observers = [];
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
    }

    private setupObservers() {
        // Disconnect existing observers
        this.disconnectObservers();

        if (this.settings.enableInDocument) {
            this.observeInDocumentBacklinks();
        }

        if (this.settings.enableSidebar) {
            this.observeSidebarBacklinks();
        }
    }

    /**
     * Observe in-document backlinks (at bottom of note)
     */
    private observeInDocumentBacklinks() {
        // Find the active markdown view
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        // Look for backlinks container in the view
        const backlinksContainer = activeView.containerEl.querySelector('.backlink-pane');
        if (!backlinksContainer) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No in-document backlinks container found');
            }
            return;
        }

        if (this.settings.debugMode) {
            console.log('[ChronoSort] Found in-document backlinks container');
        }

        this.createObserver(backlinksContainer as HTMLElement, 'in-document');
    }

    /**
     * Observe sidebar backlinks pane
     */
    private observeSidebarBacklinks() {
        // Find sidebar backlinks pane
        const backlinkPane = document.querySelector('div[data-type="backlink"] .search-result-container');
        if (!backlinkPane) {
            if (this.settings.debugMode) {
                console.log('[ChronoSort] No sidebar backlinks pane found');
            }
            return;
        }

        if (this.settings.debugMode) {
            console.log('[ChronoSort] Found sidebar backlinks pane');
        }

        this.createObserver(backlinkPane as HTMLElement, 'sidebar');
    }

    /**
     * Create a MutationObserver for a backlinks container
     */
    private createObserver(container: HTMLElement, type: string) {
        const observer = new MutationObserver((mutations) => {
            // Skip if we're currently sorting (prevents infinite loop)
            if (this.isSorting) {
                return;
            }

            // Debounce to wait for render complete
            const existingTimer = this.debounceTimers.get(type);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                this.sortBacklinks(container, type);
            }, 150);  // Wait 150ms for render to complete

            this.debounceTimers.set(type, timer);
        });

        observer.observe(container, {
            childList: true,
            subtree: true
        });

        this.observers.push(observer);

        // Also sort immediately in case backlinks are already rendered
        setTimeout(() => this.sortBacklinks(container, type), 200);
    }

    /**
     * Sort backlinks in a container
     */
    private sortBacklinks(container: HTMLElement, type: string) {
        // Find all backlink result items
        const resultItems = container.querySelectorAll('.tree-item.search-result');

        if (resultItems.length === 0) {
            if (this.settings.debugMode) {
                console.log(`[ChronoSort] No backlink items found in ${type}`);
            }
            return;
        }

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Sorting ${resultItems.length} backlinks in ${type}`);
        }

        // Convert to array and extract timestamps
        const itemsWithTimestamps: { element: Element; timestamp: number; filename: string }[] = [];

        resultItems.forEach(item => {
            const filename = this.extractFilename(item);
            const timestamp = this.getTimestamp(filename);
            itemsWithTimestamps.push({ element: item, timestamp, filename });
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

        // Find the parent container to re-append items
        const parent = resultItems[0]?.parentElement;
        if (!parent) return;

        // Set flag to prevent observer from triggering during our DOM changes
        this.isSorting = true;

        // Re-append in sorted order (moves elements)
        itemsWithTimestamps.forEach(item => {
            parent.appendChild(item.element);
        });

        // Reset flag after a short delay to allow DOM to settle
        setTimeout(() => {
            this.isSorting = false;
        }, 50);

        if (this.settings.debugMode) {
            console.log(`[ChronoSort] Re-sorted ${itemsWithTimestamps.length} items`);
        }
    }

    /**
     * Extract filename from a backlink tree item
     */
    private extractFilename(item: Element): string {
        // Look for the file title specifically - this is the direct child of the search result
        // We need to avoid picking up match content lines inside .search-result-file-matches

        // First, try the self container (the tree-item-self contains the actual file link)
        const selfContainer = item.querySelector(':scope > .tree-item-self .tree-item-inner');
        if (selfContainer) {
            const text = selfContainer.textContent?.trim() || '';
            if (this.settings.debugMode && text) {
                console.log(`[ChronoSort] Extracted from tree-item-self: "${text}"`);
            }
            if (text) return text;
        }

        // Try search-result-file-title (used by some Obsidian versions)
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
            // Skip if this is inside the matches container (content snippets)
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
     * - Daily notes (Roam format): Parse date from filename
     * - Regular notes: Use 'edited' frontmatter, fall back to mtime
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
            // Try frontmatter 'edited' date first
            const frontmatterTimestamp = this.getFrontmatterDate(file);
            if (frontmatterTimestamp !== null) {
                if (this.settings.debugMode) {
                    console.log(`[ChronoSort] Using frontmatter 'edited' for "${filename}": ${new Date(frontmatterTimestamp).toISOString()}`);
                }
                return frontmatterTimestamp;
            }

            // Fall back to mtime
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
        // Last resort: return 0
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

        // Try 'edited' first, then 'created' as fallback
        const dateStr = cache.frontmatter['edited'] || cache.frontmatter['created'];
        if (!dateStr) {
            return null;
        }

        // Parse YYYY-MM-DD format
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
     * Also handles dates embedded in text like "# [[December 4th, 2025]] meeting"
     */
    private parseRoamDate(filename: string): number | null {
        const months: Record<string, number> = {
            'January': 0, 'February': 1, 'March': 2, 'April': 3,
            'May': 4, 'June': 5, 'July': 6, 'August': 7,
            'September': 8, 'October': 9, 'November': 10, 'December': 11
        };

        // First try exact match: "December 4th, 2025" or "January 1st, 2025"
        let match = filename.match(/^(\w+)\s+(\d+)(?:st|nd|rd|th),\s+(\d{4})$/);

        // If no exact match, try to find a date inside [[...]] brackets
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

        // Validate the date
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

        // Validate
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
