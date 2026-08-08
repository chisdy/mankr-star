import { cn } from "@workspace/ui/lib/utils"

type BrandLogoProps = {
  className?: string
  /** 传给内部 svg 的尺寸类，默认 `size-5` */
  iconClassName?: string
  title?: string
}

/** Mankr Star 品牌图标，颜色跟随 `currentColor` */
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
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cn("block size-5 shrink-0", iconClassName)}
        aria-hidden
      >
        <path d="M21.1,7.5c-1.1-.2-2.8-.3-3.9-.7C14.6,5.9,15,.1,11.7.3c-2,.4-2.6,4-3.7,5.6-.9,1.4-2.3,2.6-2.5,4.4,0-1.3.2-2.3.9-3.4-1.8.6-5.1.2-6.2,1.8-.9,1.5.5,2.8,1.5,3.8.7.7,1.4,1.3,2.1,2,1.2,1.3,2.1,2.7,3.7,3.4-1.2-.3-2.1-.8-3.1-1.6,0,1.1-.5,2.6-.7,3.7-1,4.7,2.2,4.3,5.2,2.2,1.4-.8,2.4-1.4,4-1.7.9-.2,1.9-.8,2.6-1.3-.8,1.1-1.4,1.5-2.6,2.1,1.9.7,5.3,4.2,6.9,1.6.7-1.4-.2-3.4-.4-4.8-.9-2.7.8-3.8,2.6-5.4,2.6-2,2.5-4.6-1.1-4.9ZM16.9,8.2c1.5.2-.8,1.6-1.1,2,0,0,0,0,0,0-.2-.3-.3-.4-.6-.6.3-.2,1.5-1.3,1.7-1.4ZM12.9,14.9c-1.6-.9-3.3-5-.5-5.3,3.6-.3,4.1,5,.5,5.3ZM14,7.2h0c0,0-.2,1.5-.2,1.7-.3-.1-.6,0-.9-.2,0-.2.1-.8.2-1.1.3-.2.5-.3.9-.4ZM8.9,17.1c-4.6-3.5-1.6-11.3,4.1-10.9-6.2,3.1-2.7,12.2,4,10.4-2.1,2.2-5.8,2.4-8.1.5ZM16.5,15.6c-.4-.3-.7-.5-1.1-.8.2-.3.3-.4.5-.7.5.4,1,.8,1.5,1.2-.3.1-.6.2-.9.3ZM18.7,12.4c-.4.3-1.8.1-2.4.2,0-.3,0-.6,0-.9.5,0,3.1-.4,2.4.7Z" />
      </svg>
    </span>
  )
}
