export function round(num: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(num * multiplier) / multiplier;
}

export function roundArr(arr: number[], decimals: number) {
  return arr.map((num) => round(num, decimals));
}
