/// <reference path="../typescript_definitions/index.d.ts" />

let currentScadnanoHelices: Nucleotide[][] | null = null;
let currentScadnanoConnections: Array<[number, number]> = [];
type ScadnanoGridType = 'honeycomb' | 'square';

type ScadnanoPreparedLayout = {
    latticeType: ScadnanoGridType;
    nucleotideCount: number;
    helices: Nucleotide[][];
    grid: any;
    helixPos: Map<number, [number, number]>;
};

let currentScadnanoLayout: ScadnanoPreparedLayout | null = null;

function getCurrentNucleotideCount(): number {
    let count = 0;
    elements.forEach((element) => {
        if (element instanceof Nucleotide) count += 1;
    });
    return count;
}

function cloneHelixPosMap(input: Map<number, [number, number]>): Map<number, [number, number]> {
    const out = new Map<number, [number, number]>();
    input.forEach((value, key) => {
        out.set(Number(key), [Number(value[0]), Number(value[1])]);
    });
    return out;
}

function notifyHelixCoverageMismatch(helices: Nucleotide[][], inputMap: Map<number, Nucleotide>) {
    const helixCount = helices.flat().length;
    const totalCount = inputMap.size;
    if (helixCount === totalCount) return;

    notify(
        `Helix mapping error: ${helixCount}/${totalCount} nucleotides were mapped. Scadnano conversion will be missing some nucleotides.`,
        'alert',
        true
    );
}

function calculateScadnanoHelices(): Nucleotide[][] {
    const nucleotideElements = new Map<number, Nucleotide>();
    elements.forEach((element, id) => {
        if (element instanceof Nucleotide) {
            nucleotideElements.set(id, element);
        }
    });

    const helices = honda.findHelices(nucleotideElements, 3) as Nucleotide[][];
    notifyHelixCoverageMismatch(helices, nucleotideElements);
    return helices;
}

function prepareScadnanoLayout(latticeType: ScadnanoGridType, forceRecompute = false): {
    helices: Nucleotide[][];
    grid: any;
    helixPos: Map<number, [number, number]>;
} {
    const nucleotideCount = getCurrentNucleotideCount();
    if (
        !forceRecompute &&
        currentScadnanoLayout &&
        currentScadnanoLayout.latticeType === latticeType &&
        currentScadnanoLayout.nucleotideCount === nucleotideCount
    ) {
        currentScadnanoHelices = currentScadnanoLayout.helices;
        return currentScadnanoLayout;
    }

    const helices = calculateScadnanoHelices();
    currentScadnanoHelices = helices;

    const { grid, binderHelices } = toscad.setGrid(helices);
    toscad.directionAlign2(grid);
    toscad.alignGridPrim(grid, binderHelices);
    // toscad.combinedHelices(15, grid, helices, binderHelices);

    const { crossovers } = toscad.collectCrossovers(grid);
    currentScadnanoConnections = buildScadnanoConnections(crossovers);

    const angles = toscad.getAngles(grid, helices, latticeType);
    const corrected = toscad.anglecomb(grid, helices, latticeType, angles);
    const correct = toscad.anglecorr(grid, helices, latticeType, corrected.networkMap);

    currentScadnanoLayout = {
        latticeType,
        nucleotideCount,
        helices,
        grid,
        helixPos: toscad.calculateGlobalPositions(correct.networkMap, undefined, undefined, latticeType)
    };

    return currentScadnanoLayout;
}

function calculateScadnanoHelixPos(latticeType: ScadnanoGridType = 'square'): Map<number, [number, number]> {
    const { helixPos } = prepareScadnanoLayout(latticeType);
    // return toscad.HelixPosByRelativeBfs(grid, helices);
    return cloneHelixPosMap(helixPos);
    // return toscad.HelixPosAngles(grid, helices, 'honeycomb');
    // return toscad.helixPosCrossover(grid);
}

function buildScadnanoConnections(crossovers: Map<number, Map<number, { sameWalk: number; diffWalk: number }>>): Array<[number, number]> {
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

function normalizeHelixPosMap(input: any): Map<number, [number, number]> | null {
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
        Object.keys(input).forEach((k) => {
            const value = input[k];
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

function exportScadnanoWithHelixPos(name: string, gridType: ScadnanoGridType, helixPos: Map<number, [number, number]>) {
    const latticeType: ScadnanoGridType = gridType === 'honeycomb' ? 'honeycomb' : 'square';
    const { helices, grid } = prepareScadnanoLayout(latticeType);

    const scadnano = toscad.buildScadnano2(grid, helices, gridType, helixPos);
    const fileName = name ? `${name}.sc` : 'output.sc';
    makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
}

function exportScadnanoNoPos(name: string, gridType: ScadnanoGridType) {
    const latticeType: ScadnanoGridType = gridType === 'honeycomb' ? 'honeycomb' : 'square';
    const { helices, grid } = prepareScadnanoLayout(latticeType);

    const scadnano = toscad.buildScadnano2(grid, helices, gridType);
    const fileName = name ? `${name}.sc` : 'output.sc';
    makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
}

function runScadnanoLongCalculation(calc: () => void, callback?: () => void) {
    const viewObj = (window as any).view;
    if (viewObj && typeof viewObj.longCalculation === 'function') {
        viewObj.longCalculation(calc, 'Preparing scadnano export, please be patient...', callback);
        return;
    }

    calc();
    if (callback) callback();
}

function closeScadnanoDialog() {
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
        if (closeBtn) {
            closeBtn.click();
        }
    }

    const dialogEl = document.getElementById('scadnanoDialog') as HTMLElement | null;
    if (dialogEl) {
        dialogEl.classList.remove('open');
        dialogEl.setAttribute('aria-hidden', 'true');
        dialogEl.style.display = 'none';
    }
}

function runScadnanoDialogExport(name: string, gridType: ScadnanoGridType, includeHelixPos: boolean) {
    if (!includeHelixPos) {
        let failed = false;
        runScadnanoLongCalculation(() => {
            try {
                exportScadnanoNoPos(name, gridType);
            } catch (err) {
                failed = true;
                notify(`Scadnano export failed: ${err}`, 'alert');
            }
        });
        if (failed) return;
        return;
    }

    let failed = false;
    let helixPos: Map<number, [number, number]> | null = null;

    runScadnanoLongCalculation(
        () => {
            try {
                helixPos = calculateScadnanoHelixPos(gridType);
                (window as any).currentScadnanoHelixPos = cloneHelixPosMap(helixPos);
            } catch (err) {
                failed = true;
                notify(`Scadnano export failed: ${err}`, 'alert');
            }
        },
        () => {
            if (failed || !helixPos) return;
            const showGrid = (window as any).showScadnanoGridFromHelixPos;
            if (typeof showGrid !== 'function') {
                notify('Scadnano grid view is unavailable in this page.', 'alert');
                return;
            }
            showGrid(helixPos, gridType);
        }
    );
}

function scadnanoDialogExport() {
    const nameInput = document.getElementById('scadnanoFilename') as HTMLInputElement | null;
    const helixPosCheckbox = document.getElementById('scadnanoIncludeHPos') as HTMLInputElement | null;
    const scadnanoGrid = document.getElementById('scadnanoGrid') as HTMLInputElement | null;


    if (!nameInput || !helixPosCheckbox || !scadnanoGrid) {
        console.warn('scadnano export dialog missing inputs');
        return;
    }

    const name = nameInput.value.trim() || 'output';
    const gridType = scadnanoGrid.value === 'honeycomb' ? 'honeycomb' : 'square';

    closeScadnanoDialog();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            runScadnanoDialogExport(name, gridType, helixPosCheckbox.checked);
        });
    });
}

(window as any).exportScadnanoFromGridView = function (helixPosInput?: any) {
    const nameInput = document.getElementById('scadnanoFilename') as HTMLInputElement | null;
    const scadnanoGrid = document.getElementById('scadnanoGrid') as HTMLInputElement | null;

    const name = nameInput?.value.trim() || 'output';
    const gridType = scadnanoGrid?.value === 'honeycomb' ? 'honeycomb' : 'square';
    const map = normalizeHelixPosMap(helixPosInput ?? (window as any).currentScadnanoHelixPos);

    if (!map || map.size === 0) {
        notify('No edited helix positions available to export.', 'warning');
        return;
    }

    try {
        exportScadnanoWithHelixPos(name, gridType, map);
    } catch (err) {
        notify(`Scadnano export failed: ${err}`, 'alert');
    }
};

let scadnanoGridEditor: any = null;
let scadnanoGridEditorType: ScadnanoGridType | null = null;

function getScadnanoGridPane(): HTMLElement | null {
    return document.getElementById('scadnanoGridPane');
}

function getScadnanoGridCanvas(): HTMLCanvasElement | null {
    return document.getElementById('scadnanoGridCanvas') as HTMLCanvasElement | null;
}

function setScadnanoPaneWidth(widthPx: number) {
    const minW = 240;
    const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.75));
    const clamped = Math.max(minW, Math.min(maxW, Math.round(widthPx)));
    document.documentElement.style.setProperty('--scadnano-pane-width', `${clamped}px`);
}

function resizeScadnanoGridCanvas() {
    const pane = getScadnanoGridPane();
    const canvas = getScadnanoGridCanvas();
    if (!pane || !canvas) return;
    canvas.width = pane.clientWidth;
    canvas.height = pane.clientHeight;
}

function mapFromEditorNodes(editor: any): Map<number, [number, number]> {
    const out = new Map<number, [number, number]>();
    const nodes = typeof editor.getNodes === 'function' ? editor.getNodes() : [];
    nodes.forEach((node: any) => {
        out.set(Number(node.id), [Number(node.col), Number(node.row)]);
    });
    return out;
}

function publishCurrentHelixPosFromEditor() {
    if (!scadnanoGridEditor) return;
    (window as any).currentScadnanoHelixPos = mapFromEditorNodes(scadnanoGridEditor);
}

function ensureScadnanoHelicesCache(): Nucleotide[][] | null {
    if (currentScadnanoHelices && currentScadnanoHelices.length > 0) {
        return currentScadnanoHelices;
    }

    if (currentScadnanoLayout && currentScadnanoLayout.helices.length > 0) {
        currentScadnanoHelices = currentScadnanoLayout.helices;
        return currentScadnanoHelices;
    }

    try {
        currentScadnanoHelices = calculateScadnanoHelices();
        return currentScadnanoHelices;
    } catch (err) {
        notify(`Unable to map grid helix selection: ${err}`, 'warning');
        return null;
    }
}

function selectHelixFromGridNode(helixId: number) {
    const helices = ensureScadnanoHelicesCache();
    if (!helices) return;

    const helix = helices[helixId];
    if (!Array.isArray(helix) || helix.length === 0) return;

    const selectElements = (window as any)?.api?.selectElements;
    if (typeof selectElements !== 'function') return;

    selectElements(helix);
}

function ensureScadnanoGridEditor(gridType: ScadnanoGridType): any | null {
    if (scadnanoGridEditor && scadnanoGridEditorType === gridType) return scadnanoGridEditor;

    if (scadnanoGridEditor && scadnanoGridEditorType !== gridType) {
        if (typeof scadnanoGridEditor.dispose === 'function') {
            scadnanoGridEditor.dispose();
        }
        scadnanoGridEditor = null;
        scadnanoGridEditorType = null;
    }

    const canvas = getScadnanoGridCanvas();
    if (!canvas) return null;

    const scadnanoNs = (window as any).scadnano;
    if (!scadnanoNs) return null;

    const editorCtorName = gridType === 'square' ? 'SquareEditor' : 'HoneycombEditor';
    const EditorCtor = scadnanoNs[editorCtorName];
    if (typeof EditorCtor !== 'function') return null;

    scadnanoGridEditor = new EditorCtor(canvas);
    scadnanoGridEditorType = gridType;
    scadnanoGridEditor.onNodesChanged = publishCurrentHelixPosFromEditor;
    scadnanoGridEditor.onNodeSelected = (node: any) => {
        const helixId = Number(node?.id);
        if (!Number.isFinite(helixId)) return;
        selectHelixFromGridNode(helixId);
    };
    return scadnanoGridEditor;
}

(window as any).showScadnanoGridFromHelixPos = function (helixPosInput?: any, gridTypeInput?: any) {
    const pane = getScadnanoGridPane();
    if (!pane) {
        notify('Scadnano grid pane is unavailable.', 'alert');
        return;
    }

    const gridType: ScadnanoGridType = gridTypeInput === 'square' ? 'square' : 'honeycomb';

    document.body.classList.add('scadnano-grid-open');
    resizeScadnanoGridCanvas();

    const editor = ensureScadnanoGridEditor(gridType);
    if (!editor) {
        notify('Unable to open scadnano grid view.', 'alert');
        return;
    }

    if (typeof editor.resize === 'function') {
        editor.resize();
    }

    const map = normalizeHelixPosMap(helixPosInput);
    if (!map || map.size === 0) {
        notify('No helix positions available for the grid view.', 'warning');
        return;
    }

    editor.loadFromHelixPos(map);
    if (typeof editor.setConnections === 'function') {
        editor.setConnections(currentScadnanoConnections);
    }
    publishCurrentHelixPosFromEditor();
};

(window as any).hideScadnanoGridPane = function () {
    document.body.classList.remove('scadnano-grid-open');
};

function initScadnanoGridPaneControls() {
    const closeBtn = document.getElementById('scdgridClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const hidePane = (window as any).hideScadnanoGridPane;
            if (typeof hidePane === 'function') {
                hidePane();
            }
        });
    }

    const exportBtn = document.getElementById('scadnanoGridExportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            publishCurrentHelixPosFromEditor();
            const doExport = (window as any).exportScadnanoFromGridView;
            if (typeof doExport !== 'function') {
                notify('Scadnano export is unavailable.', 'alert');
                return;
            }
            doExport((window as any).currentScadnanoHelixPos);
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
        setScadnanoPaneWidth(e.clientX);
        resizeScadnanoGridCanvas();
        if (scadnanoGridEditor && typeof scadnanoGridEditor.resize === 'function') {
            scadnanoGridEditor.resize();
        }
    });

    window.addEventListener('mouseup', () => {
        if (!resizing) return;
        resizing = false;
        document.body.classList.remove('scadnano-grid-resizing');
    });

    window.addEventListener('resize', () => {
        resizeScadnanoGridCanvas();
        if (scadnanoGridEditor && typeof scadnanoGridEditor.resize === 'function') {
            scadnanoGridEditor.resize();
        }
    });
}

initScadnanoGridPaneControls();

/**
 * Toggles the disabled state of the grid dropdown based on the checkbox.
 * @param checkboxElement - The HTMLInputElement (checkbox) that was clicked.
 */
function toggleGridDropdown(checkboxElement: HTMLInputElement) {
    // We cast to HTMLSelectElement so TypeScript knows it has a 'disabled' property
    const gridDropdown = document.getElementById('scadnanoGrid') as HTMLSelectElement | null;
    
    if (gridDropdown) {
        gridDropdown.disabled = !checkboxElement.checked;
    }
}