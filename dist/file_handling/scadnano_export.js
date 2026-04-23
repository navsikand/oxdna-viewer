/// <reference path="../typescript_definitions/index.d.ts" />
class ScadnanoExportManager {
    currentScadnanoHelices = null;
    currentScadnanoConnections = [];
    currentScadnanoLayout = null;
    scadnanoGridEditor = null;
    scadnanoGridEditorType = null;
    constructor() {
        this.initScadnanoGridPaneControls();
    }
    handleDialogExport() {
        const options = this.readDialogOptions();
        if (!options)
            return;
        this.closeScadnanoDialog();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.runDialogExport(options);
            });
        });
    }
    exportFromGridView(helixPosInput) {
        const { name, gridType } = this.readCurrentExportTarget();
        const map = this.normalizeHelixPosMap(helixPosInput ?? window.currentScadnanoHelixPos);
        if (!map || map.size === 0) {
            notify('No edited helix positions available to export.', 'warning');
            return;
        }
        try {
            this.exportToScadnano(name, gridType, map);
        }
        catch (err) {
            notify(`Scadnano export failed: ${err}`, 'alert');
        }
    }
    showGridFromHelixPos(helixPosInput, gridTypeInput) {
        const pane = this.getScadnanoGridPane();
        if (!pane) {
            notify('Scadnano grid pane is unavailable.', 'alert');
            return;
        }
        const gridType = gridTypeInput === 'square' ? 'square' : 'honeycomb';
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
    hideScadnanoGridPane() {
        document.body.classList.remove('scadnano-grid-open');
    }
    toggleGridDropdown(checkboxElement) {
        const gridDropdown = document.getElementById('scadnanoGrid');
        if (gridDropdown) {
            gridDropdown.disabled = !checkboxElement.checked;
        }
    }
    runDialogExport(options) {
        if (!options.includeHelixPos) {
            this.runScadnanoLongCalculation(() => {
                try {
                    this.exportToScadnano(options.name, options.gridType);
                }
                catch (err) {
                    notify(`Scadnano export failed: ${err}`, 'alert');
                }
            });
            return;
        }
        let helixPos = null;
        let failed = false;
        this.runScadnanoLongCalculation(() => {
            try {
                helixPos = this.calculateScadnanoHelixPos(options.gridType);
                if (helixPos) {
                    window.currentScadnanoHelixPos = this.cloneHelixPosMap(helixPos);
                }
            }
            catch (err) {
                failed = true;
                notify(`Scadnano export failed: ${err}`, 'alert');
            }
        }, () => {
            if (failed || !helixPos)
                return;
            this.showGridFromHelixPos(helixPos, options.gridType);
        });
    }
    readDialogOptions() {
        const nameInput = document.getElementById('scadnanoFilename');
        const helixPosCheckbox = document.getElementById('scadnanoIncludeHPos');
        const scadnanoGrid = document.getElementById('scadnanoGrid');
        if (!nameInput || !helixPosCheckbox || !scadnanoGrid) {
            console.warn('scadnano export dialog missing inputs');
            return null;
        }
        return {
            name: nameInput.value.trim() || 'output',
            gridType: this.normalizeGridType(scadnanoGrid.value),
            includeHelixPos: helixPosCheckbox.checked,
        };
    }
    readCurrentExportTarget() {
        const nameInput = document.getElementById('scadnanoFilename');
        const scadnanoGrid = document.getElementById('scadnanoGrid');
        return {
            name: nameInput?.value.trim() || 'output',
            gridType: this.normalizeGridType(scadnanoGrid?.value),
        };
    }
    normalizeGridType(value) {
        return value === 'honeycomb' ? 'honeycomb' : 'square';
    }
    runScadnanoLongCalculation(calc, callback) {
        const longCalculation = window.view?.longCalculation;
        if (typeof longCalculation === 'function') {
            longCalculation(calc, 'Preparing scadnano export, please be patient...', callback);
            return;
        }
        calc();
        if (callback)
            callback();
    }
    closeScadnanoDialog() {
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
            if (closeBtn)
                closeBtn.click();
        }
        const dialogEl = document.getElementById('scadnanoDialog');
        if (dialogEl) {
            dialogEl.classList.remove('open');
            dialogEl.setAttribute('aria-hidden', 'true');
            dialogEl.style.display = 'none';
        }
    }
    exportToScadnano(name, gridType, helixPos) {
        const latticeType = this.normalizeGridType(gridType);
        const { helices, grid } = this.prepareScadnanoLayout(latticeType);
        const scadnano = helixPos
            ? toscad.buildScadnano2(grid, helices, gridType, helixPos)
            : toscad.buildScadnano2(grid, helices, gridType);
        const fileName = name ? `${name}.sc` : 'output.sc';
        makeTextFile(fileName, JSON.stringify(scadnano, null, 2));
    }
    getCurrentNucleotideCount() {
        let count = 0;
        elements.forEach((element) => {
            if (element instanceof Nucleotide)
                count += 1;
        });
        return count;
    }
    cloneHelixPosMap(input) {
        const out = new Map();
        input.forEach((value, key) => {
            out.set(Number(key), [Number(value[0]), Number(value[1])]);
        });
        return out;
    }
    calculateScadnanoHelices() {
        const nucleotideElements = new Map();
        elements.forEach((element, id) => {
            if (element instanceof Nucleotide) {
                nucleotideElements.set(id, element);
            }
        });
        const helices = helix.findHelices(nucleotideElements, 3);
        this.notifyHelixCoverageMismatch(helices, nucleotideElements);
        return helices;
    }
    prepareScadnanoLayout(latticeType, forceRecompute = false) {
        const nucleotideCount = this.getCurrentNucleotideCount();
        if (!forceRecompute &&
            this.currentScadnanoLayout &&
            this.currentScadnanoLayout.latticeType === latticeType &&
            this.currentScadnanoLayout.nucleotideCount === nucleotideCount) {
            this.currentScadnanoHelices = this.currentScadnanoLayout.helices;
            return this.currentScadnanoLayout;
        }
        const helices = this.calculateScadnanoHelices();
        this.currentScadnanoHelices = helices;
        const { grid, binderHelices } = toscad.setGrid(helices);
        toscad.directionAlign2(grid);
        toscad.alignGridPrim(grid, binderHelices);
        const angles = toscad.getAngles(grid, helices, latticeType);
        const corrected = toscad.anglecomb(grid, helices, latticeType, angles);
        const correct = toscad.anglecorr(grid, helices, latticeType, corrected.networkMap);
        const { crossovers } = toscad.collectCrossovers(grid);
        this.currentScadnanoConnections = this.buildScadnanoConnections(crossovers);
        this.currentScadnanoLayout = {
            latticeType,
            nucleotideCount,
            helices,
            grid,
            helixPos: toscad.calculateGlobalPositions(correct.networkMap, undefined, undefined, latticeType)
        };
        return this.currentScadnanoLayout;
    }
    calculateScadnanoHelixPos(latticeType = 'square') {
        const { helixPos } = this.prepareScadnanoLayout(latticeType);
        return this.cloneHelixPosMap(helixPos);
    }
    notifyHelixCoverageMismatch(helices, inputMap) {
        const helixCount = helices.flat().length;
        const totalCount = inputMap.size;
        if (helixCount === totalCount)
            return;
        notify(`Helix mapping error: ${helixCount}/${totalCount} nucleotides were mapped. Scadnano conversion will be missing some nucleotides.`, 'alert', true);
    }
    buildScadnanoConnections(crossovers) {
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
    normalizeHelixPosMap(input) {
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
    getScadnanoGridPane() {
        return document.getElementById('scadnanoGridPane');
    }
    getScadnanoGridCanvas() {
        return document.getElementById('scadnanoGridCanvas');
    }
    setScadnanoPaneWidth(widthPx) {
        const minW = 240;
        const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.75));
        const clamped = Math.max(minW, Math.min(maxW, Math.round(widthPx)));
        document.documentElement.style.setProperty('--scadnano-pane-width', `${clamped}px`);
    }
    resizeScadnanoGridCanvas() {
        const pane = this.getScadnanoGridPane();
        const canvas = this.getScadnanoGridCanvas();
        if (!pane || !canvas)
            return;
        canvas.width = pane.clientWidth;
        canvas.height = pane.clientHeight;
    }
    mapFromEditorNodes(editor) {
        const out = new Map();
        const nodes = typeof editor.getNodes === 'function' ? editor.getNodes() : [];
        nodes.forEach((node) => {
            out.set(Number(node.id), [Number(node.col), Number(node.row)]);
        });
        return out;
    }
    publishCurrentHelixPosFromEditor() {
        if (!this.scadnanoGridEditor)
            return;
        window.currentScadnanoHelixPos = this.mapFromEditorNodes(this.scadnanoGridEditor);
    }
    ensureScadnanoHelicesCache() {
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
        }
        catch (err) {
            notify(`Unable to map grid helix selection: ${err}`, 'warning');
            return null;
        }
    }
    selectHelixFromGridNode(helixId) {
        const helices = this.ensureScadnanoHelicesCache();
        if (!helices)
            return;
        const helix = helices[helixId];
        if (!Array.isArray(helix) || helix.length === 0)
            return;
        const selectElements = window.api?.selectElements;
        if (typeof selectElements !== 'function')
            return;
        selectElements(helix);
    }
    ensureScadnanoGridEditor(gridType) {
        if (this.scadnanoGridEditor && this.scadnanoGridEditorType === gridType)
            return this.scadnanoGridEditor;
        if (this.scadnanoGridEditor && this.scadnanoGridEditorType !== gridType) {
            if (typeof this.scadnanoGridEditor.dispose === 'function') {
                this.scadnanoGridEditor.dispose();
            }
            this.scadnanoGridEditor = null;
            this.scadnanoGridEditorType = null;
        }
        const canvas = this.getScadnanoGridCanvas();
        if (!canvas)
            return null;
        const scadnanoNs = window.scadnano;
        if (!scadnanoNs)
            return null;
        const editorCtorName = gridType === 'square' ? 'SquareEditor' : 'HoneycombEditor';
        const EditorCtor = scadnanoNs[editorCtorName];
        if (typeof EditorCtor !== 'function')
            return null;
        this.scadnanoGridEditor = new EditorCtor(canvas);
        this.scadnanoGridEditorType = gridType;
        this.scadnanoGridEditor.onNodesChanged = () => {
            this.publishCurrentHelixPosFromEditor();
        };
        this.scadnanoGridEditor.onNodeSelected = (node) => {
            const helixId = Number(node?.id);
            if (!Number.isFinite(helixId))
                return;
            this.selectHelixFromGridNode(helixId);
        };
        return this.scadnanoGridEditor;
    }
    initScadnanoGridPaneControls() {
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
            this.setScadnanoPaneWidth(e.clientX);
            this.resizeScadnanoGridCanvas();
            if (this.scadnanoGridEditor && typeof this.scadnanoGridEditor.resize === 'function') {
                this.scadnanoGridEditor.resize();
            }
        });
        window.addEventListener('mouseup', () => {
            if (!resizing)
                return;
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
function registerScadnanoWindowApi() {
    window.exportScadnanoFromGridView = (helixPosInput) => {
        scadnanoManager.exportFromGridView(helixPosInput);
    };
    window.showScadnanoGridFromHelixPos = (helixPosInput, gridTypeInput) => {
        scadnanoManager.showGridFromHelixPos(helixPosInput, gridTypeInput);
    };
    window.hideScadnanoGridPane = () => {
        scadnanoManager.hideScadnanoGridPane();
    };
    window.scadnanoDialogExport = () => {
        scadnanoManager.handleDialogExport();
    };
    window.toggleGridDropdown = (checkboxElement) => {
        scadnanoManager.toggleGridDropdown(checkboxElement);
    };
}
registerScadnanoWindowApi();
// Keep these named wrappers for inline HTML handlers and backwards compatibility.
function scadnanoDialogExport() {
    scadnanoManager.handleDialogExport();
}
function toggleGridDropdown(checkboxElement) {
    scadnanoManager.toggleGridDropdown(checkboxElement);
}
