export interface MenuInputTarget {
  hit(x: number, y: number): number;
  focus(index: number): void;
  activate(index: number): void;
  scroll(delta: number): void;
  setPressed(index: number | null): void;
  /** The control a mouse pointer rests on, or null; touch never hovers. Command lists also move
   *  their focus with it (`followPointer`); other controls only show hover. */
  hover(index: number | null): void;
}

/** Host-independent gesture ownership; a scrolling finger must never also activate a command. */
export class MenuInput {
  private press:
    | { id: number; index: number; x: number; y: number; lastY: number; dragged: boolean }
    | undefined;

  private readonly menu: MenuInputTarget;
  private pressedIndex: number | null = null;
  /** Where a mouse last rested, so hover can follow content scrolled under it. */
  private resting: { x: number; y: number } | null = null;

  constructor(menu: MenuInputTarget) {
    this.menu = menu;
  }

  down(id: number, x: number, y: number): boolean {
    if (this.press) return false;
    const index = this.menu.hit(x, y);
    if (index < 0) return false;
    this.press = { id, index, x, y, lastY: y, dragged: false };
    this.menu.focus(index);
    this.setPressed(index);
    return true;
  }

  move(id: number, x: number, y: number, hover: boolean): void {
    const press = this.press;
    if (!press) {
      this.resting = hover ? { x, y } : null;
      const index = hover ? this.menu.hit(x, y) : -1;
      this.menu.hover(index >= 0 ? index : null);
      return;
    }
    if (press.id !== id) return;
    if (Math.hypot(x - press.x, y - press.y) > 8) press.dragged = true;
    this.setPressed(!press.dragged && this.menu.hit(x, y) === press.index ? press.index : null);
    if (press.dragged) this.menu.scroll(press.lastY - y);
    press.lastY = y;
  }

  up(id: number, x: number, y: number): void {
    const press = this.press;
    if (!press || press.id !== id) return;
    this.press = undefined;
    this.setPressed(null);
    if (
      !press.dragged &&
      Math.hypot(x - press.x, y - press.y) <= 8 &&
      this.menu.hit(x, y) === press.index
    )
      this.menu.activate(press.index);
  }

  /** The pointer left the surface. */
  leave(): void {
    this.resting = null;
    this.menu.hover(null);
  }

  /** Hit-tests the resting mouse again: content moved under it (a wheel scroll, once laid out). */
  refresh(): void {
    if (this.press || !this.resting) return;
    const index = this.menu.hit(this.resting.x, this.resting.y);
    this.menu.hover(index >= 0 ? index : null);
  }

  cancel(id?: number): void {
    if (id === undefined || this.press?.id === id) {
      this.press = undefined;
      this.setPressed(null);
    }
  }

  private setPressed(index: number | null): void {
    if (this.pressedIndex === index) return;
    this.pressedIndex = index;
    this.menu.setPressed(index);
  }
}
