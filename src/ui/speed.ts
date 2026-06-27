/** Дискретные значения скорости: 0.1…1, затем 2…20 */
export const SPEED_STEPS: readonly number[] = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
]

export function speedToIndex(speed: number): number {
  const idx = SPEED_STEPS.indexOf(speed)
  return idx >= 0 ? idx : SPEED_STEPS.indexOf(1)
}

export function formatSpeed(speed: number): string {
  return speed < 1 ? speed.toFixed(1) : String(Math.round(speed))
}
