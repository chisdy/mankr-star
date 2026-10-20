import { cn } from "@workspace/ui/lib/utils"

import brandMark from "@/assets/brand-mark.json"

type BrandLogoProps = {
  className?: string
  /** 传给内部 svg 的尺寸类，默认 `size-5` */
  iconClassName?: string
  title?: string
}

/** Mankr Star 品牌图标：R2 B「明显加粗」，跟随 `currentColor`。 */
export function BrandLogo({
  className,
  iconClassName,
  title = "Mankr Star",
}: BrandLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        className
      )}
      role="img"
      aria-label={title}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={brandMark.viewBox}
        className={cn("block size-5 shrink-0", iconClassName)}
        aria-hidden
        focusable="false"
      >
        <path
          d={brandMark.path}
          fill="currentColor"
          fillRule="evenodd"
          stroke="currentColor"
          strokeWidth={brandMark.strokeWidth}
          strokeLinejoin="bevel"
        />
      </svg>
    </span>
  )
}
