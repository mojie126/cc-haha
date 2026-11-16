import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { cx } from '@/lib/cx'
import { Dropdown } from './Dropdown'
import { FIELD_BASE_CLASSES, FIELD_SIZE_CLASSES, fieldStateClasses, type FieldSize } from './Input'

export type SelectOption<T extends string = string> = {
  value: T
  label: string
  disabled?: boolean
}

export type SelectFieldProps<T extends string = string> =
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'onChange' | 'value' | 'children' | 'type'> & {
    /**
     * Required. All 7 native selects in the app shipped without a label or an
     * `aria-label`, leaving them nameless in the accessibility tree.
     */
    label: string
    labelHidden?: boolean
    options: ReadonlyArray<SelectOption<T>>
    value: T
    onChange: (value: T) => void
    hint?: ReactNode
    error?: string
    size?: FieldSize
    containerClassName?: string
  }

/**
 * A single-select control that opens the shared card menu.
 *
 * The native `<select>` is deliberately gone: its option popup is drawn by the
 * operating system, so it cannot follow the app's themes or corners, and it was
 * the only control in Settings that still looked like a browser control. The
 * trigger keeps the field chrome, focus ring and error wiring; the list and its
 * keyboard handling belong to `Dropdown`.
 */
export function SelectField<T extends string = string>({
  label,
  labelHidden = false,
  options,
  value,
  onChange,
  hint,
  error,
  size = 'lg',
  className,
  containerClassName,
  id,
  disabled,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  ...props
}: SelectFieldProps<T>) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = `${selectId}-hint`
  const errorId = `${selectId}-error`
  const describedBy = error
    ? [errorId, ariaDescribedBy].filter(Boolean).join(' ') || undefined
    : hint
      ? [hintId, ariaDescribedBy].filter(Boolean).join(' ') || undefined
      : ariaDescribedBy
  const selectedLabel = options.find((option) => option.value === value)?.label ?? ''

  return (
    <div className={cx('flex flex-col gap-1', containerClassName)}>
      {!labelHidden && (
        <label htmlFor={selectId} className="text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </label>
      )}
      <Dropdown<T>
        items={options.map((option) => ({ ...option }))}
        value={value}
        onChange={onChange}
        label={label}
        width="max-content"
        maxHeight={320}
        className="w-full"
        trigger={(
          <button
            {...props}
            type="button"
            id={selectId}
            role="combobox"
            disabled={disabled}
            aria-label={ariaLabel ?? (labelHidden ? label : undefined)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cx(
              FIELD_BASE_CLASSES,
              FIELD_SIZE_CLASSES[size],
              fieldStateClasses(!!error),
              'flex cursor-pointer items-center justify-between gap-2 text-left',
              className,
            )}
          >
            <span className="min-w-0 truncate">{selectedLabel}</span>
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 text-[var(--color-text-tertiary)]"
            />
          </button>
        )}
      />
      {error
        ? <p id={errorId} role="alert" className="text-xs text-[var(--color-error)]">{error}</p>
        : hint
          ? <p id={hintId} className="text-xs text-[var(--color-text-tertiary)]">{hint}</p>
          : null}
    </div>
  )
}
