import {TouchInput, type TouchAction, type TouchDirection} from './touch-input';

/** Explicitly enabled by the pre-race iPhone selection; never by user-agent detection. */
export class TouchControls {
  readonly input = new TouchInput();
  readonly root = document.createElement('section');
  private stick: HTMLElement;
  private knob: HTMLElement;
  private buttons = new Map<number, HTMLElement>();

  constructor(parent: HTMLElement, onPause: () => void) {
    this.root.id = 'touch-controls';
    this.root.className = 'touch-controls hidden';
    this.root.setAttribute('aria-label', 'iPhone riding controls');
    this.root.innerHTML = `
      <div class="touch-steering">
        <div class="touch-stick" role="group" aria-label="Drag to steer; up or down adjusts air pitch" data-touch="stick">
          <span class="stick-cross horizontal"></span><span class="stick-cross vertical"></span>
          <span class="stick-arrow left">‹</span><span class="stick-arrow right">›</span><span class="touch-knob"></span>
        </div><span class="touch-caption">STEER ↔ <span>· AIR PITCH ↕</span></span>
      </div>
      <button type="button" class="touch-nose" data-touch="noseDown" aria-label="Hold to dip the nose in the air">↘<span>NOSE DOWN</span></button>
      <div class="touch-utilities"><button type="button" data-touch="reset" aria-label="Recover to checkpoint">↺<span>RECOVER</span></button><button type="button" class="touch-pause" aria-label="Pause race">Ⅱ<span>PAUSE</span></button></div>
      <div class="touch-pedals"><button type="button" class="touch-brake" data-touch="brake" aria-label="Hold to brake">▰<span>BRAKE</span></button><button type="button" class="touch-throttle" data-touch="throttle" aria-label="Hold to accelerate">↑<span>GAS</span></button></div>
      <span class="touch-orientation">ROTATE TO LANDSCAPE FOR A WIDER VIEW</span>`;
    parent.append(this.root);
    this.stick = this.root.querySelector('.touch-stick')!;
    this.knob = this.root.querySelector('.touch-knob')!;
    this.root.querySelector<HTMLButtonElement>('.touch-pause')!.onclick = onPause;
    this.root.querySelectorAll<HTMLElement>('[data-touch]').forEach(element => {
      const action = element.dataset.touch as TouchAction;
      element.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (!this.input.start(event.pointerId, action)) return;
        event.preventDefault();
        this.buttons.set(event.pointerId, element);
        element.setPointerCapture(event.pointerId);
        element.classList.add('held');
        if (action === 'stick') this.moveStick(event);
      });
      element.addEventListener('pointermove', event => {
        if (action === 'stick' && this.buttons.get(event.pointerId) === element) this.moveStick(event);
      });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        element.addEventListener(name, event => this.release((event as PointerEvent).pointerId));
      }
      element.addEventListener('contextmenu', event => event.preventDefault());
    });
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('resize', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  private moveStick(event: PointerEvent) {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width * .34;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const scale = Math.min(1, radius / Math.max(1, distance));
    this.input.move(event.pointerId, dx / radius, dy / radius);
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  }

  private release(pointer: number) {
    const element = this.buttons.get(pointer);
    if (!element) return;
    this.buttons.delete(pointer);
    this.input.end(pointer);
    if (![...this.buttons.values()].includes(element)) element.classList.remove('held');
    if (element === this.stick) this.knob.style.transform = '';
  }

  clear() {
    this.input.clear();
    for (const [id, element] of [...this.buttons]) {
      this.release(id);
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    this.knob.style.transform = '';
  }

  setDirections(steering: TouchDirection, pitch: TouchDirection) {
    this.clear();
    this.input.setDirections(steering, pitch);
    this.stick.setAttribute('aria-label', `Drag left to steer ${steering === 'regular' ? 'left' : 'right'}; drag up to pitch nose ${pitch === 'regular' ? 'up' : 'down'}`);
  }

  show(visible: boolean) {
    if (!visible) this.clear();
    this.input.setEnabled(visible);
    this.root.classList.toggle('hidden', !visible);
  }
}
