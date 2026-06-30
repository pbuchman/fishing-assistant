import type { ReactElement } from 'react';

export function MobileTabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="fa-mobile-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          aria-selected={tab.value === value}
          className={tab.value === value ? 'active' : undefined}
          key={tab.value}
          role="tab"
          type="button"
          onClick={() => {
            onChange(tab.value);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
