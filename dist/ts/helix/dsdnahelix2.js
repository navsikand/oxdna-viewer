"use strict";
/// <reference path="../typescript_definitions/index.d.ts" />
/// <reference path="../typescript_definitions/oxView.d.ts" />
/// <reference path="../main.ts" />
/*
// for ease of use, and to prevent dumb mistakes as I code and test things out, here is exactly the commands to use this in console:
findBasepairs3(); // use 3 because there are 2 versions of findBasepairs, and 3 is the fastest. Dont ask why i named it that.
helix.dropIntraStrandPairs();
let {partials, unpaired} = helix.findHelixPartials(elements, 2);
let {ssdna, stubs, longssScaffold} = helix.ssdnaPartials(unpaired);
let ssScaffold = helix.longssScaffoldfunc(longssScaffold, stubs);
let {helices, lastScraps, binders, binder2, disconnected, unhandled} = helix.generateHelix(partials, ssdna, ssScaffold, stubs);
// and helices are what you want!
// This code has been completed (polishing required but sure).
// After running this, check for helix.flat().length == elements.size
// If false, then something went wrong! RIP.
*/
/*
// Check for double-pairing or cross-pairing.
let pairTally = new Map();
let overloadedNucleotides = [];
elements.forEach(nt=>{
    let targetPairId = nt.pair;
    if (targetPairId !== undefined && targetPairId !== null) {
        let currentCount = pairTally.get(targetPairId) || 0;
        pairTally.set(targetPairId, currentCount + 1);
        if (currentCount + 1 === 2) {
            overloadedNucleotides.push(targetPairId);
        }
    }
})
*/
// For even easier use, just run:
// let helices = await helix.findHelices(elements, 2);
var helix;
(function (helix_1) {
    // helper function cuz didnt want to type this every time
    function checkAngle(n1 = null, n2 = null) {
        if (!n1 || !n2)
            return 0;
        return Math.acos(n1.getA3().dot(n2.getA3())) * (180 / Math.PI);
    }
    helix_1.checkAngle = checkAngle;
    // Returns the longest strand in the system as scaffold...
    function getScaffoldStrand() {
        let maxLen = 0;
        let scaffold = null;
        systems.forEach(s => {
            s.strands.forEach(strand => {
                if (strand.getLength() > maxLen) {
                    maxLen = strand.getLength();
                    scaffold = strand;
                }
            });
        });
        return scaffold;
    }
    helix_1.getScaffoldStrand = getScaffoldStrand;
    // Removes intra-strand pairings across the whole structure
    // ALWAYS run this function after findBasepairs3(). Very important.
    function dropIntraStrandPairs() {
        elements.forEach((nt) => {
            if (!(nt instanceof Nucleotide))
                return;
            if (!nt.pair)
                return;
            if (nt.pair.strand === nt.strand) {
                const mate = nt.pair;
                nt.pair = null;
                if (mate.pair === nt) {
                    mate.pair = null;
                }
            }
        });
    }
    helix_1.dropIntraStrandPairs = dropIntraStrandPairs;
    // Finds helix parts using destructive consumption of a working copy of elements (called mermaid).
    // tolerance 2 is good enough for most cases. Higher tolerances seem to have no negative consequences, however.
    // go to terminatingConditions for what tolerance is.
    function findHelixPartials2(inputMap, tolerance = 2) {
        const elmts = new Map(inputMap); // copy of the elements map
        const elmts2 = new Map(inputMap); // backup copy for duplication, used later
        const unpaired = new Map(); // unpaired / skipped nts
        let partials = [];
        const record = (list, set, nt = null) => {
            if (nt && !set.has(nt.id)) {
                set.add(nt.id);
                list.push(nt);
            }
        };
        const nextStart = () => elmts.values().next().value;
        while (true) {
            const start = nextStart();
            if (!start)
                break;
            // Collect unpaired/binder nts for downstream ssDNA processing instead of discarding silently.
            // Additionally, only walk if the pair is also present in the current pool (mermaid).
            const pairInPool = start.pair ? elmts.get(start.pair.id) : undefined;
            if (!start.pair || !pairInPool) {
                unpaired.set(start.id, start);
                elmts.delete(start.id);
                continue;
            }
            // initialize the walker.
            let curr = start;
            let currPair = pairInPool;
            const strandA = curr.strand; // required to ensure we don't cross strands. This is how we know partials is actually a partial helix.
            const strandB = currPair.strand;
            // this is the partial being built.
            const partial = [];
            const seen = new Set();
            const terminatingConditions = (nucA, nucB, dir) => {
                const nucAc = elmts.get(nucA.id + dir);
                const nucBc = elmts.get(nucB.id - dir);
                if (!nucAc || !nucBc)
                    return null;
                if (nucAc.strand !== strandA || nucBc.strand !== strandB)
                    return null;
                // Tolerance window: OR logic. Continue if ANY offset in [1, tolerance] has forward paired to backward.
                // (allows rescue by walking farther along topological neighbors on both strands).
                let forwardCursor = nucA;
                let backwardCursor = nucB;
                for (let offset = 1; offset <= tolerance; offset++) {
                    const forward = elmts.get(nucA.id + dir * offset);
                    const backward = elmts.get(nucB.id - dir * offset);
                    if (!forward || !backward)
                        continue; // check if either of them even exist.
                    if (forward.strand !== strandA || backward.strand !== strandB)
                        continue;
                    if (forward.pair === backward) {
                        return { nextA: nucAc, nextB: nucBc };
                    }
                }
                return null;
            };
            // actual traversal loop.
            while (curr && currPair) {
                record(partial, seen, curr);
                record(partial, seen, currPair);
                // destructive consumption. This is why we make a copy of elements, and not use the original map directly.
                elmts.delete(curr.id);
                elmts.delete(currPair.id);
                const step = terminatingConditions(curr, currPair, 1) || terminatingConditions(curr, currPair, -1);
                if (!step)
                    break;
                // Always consume the immediate neighbors (curr+1 and a-1) even if mismatched.
                record(partial, seen, step.nextA);
                record(partial, seen, step.nextB);
                elmts.delete(step.nextA.id);
                elmts.delete(step.nextB.id);
                // Advance walker by one along each strand.
                curr = step.nextA;
                currPair = step.nextB;
            }
            if (partial.length) {
                partials.push(partial);
            }
        }
        // Deduplicate across all partials: any nucleotide that appears more than once
        // is moved to unpaired along with its pair and any nucleotide paired to it.
        // they will be handled as either ssDNA or just directly added to helix later.
        const seenfordups = new Map();
        const duplicates = new Set();
        partials.forEach(helix => {
            helix.forEach(nt => {
                if (seenfordups.has(nt.id)) {
                    duplicates.add(nt.id);
                }
                else {
                    seenfordups.set(nt.id, nt);
                }
            });
        });
        // had to add the multi-pairing logic (down below) to fix the problem. But still logging for curiosity.
        console.log('Duplicates set: ', duplicates);
        if (duplicates.size) {
            // Collect pair ids for duplicates
            console.log('duplicates found: ', duplicates);
            console.log('total duplicates: ', duplicates.size);
            const pairIds = new Set();
            duplicates.forEach(id => {
                const a = elmts2.get(id);
                if (a) {
                    unpaired.set(a.id, a);
                    if (a.pair) {
                        pairIds.add(a.pair.id);
                        unpaired.set(a.pair.id, a.pair);
                    }
                }
            });
            // Remove duplicates, their pairs, and any nucleotide whose pair is a duplicate
            partials.forEach((helix, i) => {
                partials[i] = helix.filter(nt => {
                    if (duplicates.has(nt.id) || pairIds.has(nt.id)) {
                        unpaired.set(nt.id, nt);
                        return false;
                    }
                    if (nt.pair && duplicates.has(nt.pair.id)) {
                        unpaired.set(nt.id, nt);
                        return false;
                    }
                    return true;
                });
            });
            // Drop empty partial lists
            partials = partials.filter(helix => helix.length > 0);
        }
        return { partials, unpaired: Array.from(unpaired.values()) };
    }
    helix_1.findHelixPartials2 = findHelixPartials2;
    // Groups unpaired/binder nucleotides (unpaired) into ssDNA partials by strand.
    // Only contiguous runs (>2) along a strand are kept; shorter runs go to stubs.
    function ssdnaPartials(unpaired) {
        const unpairStrand = new Map();
        const ssdna = [];
        const stubs = [];
        const longssScaffold = [];
        const scaffold = getScaffoldStrand();
        unpaired.forEach(nt => {
            const arr = unpairStrand.get(nt.strand) || [];
            arr.push(nt);
            unpairStrand.set(nt.strand, arr);
        });
        // For each strand, sort it, find it's 5' ends and walk down n3 to build runs.
        unpairStrand.forEach((list, strand) => {
            const inSet = new Set(list.map(n => n.id));
            const visited = new Set();
            const isScaffoldStrand = scaffold && strand === scaffold;
            list.sort((a, b) => a.id - b.id);
            for (const nt of list) {
                if (visited.has(nt.id))
                    continue;
                const isStart = !nt.n5 || !inSet.has(nt.n5.id);
                if (isStart) {
                    const run = [];
                    let curr = nt;
                    while (curr && inSet.has(curr.id)) {
                        run.push(curr);
                        visited.add(curr.id);
                        curr = curr.n3;
                    }
                    if (run.length > 2) {
                        if (!isScaffoldStrand) {
                            ssdna.push(run);
                        }
                        else {
                            longssScaffold.push(...run);
                        }
                    }
                    else {
                        run.forEach(r => stubs.push(r));
                    }
                }
                // // expand run both directions along n5/n3 within unpaired set
                // const run: Nucleotide[] = [];
                // const pushRun = (node: Nucleotide | null, dir: 'n5' | 'n3') => {
                // 	let curr = node;
                // 	while (curr && inSet.has(curr.id) && !visited.has(curr.id)) {
                // 		run.push(curr);
                // 		visited.add(curr.id);
                // 		curr = curr[dir] as Nucleotide | null;
                // 	}
                // };
                // // walk n5 then n3 from seed to capture contiguous block
                // pushRun(nt, 'n5');
                // // pushRun added seed and upstream; now extend downstream from the last added toward n3
                // // ensure we start from the n3 of the seed to avoid duplicate seed
                // const seedN3 = nt.n3 as Nucleotide | null;
                // pushRun(seedN3, 'n3');
                // if (run.length > 2) {
                // 	ssdna.push(run);
                // } else {
                // 	run.forEach(r => stubs.push(r));
                // }
            }
        });
        return { ssdna, stubs, longssScaffold };
    }
    helix_1.ssdnaPartials = ssdnaPartials;
    // helper function for adding the average a3 vector in canvas. Really should not be here.
    function averageA3a(list) {
        if (!list.length)
            return new THREE.Vector3(0, 0, 0);
        // Align all A3 vectors so they point in a consistent direction before averaging.
        const ref = list[0].getA3().clone().normalize();
        const acc = ref.clone();
        for (let i = 1; i < list.length; i++) {
            const v = list[i].getA3().clone().normalize();
            acc.add(v.dot(ref) < 0 ? v.multiplyScalar(-1) : v);
        }
        acc.divideScalar(list.length);
        const avg = acc.normalize();
        // Visualize the averaged orientation from the first nucleotide origin when possible.
        const origin = list[0]?.getPos();
        if (origin && typeof THREE !== 'undefined' && typeof scene !== 'undefined' && scene?.add) {
            const helper = new THREE.ArrowHelper(avg.clone(), origin, 5);
            scene.add(helper);
        }
        return avg;
    }
    helix_1.averageA3a = averageA3a;
    ;
    // helper to consolidate the nucleotides into contiguous segments, and enforce equal halves for scaffold segments.
    function longssScaffoldfunc(longssScaffold, stubs = []) {
        const ssScaffold = [];
        if (!longssScaffold.length)
            return ssScaffold;
        // Work on a sorted copy so numeric contiguity is easy to detect.
        const sorted = [...longssScaffold].sort((a, b) => a.id - b.id);
        let runAway = [];
        const flushRun = () => {
            if (!runAway.length)
                return;
            if (runAway.length < 3) {
                runAway.forEach(nt => stubs.push(nt));
                runAway = [];
                return;
            }
            // Enforce equal halves; trim one nucleotide if odd-length to satisfy the requirement.
            const evenLen = runAway.length - (runAway.length % 2);
            if (evenLen !== runAway.length) {
                const dropped = runAway[evenLen];
                if (dropped)
                    stubs.push(dropped);
            }
            if (evenLen === 0) {
                runAway = [];
                return;
            }
            const half = evenLen / 2;
            ssScaffold.push(runAway.slice(0, half));
            ssScaffold.push(runAway.slice(half, evenLen));
            runAway = [];
        };
        sorted.forEach(nt => {
            const last = runAway[runAway.length - 1];
            if (!last || nt.id === last.id + 1) {
                runAway.push(nt);
                return;
            }
            flushRun();
            runAway.push(nt);
        });
        flushRun();
        return ssScaffold;
    }
    helix_1.longssScaffoldfunc = longssScaffoldfunc;
    function directConnections(partials, stubs, globalSystems = systems) {
        // Dot product threshold (45 degrees should be good)
        // Does NOT work for px-crossover lattices
        const dot = 0.707;
        const idToPartial = new Map();
        partials.forEach((list, idx) => {
            list.forEach(nt => idToPartial.set(nt.id, idx));
        });
        const idToStub = new Map();
        stubs.forEach((nt, idx) => idToStub.set(nt.id, idx));
        // helper function
        const averageA3 = (list) => {
            if (!list.length)
                return null;
            const acc = new THREE.Vector3(0, 0, 0);
            list.forEach(nt => {
                acc.add(nt.getA3().clone().normalize());
            });
            const len = acc.length();
            if (len < 1e-6)
                return null;
            return acc.divideScalar(len);
        };
        // These are the nucleotides in each partial whose A3 vectors will be averaged for partial's orientation.
        const partialStrandMap = new Map();
        const getPartialStrandNts = (partialIdx, strand) => {
            let byStrand = partialStrandMap.get(partialIdx);
            if (!byStrand) {
                byStrand = new Map();
                partialStrandMap.set(partialIdx, byStrand);
            }
            let list = byStrand.get(strand.id);
            if (!list) {
                list = partials[partialIdx].filter(nt => nt.strand === strand);
                byStrand.set(strand.id, list);
            }
            return list;
        };
        const partialStrandA3 = new Map();
        const getPartialStrandA3 = (partialIdx, strand) => {
            let byStrand = partialStrandA3.get(partialIdx);
            if (!byStrand) {
                byStrand = new Map();
                partialStrandA3.set(partialIdx, byStrand);
            }
            let vec = byStrand.get(strand.id);
            if (vec === undefined) {
                const list = getPartialStrandNts(partialIdx, strand);
                vec = list.length ? averageA3(list) : null;
                byStrand.set(strand.id, vec ?? null);
            }
            return vec;
        };
        // The A3 for stubs. 
        const stubA3 = new Map();
        const getStubA3 = (idx) => {
            let vec = stubA3.get(idx);
            if (!vec) {
                vec = stubs[idx].getA3().clone().normalize();
                stubA3.set(idx, vec);
            }
            return vec;
        };
        const totalNodes = partials.length + stubs.length;
        const parent = Array.from({ length: totalNodes }, (_, i) => i);
        const find = (x) => (parent[x] === x ? x : parent[x] = find(parent[x]));
        const unite = (a, b) => {
            const pa = find(a);
            const pb = find(b);
            if (pa !== pb)
                parent[pb] = pa;
        };
        const getNodeRef = (nt) => {
            const partialId = idToPartial.get(nt.id);
            if (partialId !== undefined)
                return { node: partialId, kind: 'partial', index: partialId };
            const stubId = idToStub.get(nt.id);
            if (stubId !== undefined)
                return { node: partials.length + stubId, kind: 'stub', index: stubId };
            return null;
        };
        const partialAdj = new Map();
        const addPartialAdj = (a, b) => {
            if (a === b)
                return;
            const setA = partialAdj.get(a) || new Set();
            setA.add(b);
            partialAdj.set(a, setA);
            const setB = partialAdj.get(b) || new Set();
            setB.add(a);
            partialAdj.set(b, setB);
        };
        const stubLinksMap = new Map();
        const addStubLink = (deadNode, partialIdx, score, strand) => {
            const links = stubLinksMap.get(deadNode) || new Map();
            const prev = links.get(partialIdx);
            if (!prev || score > prev.score) {
                links.set(partialIdx, { partialIdx, score, strand });
            }
            stubLinksMap.set(deadNode, links);
        };
        const attachDot = (a, b, strand) => {
            let vecA = null;
            let vecB = null;
            if (a.kind === 'partial')
                vecA = getPartialStrandA3(a.index, strand);
            else
                vecA = getStubA3(a.index);
            if (b.kind === 'partial')
                vecB = getPartialStrandA3(b.index, strand);
            else
                vecB = getStubA3(b.index);
            if (!vecA || !vecB)
                return -1;
            return vecA.dot(vecB);
        };
        globalSystems.forEach((system) => {
            system.strands.forEach((strand) => {
                let prev = null;
                strand.forEach((elem) => {
                    const nt = elem;
                    if (prev) {
                        const nodeA = getNodeRef(prev);
                        const nodeB = getNodeRef(nt);
                        if (nodeA && nodeB && nodeA.node !== nodeB.node) {
                            if (nodeA.kind === 'partial' && nodeB.kind === 'partial') {
                                addPartialAdj(nodeA.index, nodeB.index);
                            }
                            const d = attachDot(nodeA, nodeB, strand);
                            if (d > dot) {
                                if (nodeA.kind === 'partial' && nodeB.kind === 'partial') {
                                    unite(nodeA.node, nodeB.node);
                                }
                                else if (nodeA.kind === 'stub' || nodeB.kind === 'stub') {
                                    const deadNode = nodeA.kind === 'stub' ? nodeA : nodeB;
                                    const otherNode = nodeA.kind === 'stub' ? nodeB : nodeA;
                                    if (otherNode.kind === 'partial') {
                                        addStubLink(deadNode.node, otherNode.index, d, strand);
                                    }
                                }
                            }
                        }
                    }
                    prev = nt;
                });
            });
        });
        const stubLinks = Array.from(stubLinksMap.entries()).map(([stubNode, linksByPartial]) => ({
            stubNode,
            linksByPartial
        }));
        return {
            parent,
            idToPartial,
            idToStub,
            partialAdj,
            stubLinks,
            getPartialStrandA3,
            find,
            unite
        };
    }
    helix_1.directConnections = directConnections;
    // Note that stubs don't connect 2 partials together. If a stub is between 2 partials, the partials must also align.
    function makeHelices(partials, stubs, state) {
        const dot = 0.707;
        const coreHelices = [];
        const initialScraps = [];
        if (!partials.length) {
            stubs.forEach(nt => initialScraps.push([nt]));
            return { coreHelices, initialScraps };
        }
        // Unite partials
        const find = (x) => (state.parent[x] === x ? x : state.parent[x] = find(state.parent[x]));
        const unite = (a, b) => {
            const pa = find(a);
            const pb = find(b);
            if (pa !== pb)
                state.parent[pb] = pa;
        };
        const partialParent = Array.from({ length: partials.length }, (_, i) => find(i));
        const findPartial = (x) => (partialParent[x] === x ? x : partialParent[x] = findPartial(partialParent[x]));
        const partialMembers = new Map();
        for (let i = 0; i < partials.length; i++) {
            const root = findPartial(i);
            const set = partialMembers.get(root) || new Set();
            set.add(i);
            partialMembers.set(root, set);
        }
        const mergePartialGroups = (a, b) => {
            let ra = findPartial(a);
            let rb = findPartial(b);
            if (ra === rb)
                return ra;
            const setA = partialMembers.get(ra);
            const setB = partialMembers.get(rb);
            if (setA.size < setB.size) {
                const tmp = ra;
                ra = rb;
                rb = tmp;
            }
            const keep = partialMembers.get(ra);
            const drop = partialMembers.get(rb);
            drop.forEach(idx => keep.add(idx));
            partialMembers.set(ra, keep);
            partialMembers.delete(rb);
            partialParent[rb] = ra;
            return ra;
        };
        const hasDirectConnection = (rootA, rootB) => {
            if (rootA === rootB)
                return true;
            const setA = partialMembers.get(rootA);
            const setB = partialMembers.get(rootB);
            if (!setA || !setB)
                return false;
            const small = setA.size <= setB.size ? setA : setB;
            const large = setA.size <= setB.size ? setB : setA;
            for (const idx of small) {
                const neighbors = state.partialAdj.get(idx);
                if (!neighbors)
                    continue;
                for (const n of neighbors) {
                    if (large.has(n))
                        return true;
                }
            }
            return false;
        };
        const partialsCanBridge = (a, b) => {
            const vecA = state.getPartialStrandA3(a.partialIdx, a.strand);
            const vecB = state.getPartialStrandA3(b.partialIdx, b.strand);
            if (!vecA || !vecB)
                return false;
            return vecA.dot(vecB) > dot;
        };
        state.stubLinks.forEach(({ stubNode, linksByPartial }) => {
            const candidates = Array.from(linksByPartial.values()).sort((a, b) => b.score - a.score);
            if (!candidates.length)
                return;
            const primaryLink = candidates[0];
            let primaryRoot = findPartial(primaryLink.partialIdx);
            unite(stubNode, primaryRoot);
            for (let i = 1; i < candidates.length; i++) {
                const candidate = candidates[i];
                if (!partialsCanBridge(primaryLink, candidate))
                    continue;
                const currPrimaryRoot = findPartial(primaryRoot);
                const otherRoot = findPartial(candidate.partialIdx);
                if (currPrimaryRoot === otherRoot)
                    continue;
                if (hasDirectConnection(currPrimaryRoot, otherRoot))
                    continue;
                unite(stubNode, otherRoot);
                primaryRoot = mergePartialGroups(currPrimaryRoot, otherRoot);
            }
        });
        const groups = new Map();
        partials.forEach((list, idx) => {
            const root = find(idx);
            const arr = groups.get(root) || [];
            arr.push(...list);
            groups.set(root, arr);
        });
        stubs.forEach((nt, idx) => {
            const node = partials.length + idx;
            const root = find(node);
            if (!groups.has(root)) {
                initialScraps.push([nt]);
                return;
            }
            const arr = groups.get(root) || [];
            arr.push(nt);
            groups.set(root, arr);
        });
        groups.forEach(group => {
            const seen = new Set();
            const unique = [];
            group.forEach(nt => {
                if (seen.has(nt.id))
                    return;
                seen.add(nt.id);
                unique.push(nt);
            });
            if (unique.length)
                coreHelices.push(unique);
        });
        return { coreHelices, initialScraps };
    }
    helix_1.makeHelices = makeHelices;
    function ssScaffolds(coreHelices, ssScaffold) {
        const updatedHelices = coreHelices.map(h => h.slice());
        const scaffoldScraps = [];
        if (!ssScaffold || !ssScaffold.length)
            return { updatedHelices, scaffoldScraps };
        if (!updatedHelices.length) {
            ssScaffold.forEach(segment => {
                if (segment.length)
                    scaffoldScraps.push(segment.slice());
            });
            return { updatedHelices, scaffoldScraps };
        }
        const idToHelix = new Map();
        updatedHelices.forEach((list, idx) => {
            list.forEach(nt => idToHelix.set(nt.id, idx));
        });
        const ssScaffoldIds = new Set();
        ssScaffold.forEach(segment => segment.forEach(nt => ssScaffoldIds.add(nt.id)));
        const addToHelix = (targetIdx, segment) => {
            const helix = updatedHelices[targetIdx];
            if (!helix)
                return;
            const seen = new Set(helix.map(nt => nt.id));
            segment.forEach(nt => {
                if (seen.has(nt.id))
                    return;
                helix.push(nt);
                seen.add(nt.id);
                idToHelix.set(nt.id, targetIdx);
            });
        };
        const findTargets = (segment) => {
            const segmentIds = new Set(segment.map(nt => nt.id));
            const helixIndices = new Set();
            segment.forEach(nt => {
                const n5 = nt.n5;
                const n3 = nt.n3;
                if (n5 && !segmentIds.has(n5.id) && !ssScaffoldIds.has(n5.id)) {
                    const hIdx = idToHelix.get(n5.id);
                    if (hIdx !== undefined)
                        helixIndices.add(hIdx);
                }
                if (n3 && !segmentIds.has(n3.id) && !ssScaffoldIds.has(n3.id)) {
                    const hIdx = idToHelix.get(n3.id);
                    if (hIdx !== undefined)
                        helixIndices.add(hIdx);
                }
            });
            return Array.from(helixIndices.values());
        };
        let pending = ssScaffold.filter(segment => segment.length > 0).map(segment => segment.slice());
        const maxRounds = Math.max(1, pending.length * 2);
        let round = 0;
        while (pending.length) {
            round += 1;
            let attachedThisRound = 0;
            const nextPending = [];
            pending.forEach(segment => {
                const targets = findTargets(segment);
                if (!targets.length) {
                    nextPending.push(segment);
                    return;
                }
                const primary = targets[0];
                addToHelix(primary, segment);
                attachedThisRound += 1;
            });
            if (!nextPending.length)
                break;
            if (!attachedThisRound || round >= maxRounds) {
                nextPending.forEach(segment => scaffoldScraps.push(segment.slice()));
                break;
            }
            pending = nextPending;
        }
        return { updatedHelices, scaffoldScraps };
    }
    helix_1.ssScaffolds = ssScaffolds;
    function ssDNA(updatedHelices, ssdna, combinedScraps) {
        const helices = updatedHelices.map(h => h.slice());
        const binders = [];
        const binder2 = [];
        const disconnected = [];
        const unhandled = [];
        const lastScraps = [];
        const idToHelix = new Map();
        helices.forEach((list, idx) => {
            list.forEach(nt => idToHelix.set(nt.id, idx));
        });
        const addSegmentToHelix = (targetIdx, segment) => {
            const helix = helices[targetIdx];
            if (!helix)
                return;
            const seen = new Set(helix.map(nt => nt.id));
            segment.forEach(nt => {
                if (seen.has(nt.id))
                    return;
                helix.push(nt);
                seen.add(nt.id);
                idToHelix.set(nt.id, targetIdx);
            });
        };
        const findEndOnSide = (segment, segmentSet, dir) => {
            for (const nt of segment) {
                const neighbor = nt[dir];
                if (!neighbor || !segmentSet.has(neighbor.id))
                    return nt;
            }
            return null;
        };
        const walkForHelix = (start, dir, segmentSet) => {
            let curr = start;
            while (curr) {
                if (segmentSet.has(curr.id))
                    return undefined;
                const helixId = idToHelix.get(curr.id);
                if (helixId !== undefined)
                    return { helixId, node: curr };
                curr = curr[dir];
            }
            return undefined;
        };
        const stepWithinSameHelix = (start, dir, steps, helixId) => {
            let curr = start;
            let last = start;
            for (let i = 0; i < steps; i++) {
                curr = curr?.[dir];
                if (!curr)
                    return last;
                const idx = idToHelix.get(curr.id);
                if (idx !== helixId)
                    return last;
                last = curr;
            }
            return last;
        };
        const stepN = (start, dir, steps) => {
            let curr = start;
            for (let i = 0; i < steps; i++) {
                curr = curr?.[dir];
                if (!curr)
                    return undefined;
            }
            return curr;
        };
        const classifySegment = (segment) => {
            const segmentSet = new Set(segment.map(nt => nt.id));
            const analyzeSide = (dir) => {
                const end = findEndOnSide(segment, segmentSet, dir);
                if (!end)
                    return { side: dir, result: 'overhang' };
                const anchor = end[dir];
                if (!anchor)
                    return { side: dir, result: 'overhang' };
                const first = walkForHelix(anchor, dir, segmentSet);
                if (!first)
                    return { side: dir, result: 'overhang' };
                const firstHelixId = first.helixId;
                const lastInHelix = stepWithinSameHelix(first.node, dir, 1, firstHelixId);
                const pair = lastInHelix.pair;
                if (!pair) {
                    return {
                        side: dir,
                        result: 'overhang',
                        firstHelixId
                    };
                }
                const oppositeNode = stepN(pair, dir, 3);
                if (!oppositeNode) {
                    return {
                        side: dir,
                        result: 'overhang',
                        firstHelixId
                    };
                }
                const oppositeHelixId = idToHelix.get(oppositeNode.id);
                const binder = oppositeHelixId !== undefined && firstHelixId === oppositeHelixId;
                return {
                    side: dir,
                    result: binder ? 'binder' : 'overhang',
                    firstHelixId,
                    oppositeHelixId
                };
            };
            const res5 = analyzeSide('n5');
            const res3 = analyzeSide('n3');
            return { res5, res3 };
        };
        const isBinder = (res) => res?.result === 'binder';
        const isOverhang = (res) => res?.result === 'overhang';
        const hasHelix = (res) => res?.firstHelixId !== undefined;
        ssdna.forEach(segment => {
            if (!segment.length)
                return;
            const { res5, res3 } = classifySegment(segment);
            const res5HasHelix = hasHelix(res5);
            const res3HasHelix = hasHelix(res3);
            if (!res5HasHelix && !res3HasHelix) {
                disconnected.push(segment);
                return;
            }
            if (isOverhang(res5) && hasHelix(res5) && isOverhang(res3) && !hasHelix(res3)) {
                if (res5.firstHelixId !== undefined)
                    addSegmentToHelix(res5.firstHelixId, segment);
                return;
            }
            if (isOverhang(res3) && hasHelix(res3) && isOverhang(res5) && !hasHelix(res5)) {
                if (res3.firstHelixId !== undefined)
                    addSegmentToHelix(res3.firstHelixId, segment);
                return;
            }
            if (isOverhang(res5) && res5HasHelix && isOverhang(res3) && res3HasHelix) {
                if (res5.firstHelixId !== undefined && res3.firstHelixId !== undefined) {
                    const half = Math.floor(segment.length / 2);
                    const left = segment.slice(0, half);
                    const right = segment.slice(half);
                    addSegmentToHelix(res5.firstHelixId, left);
                    addSegmentToHelix(res3.firstHelixId, right);
                    return;
                }
            }
            if (isOverhang(res5) && hasHelix(res5) && isBinder(res3)) {
                if (res5.firstHelixId !== undefined)
                    addSegmentToHelix(res5.firstHelixId, segment);
                return;
            }
            if (isOverhang(res3) && hasHelix(res3) && isBinder(res5)) {
                if (res3.firstHelixId !== undefined)
                    addSegmentToHelix(res3.firstHelixId, segment);
                return;
            }
            if (isBinder(res5) && !res5HasHelix && isOverhang(res3) && res3HasHelix) {
                if (res3.firstHelixId !== undefined)
                    addSegmentToHelix(res3.firstHelixId, segment);
                return;
            }
            if (isBinder(res3) && !res3HasHelix && isOverhang(res5) && res5HasHelix) {
                if (res5.firstHelixId !== undefined)
                    addSegmentToHelix(res5.firstHelixId, segment);
                return;
            }
            if (isBinder(res5) && isOverhang(res3) && !hasHelix(res3)) {
                binders.push(segment);
                return;
            }
            if (isBinder(res3) && isOverhang(res5) && !hasHelix(res5)) {
                binders.push(segment);
                return;
            }
            if (isBinder(res5) && isBinder(res3)) {
                binder2.push(segment);
                return;
            }
            unhandled.push(segment);
        });
        const resolveBinderHelix = (segment) => {
            const { res5, res3 } = classifySegment(segment);
            const helixIds = new Set();
            const collect = (res) => {
                if (!isBinder(res))
                    return;
                if (res.firstHelixId !== undefined)
                    helixIds.add(res.firstHelixId);
                if (res.oppositeHelixId !== undefined)
                    helixIds.add(res.oppositeHelixId);
            };
            if (res5)
                collect(res5);
            if (res3)
                collect(res3);
            if (helixIds.size === 1)
                return Array.from(helixIds.values())[0];
            return undefined;
        };
        const binderGroups = new Map();
        const addBinderToGroup = (helixId, segment) => {
            const list = binderGroups.get(helixId) || [];
            list.push(segment);
            binderGroups.set(helixId, list);
        };
        binders.forEach(segment => {
            const helixId = resolveBinderHelix(segment);
            if (helixId === undefined)
                return;
            addBinderToGroup(helixId, segment);
        });
        binder2.forEach(segment => {
            const helixId = resolveBinderHelix(segment);
            if (helixId === undefined)
                return;
            addBinderToGroup(helixId, segment);
        });
        binderGroups.forEach(segments => {
            if (!segments.length)
                return;
            const seen = new Set();
            const newHelix = [];
            segments.forEach(segment => {
                segment.forEach(nt => {
                    if (seen.has(nt.id))
                        return;
                    seen.add(nt.id);
                    newHelix.push(nt);
                });
            });
            if (newHelix.length) {
                const newIdx = helices.length;
                helices.push(newHelix);
                newHelix.forEach(nt => idToHelix.set(nt.id, newIdx));
            }
        });
        if (combinedScraps.length && helices.length) {
            const walkToHelix = (start, dir, owner) => {
                if (!start) {
                    console.warn('[walkToHelix] Side', dir, 'is null for nucleotide', owner.id, '; using opposite side if available.');
                    return null;
                }
                let curr = start;
                while (curr) {
                    const hIdx = idToHelix.get(curr.id);
                    if (hIdx !== undefined)
                        return { helixIdx: hIdx, anchor: curr };
                    curr = curr[dir];
                }
                console.warn('[walkToHelix] Side', dir, 'for nucleotide', owner.id, 'started at', start.id, 'but did not reach any existing helix.');
                return null;
            };
            const addScrapSegmentToHelix = (targetIdx, segment) => {
                const helix = helices[targetIdx];
                if (!helix)
                    return false;
                const seen = new Set(helix.map(nt => nt.id));
                segment.forEach(nt => {
                    if (seen.has(nt.id))
                        return;
                    helix.push(nt);
                    seen.add(nt.id);
                    idToHelix.set(nt.id, targetIdx);
                });
                return true;
            };
            const pickSegmentTarget = (segment) => {
                let best = null;
                segment.forEach(nt => {
                    const via5 = walkToHelix((nt.n5 ?? null), 'n5', nt);
                    const via3 = walkToHelix((nt.n3 ?? null), 'n3', nt);
                    if (!via5 && !via3)
                        return;
                    const pos = nt.getPos();
                    const consider = (hit) => {
                        const distance = pos.distanceTo(hit.anchor.getPos());
                        if (!best || distance < best.distance) {
                            best = { hit, distance };
                        }
                    };
                    if (via5)
                        consider(via5);
                    if (via3)
                        consider(via3);
                });
                return best ? best.hit : null;
            };
            const remaining = [];
            combinedScraps.forEach(segment => {
                if (!segment.length)
                    return;
                const target = pickSegmentTarget(segment);
                if (!target) {
                    remaining.push(segment.slice());
                    return;
                }
                if (!addScrapSegmentToHelix(target.helixIdx, segment)) {
                    remaining.push(segment.slice());
                    return;
                }
            });
            lastScraps.push(...remaining);
        }
        else {
            combinedScraps.forEach(segment => {
                if (segment.length)
                    lastScraps.push(segment.slice());
            });
        }
        return { helices, lastScraps, binders, binder2, disconnected, unhandled };
    }
    helix_1.ssDNA = ssDNA;
    function generateHelix2(partials, ssdna, ssScaffold, stubs) {
        // Setup and direct partial unions
        const state = directConnections(partials, stubs);
        // Resolve stubs and pull out the helix arrays
        const { coreHelices, initialScraps } = makeHelices(partials, stubs, state);
        // Attempt to attach scaffold segments to the core helices
        const { updatedHelices, scaffoldScraps } = ssScaffolds(coreHelices, ssScaffold);
        // Combine our scraps for the final cleanup phase
        const combinedScraps = [...initialScraps, ...scaffoldScraps];
        // Process ssdna, build binder helices, and attach scraps spatially
        const finalResult = ssDNA(updatedHelices, ssdna, combinedScraps);
        return finalResult;
    }
    helix_1.generateHelix2 = generateHelix2;
    // export function generateTotal(inputMap: Map<number, Nucleotide>, tolerance = 2) {
    // 	let {partials, unpaired} = findHelixPartials(inputMap, tolerance);
    // 	let {ssdna, stubs, longssScaffold} = ssdnaPartials(unpaired);
    // 	let ssScaffold = longssScaffoldfunc(longssScaffold);
    // }
    function findHelices(elements, tolerance = 2) {
        findBasepairsOptim2();
        dropIntraStrandPairs();
        // ok now we can do the rest of the stuff.
        let { partials, unpaired } = findHelixPartials2(elements, tolerance);
        let { ssdna, stubs, longssScaffold } = ssdnaPartials(unpaired);
        let ssScaffold = longssScaffoldfunc(longssScaffold, stubs);
        let { helices, lastScraps, binders, binder2, disconnected, unhandled } = generateHelix2(partials, ssdna, ssScaffold, stubs);
        const missing = [];
        console.log("Helices size:", helices.flat().length);
        console.log("Total elements:", elements.size);
        if (helices.flat().length !== elements.size) {
            console.log("Oops has occurred!");
            const helixIds = new Set();
            helices.forEach(list => list.forEach(nt => helixIds.add(nt.id)));
            const missingIds = [];
            elements.forEach((nt) => {
                if (!helixIds.has(nt.id)) {
                    missing.push(nt);
                    missingIds.push(nt.id);
                }
            });
            const listHits = new Map();
            const addHits = (label, list) => {
                const add = (nt) => {
                    if (!missingSet.has(nt.id))
                        return;
                    const set = listHits.get(nt.id) || new Set();
                    set.add(label);
                    listHits.set(nt.id, set);
                };
                if (Array.isArray(list[0])) {
                    list.forEach(segment => segment.forEach(add));
                }
                else {
                    list.forEach(add);
                }
            };
            const missingSet = new Set(missingIds);
            addHits('partials', partials);
            addHits('ssdna', ssdna);
            addHits('stubs', stubs);
            addHits('ssScaffold', ssScaffold);
            if (binders)
                addHits('binders', binders);
            if (binder2)
                addHits('binder2', binder2);
            if (disconnected)
                addHits('disconnected', disconnected);
            if (unhandled)
                addHits('unhandled', unhandled);
            addHits('lastScraps', lastScraps);
            const report = missingIds.map(id => ({
                id,
                lists: Array.from(listHits.get(id) || [])
            }));
            console.log('Missing nucleotide IDs:', missingIds);
            console.log('Missing membership report:', report);
        }
        return { helices, missing };
    }
    helix_1.findHelices = findHelices;
})(helix || (helix = {}));
