/**
 * Songbird: foley.
 *
 * There are no UI sounds here. Everything is tape, plastic, paper, a small brass
 * bell, and a room with a lamp in it. All of it is synthesised in the browser so
 * the demo stays self contained; the lullaby is placeholder audio (a soft whistle
 * of a melody) until a real recording is dropped in.
 *
 * Nothing is created until the first user gesture: `ensure()` is only ever called
 * from an event handler. That keeps the browser's autoplay rules and the brief's
 * "audio starts only from the user's tap" rule honest.
 */

type Ctx = AudioContext;

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** the J-card has seven lines; the placeholder melody loops through them */
const LINE_COUNT = 7;

const PHRASES: number[][] = [
  [72, 69, 67, 69],
  [67, 69, 72, 74],
  [72, 74, 76, 74],
  [71, 74, 72, 69],
  [69, 72, 74, 72],
  [67, 69, 72, 67],
  [69, 64],
];

export class SoundKit {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hissGain: GainNode | null = null;
  private roomGain: GainNode | null = null;
  private motorNodes: { osc: OscillatorNode; gain: GainNode; noiseSrc: AudioBufferSourceNode } | null =
    null;
  private songGain: GainNode | null = null;
  private songTimers: number[] = [];
  private songIndex = 0;
  private muted = false;

  ensure(): Ctx | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 2.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      this.noise = buf;

      this.hissGain = this.loopNoise("highpass", 3200, 0.9);
      this.roomGain = this.loopNoise("lowpass", 420, 0.7);
      this.roomGain.gain.value = 0.028;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(value: boolean) {
    this.muted = value;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return gain;
  }

  private burst(opts: {
    dur: number;
    freq: number;
    q?: number;
    gain?: number;
    type?: BiquadFilterType;
    delay?: number;
    sweepTo?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
    filter.Q.value = opts.q ?? 1;
    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.14;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(opts: {
    freq: number;
    dur: number;
    gain?: number;
    type?: OscillatorType;
    glideTo?: number;
    delay?: number;
    attack?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + opts.dur);
    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.08;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  /** a sheet of paper landing, with a little weight */
  paper() {
    this.burst({ dur: 0.18, freq: 2100, q: 0.7, gain: 0.1, sweepTo: 900 });
    this.burst({ dur: 0.1, freq: 4200, q: 1.2, gain: 0.05, delay: 0.02 });
  }

  /** thin plastic, high and dry */
  click() {
    this.burst({ dur: 0.035, freq: 2600, q: 1.4, gain: 0.11, type: "highpass" });
    this.tone({ freq: 420, dur: 0.035, gain: 0.03, type: "square" });
  }

  /** two moulded halves knocking together */
  clack() {
    this.burst({ dur: 0.05, freq: 900, q: 0.8, gain: 0.2, type: "lowpass" });
    this.tone({ freq: 168, dur: 0.1, gain: 0.09, glideTo: 120 });
  }

  /** a key cap bottoming out */
  key() {
    this.burst({ dur: 0.04, freq: 1800, q: 1.1, gain: 0.12 });
    this.tone({ freq: 132, dur: 0.09, gain: 0.07, glideTo: 96 });
  }

  /** the lever, pulled home */
  thunk() {
    this.burst({ dur: 0.14, freq: 520, q: 0.6, gain: 0.24, type: "lowpass" });
    this.tone({ freq: 96, dur: 0.28, gain: 0.28, glideTo: 48 });
    this.tone({ freq: 62, dur: 0.42, gain: 0.16, type: "triangle" });
    this.burst({ dur: 0.03, freq: 3200, q: 1.6, gain: 0.07, delay: 0.005 });
  }

  /** the tape head finding a line */
  print() {
    for (let i = 0; i < 3; i += 1) {
      this.burst({ dur: 0.03, freq: 3400, q: 2, gain: 0.035, delay: i * 0.035, type: "bandpass" });
    }
  }

  /** the small brass bell */
  bell() {
    const partials: Array<[number, number, number]> = [
      [2093, 0.11, 1.1],
      [2790, 0.075, 0.8],
      [3520, 0.045, 0.6],
      [5230, 0.025, 0.4],
    ];
    partials.forEach(([freq, gain, dur]) => {
      this.tone({ freq, dur, gain, attack: 0.004 });
    });
    this.burst({ dur: 0.03, freq: 5200, q: 1.5, gain: 0.06 });
  }

  /** a short backward stagger, the machine being careful */
  rewind() {
    this.tone({ freq: 118, dur: 0.4, gain: 0.11, type: "sawtooth", glideTo: 58 });
    this.burst({ dur: 0.36, freq: 1400, q: 0.9, gain: 0.09, sweepTo: 380 });
  }

  startMotor() {
    const ctx = this.ensure();
    if (!ctx || this.motorNodes) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 54;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.03, ctx.currentTime, 0.25);

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noise!;
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.02;

    osc.connect(filter).connect(gain).connect(this.master!);
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(this.master!);
    osc.start();
    noiseSrc.start();
    this.motorNodes = { osc, gain, noiseSrc };
    if (this.hissGain && ctx) this.hissGain.gain.setTargetAtTime(0.02, ctx.currentTime, 0.4);
  }

  stopMotor() {
    const ctx = this.ctx;
    if (!ctx || !this.motorNodes) return;
    const { osc, gain, noiseSrc } = this.motorNodes;
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    window.setTimeout(() => {
      try {
        osc.stop();
        noiseSrc.stop();
      } catch {
        /* already stopped */
      }
    }, 900);
    this.motorNodes = null;
    if (this.hissGain) this.hissGain.gain.setTargetAtTime(0.006, ctx.currentTime, 0.6);
  }

  /** room tone fades down as the lamp comes up */
  setRoomTone(towardLamp: number) {
    const ctx = this.ensure();
    if (!ctx || !this.roomGain) return;
    const level = 0.03 - Math.min(0.022, Math.max(0, towardLamp) * 0.022);
    this.roomGain.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
  }

  private voiceAt(midiNote: number, at: number, dur: number, gainValue: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const freq = midi(midiNote);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.09);
    gain.gain.setValueAtTime(gainValue, at + dur * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1500;
    filter.Q.value = 0.6;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const soft = ctx.createOscillator();
    soft.type = "sine";
    soft.frequency.value = freq * 2.002;
    const softGain = ctx.createGain();
    softGain.gain.value = 0.22;

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 2.4;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    osc.connect(filter);
    soft.connect(softGain).connect(filter);
    filter.connect(gain).connect(this.songGain!);

    osc.start(at);
    soft.start(at);
    vibrato.start(at);
    osc.stop(at + dur + 0.1);
    soft.stop(at + dur + 0.1);
    vibrato.stop(at + dur + 0.1);
  }

  /** a soft, breathy lullaby that changes phrase with each printed line */
  startSong(onLine: (index: number) => void) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stopSong();
    this.songGain = ctx.createGain();
    this.songGain.gain.value = 0.9;
    this.songGain.connect(this.master!);
    this.songIndex = 0;

    const lineLength = 3.6;
    const playPhrase = (lineIndex: number, at: number) => {
      const phrase = PHRASES[lineIndex % PHRASES.length];
      phrase.forEach((note, i) => {
        this.voiceAt(note, at + i * 0.72, 0.95, 0.075);
      });
      // a low, held root under each phrase
      this.voiceAt(phrase[0] - 12, at, lineLength * 0.85, 0.035);
    };

    const tick = () => {
      const line = this.songIndex % LINE_COUNT;
      onLine(line);
      playPhrase(line, ctx.currentTime + 0.05);
      this.songIndex += 1;
      const id = window.setTimeout(() => {
        if (this.songGain) tick();
      }, lineLength * 1000);
      this.songTimers.push(id);
    };
    tick();
  }

  stopSong() {
    this.songTimers.forEach((id) => window.clearTimeout(id));
    this.songTimers = [];
    if (this.songGain && this.ctx) {
      const g = this.songGain;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.12);
      window.setTimeout(() => {
        try {
          g.disconnect();
        } catch {
          /* already gone */
        }
      }, 600);
      this.songGain = null;
    }
  }
}
