/**
 * Long-session transcription: ffmpeg compression + splitting, word-level merge
 * with speaker alignment, and the full transcribeLong() path against a local
 * fake Scribe endpoint (no API key, no cost). Needs ffmpeg/ffprobe on PATH.
 *
 *   node scripts/test-transcription-long.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// Fake Scribe: each request answers with words every 2.5s of the part's audio,
// alternating speakers every 10s. Speaker ids are SWAPPED on odd requests, as a
// real provider may label the same person differently in each request.
let requests = 0;
const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const n = requests++;
    const duration = Number(process.env.FAKE_PART_SECS || 905);
    const words = [];
    for (let t = 0; t < duration; t += 2.5) {
      const who = Math.floor((t + n * 0) / 10) % 2; // relative to the part start
      const id = (n % 2 === 0 ? who : 1 - who);
      words.push({ text: `w${n}_${t}`, type: 'word', start: t, end: t + 0.4, speaker_id: `speaker_${id}` });
      words.push({ text: ' ', type: 'spacing', start: t + 0.4, end: t + 2.5, speaker_id: `speaker_${id}` });
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ language_code: 'heb', text: `part ${n}`, words, audio_duration_secs: duration }));
  });
});

async function run() {
  console.log('\n══ Long-session transcription ══\n');
  await new Promise((r) => server.listen(0, r));
  process.env.ELEVENLABS_STT_URL = `http://127.0.0.1:${server.address().port}/v1/speech-to-text`;
  process.env.ELEVENLABS_API_KEY = 'test';
  delete process.env.AI_MOCK;
  delete process.env.TRANSCRIPTION_MOCK;
  process.env.TRANSCRIPTION_SPLIT_THRESHOLD_SECS = String(20 * 60);
  const t = require('../services/ai/transcription.service');

  // ── planSegments ──
  console.log('── segment plan ──');
  const plan = t.planSegments(40 * 60);
  assert('40 min → 3 parts at 0/15/30 min, 15:05 each, last to the end',
    plan.length === 3 && plan[1].offset === 900 && plan[0].length === 905 && plan[2].length === null, JSON.stringify(plan));
  const tail = t.planSegments(30 * 60 + 30);
  assert('A 30s tail is folded into the previous part', tail.length === 2 && tail[1].length === null, JSON.stringify(tail));
  assert('Short audio → one part', t.planSegments(120).length === 1);

  // ── mergeParts: speaker ids swapped in part 2 ──
  console.log('── merge ──');
  const w = (text, start, speaker) => ({ text, type: 'word', start, end: start + 0.5, speaker_id: speaker });
  const sp = (start, speaker) => ({ text: ' ', type: 'spacing', start: start + 0.5, end: start + 0.6, speaker_id: speaker });
  const part0 = { offset: 0, words: [w('שלום', 1, 'speaker_0'), sp(1, 'speaker_0'), w('מה', 8, 'speaker_1'), sp(8, 'speaker_1'),
    w('כפול1', 10.2, 'speaker_1'), sp(10.2, 'speaker_1'), w('כפול2', 13.5, 'speaker_1')] };
  // part 1 starts at 10s; the same person (speaker_1 above) is "speaker_0" here
  const part1 = { offset: 10, words: [w('כפול1', 0.2, 'speaker_0'), sp(0.2, 'speaker_0'), w('כפול2', 3.5, 'speaker_0'), sp(3.5, 'speaker_0'),
    w('תשובה', 6, 'speaker_1'), sp(6, 'speaker_1'), w('המשך', 9, 'speaker_0')] };
  const merged = t.mergeParts([part0, part1]);
  const words = merged.filter((x) => x.type === 'word');
  assert('Overlap words appear once', words.map((x) => x.text).join(' ') === 'שלום מה כפול1 כפול2 תשובה המשך', words.map((x) => x.text).join(' '));
  assert('Times are on the session timeline', words.find((x) => x.text === 'תשובה').start === 16);
  assert('Swapped ids are mapped back (same person, same id)',
    words.find((x) => x.text === 'המשך').speaker_id === 'speaker_1' && words.find((x) => x.text === 'תשובה').speaker_id === 'speaker_0',
    JSON.stringify(words.map((x) => [x.text, x.speaker_id])));
  const segs = t.buildSegments(merged);
  assert('Merged segments keep two consistent speakers',
    segs.map((s) => s.speaker).join('|') === 'דובר 1|דובר 2|דובר 1|דובר 2', JSON.stringify(segs));

  if (!t.hasFfmpeg()) {
    console.log('  (ffmpeg not found: audio checks skipped)');
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tlong-'));
    try {
      // ── ffmpeg: 40 minutes of stereo 44.1kHz WAV (~420MB would be the real size; we use a tone at low rate) ──
      console.log('── ffmpeg ──');
      const src = path.join(work, 'session.wav');
      const gen = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000:duration=2400',
        '-ac', '2', src]);
      assert('Generated a 40 minute test file', gen.status === 0, String(gen.stderr));
      const prep = await t.prepareAudio(src, work);
      const srcMb = fs.statSync(src).size / 1048576;
      const outMb = fs.statSync(prep.path).size / 1048576;
      assert('Compressed to mono Opus, duration kept', Math.abs(prep.durationSecs - 2400) < 2, String(prep.durationSecs));
      assert(`Compressed size is speech-sized (${srcMb.toFixed(0)}MB → ${outMb.toFixed(1)}MB)`, outMb < 12 && outMb < srcMb / 5);
      const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,codec_name', '-of', 'csv=p=0', prep.path]);
      assert('Output is opus, 1 channel', String(probe.stdout).trim() === 'opus,1', String(probe.stdout));

      const parts = await t.splitAudio(prep.path, prep.durationSecs, work);
      const durs = [];
      for (const p of parts) {
        const d = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p.path]);
        durs.push(Number.parseFloat(String(d.stdout)));
      }
      assert('Split into 3 parts with 5s overlap (≈905/905/600s)',
        parts.length === 3 && Math.abs(durs[0] - 905) < 2 && Math.abs(durs[1] - 905) < 2 && Math.abs(durs[2] - 600) < 2, JSON.stringify(durs));

      // ── split accuracy: a beep at 900.3s must sit at 0.3s in part 2 (the merge assumes exact offsets) ──
      const beepSrc = path.join(work, 'beep.wav');
      spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=16000:duration=1000',
        '-af', "volume=enable='not(between(t,900.3,900.5))':volume=0", beepSrc]);
      const beepDir = fs.mkdtempSync(path.join(work, 'beep-'));
      const beepPrep = await t.prepareAudio(beepSrc, beepDir);
      const beepParts = await t.splitAudio(beepPrep.path, beepPrep.durationSecs, beepDir);
      const beepAt = (file) => {
        const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']);
        return Number((String(r.stderr).match(/silence_end: ([\d.]+)/) || [])[1]);
      };
      const whole = beepAt(beepPrep.path);
      const inPart = beepAt(beepParts[1].path);
      assert('Parts start exactly at their offset (beep 900.3s → same place in part 2)',
        Math.abs((whole - 900) - inPart) < 0.05, `whole ${whole}, part ${inPart}`);

      // ── full path: over threshold → split, progress, merged transcript ──
      console.log('── transcribeLong ──');
      const progress = [];
      requests = 0;
      const result = await t.transcribeLong(src, { mimeType: 'audio/wav', fileName: 'session.wav', onProgress: (a, b) => progress.push(`${a}/${b}`) });
      assert('3 requests, progress 0/0 → 1/3 → 2/3 → 3/3', requests === 3 && progress.join(',') === '0/0,1/3,2/3,3/3', progress.join(','));
      assert('Reports parts and measured duration', result.parts === 3 && Math.abs(result.durationSecs - 2400) < 2);
      const speakersAt = (sec) => result.segments.find((s) => s.start <= sec && s.end >= sec - 0.5)?.speaker;
      // the fake speaker alternates every 10s from the part start; parts start on 10s multiples, so the
      // true speaker at time T is floor(T/10)%2 everywhere: after alignment the label must follow it
      const consistent = [905, 1805, 2205].every((sec) => speakersAt(sec) === speakersAt(sec % 20 < 10 ? 0.5 : 10.5));
      assert('Speaker labels stay consistent across parts despite swapped ids', consistent,
        JSON.stringify([905, 1805, 2205].map((s) => [s, speakersAt(s)])));
      const tokens = result.text.split(/\s+/).filter((x) => /^w\d/.test(x)).map((x) => Number(x.split('_')[1]) + [0, 900, 1800][Number(x.slice(1).split('_')[0])]);
      const dupes = tokens.length - new Set(tokens).size;
      assert('No duplicated words from the overlap', dupes === 0, `${dupes} dupes`);
      assert('Temp files cleaned up', !fs.readdirSync(os.tmpdir()).some((f) => f.startsWith('transcribe-') && fs.statSync(path.join(os.tmpdir(), f)).mtimeMs > Date.now() - 60000));

      // under threshold → one request
      requests = 0;
      process.env.FAKE_PART_SECS = '600';
      const short = path.join(work, 'short.wav');
      spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000:duration=600', short]);
      const one = await t.transcribeLong(short, { mimeType: 'audio/wav', fileName: 'short.wav' });
      assert('Under the threshold → a single request (speakers untouched)', requests === 1 && one.parts === 1);
      requests = 0;
      process.env.FAKE_PART_SECS = '905';
      const forced = await t.transcribeLong(src, { mimeType: 'audio/wav', fileName: 'session.wav', forceSplit: true });
      assert('forceSplit (retry after a failed single request) splits', requests === 3 && forced.parts === 3);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  server.close();
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('[FATAL]', e); server.close(); process.exit(1); });
