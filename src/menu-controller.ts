import type {GamepadLike, GamepadList} from './input';
export type MenuAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept'
  | 'back'
  | 'start'
  | 'previous'
  | 'next'
  | 'kind'
  | 'highlight'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown';
export interface MenuEvent {
  index: number;
  action: MenuAction;
  scale: number;
}
const button = (p: GamepadLike, n: number) => (p.buttons[n]?.value ?? (p.buttons[n]?.pressed ? 1 : 0)) > 0.5;
/** Shared by browser and native Xbox input. Confirm/back never auto-repeat. */
export class MenuPad {
  private held = new Map<string, number>();
  update(pads: GamepadList, now: number): MenuEvent[] {
    const active = new Set<string>(),
      events: MenuEvent[] = [];
    for (const p of Array.from(pads)) {
      if (!p || p.connected === false) continue;
      const x = p.axes[0] || 0,
        y = p.axes[1] || 0,
        rx = p.axes[2] || 0,
        ry = p.axes[3] || 0;
      const actions: MenuAction[] = [];
      if (button(p, 12) || (y < -0.55 && Math.abs(y) >= Math.abs(x))) actions.push('up');
      if (button(p, 13) || (y > 0.55 && Math.abs(y) >= Math.abs(x))) actions.push('down');
      if (button(p, 14) || (x < -0.55 && Math.abs(x) > Math.abs(y))) actions.push('left');
      if (button(p, 15) || (x > 0.55 && Math.abs(x) > Math.abs(y))) actions.push('right');
      for (const [n, a] of [
        [0, 'accept'],
        [1, 'back'],
        [9, 'start'],
        [4, 'previous'],
        [5, 'next'],
        [2, 'kind'],
        [3, 'highlight'],
      ] as const)
        if (button(p, n)) actions.push(a);
      if (Math.abs(rx) > 0.55 || Math.abs(ry) > 0.55)
        actions.push(
          Math.abs(rx) > Math.abs(ry) ? (rx < 0 ? 'moveLeft' : 'moveRight') : ry < 0 ? 'moveUp' : 'moveDown',
        );
      for (const action of actions) {
        const key = p.index + ':' + action;
        active.add(key);
        const due = this.held.get(key);
        const repeat = [
          'up',
          'down',
          'left',
          'right',
          'previous',
          'next',
          'moveLeft',
          'moveRight',
          'moveUp',
          'moveDown',
        ].includes(action);
        if (due === undefined || (repeat && now >= due)) {
          events.push({index: p.index, action, scale: button(p, 6) ? 0.1 : button(p, 7) ? 5 : 1});
          this.held.set(key, now + (due === undefined ? 350 : 140));
        }
      }
    }
    for (const key of this.held.keys()) if (!active.has(key)) this.held.delete(key);
    return events;
  }
}

/** DOM navigation keeps existing UI handlers as the only writers of settings. */
export class MenuFocus {
  private focused: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private controls(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>('button,select,input:not([type="file"]),summary')).filter(
      e => !e.matches(':disabled') && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden',
    );
  }
  focus(element: HTMLElement | null) {
    this.focused?.classList.remove('controller-focus');
    this.focused = element;
    element?.classList.add('controller-focus');
    element?.focus({preventScroll: true});
    element?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  clear() {
    this.focused?.classList.remove('controller-focus');
    this.focused = null;
    this.root = null;
  }
  handle(root: HTMLElement, action: MenuAction) {
    const controls = this.controls(root);
    if (!controls.length) return;
    if (this.root !== root) {
      this.focused?.classList.remove('controller-focus');
      this.focused = null;
      this.root = root;
    }
    const current = root.contains(document.activeElement) ? (document.activeElement as HTMLElement) : this.focused;
    const index = controls.indexOf(current!);
    if (index < 0) {
      this.focus(controls[0]);
      if (action !== 'accept') return;
    }
    const target = index >= 0 ? controls[index] : controls[0];
    const move = (d: number) => this.focus(controls[(Math.max(0, index) + d + controls.length) % controls.length]);
    if (action === 'up' || action === 'previous') {
      move(-1);
      return;
    }
    if (action === 'down' || action === 'next') {
      move(1);
      return;
    }
    const selector = target.id
      ? '#' + CSS.escape(target.id)
      : target.dataset.field
        ? '[data-field="' + CSS.escape(target.dataset.field) + '"]'
        : null;
    if (action === 'left' || action === 'right' || action === 'accept') {
      const d = action === 'left' ? -1 : 1;
      if (target instanceof HTMLSelectElement) {
        const options = Array.from(target.options).filter(o => !o.disabled),
          i = options.indexOf(target.selectedOptions[0]);
        const next = options[Math.max(0, Math.min(options.length - 1, i + d))];
        if (next && next.value !== target.value) {
          target.value = next.value;
          target.dispatchEvent(new Event('change', {bubbles: true}));
        }
      } else if (target instanceof HTMLInputElement && ['number', 'range'].includes(target.type)) {
        if (action !== 'accept') {
          if (d > 0) target.stepUp();
          else target.stepDown();
          target.dispatchEvent(new Event('input', {bubbles: true}));
          target.dispatchEvent(new Event('change', {bubbles: true}));
        }
      } else if (action === 'accept') {
        target.click();
      } else {
        move(d);
        return;
      }
      const replacement = selector ? root.querySelector<HTMLElement>(selector) : null;
      if (root.getClientRects().length) this.focus(replacement || (target.isConnected ? target : null));
    }
  }
}
