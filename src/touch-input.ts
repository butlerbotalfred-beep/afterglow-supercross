import {axisWithDeadzone, screenSteerToWorld, neutralControl, type Control} from './input';

export type TouchDirection = 'regular' | 'inverted';

export type TouchAction = 'stick' | 'throttle' | 'brake' | 'reset' | 'noseDown';

/** Pointer ownership keeps one lifted/cancelled finger from releasing another. */
export class TouchInput {
  private enabled = false;
  private steering: TouchDirection = 'regular';
  private pitch: TouchDirection = 'regular';

  setDirections(steering: TouchDirection, pitch: TouchDirection) {
    if (this.steering !== steering || this.pitch !== pitch) this.clear();
    this.steering = steering;
    this.pitch = pitch;
  }
  private pointers = new Map<number, TouchAction>();
  private stick: number | null = null;
  private x = 0;
  private y = 0;

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) this.clear();
    this.enabled = enabled;
  }

  start(pointer: number, action: TouchAction): boolean {
    if (!this.enabled || this.pointers.has(pointer) || (action === 'stick' && this.stick !== null)) return false;
    this.pointers.set(pointer, action);
    if (action === 'stick') this.stick = pointer;
    return true;
  }

  move(pointer: number, x: number, y: number) {
    if (pointer !== this.stick) return;
    this.x = axisWithDeadzone(x, 0.1);
    this.y = axisWithDeadzone(-y, 0.15);
  }

  end(pointer: number) {
    this.pointers.delete(pointer);
    if (pointer === this.stick) {
      this.stick = null;
      this.x = 0;
      this.y = 0;
    }
  }

  clear() {
    this.pointers.clear();
    this.stick = null;
    this.x = 0;
    this.y = 0;
  }

  read(): Control {
    if (!this.enabled) return neutralControl();
    const held = new Set(this.pointers.values());
    return {
      throttle: +held.has('throttle'),
      brake: +held.has('brake'),
      steer: this.steering === 'regular' ? screenSteerToWorld(this.x) : this.x,
      pitch: held.has('noseDown') ? -1 : this.pitch === 'inverted' ? screenSteerToWorld(this.y) : this.y,
      reset: held.has('reset'),
      pause: false,
    };
  }
}
