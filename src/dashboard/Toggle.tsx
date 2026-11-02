interface Props {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

export function Toggle({ label, checked, disabled, onChange }: Props) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
