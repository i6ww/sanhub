import assert from 'node:assert/strict';
import {
  normalizeAspectRatio,
  resolveGeminiCompatibleImageSize,
  resolveImageSize,
} from '../lib/image-sizing';

assert.equal(normalizeAspectRatio('16：9'), '16:9');
assert.equal(normalizeAspectRatio(' １６ ： ９ '), '16:9');

assert.equal(
  resolveGeminiCompatibleImageSize({ aspectRatio: '16：9', imageSize: '2K' }, '16:9'),
  '2048x1152'
);

assert.deepEqual(
  {
    ...resolveImageSize('2048x2048'),
    aspectRatio: normalizeAspectRatio('16：9') || resolveImageSize('2048x2048').aspectRatio,
  },
  { size: '2048x2048', aspectRatio: '16:9' }
);

console.log('image sizing verification passed');
