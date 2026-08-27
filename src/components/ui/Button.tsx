import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Düğme türü.
 *
 * `primary` yalnızca ödemeyi başlatan eylem içindir — emerald'in anlamı
 * "geçişe izin ver" olduğu için her düğmeye dağıtılmaz. Geri kalan her şey
 * `secondary` (kutulu, nötr) ya da `ghost` (çerçevesiz, ikincil eylem).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-bg font-black hover:brightness-110 ' +
    'disabled:bg-surface-2 disabled:text-dim disabled:brightness-100',
  secondary:
    'bg-surface-2 text-text border border-border hover:border-border-strong ' +
    'disabled:text-dim',
  ghost:
    'bg-transparent text-muted hover:text-text disabled:text-dim',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-label',
  md: 'px-4 py-2 text-label',
  lg: 'w-full py-5 text-subhead',
};

/**
 * Arayüzdeki tek düğme biçimi.
 *
 * Her bileşenin kendi düğme görünümünü tanımlaması, aynı işlevin farklı
 * yerlerde farklı görünmesine yol açıyordu.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /*
   * Bu projede @types/react kurulu değil, dolayısıyla JSX çocukları
   * prop tipine otomatik eklenmiyor; zorunlu bırakılırsa her kullanım
   * "children eksik" hatası verir. (Toast.tsx'in FC<...> kullanmasının
   * sebebi de aynı eksiklik.)
   */
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        'uppercase tracking-widest rounded-sm transition-all ' +
        'active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ' +
        'disabled:active:scale-100 flex items-center justify-center gap-2 ' +
        `${VARIANTS[variant]} ${SIZES[size]} ${className}`
      }
    >
      {children}
    </button>
  );
}
