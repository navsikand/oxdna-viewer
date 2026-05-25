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

namespace helix {
	// helper function cuz didnt want to type this every time
	export function checkAngle(n1: Nucleotide | null = null, n2: Nucleotide | null = null) {
		if (!n1 || !n2) return 0;
		return Math.acos(n1.getA3().dot(n2.getA3())) * (180 / Math.PI);
	}

	// Returns the longest strand in the system as scaffold...
	export function getScaffoldStrand() {
		let maxLen = 0;
		let scaffold: Strand | null = null;
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

	// Removes intra-strand pairings across the whole structure
	// ALWAYS run this function after findBasepairs3(). Very important.
	export function dropIntraStrandPairs() {
		elements.forEach((nt: any) => {
			if (!(nt instanceof Nucleotide)) return;
			if (!nt.pair) return;
			if (nt.pair.strand === nt.strand) {
				const mate = nt.pair as Nucleotide;
				nt.pair = null;
				if (mate.pair === nt) {
					mate.pair = null;
				}
			}
		});
	}

	// Finds helix parts using destructive consumption of a working copy of elements (called elmts).
	// tolerance 2 is good enough for most cases. Higher tolerances seem to have no negative consequences, however.
	// go to terminatingConditions for what tolerance is.
	export function findHelixPartials2(inputMap: Map<number, Nucleotide>, tolerance = 2) {
		const elmts = new Map<number, Nucleotide>(inputMap); // copy of the elements map
		const elmts2 = new Map<number, Nucleotide>(inputMap); // backup copy for duplication, used later
		const unpaired = new Map<number, Nucleotide>(); // unpaired / skipped nts

		let partials: Nucleotide[][] = [];
		const record = (list: Nucleotide[], set: Set<number>, nt: Nucleotide | null = null) => {
			if (nt && !set.has(nt.id)) {
				set.add(nt.id);
				list.push(nt);
			}
		};

		const nextStart = () => elmts.values().next().value;

		while (true) {
			const start = nextStart();
			if (!start) break;

			// Collect unpaired/binder nts for downstream ssDNA processing instead of discarding silently.
			// Additionally, only walk if the pair is also present in the current pool (elmts).
			const pairInPool = start.pair ? elmts.get(start.pair.id) as Nucleotide | undefined : undefined;
			if (!start.pair || !pairInPool) {
				unpaired.set(start.id, start as Nucleotide);
				elmts.delete(start.id);
				continue;
			}

			// initialize the walker.
			let curr: Nucleotide | null = start;
			let currPair: Nucleotide | null = pairInPool;
			const strandA = curr.strand; // required to ensure we don't cross strands. This is how we know partials is actually a partial helix.
			const strandB = currPair.strand;

			// this is the partial being built.
			const partial: Nucleotide[] = [];
			const seen = new Set<number>();

			type DirectionStep = { nextA: Nucleotide; nextB: Nucleotide } | null;

			const terminatingConditions = (nucA: Nucleotide, nucB: Nucleotide, dir: 1 | -1): DirectionStep => {
				const nucAc = elmts.get(nucA.id + dir) as Nucleotide | undefined;
				const nucBc = elmts.get(nucB.id - dir) as Nucleotide | undefined;
				if (!nucAc || !nucBc) return null;
				if (nucAc.strand !== strandA || nucBc.strand !== strandB) return null;

				// Tolerance window: OR logic. Continue if ANY offset in [1, tolerance] has forward paired to backward.
				// (allows rescue by walking farther along topological neighbors on both strands).
				let forwardCursor: Nucleotide | null = nucA;
				let backwardCursor: Nucleotide | null = nucB;
				for (let offset = 1; offset <= tolerance; offset++) {
					const forward = elmts.get(nucA.id + dir * offset) as Nucleotide | undefined;
					const backward = elmts.get(nucB.id - dir * offset) as Nucleotide | undefined;
					if (!forward || !backward) continue; // check if either of them even exist.
					if (forward.strand !== strandA || backward.strand !== strandB) continue;
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

				if (!step) break;

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
		const seenfordups = new Map<number, Nucleotide>();
		const duplicates = new Set<number>();
		partials.forEach(helix => {
			helix.forEach(nt => {
				if (seenfordups.has(nt.id)) {
					duplicates.add(nt.id);
				} else {
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
			const pairIds = new Set<number>();
			duplicates.forEach(id => {
				const a = elmts2.get(id) as Nucleotide | undefined;
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

	// Groups unpaired/binder nucleotides (unpaired) into ssDNA partials by strand.
	// Only contiguous runs (>2) along a strand are kept; shorter runs go to stubs.
	export function ssdnaPartials(unpaired: Nucleotide[]) {
		const unpairStrand = new Map<Strand, Nucleotide[]>();
		const ssdna: Nucleotide[][] = [];
		const stubs: Nucleotide[] = [];
		const longssScaffold: Nucleotide[] = [];
		const scaffold = getScaffoldStrand();

		unpaired.forEach(nt => {
			const arr = unpairStrand.get(nt.strand) || [];
			arr.push(nt);
			unpairStrand.set(nt.strand, arr);
		});

		// For each strand, sort it, find it's 5' ends and walk down n3 to build runs.
		unpairStrand.forEach((list, strand) => {
			const inSet = new Set(list.map(n => n.id));
			const visited = new Set<number>();
			const isScaffoldStrand = scaffold && strand === scaffold;

			list.sort((a, b) => a.id - b.id);

			for (const nt of list) {
				if (visited.has(nt.id)) continue;

				const isStart = !nt.n5 || !inSet.has((nt.n5 as Nucleotide).id);

				if (isStart) {
					const run: Nucleotide[] = [];
					let curr: Nucleotide | null = nt;

					while (curr && inSet.has(curr.id)) {
						run.push(curr);
						visited.add(curr.id);
						curr = curr.n3 as Nucleotide | null;
					}

					if (run.length > 2) {
						if (!isScaffoldStrand) {
							ssdna.push(run);
						} else {
							longssScaffold.push(...run);
						}
					} else {
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

	// helper function for adding the average a3 vector in canvas. Really should not be here.
	export function averageA3a(list: Nucleotide[]) {
		if (!list.length) return new THREE.Vector3(0, 0, 0);

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
		if (origin && typeof THREE !== 'undefined' && typeof scene !== 'undefined' && (scene as any)?.add) {
			const helper = new THREE.ArrowHelper(avg.clone(), origin, 5);
			(scene as any).add(helper);
		}

		return avg;
	};

	// helper to consolidate the nucleotides into contiguous segments, and enforce equal halves for scaffold segments.
	export function longssScaffoldfunc(longssScaffold: Nucleotide[], stubs: Nucleotide[] = []) {
		const ssScaffold: Nucleotide[][] = [];
		if (!longssScaffold.length) return ssScaffold;

		// Work on a sorted copy so numeric contiguity is easy to detect.
		const sorted = [...longssScaffold].sort((a, b) => a.id - b.id);
		let runAway: Nucleotide[] = [];

		const flushRun = () => {
			if (!runAway.length) return;
			if (runAway.length < 3) {
				runAway.forEach(nt => stubs.push(nt));
				runAway = [];
				return;
			}
			// Enforce equal halves; trim one nucleotide if odd-length to satisfy the requirement.
			const evenLen = runAway.length - (runAway.length % 2);
			if (evenLen !== runAway.length) {
				const dropped = runAway[evenLen];
				if (dropped) stubs.push(dropped);
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

	// let partialStrandMap = new Map<number, Map<number, Nucleotide[]>>();

	// Perfected!
	// this one uses average a3 vectors of CONNECTED strands, as opposed to average a3 vectors of the entire partial (which cancels out, due to topology).
	export function generateHelix(partials: Nucleotide[][], ssdna: Nucleotide[][], ssScaffold: Nucleotide[][], stubs: Nucleotide[]) {
		// Currently uses partials, ssScaffold and stubs to build perfect (almost) helices.
		// Hence, helices.flat().length and ssdna.flat().length should be the full size of the structure. For any missing piece, check lastScraps[].
		const helices: Nucleotide[][] = [];
		// guys for context lastScraps[] basically are the dumb nucleotides that couldnt be placed into helices due to fraying and angle conflicts.
		// Stored as segments so grouped leftovers (e.g. deferred ssScaffold segments) stay together.
		const lastScraps: Nucleotide[][] = [];
		if (!partials.length) return { helices, lastScraps }; // surely no helices if no partials.
		const dot = 0.707;

		// quick lookup for id to partial index and stubs index.
		const idToPartial = new Map<number, number>();
		partials.forEach((list, idx) => {
			list.forEach(nt => idToPartial.set(nt.id, idx));
		});
		const idTostubs = new Map<number, number>();
		stubs.forEach((nt, idx) => idTostubs.set(nt.id, idx));
		console.log('ID to Partial Map:', idToPartial); // lets check out what the map looks like
		console.log('ID to stubs Map:', idTostubs);

		const averageA3 = (list: Nucleotide[]) => {
			if (!list.length) return null;
			const acc = new THREE.Vector3(0, 0, 0);
			list.forEach(nt => {
				acc.add(nt.getA3().clone().normalize());
			});
			const len = acc.length();
			if (len < 1e-6) return null;
			return acc.divideScalar(len);
		};

		// within a partial, find the nts that belong to a specific strand within a specific partial. 
		// these will the ones used for finding the average a3 vector, which will later be used for connecting partials.
		const partialStrandMap = new Map<number, Map<number, Nucleotide[]>>();
		const getPartialStrandNts = (partialIdx: number, strand: Strand) => {
			let byStrand = partialStrandMap.get(partialIdx);
			if (!byStrand) {
				byStrand = new Map<number, Nucleotide[]>();
				partialStrandMap.set(partialIdx, byStrand);
			}
			let list = byStrand.get(strand.id);
			if (!list) {
				list = partials[partialIdx].filter(nt => nt.strand === strand);
				byStrand.set(strand.id, list);
			}
			return list;
		};

		// similar to above, but caches average a3 vectors for each partial-strand combo instead of just nucleotide lists.
		const partialStrandA3 = new Map<number, Map<number, THREE.Vector3 | null>>();
		const getPartialStrandA3 = (partialIdx: number, strand: Strand) => {
			let byStrand = partialStrandA3.get(partialIdx);
			if (!byStrand) {
				byStrand = new Map<number, THREE.Vector3 | null>();
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

		// stubs are just single nts, so caching their a3 vectors is simpler.
		const stubsA3 = new Map<number, THREE.Vector3>();
		const getstubsA3 = (idx: number) => {
			let vec = stubsA3.get(idx);
			if (!vec) {
				vec = stubs[idx].getA3().clone().normalize();
				stubsA3.set(idx, vec);
			}
			return vec;
		};

		const totalNodes = partials.length + stubs.length;
		const parent = Array.from({ length: totalNodes }, (_, i) => i);
		const find = (x: number): number => (parent[x] === x ? x : parent[x] = find(parent[x]));
		const unite = (a: number, b: number) => {
			const pa = find(a);
			const pb = find(b);
			if (pa !== pb) parent[pb] = pa;
		};

		type NodeRef = { node: number; kind: 'partial' | 'stubs'; index: number };
		// convert a nucleotide to its corresponding node reference (partial or stubs)...
		const getNodeRef = (nt: Nucleotide): NodeRef | null => {
			const partialId = idToPartial.get(nt.id);
			if (partialId !== undefined) return { node: partialId, kind: 'partial', index: partialId };
			const stubsId = idTostubs.get(nt.id);
			if (stubsId !== undefined) return { node: partials.length + stubsId, kind: 'stubs', index: stubsId };
			return null;
		};

		// Track direct adjacency between partials and collect stubs links for a second pass.
		const partialAdj = new Map<number, Set<number>>();
		const addPartialAdj = (a: number, b: number) => {
			if (a === b) return;
			const setA = partialAdj.get(a) || new Set<number>();
			setA.add(b);
			partialAdj.set(a, setA);
			const setB = partialAdj.get(b) || new Set<number>();
			setB.add(a);
			partialAdj.set(b, setB);
		};
		type stubsLink = {
			partialIdx: number;
			score: number;
			strand: Strand;
		};
		const stubsLinks = new Map<number, Map<number, stubsLink>>();
		const addstubsLink = (stubNode: number, partialIdx: number, score: number, strand: Strand) => {
			const links = stubsLinks.get(stubNode) || new Map<number, stubsLink>();
			const prev = links.get(partialIdx);
			if (!prev || score > prev.score) {
				links.set(partialIdx, { partialIdx, score, strand });
			}
			stubsLinks.set(stubNode, links);
		};

		const attachDot = (a: NodeRef, b: NodeRef, strand: Strand) => {
			let vecA: THREE.Vector3 | null = null;
			let vecB: THREE.Vector3 | null = null;

			if (a.kind === 'partial') vecA = getPartialStrandA3(a.index, strand);
			else vecA = getstubsA3(a.index);

			if (b.kind === 'partial') vecB = getPartialStrandA3(b.index, strand);
			else vecB = getstubsA3(b.index);

			if (!vecA || !vecB) return -1;
			return vecA.dot(vecB);
		};

		// Only connect nodes that are adjacent on the same strand and whose A3 vectors align.
		systems.forEach(system => {
			system.strands.forEach(strand => {
				let prev: Nucleotide | null = null;
				strand.forEach(elem => {
					const nt = elem as Nucleotide;
					if (prev) {
						const nodeA = getNodeRef(prev);
						const nodeB = getNodeRef(nt);
						if (nodeA && nodeB && nodeA.node !== nodeB.node) {
							// find adjacency between partials. Reason being, this will then be used for stubs connection checks later.
							// without this, funny unintended behavior CAN happen.
							// Example scenario: comment this part out and try running this code on Dumbbell Structure (nanobase 51). Helix 34/35 will be merged, unfortunately.
							if (nodeA.kind === 'partial' && nodeB.kind === 'partial') {
								addPartialAdj(nodeA.index, nodeB.index);
							}
							const d = attachDot(nodeA, nodeB, strand);
							if (d > dot) {
								if (nodeA.kind === 'partial' && nodeB.kind === 'partial') {
									// unionize the partials without question
									unite(nodeA.node, nodeB.node);
								} else if (nodeA.kind === 'stubs' || nodeB.kind === 'stubs') {
									// if either of the nodes are stubs, then checks are necessary.
									// add this to a "link". They will be processed in the 2nd pass. Slows down but much more accurate.
									const stubNode = nodeA.kind === 'stubs' ? nodeA : nodeB;
									const otherNode = nodeA.kind === 'stubs' ? nodeB : nodeA;
									// does not do anything if both nodes are stubs.
									if (otherNode.kind === 'partial') {
										addstubsLink(stubNode.node, otherNode.index, d, strand);
									}
								}
							}
						}
					}
					prev = nt;
				});
			});
		});

		// Second pass: attach stubs after partial unions are finalized.
		const partialParent = Array.from({ length: partials.length }, (_, i) => find(i));
		const findPartial = (x: number): number => (partialParent[x] === x ? x : partialParent[x] = findPartial(partialParent[x]));
		const partialMembers = new Map<number, Set<number>>();
		for (let i = 0; i < partials.length; i++) {
			const root = findPartial(i);
			const set = partialMembers.get(root) || new Set<number>();
			set.add(i);
			partialMembers.set(root, set);
		}
		// merging partials connected via a stubs.
		const mergePartialGroups = (a: number, b: number) => {
			let ra = findPartial(a);
			let rb = findPartial(b);
			if (ra === rb) return ra; // they are already united
			const setA = partialMembers.get(ra)!;
			const setB = partialMembers.get(rb)!;
			if (setA.size < setB.size) {
				const tmp = ra;
				ra = rb;
				rb = tmp;
			}
			const keep = partialMembers.get(ra)!;
			const drop = partialMembers.get(rb)!;
			drop.forEach(idx => keep.add(idx));
			partialMembers.set(ra, keep);
			partialMembers.delete(rb);
			partialParent[rb] = ra;
			return ra;
		};
		// if the 2 "helices" (partial groups) are to be merged, then they can NOT have connections amongst each other. 
		// if they do, then the one of the helix "turned around" to connect somewhere, and therefore should not be merged because it is now a different helix.
		const hasDirectConnection = (rootA: number, rootB: number) => {
			if (rootA === rootB) return true;
			const setA = partialMembers.get(rootA);
			const setB = partialMembers.get(rootB);
			if (!setA || !setB) return false;
			const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
			for (const idx of small) {
				const neighbors = partialAdj.get(idx);
				if (!neighbors) continue;
				for (const n of neighbors) {
					if (large.has(n)) return true;
				}
			}
			return false;
		};

		const partialsCanBridge = (a: stubsLink, b: stubsLink) => {
			const vecA = getPartialStrandA3(a.partialIdx, a.strand);
			const vecB = getPartialStrandA3(b.partialIdx, b.strand);
			if (!vecA || !vecB) return false;
			return vecA.dot(vecB) > dot;
		};

		stubsLinks.forEach((linksByPartial, stubNode) => {
			const candidates = Array.from(linksByPartial.values()).sort((a, b) => b.score - a.score);
			if (!candidates.length) return;

			// stubs belongs to the best-aligned partial by default.
			const primaryLink = candidates[0];
			let primaryRoot = findPartial(primaryLink.partialIdx);
			unite(stubNode, primaryRoot);

			// Bridge to additional partial groups only when the partials also align.
			for (let i = 1; i < candidates.length; i++) {
				const candidate = candidates[i];
				if (!partialsCanBridge(primaryLink, candidate)) continue;

				const currPrimaryRoot = findPartial(primaryRoot);
				const otherRoot = findPartial(candidate.partialIdx);
				if (currPrimaryRoot === otherRoot) continue;
				if (hasDirectConnection(currPrimaryRoot, otherRoot)) {
					continue; // block stubs merge across already-connected helices
				}

				unite(stubNode, otherRoot);
				primaryRoot = mergePartialGroups(currPrimaryRoot, otherRoot);
			}
		});

		const groups = new Map<number, Nucleotide[]>();
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
				lastScraps.push([nt]);
				return;
			}
			const arr = groups.get(root) || [];
			arr.push(nt);
			groups.set(root, arr);
		});
		console.log('Merged Groups:', groups);

		// if everything goes right, you should NEVER have duplicates, helices or nucleotides. But this is good for safety.
		groups.forEach(group => {
			const seen = new Set<number>();
			const unique: Nucleotide[] = [];
			group.forEach(nt => {
				if (seen.has(nt.id)) {
					console.log('Duplicate nucleotide found in helix grouping:', nt);
					return;
				}
				seen.add(nt.id);
				unique.push(nt);
			});
			if (unique.length) helices.push(unique);
		});

		// After helices are built, attach ssScaffold segments to the helix they connect to.
		if (ssScaffold && ssScaffold.length) {
			const idToHelix = new Map<number, number>();
			helices.forEach((list, idx) => {
				list.forEach(nt => idToHelix.set(nt.id, idx));
			});

			const ssScaffoldIds = new Set<number>();
			ssScaffold.forEach(segment => segment.forEach(nt => ssScaffoldIds.add(nt.id)));

			// fairly obvious. Adds the segment of nucleotides (from ssScaffold) to the target helix index.
			const addToHelix = (targetIdx: number, segment: Nucleotide[]) => {
				const helix = helices[targetIdx];
				const seen = new Set<number>(helix.map(nt => nt.id));
				segment.forEach(nt => {
					if (seen.has(nt.id)) return;
					helix.push(nt);
					seen.add(nt.id);
					idToHelix.set(nt.id, targetIdx);
				});
			};

			const findSsScaffoldTargets = (segment: Nucleotide[]) => {
				const segmentIds = new Set<number>(segment.map(nt => nt.id));
				const helixIndices = new Set<number>();

				segment.forEach(nt => {
					const n5 = nt.n5 as Nucleotide | null;
					const n3 = nt.n3 as Nucleotide | null;

					if (n5 && !segmentIds.has(n5.id) && !ssScaffoldIds.has(n5.id)) {
						const hIdx = idToHelix.get(n5.id);
						if (hIdx !== undefined) helixIndices.add(hIdx);
					}

					if (n3 && !segmentIds.has(n3.id) && !ssScaffoldIds.has(n3.id)) {
						const hIdx = idToHelix.get(n3.id);
						if (hIdx !== undefined) helixIndices.add(hIdx);
					}
				});

				return Array.from(helixIndices.values());
			};

			let pending = ssScaffold.filter(segment => segment.length > 0);
			const maxRounds = Math.max(1, pending.length * 2);
			let round = 0;

			while (pending.length) {
				round += 1;
				let attachedThisRound = 0;
				const nextPending: Nucleotide[][] = [];

				pending.forEach(segment => {
					const targets = findSsScaffoldTargets(segment);
					if (!targets.length) {
						nextPending.push(segment);
						return;
					}

					// IN CASE that the ssScaffold segment connects to multiple helices, warn the user.
					if (targets.length > 1) {
						console.warn('ssScaffold segment connects to multiple helices; attaching to first.', {
							helices: targets,
							segmentLength: segment.length,
							round
						});
					}
					const primary = targets[0];
					addToHelix(primary, segment);
					attachedThisRound += 1;
				});

				if (!nextPending.length) break;

				if (!attachedThisRound) {
					console.warn('[ssScaffold] No attach progress in retry round; moving unresolved segments to lastScraps as grouped segments.', {
						round,
						unresolvedSegments: nextPending.length
					});
					nextPending.forEach(segment => lastScraps.push(segment.slice()));
					break;
				}

				if (round >= maxRounds) {
					console.warn('[ssScaffold] Retry limit reached; moving unresolved segments to lastScraps as grouped segments.', {
						round,
						unresolvedSegments: nextPending.length,
						maxRounds
					});
					nextPending.forEach(segment => lastScraps.push(segment.slice()));
					break;
				}

				pending = nextPending;
			}
		}

		const partialToHelix = new Map<number, number>();
		helices.forEach((list, hIdx) => {
			list.forEach(nt => {
				const pIdx = idToPartial.get(nt.id);
				if (pIdx !== undefined && !partialToHelix.has(pIdx)) {
					partialToHelix.set(pIdx, hIdx);
				}
			});
		});

		const addSegmentToHelix = (targetIdx: number, segment: Nucleotide[]) => {
			const helix = helices[targetIdx];
			if (!helix) return;
			const seen = new Set<number>(helix.map(nt => nt.id));
			segment.forEach(nt => {
				if (seen.has(nt.id)) return;
				helix.push(nt);
				seen.add(nt.id);
			});
		};

		// const oppositeDir = (dir: 'n5' | 'n3') => (dir === 'n5' ? 'n3' : 'n5');

		const findEndOnSide = (segment: Nucleotide[], segmentSet: Set<number>, dir: 'n5' | 'n3') => {
			for (const nt of segment) {
				const neighbor = nt[dir] as Nucleotide | null;
				if (!neighbor || !segmentSet.has(neighbor.id)) return nt;
			}
			return null;
		};

		const walkForPartial = (
			start: Nucleotide | null,
			dir: 'n5' | 'n3',
			segmentSet: Set<number>
		) => {
			let curr = start;
			while (curr) {
				if (segmentSet.has(curr.id)) return undefined;
				const pIdx = idToPartial.get(curr.id);
				if (pIdx !== undefined) return { pIdx, node: curr };
				curr = curr[dir] as Nucleotide | null;
			}
			return undefined;
		};

		const stepWithinSamePartial = (
			start: Nucleotide,
			dir: 'n5' | 'n3',
			steps: number,
			pIdx: number
		) => {
			let curr: Nucleotide | null = start;
			let last: Nucleotide = start;
			for (let i = 0; i < steps; i++) {
				curr = curr?.[dir] as Nucleotide | null;
				if (!curr) return last;
				const idx = idToPartial.get(curr.id);
				if (idx !== pIdx) return last;
				last = curr;
			}
			return last;
		};

		const stepN = (start: Nucleotide, dir: 'n5' | 'n3', steps: number) => {
			let curr: Nucleotide | null = start;
			for (let i = 0; i < steps; i++) {
				curr = curr?.[dir] as Nucleotide | null;
				if (!curr) return undefined;
			}
			return curr;
		};

		type SideResult = {
			side: 'n5' | 'n3';
			result: 'binder' | 'overhang';
			firstPartialId?: number;
			oppositePartialId?: number;
			firstHelixId?: number;
			oppositeHelixId?: number;
		};

		const classifySegment = (segment: Nucleotide[]) => {
			const segmentSet = new Set<number>(segment.map(nt => nt.id));

			const analyzeSide = (dir: 'n5' | 'n3'): SideResult => {
				const end = findEndOnSide(segment, segmentSet, dir);
				if (!end) return { side: dir, result: 'overhang' };

				const anchor = end[dir] as Nucleotide | null;
				if (!anchor) return { side: dir, result: 'overhang' };

				const first = walkForPartial(anchor, dir, segmentSet);
				if (!first) return { side: dir, result: 'overhang' };

				const firstHelixId = partialToHelix.get(first.pIdx);
				// note: using more than 1 step might look fine, but it can cause issues in edge cases.
				// specifically, structure 51 from nanobase (Dumbbell structure) has issues with this.
				// Sticking to 1 step has NOT shown ANY problems so far.
				const lastInPartial = stepWithinSamePartial(first.node, dir, 1, first.pIdx);
				const pair = lastInPartial.pair as Nucleotide | null;
				if (!pair) {
					return {
						side: dir,
						result: 'overhang',
						firstPartialId: first.pIdx,
						firstHelixId
					};
				}

				const oppositeNode = stepN(pair, dir, 3);
				if (!oppositeNode) {
					return {
						side: dir,
						result: 'overhang',
						firstPartialId: first.pIdx,
						firstHelixId
					};
				}

				const oppositePartialId = idToPartial.get(oppositeNode.id);
				const oppositeHelixId = oppositePartialId !== undefined ? partialToHelix.get(oppositePartialId) : undefined;

				const binder =
					oppositePartialId !== undefined &&
					firstHelixId !== undefined &&
					oppositeHelixId !== undefined &&
					firstHelixId === oppositeHelixId;

				return {
					side: dir,
					result: binder ? 'binder' : 'overhang',
					firstPartialId: first.pIdx,
					oppositePartialId,
					firstHelixId,
					oppositeHelixId
				};
			};

			const res5 = analyzeSide('n5');
			const res3 = analyzeSide('n3');
			return { res5, res3 };
		};

		const binders: Nucleotide[][] = [];
		const binder2: Nucleotide[][] = [];
		const disconnected: Nucleotide[][] = [];
		const unhandled: Nucleotide[][] = [];

		const isBinder = (res: SideResult | undefined) => res?.result === 'binder';
		const isOverhang = (res: SideResult | undefined) => res?.result === 'overhang';
		const hasPartial = (res: SideResult | undefined) => res?.firstPartialId !== undefined;

		// The lot of if statements are required (unless you can figure out a better way).
		// You can read through these, but they mostly comprise of cases where the segment is connected to helices on both ends, and has different types of such connections.
		// example, if overhang on one end and binder on the other, then it will connect to the helix on overhang side.
		ssdna.forEach(segment => {
			if (!segment.length) return;
			const { res5, res3 } = classifySegment(segment);
			const res5HasPartial = hasPartial(res5);
			const res3HasPartial = hasPartial(res3);

			if (!res5HasPartial && !res3HasPartial) {
				disconnected.push(segment);
				return;
			}

			if (isOverhang(res5) && hasPartial(res5) && isOverhang(res3) && !hasPartial(res3)) {
				if (res5.firstHelixId !== undefined) addSegmentToHelix(res5.firstHelixId, segment);
				return;
			}
			if (isOverhang(res3) && hasPartial(res3) && isOverhang(res5) && !hasPartial(res5)) {
				if (res3.firstHelixId !== undefined) addSegmentToHelix(res3.firstHelixId, segment);
				return;
			}

			if (isOverhang(res5) && res5HasPartial && isOverhang(res3) && res3HasPartial) {
				if (res5.firstHelixId !== undefined && res3.firstHelixId !== undefined) {
					const half = Math.floor(segment.length / 2);
					const left = segment.slice(0, half);
					const right = segment.slice(half);
					addSegmentToHelix(res5.firstHelixId, left);
					addSegmentToHelix(res3.firstHelixId, right);
					return;
				}
			}

			if (isOverhang(res5) && hasPartial(res5) && isBinder(res3)) {
				if (res5.firstHelixId !== undefined) addSegmentToHelix(res5.firstHelixId, segment);
				return;
			}
			if (isOverhang(res3) && hasPartial(res3) && isBinder(res5)) {
				if (res3.firstHelixId !== undefined) addSegmentToHelix(res3.firstHelixId, segment);
				return;
			}

			if (isBinder(res5) && !res5HasPartial && isOverhang(res3) && res3HasPartial) {
				if (res3.firstHelixId !== undefined) addSegmentToHelix(res3.firstHelixId, segment);
				return;
			}
			if (isBinder(res3) && !res3HasPartial && isOverhang(res5) && res5HasPartial) {
				if (res5.firstHelixId !== undefined) addSegmentToHelix(res5.firstHelixId, segment);
				return;
			}

			if (isBinder(res5) && isOverhang(res3) && !hasPartial(res3)) {
				binders.push(segment);
				return;
			}
			if (isBinder(res3) && isOverhang(res5) && !hasPartial(res5)) {
				binders.push(segment);
				return;
			}

			if (isBinder(res5) && isBinder(res3)) {
				binder2.push(segment);
				return;
			}

			unhandled.push(segment);
		});

		// For any binder/binder2 segments, group them by which helix they connect to.
		// If multiple binder segments connect to the same helix, they form a new helix.
		const resolveBinderHelix = (segment: Nucleotide[]) => {
			const { res5, res3 } = classifySegment(segment);
			const helixIds = new Set<number>();
			const collect = (res: SideResult) => {
				if (!isBinder(res)) return;
				if (res.firstHelixId !== undefined) helixIds.add(res.firstHelixId);
				if (res.oppositeHelixId !== undefined) helixIds.add(res.oppositeHelixId);
			};
			if (res5) collect(res5);
			if (res3) collect(res3);
			if (helixIds.size === 1) return Array.from(helixIds.values())[0];
			return undefined;
		};

		const binderGroups = new Map<number, Nucleotide[][]>();
		const addBinderToGroup = (helixId: number, segment: Nucleotide[]) => {
			const list = binderGroups.get(helixId) || [];
			list.push(segment);
			binderGroups.set(helixId, list);
		};

		binders.forEach(segment => {
			const helixId = resolveBinderHelix(segment);
			if (helixId === undefined) return;
			addBinderToGroup(helixId, segment);
		});
		binder2.forEach(segment => {
			const helixId = resolveBinderHelix(segment);
			if (helixId === undefined) return;
			addBinderToGroup(helixId, segment);
		});

		binderGroups.forEach(segments => {
			if (!segments.length) return;
			const seen = new Set<number>();
			const newHelix: Nucleotide[] = [];
			segments.forEach(segment => {
				segment.forEach(nt => {
					if (seen.has(nt.id)) return;
					seen.add(nt.id);
					newHelix.push(nt);
				});
			});
			if (newHelix.length) helices.push(newHelix);
		});

		// This is the code to re-attach lastScraps[] segments to the closest helix by partial connection (n5/n3).
		// For grouped segments (e.g. deferred ssScaffold), we attach the full segment to one chosen helix.
		if (lastScraps.length && helices.length) {
			const idToHelix = new Map<number, number>();
			helices.forEach((list, idx) => {
				list.forEach(nt => idToHelix.set(nt.id, idx));
			});

			type WalkHit = { helixIdx: number; anchor: Nucleotide };

			const walkToHelix = (start: Nucleotide | null, dir: 'n5' | 'n3', owner: Nucleotide): WalkHit | null => {
				if (!start) {
					console.warn('[walkToHelix] Side', dir, 'is null for nucleotide', owner.id, '; using opposite side if available.');
					return null;
				}
				let curr: Nucleotide | null = start;
				while (curr) {
					// which helix does this current nt belong to?
					const hIdx = idToHelix.get(curr.id);
					if (hIdx !== undefined) return { helixIdx: hIdx, anchor: curr };
					curr = curr[dir] as Nucleotide | null;
				}
				console.warn('[walkToHelix] Side', dir, 'for nucleotide', owner.id, 'started at', start.id, 'but did not reach any existing helix.');
				return null;
			};

			const addlastScrapsSegmentToHelix = (targetIdx: number, segment: Nucleotide[]) => {
				const helix = helices[targetIdx];
				if (!helix) return false;
				const seen = new Set<number>(helix.map(nt => nt.id));
				segment.forEach(nt => {
					if (seen.has(nt.id)) return;
					helix.push(nt);
					seen.add(nt.id);
					idToHelix.set(nt.id, targetIdx);
				});
				return true;
			};

			const pickSegmentTarget = (segment: Nucleotide[]): WalkHit | null => {
				let best: { hit: WalkHit; distance: number } | null = null;

				segment.forEach(nt => {
					const via5 = walkToHelix((nt.n5 ?? null) as Nucleotide | null, 'n5', nt);
					const via3 = walkToHelix((nt.n3 ?? null) as Nucleotide | null, 'n3', nt);

					if (!via5 && via3) {
						console.log('[walkToHelix] Nucleotide', nt.id, ': n5 lookup failed; using n3 fallback candidate to helix', via3.helixIdx, 'via anchor', via3.anchor.id);
					}
					if (!via3 && via5) {
						console.log('[walkToHelix] Nucleotide', nt.id, ': n3 lookup failed; using n5 fallback candidate to helix', via5.helixIdx, 'via anchor', via5.anchor.id);
					}

					if (!via5 && !via3) {
						console.warn('[walkToHelix] Nucleotide', nt.id, ': both n5 and n3 lookups failed while resolving segment target.');
						return;
					}

					const pos = nt.getPos();
					const consider = (hit: WalkHit) => {
						const distance = pos.distanceTo(hit.anchor.getPos());
						if (!best || distance < best.distance) {
							best = { hit, distance };
						}
					};

					if (via5) consider(via5);
					if (via3) consider(via3);
				});

				return best ? best.hit : null;
			};

			const remaining: Nucleotide[][] = [];
			lastScraps.forEach(segment => {
				if (!segment.length) return;
				const target = pickSegmentTarget(segment);
				if (!target) {
					console.warn('[walkToHelix] Could not resolve target helix for lastScraps segment; keeping grouped segment in lastScraps.', {
						segmentLength: segment.length,
						segmentIds: segment.map(nt => nt.id)
					});
					remaining.push(segment);
					return;
				}

				if (!addlastScrapsSegmentToHelix(target.helixIdx, segment)) {
					remaining.push(segment);
					return;
				}
				console.log('[walkToHelix] Attached lastScraps segment to helix', target.helixIdx, 'segmentLength', segment.length);
			});
			// push the remaining grouped segments back to lastScraps[].
			lastScraps.length = 0;
			lastScraps.push(...remaining);
		}

		// const finalHelices = helices.filter(h => h.length > 0);
		return { helices, lastScraps, binders, binder2, disconnected, unhandled };
	}
	// export function generateTotal(inputMap: Map<number, Nucleotide>, tolerance = 2) {
	// 	let {partials, unpaired} = findHelixPartials(inputMap, tolerance);
	// 	let {ssdna, stubs, longssScaffold} = ssdnaPartials(unpaired);
	// 	let ssScaffold = longssScaffoldfunc(longssScaffold);
	// }

	export function findHelices(inputMap: Map<number, Nucleotide>, tolerance = 2) {
		findBasepairsOptim2();
		dropIntraStrandPairs();
		// ok now we can do the rest of the stuff.
		let { partials, unpaired } = findHelixPartials2(inputMap, tolerance);
		let { ssdna, stubs, longssScaffold } = ssdnaPartials(unpaired);
		let ssScaffold = longssScaffoldfunc(longssScaffold, stubs);
		let { helices, lastScraps, binders, binder2, disconnected, unhandled } = generateHelix(partials, ssdna, ssScaffold, stubs);
		const missing: Nucleotide[] = [];
		console.log("Helices size:", helices.flat().length);
		console.log("Total elements:", inputMap.size);
		if (helices.flat().length !== inputMap.size) {
			console.log("Oops has occurred!");
			const helixIds = new Set<number>();
			helices.forEach(list => list.forEach(nt => helixIds.add(nt.id)));

			const missingIds: number[] = [];
			inputMap.forEach((nt) => {
				if (!helixIds.has(nt.id)) {
					missing.push(nt);
					missingIds.push(nt.id);
				}
			});

			const listHits = new Map<number, Set<string>>();
			const addHits = (label: string, list: Nucleotide[] | Nucleotide[][]) => {
				const add = (nt: Nucleotide) => {
					if (!missingSet.has(nt.id)) return;
					const set = listHits.get(nt.id) || new Set<string>();
					set.add(label);
					listHits.set(nt.id, set);
				};
				if (Array.isArray(list[0])) {
					(list as Nucleotide[][]).forEach(segment => segment.forEach(add));
				} else {
					(list as Nucleotide[]).forEach(add);
				}
			};

			const missingSet = new Set<number>(missingIds);
			addHits('partials', partials);
			addHits('ssdna', ssdna);
			addHits('stubs', stubs);
			addHits('ssScaffold', ssScaffold);
			if (binders) addHits('binders', binders);
			if (binder2) addHits('binder2', binder2);
			if (disconnected) addHits('disconnected', disconnected);
			if (unhandled) addHits('unhandled', unhandled);
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
}