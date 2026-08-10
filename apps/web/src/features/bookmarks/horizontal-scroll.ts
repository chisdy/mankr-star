const SCROLL_STEP_RATIO = 0.7

export function getHorizontalScrollStep(
  clientWidth: number,
  direction: "left" | "right"
): number {
  const distance = clientWidth * SCROLL_STEP_RATIO
  return direction === "left" ? -distance : distance
}
