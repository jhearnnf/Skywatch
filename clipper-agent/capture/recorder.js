// Screen recorder built on CDP's screencast, not Playwright's recordVideo.
//
// recordVideo produces variable-framerate WebM whose timing drifts under load —
// exactly the conditions a WebGL game creates. Remotion composes on a fixed
// frame grid, so the two disagree and the clip slides out of sync with the
// narration.
//
// Screencast hands us individual frames with real timestamps. We keep those
// timestamps and let ffmpeg resample to constant 30fps, which stays honest
// about when things actually happened.

const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const FPS = 30;

// Read back what was actually written, rather than trusting the request.
function probeDimensions(file) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      file,
    ]);
    let out = '';
    ff.stdout.on('data', d => { out += d; });
    ff.on('error', () => resolve({ width: null, height: null, durationSec: null }));
    ff.on('exit', () => {
      const [w, h, d] = out.trim().split(/\s+/).map(Number);
      resolve({ width: w || null, height: h || null, durationSec: d || null });
    });
  });
}

async function record(page, { outPath, workDir, width, height, onFrame }) {
  await fs.mkdir(workDir, { recursive: true });

  const client = await page.context().newCDPSession(page);
  const frames = [];
  let stopped = false;

  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    // Acknowledge immediately or Chrome stops sending. Do it before any file
    // I/O so a slow disk cannot throttle the capture rate.
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (stopped) return;

    const index = frames.length;
    const file = path.join(workDir, `f${String(index).padStart(6, '0')}.jpg`);
    frames.push({ file, timestamp: metadata?.timestamp ?? Date.now() / 1000 });
    await fs.writeFile(file, Buffer.from(data, 'base64')).catch(() => {});
    onFrame?.(index);
  });

  // maxWidth/maxHeight are essential, not optional. Without them Chrome
  // screencasts at CSS pixel size — 432x768 — and silently throws away the
  // deviceScaleFactor that was the entire point of the viewport maths.
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    everyNthFrame: 1,
    maxWidth: width,
    maxHeight: height,
  });

  const started = Date.now();

  return {
    elapsed: () => Date.now() - started,
    async stop() {
      stopped = true;
      await client.send('Page.stopScreencast').catch(() => {});

      if (frames.length < 2) throw new Error('capture produced no frames');

      // Concat demuxer with per-frame durations preserves the real cadence.
      // A plain image sequence would assume every frame took exactly 1/30s,
      // which silently speeds up or slows down whatever actually happened.
      //
      // Screencast is change-driven: a page that stops animating stops sending
      // frames. So the LAST frame must be held until recording actually
      // stopped, or a 25-second run whose page went still after two seconds
      // produces a two-second video.
      const endedAt = Date.now() / 1000;
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = frames[i + 1];
        const until = next ? next.timestamp : endedAt;
        const dur = Math.max(0.001, until - frames[i].timestamp);
        lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`);
        lines.push(`duration ${dur.toFixed(6)}`);
      }
      // The demuxer ignores the final duration unless the last file repeats.
      lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);

      const listPath = path.join(workDir, 'frames.txt');
      await fs.writeFile(listPath, lines.join('\n'), 'utf8');

      await new Promise((resolve, reject) => {
        // Upscale to the delivery size here rather than trying to force the
        // browser to capture at it — see the framing note in handlers/capture.js.
        // lanczos because the source is UI: it keeps text edges crisp where
        // bilinear would smear them.
        const scale = (width && height)
          ? `,scale=${width}:${height}:flags=lanczos`
          : '';

        const ff = spawn('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-vf', `fps=${FPS}${scale},format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          outPath,
        ], { stdio: 'ignore' });
        ff.on('error', () => reject(new Error('ffmpeg not found on PATH - required to encode captures')));
        ff.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      });

      const { size } = await require('fs').promises.stat(outPath);
      // Measured, not assumed. Reporting the dimensions we *intended* is how
      // a 432x768 capture got recorded as 1080x1920 in the job result.
      const probed = await probeDimensions(outPath);
      return {
        path: outPath, frames: frames.length, bytes: size, fps: FPS,
        width: probed.width, height: probed.height, durationSec: probed.durationSec,
      };
    },
  };
}

module.exports = { record, FPS };
