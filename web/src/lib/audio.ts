/**
 * Foley: tape, plastic, paper, a small brass bell. Synthesised in the browser,
 * created on the first user gesture only (`ensure()` is only ever called from
 * an event handler). While the song plays, foley is ducked hard and the motor
 * is silent so nothing competes with the voice.
 */

export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hissGain: GainNode | null = null;
  private motor: { osc: OscillatorNode; gain: GainNode; noiseSrc: AudioBufferSourceNode; noiseGain: GainNode } | null = null;
  private muted = false;
  private ducked = false;

  ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level();
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
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private level() {
    if (this.muted) return 0;
    return this.ducked ? 0.18 : 0.7;
  }

  private apply() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.08);
  }

  setMuted(value: boolean) {
    this.muted = value;
    this.apply();
  }

  /** the song is playing: foley steps back */
  setDucked(value: boolean) {
    this.ducked = value;
    this.apply();
    if (value) this.stopMotor();
    if (this.hissGain && this.ctx) this.hissGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
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

  private burst(o: { dur: number; freq: number; q?: number; gain?: number; type?: BiquadFilterType; delay?: number; sweepTo?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? "bandpass";
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    filter.Q.value = o.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.gain ?? 0.14, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  private tone(o: { freq: number; dur: number; gain?: number; type?: OscillatorType; glideTo?: number; delay?: number; attack?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + o.dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.gain ?? 0.08, t + (o.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** a print clipped into the strip */
  paper(delay = 0) {
    this.burst({ dur: 0.18, freq: 2100, q: 0.7, gain: 0.09, sweepTo: 900, delay });
    this.burst({ dur: 0.05, freq: 900, q: 0.8, gain: 0.12, type: "lowpass", delay: delay + 0.12 });
  }

  /** thin plastic, high and dry */
  click() {
    this.burst({ dur: 0.035, freq: 2600, q: 1.4, gain: 0.1, type: "highpass" });
    this.tone({ freq: 420, dur: 0.035, gain: 0.025, type: "square" });
  }

  /** a key cap bottoming out; pitch differs per key */
  key(pitch = 132) {
    this.burst({ dur: 0.04, freq: 1800, q: 1.1, gain: 0.12 });
    this.tone({ freq: pitch, dur: 0.09, gain: 0.07, glideTo: pitch * 0.73 });
  }

  /** the lever, pulled home */
  thunk() {
    this.burst({ dur: 0.14, freq: 520, q: 0.6, gain: 0.24, type: "lowpass" });
    this.tone({ freq: 96, dur: 0.28, gain: 0.26, glideTo: 48 });
    this.tone({ freq: 62, dur: 0.42, gain: 0.14, type: "triangle" });
    this.burst({ dur: 0.03, freq: 3200, q: 1.6, gain: 0.07, delay: 0.005 });
  }

  /** the receipt printer stepping a line */
  print(delay = 0) {
    for (let i = 0; i < 4; i += 1) {
      this.burst({ dur: 0.028, freq: 3400, q: 2, gain: 0.03, delay: delay + i * 0.032, type: "bandpass" });
    }
  }

  /** a sticker coming off its backing */
  peel() {
    this.burst({ dur: 0.32, freq: 5200, q: 0.9, gain: 0.05, sweepTo: 1800 });
    this.burst({ dur: 0.04, freq: 1300, q: 1, gain: 0.06, delay: 0.3 });
  }

  /** the small brass bell */
  bell() {
    ([
      [2093, 0.1, 1.1],
      [2790, 0.07, 0.8],
      [3520, 0.04, 0.6],
      [5230, 0.022, 0.4],
    ] as const).forEach(([freq, gain, dur]) => this.tone({ freq, dur, gain, attack: 0.004 }));
  }

  /** the tape being pulled out of the deck */
  eject() {
    this.burst({ dur: 0.08, freq: 700, q: 0.7, gain: 0.2, type: "lowpass" });
    this.tone({ freq: 210, dur: 0.12, gain: 0.08, glideTo: 150 });
    this.burst({ dur: 0.05, freq: 2400, q: 1, gain: 0.06, delay: 0.09 });
  }

  startMotor() {
    const ctx = this.ensure();
    if (!ctx || this.motor || this.ducked || !this.master || !this.noise) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 54;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 280;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.022, ctx.currentTime, 0.3);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noise;
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.0001;
    noiseGain.gain.setTargetAtTime(0.012, ctx.currentTime, 0.3);
    osc.connect(filter).connect(gain).connect(this.master);
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(this.master);
    osc.start();
    noiseSrc.start();
    this.motor = { osc, gain, noiseSrc, noiseGain };
    if (this.hissGain) this.hissGain.gain.setTargetAtTime(0.012, ctx.currentTime, 0.4);
  }

  stopMotor() {
    const ctx = this.ctx;
    if (!ctx || !this.motor) return;
    const { osc, gain, noiseSrc, noiseGain } = this.motor;
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    noiseGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    window.setTimeout(() => {
      try {
        osc.stop();
        noiseSrc.stop();
      } catch {
        /* already stopped */
      }
    }, 900);
    this.motor = null;
    if (this.hissGain) this.hissGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.6);
  }
}

export const sound = new SoundKit();
