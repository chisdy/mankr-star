import * as React from "react"
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

type SearchInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** 点击清除时调用；传入后不再合成空 onChange，由调用方负责清空 value */
  onClear?: () => void
  clearAriaLabel: string
  containerClassName?: string
}

function SearchInput({
  className,
  containerClassName,
  value,
  onChange,
  onClear,
  clearAriaLabel,
  ref,
  ...props
}: SearchInputProps) {
  const hasValue = Boolean(value)

  const handleClear = () => {
    if (onClear) {
      onClear()
      return
    }
    onChange?.({
      target: { value: "" },
      currentTarget: { value: "" },
    } as React.ChangeEvent<HTMLInputElement>)
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...props}
        ref={ref}
        type="search"
        value={value}
        onChange={onChange}
        className={cn(
          "pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
          className,
        )}
      />
      {hasValue ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label={clearAriaLabel}
          disabled={props.disabled}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export { SearchInput }
export type { SearchInputProps }
