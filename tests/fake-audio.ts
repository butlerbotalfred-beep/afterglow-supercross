// A stand-in for the browser's sound hardware, so the sound engine can be tested in Node. It makes no sound; it
// records what was built and every value change, and notes any level set in one step on a node already wired in.
export class FakeParam {
  /** Every change asked for, in order. */
  ops: {type: string; value: number; time: number}[] = [];
  private current: number;
  constructor(
    private node: FakeNode,
    start: number,
  ) {
    this.current = start;
  }
  get value() {
    return this.current;
  }
  set value(v: number) {
    this.current = v;
    this.ops.push({type: 'set', value: v, time: this.node.context.currentTime});
    if (this.node.wired) this.node.context.steps.push(this.node.kind);
  }
  setTargetAtTime(value: number, time: number) {
    this.current = value;
    this.ops.push({type: 'target', value, time});
  }
  setValueAtTime(value: number, time: number) {
    this.current = value;
    this.ops.push({type: 'setAt', value, time});
    this.node.context.steps.push(this.node.kind);
  }
}
export class FakeNode {
  wired = false;
  outputs: FakeNode[] = [];
  gain = new FakeParam(this, 1);
  frequency = new FakeParam(this, 440);
  Q = new FakeParam(this, 1);
  pan = new FakeParam(this, 0);
  playbackRate = new FakeParam(this, 1);
  type = '';
  loop = false;
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopAt = Infinity;
  constructor(
    public context: FakeAudioContext,
    public kind: string,
  ) {}
  connect(to: FakeNode) {
    this.wired = to.wired = true;
    this.outputs.push(to);
    return to;
  }
  disconnect() {
    this.outputs = [];
  }
  start() {
    this.started = true;
  }
  stop(at = this.context.currentTime) {
    this.stopAt = at;
  }
  get running() {
    return this.started && this.context.currentTime < this.stopAt;
  }
}
export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' = 'suspended';
  nodes: FakeNode[] = [];
  /** Kinds of node that had a value set in one step after being wired in. Must stay empty. */
  steps: string[] = [];
  destination = new FakeNode(this, 'destination');
  private make(kind: string) {
    const node = new FakeNode(this, kind);
    this.nodes.push(node);
    return node;
  }
  createGain = () => this.make('gain');
  createOscillator = () => this.make('oscillator');
  createBiquadFilter = () => this.make('filter');
  createStereoPanner = () => this.make('panner');
  createBufferSource = () => this.make('source');
  createDynamicsCompressor = () => this.make('compressor');
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return {length, duration: length / rate, getChannelData: () => data};
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  /** Oscillators making sound now. */
  get oscillators() {
    return this.nodes.filter(n => n.kind === 'oscillator' && n.running).length;
  }
  /** One-shot and looping samples started so far. */
  get sources() {
    return this.nodes.filter(n => n.kind === 'source' && n.started).length;
  }
}
