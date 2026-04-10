/// <reference path="../typescript_definitions/index.d.ts" />
let currentScadnanoHelices = null;
let currentScadnanoConnections = [];
let currentScadnanoLayout = null;
function getCurrentNucleotideCount() {
    let count = 0;
    elements.forEach((element) => {
        if (element instanceof Nucleotide)
            count += 1;
    });
    return count;
}
function cloneHelixPosMap(input) {
    const out = new Map();
    input.forEach((value, key) => {
        out.set(Number(key), [Number(value[0]), Number(value[1])]);
    });
    return out;
}
function notifyHelixCoverageMismatch(helices, inputMap) {
    const helixCount = helices.flat().length;
    const totalCount = inputMap.size;
    if (helixCount === totalCount)
        return;
    notify(`Helix mapping error: ${helixCount}/${totalCount} nucleotides were mapped. Scadnano conversion will be missing some nucleotides.`, 'alert', true);
}
function calculateScadnanoHelices() {
    const nucleotideElements = new Map();
    elements.forEach((element, id) => {
        if (element instanceof Nucleotide) {
            nucleotideElements.set(id, element);
        }
    });
    const helices = honda.findHelices(nucleotideElements, 3);
    notifyHelixCoverageMismatch(helices, nucleotideElements);
    return helices;
}
function prepareScadnanoLayout(latticeType, forceRecompute = false) {
    const nucleotideCount = getCurrentNucleotideCount();
    if (!forceRecompute &&
        currentScadnanoLayout &&
        currentScadnanoLayout.latticeType === latticeType &&
        currentScadnanoLayout.nucleotideCount === nucleotideCount) {
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
function calculateScadnanoHelixPos(latticeType = 'square') {
    const { helixPos } = prepareScadnanoLayout(latticeType);
    // return toscad.HelixPosByRelativeBfs(grid, helices);
    return cloneHelixPosMap(helixPos);
    // return toscad.HelixPosAngles(grid, helices, 'honeycomb');
    // return toscad.helixPosCrossover(grid);
}
function buildScadnanoConnections(crossovers) {
    const uniquePairs = new Set();
    const pairs = [];
    for (const [fromHelix, toMap] of crossovers.entries()) {
        for (const [toHelix, counts] of toMap.entries()) {
            const totalConnections = Number(counts?.sameWalk ?? 0) + Number(counts?.diffWalk ?? 0);
            if (totalConnections <= 0)
                continue;
            const a = Math.min(fromHelix, toHelix);
            const b = Math.max(fromHelix, toHelix);
            if (a === b)
                continue;
            const key = `${a}:${b}`;
            if (uniquePairs.has(key))
                continue;
            uniquePairs.add(key);
            pairs.push([a, b]);
        }
    }
    return pairs;
}
function normalizeHelixPosMap(input) {
    if (!input)
        return null;
    if (input instanceof Map) {
        const out = new Map();
        input.forEach((value, key) => {
            if (!Array.isArray(value) || value.length < 2)
                return;
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
        const out = new Map();
        input.forEach((entry) => {
            if (!Array.isArray(entry) || entry.length < 2)
                return;
            const helixId = Number(entry[0]);
            const value = entry[1];
            if (!Array.isArray(value) || value.length < 2)
                return;
            const col = Number(value[0]);
            const row = Number(value[1]);
            if (Number.isFinite(helixId) && Number.isFinite(col) && Number.isFinite(row)) {
                out.set(helixId, [col, row]);
            }
        });
        return out;
    }
    if (typeof input === 'object') {
        const out = new Map();
        Object.keys(input).forEach((k) => {
            const value = input[k];
            if (!Array.isArray(value) || value.length < 2)
                return;
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
function exportScadnanoWithHelixPos(name, gridType, helixPos) {
    const latticeType = gridType === 'honeycomb' ? 'honeycomb' : 'square';
    const { helices, grid } = prepareScadnanoLayout(latticeType);
    const scadnano = toscad.buildScadnano2(grid, helices, gridType, helixPos);
    const fileName = name ? `${name}.sc` : 'output.sc';
    makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
}
function exportScadnanoNoPos(name, gridType) {
    const latticeType = gridType === 'honeycomb' ? 'honeycomb' : 'square';
    const { helices, grid } = prepareScadnanoLayout(latticeType);
    const scadnano = toscad.buildScadnano2(grid, helices, gridType);
    const fileName = name ? `${name}.sc` : 'output.sc';
    makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
}
function runScadnanoLongCalculation(calc, callback) {
    const viewObj = window.view;
    if (viewObj && typeof viewObj.longCalculation === 'function') {
        viewObj.longCalculation(calc, 'Preparing scadnano export, please be patient...', callback);
        return;
    }
    calc();
    if (callback)
        callback();
}
function closeScadnanoDialog() {
    let closedByMetro = false;
    const metroDialog = window?.Metro?.dialog;
    if (metroDialog && typeof metroDialog.close === 'function') {
        try {
            metroDialog.close('#scadnanoDialog');
            closedByMetro = true;
        }
        catch (err) {
            console.warn('Failed to close scadnano dialog via Metro API:', err);
        }
    }
    if (!closedByMetro) {
        const closeBtn = document.querySelector('#scadnanoDialog .js-dialog-close');
        if (closeBtn) {
            closeBtn.click();
        }
    }
    const dialogEl = document.getElementById('scadnanoDialog');
    if (dialogEl) {
        dialogEl.classList.remove('open');
        dialogEl.setAttribute('aria-hidden', 'true');
        dialogEl.style.display = 'none';
    }
}
function runScadnanoDialogExport(name, gridType, includeHelixPos) {
    if (!includeHelixPos) {
        let failed = false;
        runScadnanoLongCalculation(() => {
            try {
                exportScadnanoNoPos(name, gridType);
            }
            catch (err) {
                failed = true;
                notify(`Scadnano export failed: ${err}`, 'alert');
            }
        });
        if (failed)
            return;
        return;
    }
    let failed = false;
    let helixPos = null;
    runScadnanoLongCalculation(() => {
        try {
            helixPos = calculateScadnanoHelixPos(gridType);
            window.currentScadnanoHelixPos = cloneHelixPosMap(helixPos);
        }
        catch (err) {
            failed = true;
            notify(`Scadnano export failed: ${err}`, 'alert');
        }
    }, () => {
        if (failed || !helixPos)
            return;
        const showGrid = window.showScadnanoGridFromHelixPos;
        if (typeof showGrid !== 'function') {
            notify('Scadnano grid view is unavailable in this page.', 'alert');
            return;
        }
        showGrid(helixPos, gridType);
    });
}
function scadnanoDialogExport() {
    const nameInput = document.getElementById('scadnanoFilename');
    const helixPosCheckbox = document.getElementById('scadnanoIncludeHPos');
    const scadnanoGrid = document.getElementById('scadnanoGrid');
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
window.exportScadnanoFromGridView = function (helixPosInput) {
    const nameInput = document.getElementById('scadnanoFilename');
    const scadnanoGrid = document.getElementById('scadnanoGrid');
    const name = nameInput?.value.trim() || 'output';
    const gridType = scadnanoGrid?.value === 'honeycomb' ? 'honeycomb' : 'square';
    const map = normalizeHelixPosMap(helixPosInput ?? window.currentScadnanoHelixPos);
    if (!map || map.size === 0) {
        notify('No edited helix positions available to export.', 'warning');
        return;
    }
    try {
        exportScadnanoWithHelixPos(name, gridType, map);
    }
    catch (err) {
        notify(`Scadnano export failed: ${err}`, 'alert');
    }
};
let scadnanoGridEditor = null;
let scadnanoGridEditorType = null;
function getScadnanoGridPane() {
    return document.getElementById('scadnanoGridPane');
}
function getScadnanoGridCanvas() {
    return document.getElementById('scadnanoGridCanvas');
}
function setScadnanoPaneWidth(widthPx) {
    const minW = 240;
    const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.75));
    const clamped = Math.max(minW, Math.min(maxW, Math.round(widthPx)));
    document.documentElement.style.setProperty('--scadnano-pane-width', `${clamped}px`);
}
function resizeScadnanoGridCanvas() {
    const pane = getScadnanoGridPane();
    const canvas = getScadnanoGridCanvas();
    if (!pane || !canvas)
        return;
    canvas.width = pane.clientWidth;
    canvas.height = pane.clientHeight;
}
function mapFromEditorNodes(editor) {
    const out = new Map();
    const nodes = typeof editor.getNodes === 'function' ? editor.getNodes() : [];
    nodes.forEach((node) => {
        out.set(Number(node.id), [Number(node.col), Number(node.row)]);
    });
    return out;
}
function publishCurrentHelixPosFromEditor() {
    if (!scadnanoGridEditor)
        return;
    window.currentScadnanoHelixPos = mapFromEditorNodes(scadnanoGridEditor);
}
function ensureScadnanoHelicesCache() {
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
    }
    catch (err) {
        notify(`Unable to map grid helix selection: ${err}`, 'warning');
        return null;
    }
}
function selectHelixFromGridNode(helixId) {
    const helices = ensureScadnanoHelicesCache();
    if (!helices)
        return;
    const helix = helices[helixId];
    if (!Array.isArray(helix) || helix.length === 0)
        return;
    const selectElements = window?.api?.selectElements;
    if (typeof selectElements !== 'function')
        return;
    selectElements(helix);
}
function ensureScadnanoGridEditor(gridType) {
    if (scadnanoGridEditor && scadnanoGridEditorType === gridType)
        return scadnanoGridEditor;
    if (scadnanoGridEditor && scadnanoGridEditorType !== gridType) {
        if (typeof scadnanoGridEditor.dispose === 'function') {
            scadnanoGridEditor.dispose();
        }
        scadnanoGridEditor = null;
        scadnanoGridEditorType = null;
    }
    const canvas = getScadnanoGridCanvas();
    if (!canvas)
        return null;
    const scadnanoNs = window.scadnano;
    if (!scadnanoNs)
        return null;
    const editorCtorName = gridType === 'square' ? 'SquareEditor' : 'HoneycombEditor';
    const EditorCtor = scadnanoNs[editorCtorName];
    if (typeof EditorCtor !== 'function')
        return null;
    scadnanoGridEditor = new EditorCtor(canvas);
    scadnanoGridEditorType = gridType;
    scadnanoGridEditor.onNodesChanged = publishCurrentHelixPosFromEditor;
    scadnanoGridEditor.onNodeSelected = (node) => {
        const helixId = Number(node?.id);
        if (!Number.isFinite(helixId))
            return;
        selectHelixFromGridNode(helixId);
    };
    return scadnanoGridEditor;
}
window.showScadnanoGridFromHelixPos = function (helixPosInput, gridTypeInput) {
    const pane = getScadnanoGridPane();
    if (!pane) {
        notify('Scadnano grid pane is unavailable.', 'alert');
        return;
    }
    const gridType = gridTypeInput === 'square' ? 'square' : 'honeycomb';
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
window.hideScadnanoGridPane = function () {
    document.body.classList.remove('scadnano-grid-open');
};
function initScadnanoGridPaneControls() {
    const closeBtn = document.getElementById('scdgridClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const hidePane = window.hideScadnanoGridPane;
            if (typeof hidePane === 'function') {
                hidePane();
            }
        });
    }
    const exportBtn = document.getElementById('scadnanoGridExportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            publishCurrentHelixPosFromEditor();
            const doExport = window.exportScadnanoFromGridView;
            if (typeof doExport !== 'function') {
                notify('Scadnano export is unavailable.', 'alert');
                return;
            }
            doExport(window.currentScadnanoHelixPos);
        });
    }
    const resizeHandle = document.getElementById('scadnanoGridResizeHandle');
    let resizing = false;
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            resizing = true;
            document.body.classList.add('scadnano-grid-resizing');
            e.preventDefault();
        });
    }
    window.addEventListener('mousemove', (e) => {
        if (!resizing)
            return;
        setScadnanoPaneWidth(e.clientX);
        resizeScadnanoGridCanvas();
        if (scadnanoGridEditor && typeof scadnanoGridEditor.resize === 'function') {
            scadnanoGridEditor.resize();
        }
    });
    window.addEventListener('mouseup', () => {
        if (!resizing)
            return;
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
function toggleGridDropdown(checkboxElement) {
    // We cast to HTMLSelectElement so TypeScript knows it has a 'disabled' property
    const gridDropdown = document.getElementById('scadnanoGrid');
    if (gridDropdown) {
        gridDropdown.disabled = !checkboxElement.checked;
    }
}
