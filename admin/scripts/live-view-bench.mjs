#!/usr/bin/env node
/**
 * Live View bandwidth comparison (synthetic).
 * Measures Base64-JSON overhead vs binary TLV1 for the same JPEG payloads.
 * Does not invent WebRTC/VPS CPU numbers — run a live session for those.
 */
import { encodeLiveViewBinaryFrame } from '../shared/live-view/binary.ts';

function makeFakeJpeg(size) {
  const buf = new Uint8Array(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;
  for (let i = 2; i < buf.length - 2; i++) buf[i] = (i * 17) & 0xff;
  return buf;
}

function jsonBase64FrameSize(jpeg, sessionId) {
  const dataBase64 = Buffer.from(jpeg).toString('base64');
  const msg = JSON.stringify({
    type: 'live-view:frame',
    data: {
      sessionId,
      mimeType: 'image/jpeg',
      dataBase64,
      capturedAt: new Date().toISOString(),
      privacyBlocked: false,
    },
  });
  return Buffer.byteLength(msg, 'utf8');
}

const sessionId = '11111111-2222-3333-4444-555555555555';
const sizes = [12_000, 28_000, 55_000, 90_000];
const fpsByPreset = { low: 2, medium: 2.5, high: 3.5 };

console.log('Live View synthetic bandwidth bench');
console.log('===================================');

for (const jpegSize of sizes) {
  const jpeg = makeFakeJpeg(jpegSize);
  const legacy = jsonBase64FrameSize(jpeg, sessionId);
  const binary = encodeLiveViewBinaryFrame({
    sessionId,
    capturedAtMs: Date.now(),
    width: 720,
    height: 405,
    jpeg,
  }).byteLength;
  const savings = ((legacy - binary) / legacy) * 100;
  console.log(`\nJPEG payload: ${jpegSize} bytes`);
  console.log(`  Old Base64 JSON WS frame: ${legacy} bytes`);
  console.log(`  New binary TLV1 frame:    ${binary} bytes`);
  console.log(`  Savings vs Base64 JSON:   ${savings.toFixed(1)}%`);

  for (const [preset, fps] of Object.entries(fpsByPreset)) {
    const legacyPerMin = (legacy * fps * 60) / (1024 * 1024);
    const binaryPerMin = (binary * fps * 60) / (1024 * 1024);
    console.log(
      `  ${preset} @ ${fps} fps → legacy ${legacyPerMin.toFixed(2)} MB/min, binary ${binaryPerMin.toFixed(2)} MB/min`
    );
  }
}

console.log('\nNote: WebRTC bitrate is network-adaptive; measure with getStats() in a live session.');
console.log('VPS CPU/memory: compare relay of binary frames vs Base64 JSON parse/stringify under load.');
