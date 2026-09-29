"use strict";
/// <reference path="../typescript_definitions/index.d.ts" />
/// <reference path="../typescript_definitions/oxView.d.ts" />
/// <reference path="../main.ts" />
var helix;
(function (helix) {
    const MAX_ANGULAR_SEPARATION = 40 * Math.PI / 180;
    const NOISE = -1;
    // Spatial clusters get grouped by crossovers - requirement for this is they share 3 crossovers at minimum.
    const MIN_SHARED_CROSSOVERS = 3;
    function angularSeparation(a, b) {
        const dot = Math.max(-1, Math.min(1, Math.abs(a.dot(b))));
        return Math.acos(dot);
    }
    // Cluster helices by axis orientation (40º cutoff) using DBSCAN. 
    function dbscan(helices, grid, binderHelixIds, minPts = 1) {
        if (!Array.isArray(helices) || helices.length === 0)
            return [];
        minPts = Math.max(1, Math.floor(minPts));
        const binderIds = new Set(binderHelixIds);
        const axes = new Map();
        const nucleotideOwner = new Map();
        helices.forEach((hx, helixId) => {
            for (const nt of hx) {
                if (!nucleotideOwner.has(nt.id))
                    nucleotideOwner.set(nt.id, helixId);
            }
            if (binderIds.has(helixId))
                return;
            const axis = toscad.kmHelixAxis(grid, helices, helixId);
            if (axis)
                axes.set(helixId, axis);
        });
        const candidates = Array.from(axes.keys());
        const regionQuery = (helixId) => {
            const axis = axes.get(helixId);
            if (!axis)
                return [];
            return candidates.filter(otherId => {
                if (otherId === helixId)
                    return false;
                const otherAxis = axes.get(otherId);
                return !!otherAxis && angularSeparation(axis, otherAxis) <= MAX_ANGULAR_SEPARATION;
            });
        };
        return assembleClusters(helices, minPts, binderIds, nucleotideOwner, candidates, regionQuery);
    }
    helix.dbscan = dbscan;
    // DBSCAN core, used by both spatial and orientation clustering.
    function assembleClusters(helices, minPts, binderIds, nucleotideOwner, candidates, regionQuery) {
        const labels = new Map();
        const visited = new Set();
        let clusterId = 0;
        for (const helixId of candidates) {
            if (visited.has(helixId))
                continue;
            visited.add(helixId);
            let neighbours = regionQuery(helixId);
            if (neighbours.length < minPts) {
                labels.set(helixId, NOISE);
                continue;
            }
            clusterId++;
            labels.set(helixId, clusterId);
            const queued = new Set(neighbours);
            for (let i = 0; i < neighbours.length; i++) {
                const neighbourId = neighbours[i];
                if (!visited.has(neighbourId)) {
                    visited.add(neighbourId);
                    const expanded = regionQuery(neighbourId);
                    if (expanded.length >= minPts) {
                        for (const expandedId of expanded) {
                            if (queued.has(expandedId))
                                continue;
                            queued.add(expandedId);
                            neighbours.push(expandedId);
                        }
                    }
                }
                if (!labels.has(neighbourId) || labels.get(neighbourId) === NOISE) {
                    labels.set(neighbourId, clusterId);
                }
            }
        }
        // Assign output clusters only after DBSCAN finishes.
        const clustered = [];
        const clusterOutput = new Map();
        const helixOutput = new Map();
        // only do non-binder helices first.
        helices.forEach((hx, helixId) => {
            if (binderIds.has(helixId))
                return;
            const label = labels.get(helixId);
            let outputId;
            if (label !== undefined && label !== NOISE && clusterOutput.has(label)) {
                outputId = clusterOutput.get(label);
            }
            else {
                outputId = clustered.length;
                clustered.push([]);
                if (label !== undefined && label !== NOISE)
                    clusterOutput.set(label, outputId);
            }
            clustered[outputId].push(helixId);
            helixOutput.set(helixId, outputId);
        });
        for (const binderId of binderIds) {
            let parentOutput;
            for (const nt of helices[binderId]) {
                for (const neighbour of [nt.n5, nt.n3]) {
                    if (!(neighbour instanceof Nucleotide))
                        continue;
                    const parentId = nucleotideOwner.get(neighbour.id);
                    if (parentId === undefined || parentId === binderId || binderIds.has(parentId))
                        continue;
                    parentOutput = helixOutput.get(parentId);
                    break;
                }
                if (parentOutput !== undefined)
                    break;
            }
            if (parentOutput === undefined) {
                parentOutput = clustered.length;
                clustered.push([]);
            }
            clustered[parentOutput].push(binderId);
        }
        return clustered;
    }
    // 2 helices belong to the same spatial cluster if they share at least 3 crossovers.
    function spatialDbscan(helices, grid, binderHelixIds, minPts = 1) {
        if (!Array.isArray(helices) || helices.length === 0)
            return [];
        minPts = Math.max(1, Math.floor(minPts));
        const binderIds = new Set(binderHelixIds);
        const nucleotideOwner = new Map();
        helices.forEach((hx, helixId) => {
            for (const nt of hx) {
                if (!nucleotideOwner.has(nt.id))
                    nucleotideOwner.set(nt.id, helixId);
            }
        });
        const { crossovers } = toscad.collectCrossovers(grid);
        const sharedCrossovers = (a, b) => {
            const counts = crossovers.get(a)?.get(b);
            if (!counts)
                return 0;
            return (counts.sameWalk ?? 0) + (counts.diffWalk ?? 0);
        };
        // Duplex helices are the clustering candidates; binders are attached later.
        const candidates = [];
        helices.forEach((_, helixId) => {
            if (!binderIds.has(helixId))
                candidates.push(helixId);
        });
        const regionQuery = (helixId) => {
            return candidates.filter(otherId => otherId !== helixId && sharedCrossovers(helixId, otherId) >= MIN_SHARED_CROSSOVERS);
        };
        return assembleClusters(helices, minPts, binderIds, nucleotideOwner, candidates, regionQuery);
    }
    helix.spatialDbscan = spatialDbscan;
    // Merge clusters that are small (<= 2 helices) into larger clusters
    // Also, "scatter" the resulting super-clusters in a single frame (to prevent overlap).
    function mergeClusters(clusters, helices, grid, latticeType, tolerance, wireframe) {
        const SMALL_CLUSTER_MAX = 2;
        const CLUSTER_GAP = 4;
        // Lay out one cluster (list of top-level helix ids) on its own frame.
        const layoutCluster = (memberHelixIds) => {
            const subMap = new Map();
            for (const hid of memberHelixIds) {
                for (const nt of helices[hid] ?? [])
                    subMap.set(nt.id, nt);
            }
            return toscad.layoutPipeline(subMap, {
                tolerance,
                lattice: latticeType,
                renumber: false,
                wireframe,
                _skipCluster: true
            });
        };
        // top-level helix id -> raw cluster index, plus per-cluster size and min helix id.
        const clusterOf = new Map();
        clusters.forEach((c, ci) => { for (const h of c)
            clusterOf.set(h, ci); });
        const clusterSize = clusters.map(c => c.length);
        // the min helix id only is used for tie-breaking because idk what better way to tie-break this
        const clusterMinHelix = clusters.map(c => c.reduce((m, h) => Math.min(m, h), Infinity));
        const clusterOfNt = (nt) => {
            const h = grid.get(nt.id)?.helixId;
            return h === undefined ? undefined : clusterOf.get(h);
        };
        // For each small cluster, choose the most-connected target cluster (or tie-break with lowest min helix id).
        const mergeTarget = new Map();
        clusters.forEach((c, ci) => {
            if (c.length === 0 || c.length > SMALL_CLUSTER_MAX)
                return;
            const counts = new Map();
            for (const h of c) {
                for (const nt of helices[h] ?? []) {
                    for (const nb of [nt.n5, nt.n3, nt.pair]) {
                        if (!(nb instanceof Nucleotide))
                            continue;
                        const cj = clusterOfNt(nb);
                        if (cj === undefined || cj === ci)
                            continue;
                        counts.set(cj, (counts.get(cj) ?? 0) + 1);
                    }
                }
            }
            let best = -1;
            for (const [cj, cnt] of counts) {
                if (best < 0) {
                    best = cj;
                    continue;
                }
                const bc = counts.get(best);
                if (cnt > bc || (cnt === bc && clusterMinHelix[cj] < clusterMinHelix[best]))
                    best = cj;
            }
            if (best >= 0)
                mergeTarget.set(ci, best);
        });
        // Group small clusters with their targets via union-find.
        const parent = clusters.map((_, i) => i);
        const find = (x) => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb)
                parent[ra] = rb;
        };
        for (const [ci, tj] of mergeTarget)
            union(ci, tj);
        const groups = new Map();
        clusters.forEach((c, ci) => {
            if (!c.length)
                return;
            const r = find(ci);
            if (!groups.has(r))
                groups.set(r, []);
            groups.get(r).push(ci);
        });
        // Build one super-cluster (combined local frame) from a group of clusters.
        const buildSuperCluster = (members) => {
            // Host = largest member; tie -> lowest min helix id. Others are satellites.
            let host = members[0];
            for (const m of members) {
                if (clusterSize[m] > clusterSize[host] ||
                    (clusterSize[m] === clusterSize[host] && clusterMinHelix[m] < clusterMinHelix[host])) {
                    host = m;
                }
            }
            const gHelices = [];
            const gGrid = new Map();
            const gNetwork = new Map();
            const gPos = new Map();
            const occupied = new Set();
            const ntToGHelix = new Map();
            // Append a sub-layout's helices/grid/network under a fresh id range and
            // return the idBase so the caller can assign positions per local helix.
            const appendTopology = (sub) => {
                const idBase = gHelices.length;
                for (const h of sub.helices)
                    gHelices.push(h);
                for (const [ntId, mark] of sub.grid) {
                    gGrid.set(ntId, { ...mark, helixId: idBase + mark.helixId });
                    ntToGHelix.set(ntId, idBase + mark.helixId);
                }
                for (const [a, inner] of sub.networkMap) {
                    const remapped = new Map();
                    for (const [b, ang] of inner)
                        remapped.set(idBase + b, ang);
                    gNetwork.set(idBase + a, remapped);
                }
                return idBase;
            };
            // Host defines the frame: keep its native positions.
            const hostSub = layoutCluster(clusters[host]);
            const hostBase = appendTopology(hostSub);
            for (const [lid, p] of hostSub.helixPos) {
                const cell = [p[0], p[1]];
                gPos.set(hostBase + lid, cell);
                occupied.add(`${cell[0]},${cell[1]}`);
            }
            // Anchor for a satellite: cell of the already-placed helix it bonds to,
            // choosing the connection whose target helix has the lowest top-level id.
            const anchorFor = (sat) => {
                let bestKey = Infinity;
                let anchor;
                for (const h of clusters[sat]) {
                    for (const nt of helices[h] ?? []) {
                        for (const nb of [nt.n5, nt.n3, nt.pair]) {
                            if (!(nb instanceof Nucleotide))
                                continue;
                            const gh = ntToGHelix.get(nb.id);
                            if (gh === undefined)
                                continue; // not placed yet
                            const thId = grid.get(nb.id)?.helixId ?? Infinity;
                            if (thId < bestKey) {
                                bestKey = thId;
                                anchor = gPos.get(gh);
                            }
                        }
                    }
                }
                return anchor;
            };
            const placeSatellite = (sat, anchor) => {
                const sub = layoutCluster(clusters[sat]);
                const idBase = gHelices.length;
                for (const h of sub.helices)
                    gHelices.push(h);
                for (const [a, inner] of sub.networkMap) {
                    const remapped = new Map();
                    for (const [b, ang] of inner)
                        remapped.set(idBase + b, ang);
                    gNetwork.set(idBase + a, remapped);
                }
                // Drop each helix at the nearest open cell to the anchor (internal
                // layout of the small cluster is discarded).
                for (const [lid] of sub.helixPos) {
                    const cell = toscad.findNearestOpenPos(anchor, occupied);
                    gPos.set(idBase + lid, cell);
                    occupied.add(`${cell[0]},${cell[1]}`);
                }
                for (const [ntId, mark] of sub.grid) {
                    gGrid.set(ntId, { ...mark, helixId: idBase + mark.helixId });
                    ntToGHelix.set(ntId, idBase + mark.helixId);
                }
            };
            // Place satellites in dependency order: a satellite is placeable once one
            // of its bonds reaches an already-placed helix.
            let remaining = members.filter(m => m !== host);
            let progress = true;
            while (remaining.length && progress) {
                progress = false;
                const still = [];
                for (const sat of remaining) {
                    const anchor = anchorFor(sat);
                    if (!anchor) {
                        still.push(sat);
                        continue;
                    }
                    placeSatellite(sat, anchor);
                    progress = true;
                }
                remaining = still;
            }
            // Fallback for satellites with no reachable anchor (group not fully
            // connected): anchor them to the host's first cell.
            if (remaining.length) {
                const fallback = gPos.get(hostBase) ?? [0, 0];
                for (const sat of remaining)
                    placeSatellite(sat, fallback);
            }
            return { helices: gHelices, grid: gGrid, networkMap: gNetwork, pos: gPos };
        };
        // Deterministic group order: by the lowest helix id any member holds.
        const groupList = [...groups.values()].sort((a, b) => {
            const ma = a.reduce((m, ci) => Math.min(m, clusterMinHelix[ci]), Infinity);
            const mb = b.reduce((m, ci) => Math.min(m, clusterMinHelix[ci]), Infinity);
            return ma - mb;
        });
        // Scatter super-clusters left-to-right with CLUSTER_GAP between them.
        const combinedHelices = [];
        const combinedGrid = new Map();
        const combinedNetwork = new Map();
        const combinedPos = new Map();
        let globalMaxCol = -Infinity;
        for (const members of groupList) {
            const sc = buildSuperCluster(members);
            if (!sc.helices.length)
                continue;
            let minCol = Infinity;
            for (const [, p] of sc.pos)
                if (p[0] < minCol)
                    minCol = p[0];
            let dCol = (isFinite(globalMaxCol) && isFinite(minCol))
                ? (globalMaxCol + CLUSTER_GAP - minCol)
                : 0;
            // Honeycomb's (col+row)&1 2-coloring survives a column shift only when the
            // shift is even, so nudge by one when needed. (Square has no such rule.)
            if (latticeType === 'honeycomb' && (dCol & 1))
                dCol += 1;
            const idBase = combinedHelices.length;
            for (const h of sc.helices)
                combinedHelices.push(h);
            for (const [ntId, mark] of sc.grid) {
                combinedGrid.set(ntId, { ...mark, helixId: idBase + mark.helixId });
            }
            for (const [a, inner] of sc.networkMap) {
                const remapped = new Map();
                for (const [b, ang] of inner)
                    remapped.set(idBase + b, ang);
                combinedNetwork.set(idBase + a, remapped);
            }
            for (const [lid, p] of sc.pos) {
                const np = [p[0] + dCol, p[1]];
                combinedPos.set(idBase + lid, np);
                if (np[0] > globalMaxCol)
                    globalMaxCol = np[0];
            }
        }
        console.log(`[layoutPipeline] ${clusters.length} raw cluster(s) -> ${groupList.length} ` +
            `super-cluster(s), ${combinedHelices.length} helices`);
        toscad.validateGrid(combinedGrid);
        return {
            helices: combinedHelices,
            grid: combinedGrid,
            helixPos: combinedPos,
            networkMap: combinedNetwork
        };
    }
    helix.mergeClusters = mergeClusters;
})(helix || (helix = {}));
