import type { ReactNode } from 'react';

/**
 * Kart tonu.
 *
 * `accent` ve `danger` süs değil durum bildirir: biri "ödendi / başarılı",
 * diğeri "başarısız". Nötr bir panel her zaman `default` olmalı.
 */
export type CardTone = 'default' | 'accent' | 'danger';

const TONES: Record<CardTone, string> = {
  default: 'bg-surface border-border',
  accent: 'bg-accent-surface border-accent-border',
  danger: 'bg-danger-surface border-danger-border',
};

/**
 * Arayüzdeki tek "kart" biçimi.
 *
 * Önceden aynı görsel desen dört dosyada dört ayrı utility dizisiyle
 * yazılmıştı ve zamanla birbirinden ayrışmıştı (farklı kenarlık renkleri,
 * farklı dolgular). Ortak bir sınıf yerine bileşen tercih edildi: global bir
 * `.card` sınıfı Tailwind utility'leriyle özgüllük yarışına girebilirdi.
 */
export default function Card({
  tone = 'default',
  className = '',
  children,
}: {
  tone?: CardTone;
  className?: string;
  /*
   * Bu projede @types/react kurulu değil, dolayısıyla JSX çocukları
   * prop tipine otomatik eklenmiyor; zorunlu bırakılırsa her kullanım
   * "children eksik" hatası verir. (Toast.tsx'in FC<...> kullanmasının
   * sebebi de aynı eksiklik.)
   */
  children?: ReactNode;
}) {
  return (
    <div className={`border rounded-sm p-4 ${TONES[tone]} ${className}`}>
      {children}
    </div>
  );
}
