/// <reference path="../typescript_definitions/index.d.ts" />

type ScadnanoGridType = 'honeycomb' | 'square';
type HelixPosMap = Map<number, [number, number]>;

type ScadnanoPreparedLayout = {
    latticeType: ScadnanoGridType;
    nucleotideCount: number;
    helices: Nucleotide[][];
    grid: any;
    helixPos: HelixPosMap;
    wireframe: boolean;
};

type ScadnanoDialogOptions = {
    name: string;
    gridType: ScadnanoGridType;
    includeHelixPos: boolean;
    wireframe: boolean;
};

interface Window {
    view?: {
        longCalculation: (calc: () => void, message: string, callback?: () => void) => void;
    };
    api?: {
        selectElements?: (elementsToSelect: any) => void;
    };
    scadnano?: any;

    currentScadnanoHelixPos?: HelixPosMap;
    exportScadnanoFromGridView?: (helixPosInput?: unknown) => void;
    showScadnanoGridFromHelixPos?: (helixPosInput?: unknown, gridTypeInput?: unknown) => void;
    hideScadnanoGridPane?: () => void;
    scadnanoDialogExport?: () => void;
    toggleGridDropdown?: (checkboxElement: HTMLInputElement) => void;
    scadnanoSelectHelixFromNucleotide?: (nucleotideInput?: unknown) => void;
}

class ScadnanoExportManager {
    private currentScadnanoHelices: Nucleotide[][] | null = null;
    private currentScadnanoMissing: Nucleotide[] = [];
    private currentScadnanoConnections: Array<[number, number]> = [];
    private currentScadnanoLayout: ScadnanoPreparedLayout | null = null;

    private scadnanoGridEditor: any = null;
    private scadnanoGridEditorType: ScadnanoGridType | null = null;

    constructor() {
        this.initScadnanoGridPaneControls();
    }

    public handleDialogExport(): void {
        const options = this.readDialogOptions();
        if (!options) return;

        this.closeScadnanoDialog();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.runDialogExport(options);
            });
        });
    }

    public exportFromGridView(helixPosInput?: unknown): void {
        const { name, gridType, wireframe } = this.readCurrentExportTarget();
        const map = this.normalizeHelixPosMap(helixPosInput ?? window.currentScadnanoHelixPos);

        if (!map || map.size === 0) {
            notify('No edited helix positions available to export.', 'warning');
            return;
        }

        try {
            this.exportToScadnano(name, gridType, map, wireframe);
        } catch (err) {
            notify(`Scadnano export failed: ${err}`, 'alert');
        }
    }

    public showGridFromHelixPos(helixPosInput?: unknown, gridTypeInput?: unknown): void {
        const pane = this.getScadnanoGridPane();
        if (!pane) {
            notify('Scadnano grid pane is unavailable.', 'alert');
            return;
        }

        const gridType: ScadnanoGridType = gridTypeInput === 'square' ? 'square' : 'honeycomb';

        document.body.classList.add('scadnano-grid-open');
        this.resizeScadnanoGridCanvas();

        const editor = this.ensureScadnanoGridEditor(gridType);
        if (!editor) {
            notify('Unable to open scadnano grid view.', 'alert');
            return;
        }

        if (typeof editor.resize === 'function') {
            editor.resize();
        }

        const map = this.normalizeHelixPosMap(helixPosInput);
        if (!map || map.size === 0) {
            notify('No helix positions available for the grid view.', 'warning');
            return;
        }

        editor.loadFromHelixPos(map);
        if (typeof editor.setConnections === 'function') {
            editor.setConnections(this.currentScadnanoConnections);
        }
        this.publishCurrentHelixPosFromEditor();
    }

    public hideScadnanoGridPane(): void {
        document.body.classList.remove('scadnano-grid-open');
    }

    public toggleGridDropdown(checkboxElement: HTMLInputElement): void {
        const gridDropdown = document.getElementById('scadnanoGrid') as HTMLSelectElement | null;
        if (gridDropdown) {
            gridDropdown.disabled = !checkboxElement.checked;
        }
    }

    public selectHelixFromNucleotide(nucleotideInput?: unknown): void {
        if (!document.body.classList.contains('scadnano-grid-open')) return;
        if (!this.scadnanoGridEditor || typeof this.scadnanoGridEditor.selectNodeById !== 'function') return;

        const nucleotide = nucleotideInput instanceof Nucleotide
            ? nucleotideInput
            : (typeof nucleotideInput === 'number' ? elements.get(nucleotideInput) : null);

        if (!nucleotide || !(nucleotide instanceof Nucleotide)) return;

        const helices = this.ensureScadnanoHelicesCache();
        if (!helices) return;

        const helixId = toscad.findHelixID(nucleotide.id, helices);
        if (helixId === null) return;

        this.scadnanoGridEditor.selectNodeById(helixId);
    }

    private runDialogExport(options: ScadnanoDialogOptions): void {
        if (!options.includeHelixPos) {
            this.runScadnanoLongCalculation(() => {
                try {
                    this.exportToScadnano(options.name, options.gridType, undefined, options.wireframe);
                } catch (err) {
                    notify(`Scadnano export failed: ${err}`, 'alert');
                }
            });
            return;
        }

        let helixPos: HelixPosMap | null = null;
        let failed = false;

        this.runScadnanoLongCalculation(
            () => {
                try {
                    helixPos = this.calculateScadnanoHelixPos(options.gridType, options.wireframe);
                    if (helixPos) {
                        window.currentScadnanoHelixPos = this.cloneHelixPosMap(helixPos);
                    }
                } catch (err) {
                    failed = true;
                    notify(`Scadnano export failed: ${err}`, 'alert');
                }
            },
            () => {
                if (failed || !helixPos) return;
                this.showGridFromHelixPos(helixPos, options.gridType);
            }
        );
    }

    private readDialogOptions(): ScadnanoDialogOptions | null {
        const nameInput = document.getElementById('scadnanoFilename') as HTMLInputElement | null;
        const helixPosCheckbox = document.getElementById('scadnanoIncludeHPos') as HTMLInputElement | null;
        const scadnanoGrid = document.getElementById('scadnanoGrid') as HTMLInputElement | null;
        const wireframeCheckbox = document.getElementById('scadnanoWireframe') as HTMLInputElement | null;

        if (!nameInput || !helixPosCheckbox || !scadnanoGrid || !wireframeCheckbox) {
            console.warn('scadnano export dialog missing inputs');
            return null;
        }

        return {
            name: nameInput.value.trim() || 'output',
            gridType: this.normalizeGridType(scadnanoGrid.value),
            includeHelixPos: helixPosCheckbox.checked,
            wireframe: wireframeCheckbox.checked,
        };
    }

    private readCurrentExportTarget(): { name: string; gridType: ScadnanoGridType; wireframe: boolean } {
        const nameInput = document.getElementById('scadnanoFilename') as HTMLInputElement | null;
        const scadnanoGrid = document.getElementById('scadnanoGrid') as HTMLInputElement | null;
        const wireframeCheckbox = document.getElementById('scadnanoWireframe') as HTMLInputElement | null;

        return {
            name: nameInput?.value.trim() || 'output',
            gridType: this.normalizeGridType(scadnanoGrid?.value),
            wireframe: Boolean(wireframeCheckbox?.checked),
        };
    }

    private normalizeGridType(value?: string): ScadnanoGridType {
        return value === 'honeycomb' ? 'honeycomb' : 'square';
    }

    private runScadnanoLongCalculation(calc: () => void, callback?: () => void): void {
        const longCalculation = window.view?.longCalculation;
        if (typeof longCalculation === 'function') {
            longCalculation(calc, 'Preparing scadnano export, please be patient...', callback);
            return;
        }

        calc();
        if (callback) callback();
    }

    private closeScadnanoDialog(): void {
        let closedByMetro = false;
        const metroDialog = (window as any)?.Metro?.dialog;

        if (metroDialog && typeof metroDialog.close === 'function') {
            try {
                metroDialog.close('#scadnanoDialog');
                closedByMetro = true;
            } catch (err) {
                console.warn('Failed to close scadnano dialog via Metro API:', err);
            }
        }

        if (!closedByMetro) {
            const closeBtn = document.querySelector('#scadnanoDialog .js-dialog-close') as HTMLElement | null;
            if (closeBtn) closeBtn.click();
        }

        const dialogEl = document.getElementById('scadnanoDialog') as HTMLElement | null;
        if (dialogEl) {
            dialogEl.classList.remove('open');
            dialogEl.setAttribute('aria-hidden', 'true');
        }
    }

    private exportToScadnano(
        name: string,
        gridType: ScadnanoGridType,
        helixPos?: HelixPosMap,
        wireframe = false
    ): void {
        const latticeType: ScadnanoGridType = this.normalizeGridType(gridType);
        const { helices, grid } = this.prepareScadnanoLayout(latticeType, false, wireframe);

        const scadnano = helixPos
            ? toscad.buildScadnano2(grid, helices, gridType, helixPos)
            : toscad.buildScadnano2(grid, helices, gridType);

        const fileName = name ? `${name}.sc` : 'output.sc';
        makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
    }

    private getCurrentNucleotideCount(): number {
        let count = 0;
        elements.forEach((element) => {
            if (element instanceof Nucleotide) count += 1;
        });
        return count;
    }

    private cloneHelixPosMap(input: HelixPosMap): HelixPosMap {
        const out = new Map<number, [number, number]>();
        input.forEach((value, key) => {
            out.set(Number(key), [Number(value[0]), Number(value[1])]);
        });
        return out;
    }

    private calculateScadnanoHelices(): Nucleotide[][] {
        const nucleotideElements = new Map<number, Nucleotide>();
        elements.forEach((element, id) => {
            if (element instanceof Nucleotide) {
                nucleotideElements.set(id, element);
            }
        });

        const result = helix.findHelices(nucleotideElements, 3) as { helices: Nucleotide[][]; missing: Nucleotide[] };
        const helices = result?.helices ?? [];
        this.currentScadnanoMissing = Array.isArray(result?.missing) ? result.missing : [];
        this.notifyHelixCoverageMismatch(helices, nucleotideElements, this.currentScadnanoMissing);
        return helices;
    }

    private prepareScadnanoLayout(
        latticeType: ScadnanoGridType,
        forceRecompute = false,
        wireframe = false
    ): ScadnanoPreparedLayout {
        const nucleotideCount = this.getCurrentNucleotideCount();
        if (
            !forceRecompute &&
            this.currentScadnanoLayout &&
            this.currentScadnanoLayout.latticeType === latticeType &&
            this.currentScadnanoLayout.nucleotideCount === nucleotideCount &&
            this.currentScadnanoLayout.wireframe === wireframe
        ) {
            this.currentScadnanoHelices = this.currentScadnanoLayout.helices;
            return this.currentScadnanoLayout;
        }

        const helices = this.calculateScadnanoHelices();
        this.currentScadnanoHelices = helices;

        const { grid, binderHelices } = toscad.setGrid(helices);
        toscad.directionAlign2(grid);
        toscad.alignGridPrim(grid, binderHelices);

        const angles = toscad.getAngles(grid, helices, latticeType);
        let networkMap = angles;

        if (!wireframe) {
            const corrected = toscad.anglecomb(grid, helices, latticeType, angles);
            const correct = toscad.anglecorr(grid, helices, latticeType, corrected.networkMap);
            networkMap = correct.networkMap;
        }

        const { crossovers } = toscad.collectCrossovers(grid);
        this.currentScadnanoConnections = this.buildScadnanoConnections(crossovers);

        this.currentScadnanoLayout = {
            latticeType,
            nucleotideCount,
            helices,
            grid,
            helixPos: toscad.calculateGlobalPositions(networkMap, undefined, undefined, latticeType),
            wireframe
        };

        return this.currentScadnanoLayout;
    }

    private calculateScadnanoHelixPos(latticeType: ScadnanoGridType = 'square', wireframe = false): HelixPosMap {
        const { helixPos } = this.prepareScadnanoLayout(latticeType, false, wireframe);
        return this.cloneHelixPosMap(helixPos);
    }

    private notifyHelixCoverageMismatch(
        helices: Nucleotide[][],
        inputMap: Map<number, Nucleotide>,
        missing: Nucleotide[] = []
    ): void {
        const helixCount = helices.flat().length;
        const totalCount = inputMap.size;
        if (helixCount === totalCount) return;

        const missingCount = missing.length || (totalCount - helixCount);

        notify(
            `Helix mapping error: ${helixCount}/${totalCount} nucleotides were mapped. Missing ${missingCount} nucleotides.`,
            'alert',
            true
        );
    }

    private buildScadnanoConnections(
        crossovers: Map<number, Map<number, { sameWalk: number; diffWalk: number }>>
    ): Array<[number, number]> {
        const uniquePairs = new Set<string>();
        const pairs: Array<[number, number]> = [];

        for (const [fromHelix, toMap] of crossovers.entries()) {
            for (const [toHelix, counts] of toMap.entries()) {
                const totalConnections = Number(counts?.sameWalk ?? 0) + Number(counts?.diffWalk ?? 0);
                if (totalConnections <= 0) continue;

                const a = Math.min(fromHelix, toHelix);
                const b = Math.max(fromHelix, toHelix);
                if (a === b) continue;

                const key = `${a}:${b}`;
                if (uniquePairs.has(key)) continue;
                uniquePairs.add(key);
                pairs.push([a, b]);
            }
        }

        return pairs;
    }

    private normalizeHelixPosMap(input: unknown): HelixPosMap | null {
        if (!input) return null;

        if (input instanceof Map) {
            const out = new Map<number, [number, number]>();
            input.forEach((value, key) => {
                if (!Array.isArray(value) || value.length < 2) return;
                const helixId = Number(key);
                const col = Number(value[0]);
                const row = Number(value[1]);
                if (Number.isFinite(helixId) && Number.isFinite(col) && Number.isFinite(row)) {
                    out.set(helixId, [col, row]);
                }
            });
            return out;
        }

        if (Array.isArray(input)) {
            const out = new Map<number, [number, number]>();
            input.forEach((entry: any) => {
                if (!Array.isArray(entry) || entry.length < 2) return;
                const helixId = Number(entry[0]);
                const value = entry[1];
                if (!Array.isArray(value) || value.length < 2) return;
                const col = Number(value[0]);
                const row = Number(value[1]);
                if (Number.isFinite(helixId) && Number.isFinite(col) && Number.isFinite(row)) {
                    out.set(helixId, [col, row]);
                }
            });
            return out;
        }

        if (typeof input === 'object') {
            const out = new Map<number, [number, number]>();
            Object.keys(input as Record<string, any>).forEach((k) => {
                const value = (input as Record<string, any>)[k];
                if (!Array.isArray(value) || value.length < 2) return;
                const helixId = Number(k);
                const col = Number(value[0]);
                const row = Number(value[1]);
                if (Number.isFinite(helixId) && Number.isFinite(col) && Number.isFinite(row)) {
                    out.set(helixId, [col, row]);
                }
            });
            return out;
        }

        return null;
    }

    private getScadnanoGridPane(): HTMLElement | null {
        return document.getElementById('scadnanoGridPane');
    }

    private getScadnanoGridCanvas(): HTMLCanvasElement | null {
        return document.getElementById('scadnanoGridCanvas') as HTMLCanvasElement | null;
    }

    private setScadnanoPaneWidth(widthPx: number): void {
        const minW = 240;
        const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.75));
        const clamped = Math.max(minW, Math.min(maxW, Math.round(widthPx)));
        document.documentElement.style.setProperty('--scadnano-pane-width', `${clamped}px`);
    }

    private resizeScadnanoGridCanvas(): void {
        const pane = this.getScadnanoGridPane();
        const canvas = this.getScadnanoGridCanvas();
        if (!pane || !canvas) return;
        canvas.width = pane.clientWidth;
        canvas.height = pane.clientHeight;
    }

    private mapFromEditorNodes(editor: any): HelixPosMap {
        const out = new Map<number, [number, number]>();
        const nodes = typeof editor.getNodes === 'function' ? editor.getNodes() : [];
        nodes.forEach((node: any) => {
            out.set(Number(node.id), [Number(node.col), Number(node.row)]);
        });
        return out;
    }

    private publishCurrentHelixPosFromEditor(): void {
        if (!this.scadnanoGridEditor) return;
        window.currentScadnanoHelixPos = this.mapFromEditorNodes(this.scadnanoGridEditor);
    }

    private ensureScadnanoHelicesCache(): Nucleotide[][] | null {
        if (this.currentScadnanoHelices && this.currentScadnanoHelices.length > 0) {
            return this.currentScadnanoHelices;
        }

        if (this.currentScadnanoLayout && this.currentScadnanoLayout.helices.length > 0) {
            this.currentScadnanoHelices = this.currentScadnanoLayout.helices;
            return this.currentScadnanoHelices;
        }

        try {
            this.currentScadnanoHelices = this.calculateScadnanoHelices();
            return this.currentScadnanoHelices;
        } catch (err) {
            notify(`Unable to map grid helix selection: ${err}`, 'warning');
            return null;
        }
    }

    private selectHelixFromGridNode(helixId: number): void {
        const helices = this.ensureScadnanoHelicesCache();
        if (!helices) return;

        const helix = helices[helixId];
        if (!Array.isArray(helix) || helix.length === 0) return;

        const selectElements = window.api?.selectElements;
        if (typeof selectElements !== 'function') return;

        selectElements(helix);
    }

    private selectMissingNucleotides(): void {
        this.ensureScadnanoHelicesCache();

        if (!this.currentScadnanoMissing.length) {
            notify('No missing nucleotides detected from helix mapping.', 'warning');
            return;
        }

        const selectElements = window.api?.selectElements;
        if (typeof selectElements !== 'function') {
            notify('Selection API is unavailable.', 'warning');
            return;
        }

        selectElements(this.currentScadnanoMissing);
    }

    private ensureScadnanoGridEditor(gridType: ScadnanoGridType): any | null {
        if (this.scadnanoGridEditor && this.scadnanoGridEditorType === gridType) return this.scadnanoGridEditor;

        if (this.scadnanoGridEditor && this.scadnanoGridEditorType !== gridType) {
            if (typeof this.scadnanoGridEditor.dispose === 'function') {
                this.scadnanoGridEditor.dispose();
            }
            this.scadnanoGridEditor = null;
            this.scadnanoGridEditorType = null;
        }

        const canvas = this.getScadnanoGridCanvas();
        if (!canvas) return null;

        const scadnanoNs = window.scadnano;
        if (!scadnanoNs) return null;

        const editorCtorName = gridType === 'square' ? 'SquareEditor' : 'HoneycombEditor';
        const EditorCtor = scadnanoNs[editorCtorName];
        if (typeof EditorCtor !== 'function') return null;

        this.scadnanoGridEditor = new EditorCtor(canvas);
        this.scadnanoGridEditorType = gridType;

        this.scadnanoGridEditor.onNodesChanged = () => {
            this.publishCurrentHelixPosFromEditor();
        };

        this.scadnanoGridEditor.onNodeSelected = (node: any) => {
            const helixId = Number(node?.id);
            if (!Number.isFinite(helixId)) return;
            this.selectHelixFromGridNode(helixId);
        };

        return this.scadnanoGridEditor;
    }

    private initScadnanoGridPaneControls(): void {
        const closeBtn = document.getElementById('scdgridClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideScadnanoGridPane();
            });
        }

        const exportBtn = document.getElementById('scadnanoGridExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.publishCurrentHelixPosFromEditor();
                this.exportFromGridView(window.currentScadnanoHelixPos);
            });
        }

        const missingBtn = document.getElementById('scadnanoGridMissingBtn');
        if (missingBtn) {
            missingBtn.addEventListener('click', () => {
                this.selectMissingNucleotides();
            });
        }

        const resizeHandle = document.getElementById('scadnanoGridResizeHandle');
        let resizing = false;

        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
                resizing = true;
                document.body.classList.add('scadnano-grid-resizing');
                e.preventDefault();
            });
        }

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!resizing) return;
            this.setScadnanoPaneWidth(e.clientX);
            this.resizeScadnanoGridCanvas();
            if (this.scadnanoGridEditor && typeof this.scadnanoGridEditor.resize === 'function') {
                this.scadnanoGridEditor.resize();
            }
        });

        window.addEventListener('mouseup', () => {
            if (!resizing) return;
            resizing = false;
            document.body.classList.remove('scadnano-grid-resizing');
        });

        window.addEventListener('resize', () => {
            this.resizeScadnanoGridCanvas();
            if (this.scadnanoGridEditor && typeof this.scadnanoGridEditor.resize === 'function') {
                this.scadnanoGridEditor.resize();
            }
        });
    }
}

const scadnanoManager = new ScadnanoExportManager();

function registerScadnanoWindowApi(): void {
    window.exportScadnanoFromGridView = (helixPosInput?: unknown) => {
        scadnanoManager.exportFromGridView(helixPosInput);
    };

    window.showScadnanoGridFromHelixPos = (helixPosInput?: unknown, gridTypeInput?: unknown) => {
        scadnanoManager.showGridFromHelixPos(helixPosInput, gridTypeInput);
    };

    window.hideScadnanoGridPane = () => {
        scadnanoManager.hideScadnanoGridPane();
    };

    window.scadnanoDialogExport = () => {
        scadnanoManager.handleDialogExport();
    };

    window.toggleGridDropdown = (checkboxElement: HTMLInputElement) => {
        scadnanoManager.toggleGridDropdown(checkboxElement);
    };

    window.scadnanoSelectHelixFromNucleotide = (nucleotideInput?: unknown) => {
        scadnanoManager.selectHelixFromNucleotide(nucleotideInput);
    };
}

registerScadnanoWindowApi();

// Keep these named wrappers for inline HTML handlers and backwards compatibility.
function scadnanoDialogExport(): void {
    scadnanoManager.handleDialogExport();
}

function toggleGridDropdown(checkboxElement: HTMLInputElement): void {
    scadnanoManager.toggleGridDropdown(checkboxElement);
}
