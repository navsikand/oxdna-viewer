/**
 * Open/close decision for the commit-history window, with injected side effects.
 *
 * The bug this exists for: the first click on "View History" opened the window
 * and closed it again. `UI.openCommitHistoryModal` created the window, and the
 * window's own load callback called `openCommitHistoryModal` a second time; the
 * second call found the (now existing) element, did not match the "not open"
 * branch, and toggled it - closing what had just been opened. A second click
 * then happened to work, because by then the stale-DOM removal path deleted the
 * element and the following click created a fresh one.
 *
 * Contract implemented here:
 *  - already open for this structure: no-op (no toggle, no re-init)
 *  - already open for a *different* structure: re-init once, still no toggle
 *  - a click while a creation is still in flight joins that same promise
 *    (one create, one open)
 *  - otherwise: remove a stale element if one is genuinely dangling, then
 *    either open the existing window once, or create it and open it at most once
 *  - `initCommitHistory` runs exactly once per successful open
 *
 * Pure: no imports, no DOM, no globals - the harness injects fakes and asserts
 * call counts and ordering.
 */

/**
 * Compiled as a global script together with UI.ts (the viewer build concatenates
 * its `files` list), so this file has no `export`/`import`: UI.ts must remain a
 * non-module script or its globals (`view`, ...) disappear.
 */
interface HistoryWindowDeps {
  /** The DOM id of the history window (e.g. "commitHistoryWindow"). */
  windowId: string;
  /** True when the window element exists and is currently displayed. */
  isOpen(id: string): boolean;
  /** True when the window element exists at all. */
  windowExists(id: string): boolean;
  /** True when the element exists but is dangling/detached from its container. */
  isStale(id: string): boolean;
  /** Creates the window and resolves once it has loaded. */
  createWindow(id: string): Promise<void>;
  /** Toggles an existing window (used only to open a closed one). */
  toggleWindow(id: string): void;
  /** Removes a dangling element. */
  removeStale(id: string): void;
  /** Populates the history for a structure. */
  initCommitHistory(structureId: string): void;
  log?(message: string): void;
}

class HistoryWindowController {
  private readonly inFlight = new Map<string, Promise<void>>();
  private lastStructureId: string | null = null;

  constructor(private readonly deps: HistoryWindowDeps) {}

  /** Opens (or re-initialises) the history window for `structureId`. */
  public open(structureId: string): Promise<void> {
    const id = this.deps.windowId;

    const pending = this.inFlight.get(id);
    if (pending) {
      // A second click while the window is still loading must not start a second
      // creation, and must not queue a second toggle.
      this.deps.log?.("history window open already in flight; joining");
      return pending;
    }

    const task = this.run(id, structureId).finally(() => {
      this.inFlight.delete(id);
    });
    // Register synchronously, before any await, so a double click cannot slip
    // past the in-flight check.
    this.inFlight.set(id, task);
    return task;
  }

  private async run(id: string, structureId: string): Promise<void> {
    const exists = this.deps.windowExists(id);
    // Staleness is decided before "is it open": a dangling element has no
    // container to read a display state from, and asking anyway is what made the
    // stale case throw instead of being cleaned up.
    const stale = exists && this.deps.isStale(id);
    const open = !stale && exists && this.deps.isOpen(id);

    if (open) {
      if (this.lastStructureId === structureId) {
        this.deps.log?.("history window already open for this structure");
        return;
      }
      this.deps.log?.("history window open for another structure; re-initialising");
      this.deps.initCommitHistory(structureId);
      this.lastStructureId = structureId;
      return;
    }

    if (stale) {
      // Only a genuinely dangling element is removed; a live one is opened.
      this.deps.removeStale(id);
    }

    if (this.deps.windowExists(id)) {
      this.deps.toggleWindow(id);
      this.deps.initCommitHistory(structureId);
      this.lastStructureId = structureId;
      return;
    }

    await this.deps.createWindow(id);
    // Creating the window displays it. Only open it if that did not happen -
    // never toggling again is what the original double-entry did wrong.
    if (!this.deps.isOpen(id)) {
      this.deps.toggleWindow(id);
    }
    this.deps.initCommitHistory(structureId);
    this.lastStructureId = structureId;
  }
}
