import type {GamepadLike} from './input';
let stream: EventSource | null = null,
  pads: GamepadLike[] = [],
  lastUpdate = 0;
let status: 'off' | 'connecting' | 'connected' | 'unavailable' = 'off';
export const nativeControllerStatus = () => status;
export const nativeGamepads = (): GamepadLike[] => (Date.now() - lastUpdate < 300 ? pads : []);
export function stopNativeController() {
  stream?.close();
  stream = null;
  pads = [];
  lastUpdate = 0;
  status = 'off';
}
export function startNativeController() {
  if (stream) return;
  if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    status = 'unavailable';
    return;
  }
  status = 'connecting';
  stream = new EventSource('/__controller/events');
  stream.onmessage = event => {
    try {
      const incoming = JSON.parse(event.data);
      if (!Array.isArray(incoming)) return;
      pads = incoming;
      lastUpdate = Date.now();
      status = 'connected';
    } catch {}
  };
  stream.onerror = () => {
    pads = [];
    lastUpdate = 0;
    status = 'unavailable';
    stream?.close();
    stream = null;
  };
}
