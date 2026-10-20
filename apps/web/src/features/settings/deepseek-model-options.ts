export type DeepseekModelOption = { value: string; label: string }

/**
 * 已保存、但还没出现在官方名单里的模型必须一直留在选项表中。
 * 如果它只在「当前选中值不在名单里」时才挂上，用户一点官方模型该项就会被卸掉。
 * Base UI 发现选项数量变了、且当前值对不上时，会把值校正回打开页面时的模型。
 */
export function buildDeepseekModelOptions(input: {
  synced: readonly { id: string; name: string }[]
  savedModel: string | null | undefined
  draftModel: string | null | undefined
  builtin: readonly DeepseekModelOption[]
}): DeepseekModelOption[] {
  const options =
    input.synced.length > 0
      ? input.synced.map((model) => ({
          value: model.id,
          label: model.name || model.id,
        }))
      : [...input.builtin]

  const ensure = (model: string | null | undefined) => {
    if (!model || options.some((option) => option.value === model)) return
    options.unshift({ value: model, label: model })
  }

  ensure(input.savedModel)
  ensure(input.draftModel)
  return options
}
