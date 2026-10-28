/**
 * Synthesizes a short, royalty-free "warm café" music bed as 16-bit PCM WAV, so the demo pipeline has real
 * audio without any licensed track. Clearly a DEMO asset (soft chords + light pulse), not production music.
 */
export function generateDemoMusicWav(durationSec = 30, sampleRate = 44_100): Buffer {
  const total = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(total);
  const bpm = 96;
  const beat = 60 / bpm;
  const bar = beat * 4;
  // Cmaj7 – Am7 – Fmaj7 – G6 (frequencies in Hz)
  const chords = [
    [130.81, 164.81, 196.0, 246.94],
    [110.0, 130.81, 164.81, 196.0],
    [87.31, 130.81, 174.61, 220.0],
    [98.0, 123.47, 146.83, 164.81],
  ];
  const melody = [523.25, 587.33, 659.25, 587.33, 523.25, 440.0, 493.88, 523.25];

  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const chord = chords[Math.floor(t / bar) % chords.length]!;
    const inBar = (t % bar) / bar;
    const padEnv = Math.min(1, inBar * 8) * (1 - 0.35 * inBar);
    let v = 0;
    for (const f of chord) {
      v += 0.05 * padEnv * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.001 * t));
    }
    // Soft kick on every beat.
    const beatT = t % beat;
    v += 0.22 * Math.exp(-beatT * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-beatT * 30)) * beatT);
    // Gentle plucked melody on eighth notes.
    const eighth = beat / 2;
    const note = melody[Math.floor(t / eighth) % melody.length]!;
    const noteT = t % eighth;
    v += 0.045 * Math.exp(-noteT * 9) * Math.sin(2 * Math.PI * note * t);
    samples[i] = v;
  }

  // Normalize to -3 dBFS and fade the edges.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.7 / peak : 1;
  const fade = sampleRate * 0.5;

  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const edge = Math.min(1, i / fade, (total - i) / fade);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]! * gain * edge)) * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
