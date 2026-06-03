// https://apps.timwhitlock.info/emoji/tables/unicode
export function getRandomEmoji() {
  const emoticons = [0x1f600, 0x1f64f];
  const transport = [0x1f680, 0x1f6c0];
  const objects = [0x1f300, 0x1f530];
  const additional = [0x1f5fb, 0x1f636];
  const additional2 = [0x1f681, 0x1f6c5];
  const additional3 = [0x1f30d, 0x1f52d];

  const ranges = [emoticons, transport, objects, additional, additional2, additional3];

  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return String.fromCodePoint(range[0] + Math.floor(Math.random() * (range[1] - range[0])));
}
