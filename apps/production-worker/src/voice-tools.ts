import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import { DEMO_BUSINESS } from '@kampora/creative-engine';
import {
  ElevenLabsTtsProvider,
  ELEVENLABS_HEBREW_MODELS,
  normalizeHebrewForSpeech,
  parseVoiceList,
  prepareForProvider,
  probeBufferDurationSec,
  wordsFromAlignment,
} from '@kampora/hebrew-voice';

/**
 * Voice tools (run from the repo root):
 *   npm run voices:list                      FREE: lists Hebrew voices on your ElevenLabs account.
 *   npm run voice:compare -- --approve-paid [--models=eleven_v3,eleven_v4] [--max-generations=8]
 *                                            PAID: same Hebrew ad sentences across voices/models → listen.
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICES from .env. The key is never printed.
 */
const SENTENCES = [
  { id: 'hook', text: 'רגע, ראיתם את המבצע ב-Luz?' },
  { id: 'price', text: 'עכשיו: קפה + מאפה ב-29.90 ₪ עד סוף החודש.' },
  { id: 'details', text: 'פתוח כל יום מ-7:00, פלורנטין 12, תל אביב.' },
];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

async function listVoices(apiKey: string) {
  const url = 'https://api.elevenlabs.io/v2/voices?language=he&page_size=100';
  const res = await fetch(url, { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    voices: Array<{
      voice_id: string;
      name: string;
      category?: string;
      labels?: Record<string, string>;
      verified_languages?: Array<{ language: string; model_id: string; accent?: string; locale?: string }>;
    }>;
  };
  if (!json.voices.length) {
    console.log(
      'No voices with language=he on this account. Add Hebrew voices from the ElevenLabs Voice Library, then rerun.',
    );
    return;
  }
  for (const v of json.voices) {
    const he = (v.verified_languages ?? []).filter((l) => l.language === 'he');
    const labels = Object.entries(v.labels ?? {})
      .map(([k, val]) => `${k}=${val}`)
      .join(', ');
    console.log(`${v.voice_id} | ${v.name} | ${v.category ?? ''} | ${labels}`);
    for (const l of he)
      console.log(
        `    he verified for ${l.model_id}${l.accent ? ` (${l.accent})` : ''}${l.locale ? ` ${l.locale}` : ''}`,
      );
  }
  console.log('\nAdd chosen voices to ELEVENLABS_VOICES as "voiceId|Label|female;voiceId2|Label|male".');
}

async function compare(apiKey: string) {
  const voices = parseVoiceList(
    process.env.ELEVENLABS_VOICES,
    process.env.ELEVENLABS_MODEL_ID || 'eleven_v3',
  );
  if (!voices.length) throw new Error('ELEVENLABS_VOICES is empty (run voices:list first)');
  const models = (arg('models') ?? 'eleven_v3,eleven_v4')
    .split(',')
    .filter((m) => (ELEVENLABS_HEBREW_MODELS as readonly string[]).includes(m));
  const maxGenerations = Number(arg('max-generations') ?? 8);
  const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);

  // Plain text for every sentence + one selective-niqqud variant of the hook (does vocalizing "מבצע" help?).
  const variants = [
    ...SENTENCES.map((s) => ({ ...s, selectiveNiqqud: false })),
    { id: 'hook-niqqud', text: SENTENCES[0]!.text, selectiveNiqqud: true },
  ];
  const plan = voices.flatMap((voice) =>
    models.flatMap((model) =>
      variants.map((v) => {
        const spoken = normalizeHebrewForSpeech(v.text, {
          pronunciation: DEMO_BUSINESS.pronunciation,
        }).spoken;
        const speech = prepareForProvider(spoken, 'elevenlabs', {
          modelId: model,
          selectiveNiqqud: v.selectiveNiqqud,
        });
        const price = catalog.find('elevenlabs', model, 'TTS');
        return {
          voice,
          model,
          variant: v,
          speech,
          estUsd: price ? catalog.estimate(price, speech.characters) : 0,
        };
      }),
    ),
  );
  const totalUsd = plan.reduce((s, p) => s + p.estUsd, 0);
  const chars = plan.reduce((s, p) => s + p.speech.characters, 0);
  console.log(
    `Plan: ${plan.length} generations, ${chars} characters, est. $${totalUsd.toFixed(3)} (planning estimate; billed in credits)`,
  );
  for (const p of plan) console.log(`  ${p.model} · ${p.voice.label} · ${p.variant.id}: ${p.speech.payload}`);
  if (plan.length > maxGenerations) {
    throw new Error(
      `Refusing: ${plan.length} generations > --max-generations=${maxGenerations}. Narrow --models or ELEVENLABS_VOICES.`,
    );
  }
  if (!process.argv.includes('--approve-paid')) {
    console.log('\nDry run only. Re-run with --approve-paid to generate (paid).');
    return;
  }

  const outDir = path.resolve(
    __dirname,
    '../../../out/voice-compare',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(outDir, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  for (const p of plan) {
    const provider = new ElevenLabsTtsProvider({ apiKey, voiceId: p.voice.id, modelId: p.model });
    const file = `${p.model}__${p.voice.id}__${p.variant.id}.mp3`;
    try {
      const res = await provider.synthesize({ segmentKey: p.variant.id, speech: p.speech });
      await writeFile(path.join(outDir, file), res.audio);
      const durationSec = await probeBufferDurationSec(res.audio, 'mp3');
      const words = wordsFromAlignment(res.alignment);
      results.push({
        ...summary(p),
        file,
        durationSec,
        alignment: Boolean(res.alignment),
        alignedWords: words.length,
        requestId: res.requestId,
      });
      console.log(`✓ ${file} ${durationSec}s alignment=${Boolean(res.alignment)}`);
    } catch (error) {
      results.push({ ...summary(p), error: error instanceof Error ? error.message : String(error) });
      console.log(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(path.join(outDir, 'index.html'), html(results));
  console.log(`\nListen: ${path.join(outDir, 'index.html')}`);
}

function summary(p: {
  voice: { id: string; label: string };
  model: string;
  variant: { id: string; text: string };
  speech: { payload: string; characters: number };
  estUsd: number;
}) {
  return {
    voiceId: p.voice.id,
    voice: p.voice.label,
    model: p.model,
    variant: p.variant.id,
    subtitle: p.variant.text,
    spoken: p.speech.payload,
    characters: p.speech.characters,
    estUsd: p.estUsd,
  };
}

function html(results: Array<Record<string, unknown>>): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
    );
  const rows = results
    .map(
      (
        r,
      ) => `<tr><td>${esc(r.model)}</td><td>${esc(r.voice)}</td><td>${esc(r.variant)}</td><td>${esc(r.subtitle)}<br><small>${esc(r.spoken)}</small></td>
<td>${r.file ? `<audio controls src="${esc(r.file)}"></audio>` : `<b>${esc(r.error)}</b>`}</td><td>${esc(r.durationSec)}s · align ${esc(r.alignment)}</td>
<td><select><option></option><option>טבעי</option><option>סביר</option><option>לא טבעי</option><option>הגייה שגויה</option></select></td></tr>`,
    )
    .join('\n');
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>Kampora voice comparison</title>
<style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;vertical-align:top}small{color:#666}</style>
<h1>השוואת קולות – משפטי פרסומת זהים</h1><p>הקשיבו לכל שורה ודרגו. ההערכה נשמרת רק בדף הזה.</p>
<table><tr><th>מודל</th><th>קול</th><th>משפט</th><th>כתובית / טקסט שנשלח</th><th>האזנה</th><th>מדידה</th><th>דירוג</th></tr>
${rows}</table></html>`;
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set (.env)');
  if (process.argv[2] === 'list') await listVoices(apiKey);
  else await compare(apiKey);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
