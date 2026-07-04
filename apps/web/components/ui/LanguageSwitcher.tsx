'use client';

import clsx from 'clsx';
import { useI18n, type Language } from '@/lib/i18n';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  const options: Array<{ value: Language; label: string }> = [
    { value: 'en', label: 'EN' },
    { value: 'zh', label: '中文' },
  ];

  return (
    <div className={clsx('inline-flex shrink-0 rounded border border-border/70 bg-bg-card/70 p-0.5', compact ? 'w-full' : '')} aria-label={t('Language')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLanguage(option.value)}
          className={clsx(
            'rounded px-2 py-1 text-[10px] font-semibold transition-colors',
            compact && 'flex-1',
            language === option.value
              ? 'bg-white/10 text-white'
              : 'text-slate-500 hover:text-slate-300'
          )}
          aria-pressed={language === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
