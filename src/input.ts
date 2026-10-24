import {nativeGamepads} from './native-controller';
export type Control = {
  throttle: number; brake: number; steer: number; pitch: number;
  reset: boolean; pause: boolean;
};
export type Device = { kind: 'keyboard' } | { kind: 'touch' } | { kind: 'gamepad'; index: number };
export type GamepadLike = {
  index: number; id: string; connected?: boolean;
  axes: readonly number[];
  buttons: readonly { value: number; pressed?: boolean }[];
};
export type GamepadList = ArrayLike<GamepadLike | null>;

export const neutralControl = (): Control => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, reset: false, pause: false });
/** Bikes face local +Z; the rear camera's screen-right points toward local -X. */
export const screenSteerToWorld = (axis: number) => axis === 0 ? 0 : -axis;
const deviceKey = (device: Device) => device.kind === 'gamepad' ? `gamepad:${device.index}` : device.kind;
const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

export function uniqueDevices(devices: readonly Device[]): Device[] {
  const seen = new Set<string>();
  return devices.filter(device => {
    const key = deviceKey(device);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapKeyboard(keys: ReadonlySet<string>): Control {
  const down = (...codes: string[]) => codes.some(code => keys.has(code));
  return {
    throttle: +down('KeyW', 'ArrowUp'), brake: +down('KeyS', 'ArrowDown'),
    steer: screenSteerToWorld(+down('KeyD', 'ArrowRight') - +down('KeyA', 'ArrowLeft')),
    pitch: +down('KeyE') - +down('KeyQ', 'Space'),
    reset: down('KeyR'), pause: down('Escape', 'KeyP'),
  };
}

export function axisWithDeadzone(value: number, deadzone = 0.16): number {
  const safe = clamp(value, -1, 1);
  return Math.abs(safe) <= deadzone ? 0 : Math.sign(safe) * (Math.abs(safe) - deadzone) / (1 - deadzone);
}

export function mapGamepad(pad: GamepadLike | null | undefined): Control {
  if (!pad || pad.connected === false) return neutralControl();
  const button = (index: number) => clamp(pad.buttons[index]?.value ?? (pad.buttons[index]?.pressed ? 1 : 0), 0, 1);
  return {
    throttle: button(7), brake: button(6), steer: screenSteerToWorld(axisWithDeadzone(pad.axes[0] ?? 0)),
    pitch: axisWithDeadzone(pad.axes[1] ?? 0),
    reset: button(1) > 0.5, pause: button(9) > 0.5,
  };
}

/** Resolve by physical gamepad index, even if the browser list is sparse or reordered. */
export function routeControls(devices: readonly Device[], keys: ReadonlySet<string>, pads: GamepadList, touch: Control = neutralControl()): Control[] {
  return devices.map(device => device.kind === 'keyboard' ? mapKeyboard(keys)
    : device.kind === 'touch' ? { ...touch } : mapGamepad(Array.from(pads).find(pad => pad?.index === device.index)));
}

export type GamepadStatus = {pads:GamepadList;state:'ready'|'unavailable'|'blocked';message:string};
/** Keep browser access failures distinct from a connected API with no visible controllers. */
export function readGamepadStatus():GamepadStatus {
  if(nativeGamepads().length)return {pads:nativeGamepads(),state:'ready',message:''};
  if(typeof navigator==='undefined'||typeof navigator.getGamepads!=='function')return {pads:[],state:'unavailable',message:'This browser cannot access controllers. Open the game in Safari or Chrome on this Mac.'};
  try{const browser=Array.from(navigator.getGamepads()).filter(p=>p&&p.connected!==false);return {pads:browser.length?browser:nativeGamepads(),state:'ready',message:''};}
  catch{return {pads:[],state:'blocked',message:'Controller access is blocked in this browser. Open the game in Safari or Chrome on this Mac.'};}
}
export function readBrowserGamepads():GamepadList {return readGamepadStatus().pads;}

/** An intentional A press takes over the solo keyboard slot, including Free Practice. */
export function controllerJoinSlot(devices:readonly (Device|null)[],index:number,practice:boolean):number {
  const existing=devices.findIndex(d=>d?.kind==='gamepad'&&d.index===index);
  if(existing>=0)return existing;
  if(devices.length===1&&(!devices[0]||devices[0].kind==='keyboard'))return 0;
  const empty=devices.findIndex(d=>!d);if(empty>=0)return empty;
  return !practice&&devices.length<4?devices.length:-1;
}

const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'Space', 'KeyR', 'Escape', 'KeyP']);

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly previousButtons = new Map<string, { reset: boolean; pause: boolean }>();
  private readonly onKeyDown = (event: Event) => {
    const key = event as KeyboardEvent;
    const target = key.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
    if (controlledKeys.has(key.code)) { key.preventDefault(); this.keys.add(key.code); }
  };
  private readonly onKeyUp = (event: Event) => { this.keys.delete((event as KeyboardEvent).code); };
  private readonly onBlur = () => { this.keys.clear(); this.previousButtons.clear(); };

  constructor(
    private readonly target: EventTarget | null = typeof window !== 'undefined' ? window : null,
    private readonly readGamepads: () => GamepadList = readBrowserGamepads,
    private readonly readTouch: () => Control = neutralControl,
  ) {
    target?.addEventListener('keydown', this.onKeyDown);
    target?.addEventListener('keyup', this.onKeyUp);
    target?.addEventListener('blur', this.onBlur);
  }

  sample(device: Device): Control {
    const control = routeControls([device], this.keys, this.readGamepads(), this.readTouch())[0];
    const key = deviceKey(device);
    const previous = this.previousButtons.get(key);
    this.previousButtons.set(key, { reset: control.reset, pause: control.pause });
    return { ...control, reset: control.reset && !previous?.reset, pause: control.pause && !previous?.pause };
  }

  connectedGamepads(): { index: number; id: string }[] {
    return Array.from(this.readGamepads()).filter((pad): pad is GamepadLike => !!pad && pad.connected !== false)
      .map(({ index, id }) => ({ index, id }));
  }

  dispose(): void {
    this.target?.removeEventListener('keydown', this.onKeyDown);
    this.target?.removeEventListener('keyup', this.onKeyUp);
    this.target?.removeEventListener('blur', this.onBlur);
    this.onBlur();
  }
}
