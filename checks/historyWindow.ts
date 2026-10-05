/**
 * Deterministic checks for the commit-history open/close contract (Phase 7).
 *
 * Script mode on purpose: no `import`/`export`, so tsc can concatenate this file
 * with ts/UI/historyWindowController.ts via --outFile and node can run the result.
 * The viewer's build has the same constraint (UI.ts must stay a global script).
 *
 *   npx tsc ts/UI/historyWindowController.ts checks/historyWindow.ts \
 *     --outFile /tmp/oxcloud-history/history.js --target es2018 --module none
 *   node /tmp/oxcloud-history/history.js
 */

interface CallLog {
  createWindow: number;
  toggleWindow: number;
  removeStale: number;
  initCommitHistory: string[];
  log: string[];
}

class FakeDeps implements HistoryWindowDeps {
  windowId = "commitHistoryWindow";
  exists = false;
  open = false;
  stale = false;
  /** When false, createWindow resolves without making the window visible. */
  createShowsWindow = true;
  /** Resolves createWindow on demand, to hold a creation "in flight". */
  manualResolve: (() => void) | null = null;
  calls: CallLog = {
    createWindow: 0,
    toggleWindow: 0,
    removeStale: 0,
    initCommitHistory: [],
    log: [],
  };

  isOpen(): boolean {
    return this.open;
  }

  windowExists(): boolean {
    return this.exists;
  }

  isStale(): boolean {
    return this.stale;
  }

  createWindow(): Promise<void> {
    this.calls.createWindow += 1;
    return new Promise<void>((resolve) => {
      const finish = () => {
        this.exists = true;
        if (this.createShowsWindow) this.open = true;
        resolve();
      };
      if (this.manualResolve) {
        this.pendingResolve = finish;
      } else {
        finish();
      }
    });
  }

  pendingResolve: (() => void) | null = null;

  /** Releases a createWindow held by manualResolve. */
  release(): void {
    const resolve = this.pendingResolve;
    if (!resolve) throw new Error("no creation is in flight");
    this.pendingResolve = null;
    resolve();
  }

  toggleWindow(): void {
    this.calls.toggleWindow += 1;
    this.open = !this.open;
  }

  removeStale(): void {
    this.calls.removeStale += 1;
    this.stale = false;
    this.exists = false;
    this.open = false;
  }

  initCommitHistory(structureId: string): void {
    this.calls.initCommitHistory.push(structureId);
  }

  log(message: string): void {
    this.calls.log.push(message);
  }
}

const failures: string[] = [];
let passed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(message);
  }
}

function check(name: string, body: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      console.log(`[PASS] ${name}`);
    })
    .catch((error: unknown) => {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`[FAIL] ${name}`);
    });
}

async function main(): Promise<void> {
  // (a) First click, nothing exists yet: one creation, one open, one init.
  await check("history: the first click opens exactly once", async () => {
    const deps = new FakeDeps();
    const controller = new HistoryWindowController(deps);
    await controller.open("structure-1");
    assert(deps.calls.createWindow === 1, `createWindow was called ${deps.calls.createWindow} times`);
    assert(deps.calls.toggleWindow === 0, `toggleWindow was called ${deps.calls.toggleWindow} times`);
    assert(deps.exists && deps.open, "the window is not open after one click");
    assert(
      deps.calls.initCommitHistory.length === 1 &&
        deps.calls.initCommitHistory[0] === "structure-1",
      `initCommitHistory calls: ${JSON.stringify(deps.calls.initCommitHistory)}`,
    );
  });

  // (b) The window's own load must not toggle it again (the original bug).
  await check("history: the load callback does not toggle the window shut", async () => {
    const deps = new FakeDeps();
    deps.createShowsWindow = false; // the window is created but not shown yet
    const controller = new HistoryWindowController(deps);
    await controller.open("structure-1");
    assert(deps.calls.createWindow === 1, `createWindow was called ${deps.calls.createWindow} times`);
    // Created but not visible -> opened exactly once, and never closed again.
    assert(deps.calls.toggleWindow === 1, `toggleWindow was called ${deps.calls.toggleWindow} times`);
    assert(deps.open, "the window is not open after a creation that did not show it");
    assert(deps.calls.initCommitHistory.length === 1, "initCommitHistory did not run exactly once");
  });

  // (c) A second click while the creation is still loading joins the first.
  await check("history: a double click creates one window and opens it once", async () => {
    const deps = new FakeDeps();
    deps.manualResolve = () => undefined;
    const controller = new HistoryWindowController(deps);
    const first = controller.open("structure-1");
    const second = controller.open("structure-1");
    assert(first === second, "the in-flight click did not join the same promise");
    deps.release();
    await Promise.all([first, second]);
    assert(deps.calls.createWindow === 1, `createWindow was called ${deps.calls.createWindow} times`);
    assert(deps.calls.toggleWindow === 0, `toggleWindow was called ${deps.calls.toggleWindow} times`);
    assert(deps.calls.initCommitHistory.length === 1, "initCommitHistory did not run exactly once");
    assert(deps.exists && deps.open, "the window is not open after a double click");
  });

  // (d) Already open: zero toggles, and no re-init for the same structure.
  await check("history: an already open window is not toggled", async () => {
    const deps = new FakeDeps();
    deps.exists = true;
    deps.open = true;
    const controller = new HistoryWindowController(deps);
    await controller.open("structure-1");
    assert(deps.calls.toggleWindow === 0, `toggleWindow was called ${deps.calls.toggleWindow} times`);
    assert(deps.calls.createWindow === 0, `createWindow was called ${deps.calls.createWindow} times`);
    assert(deps.calls.removeStale === 0, "a live window was removed");
    // The first call still loads the requested structure into the open window
    // (the window may have been showing a different one), but must not toggle.
    assert(
      deps.calls.initCommitHistory.length === 1 &&
        deps.calls.initCommitHistory[0] === "structure-1",
      `initCommitHistory calls: ${JSON.stringify(deps.calls.initCommitHistory)}`,
    );

    // Same structure again: nothing at all happens.
    await controller.open("structure-1");
    assert(deps.calls.toggleWindow === 0, "an idempotent re-open toggled the window");
    assert(
      deps.calls.initCommitHistory.length === 1,
      `initCommitHistory re-ran for the same structure: ${JSON.stringify(deps.calls.initCommitHistory)}`,
    );

    // A different structure re-initialises once, still without toggling.
    await controller.open("structure-2");
    assert(deps.calls.toggleWindow === 0, "re-init toggled the window");
    assert(
      deps.calls.initCommitHistory.length === 2 &&
        deps.calls.initCommitHistory[1] === "structure-2",
      `initCommitHistory calls: ${JSON.stringify(deps.calls.initCommitHistory)}`,
    );
    assert(deps.open, "the window was closed by the re-init");
  });

  // (e) A stale element is removed once, then a fresh window is created.
  await check("history: a stale element is removed once, then created", async () => {
    const deps = new FakeDeps();
    deps.exists = true;
    deps.open = false;
    deps.stale = true;
    const controller = new HistoryWindowController(deps);
    await controller.open("structure-1");
    assert(deps.calls.removeStale === 1, `removeStale was called ${deps.calls.removeStale} times`);
    assert(deps.calls.createWindow === 1, `createWindow was called ${deps.calls.createWindow} times`);
    assert(deps.exists && deps.open, "no window is open after the stale removal");
    assert(deps.calls.initCommitHistory.length === 1, "initCommitHistory did not run exactly once");
  });

  // A closed but live window is opened, never deleted.
  await check("history: a live but closed window is opened, not deleted", async () => {
    const deps = new FakeDeps();
    deps.exists = true;
    deps.open = false;
    deps.stale = false;
    const controller = new HistoryWindowController(deps);
    await controller.open("structure-1");
    assert(deps.calls.removeStale === 0, "a live window was removed");
    assert(deps.calls.toggleWindow === 1, `toggleWindow was called ${deps.calls.toggleWindow} times`);
    assert(deps.calls.createWindow === 0, "a live window was re-created");
    assert(deps.open, "the live window was not opened");
  });

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

void main();
