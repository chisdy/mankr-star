/**
 * 动效 token，移植自 beui.dev。
 * 默认的 ease-in / ease-out 观感偏弱，这里统一用自定义曲线与 spring 物理参数。
 */

export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

/** 按压反馈 */
export const SPRING_PRESS = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const

/** 内容互换：同一控件内的文字/图标换位 */
export const SPRING_SWAP = {
  type: "spring",
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const

/** 浮层入场 */
export const SPRING_PANEL = {
  type: "spring",
  stiffness: 420,
  damping: 40,
  mass: 0.5,
} as const

/** 共享布局滑移：列表项与指示器在位置之间形变 */
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const
