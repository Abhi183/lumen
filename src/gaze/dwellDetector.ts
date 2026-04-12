// Dwell-based selection for gaze input.
//
// A "target" is any labeled rectangular region. The detector is fed a stream
// of gaze points; when the gaze stays inside the same target continuously
// for >= dwellMs, it emits a "fire" event for that target exactly once.
// Selection re-arms only after the gaze leaves the target — this prevents
// a staring user from auto-firing the same button forever.
//
// Hysteresis: while you are dwelling on a target, that target's hit-test
// rectangle is grown by `stickyMargin` (default 15%) on each side. The
// effect is that a small gaze wobble won't pop you off the target you
// were aiming at — you have to look definitely-elsewhere to switch.

export interface DwellTarget {
  id: string;
  /** Rect in the same coordinate space as the gaze point. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface DwellUpdate {
  /** The target the gaze is currently over, or null. */
  hoverId: string | null;
  /** 0..1 fraction of the dwell timer elapsed for the current hover. */
  progress: number;
  /** Target id that just fired on this frame, or null. */
  fired: string | null;
}

export interface DwellConfig {
  /** How long the user must hold a target to select it. */
  dwellMs: number;
  /** Fractional margin added to the currently-dwelled target's bounds. */
  stickyMargin: number;
}

export const DEFAULT_DWELL_CONFIG: DwellConfig = {
  dwellMs: 800,
  stickyMargin: 0.15,
};

export class DwellDetector {
  private config: DwellConfig;
  private enteredTargetId: string | null = null;
  private enteredAt = 0;
  private firedOnThisHover = false;

  constructor(config: DwellConfig = DEFAULT_DWELL_CONFIG) {
    this.config = config;
  }

  setConfig(config: DwellConfig): void {
    this.config = config;
  }

  getConfig(): DwellConfig {
    return this.config;
  }

  reset(): void {
    this.enteredTargetId = null;
    this.enteredAt = 0;
    this.firedOnThisHover = false;
  }

  update(
    point: { x: number; y: number } | null,
    now: number,
    targets: readonly DwellTarget[],
  ): DwellUpdate {
    const hoverId = point ? this.hitTest(point, targets) : null;

    if (hoverId !== this.enteredTargetId) {
      // Gaze just entered a new region (or left one). Reset timer + arm.
      this.enteredTargetId = hoverId;
      this.enteredAt = now;
      this.firedOnThisHover = false;
    }

    if (hoverId === null) {
      return { hoverId: null, progress: 0, fired: null };
    }

    if (this.firedOnThisHover) {
      return { hoverId, progress: 1, fired: null };
    }

    const elapsed = now - this.enteredAt;
    const progress = Math.min(1, elapsed / this.config.dwellMs);

    if (progress >= 1) {
      this.firedOnThisHover = true;
      return { hoverId, progress: 1, fired: hoverId };
    }
    return { hoverId, progress, fired: null };
  }

  /**
   * Find which target the point is over. The currently-dwelled target
   * gets first-look priority with an expanded hit area; only if that
   * misses do we fall through to the normal hit test.
   */
  private hitTest(
    point: { x: number; y: number },
    targets: readonly DwellTarget[],
  ): string | null {
    if (this.enteredTargetId !== null) {
      const sticky = findById(targets, this.enteredTargetId);
      if (sticky && pointIn(point, expandRect(sticky.rect, this.config.stickyMargin))) {
        return sticky.id;
      }
    }
    for (const t of targets) {
      if (pointIn(point, t.rect)) return t.id;
    }
    return null;
  }
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pointIn(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function expandRect(r: Rect, margin: number): Rect {
  const dw = r.width * margin;
  const dh = r.height * margin;
  return {
    x: r.x - dw,
    y: r.y - dh,
    width: r.width + 2 * dw,
    height: r.height + 2 * dh,
  };
}

function findById(targets: readonly DwellTarget[], id: string): DwellTarget | null {
  for (const t of targets) {
    if (t.id === id) return t;
  }
  return null;
}
