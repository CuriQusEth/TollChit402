/**
 * TollChit402 markası.
 *
 * İşaret satır içi SVG, kelime markası gerçek metin: public/brand/'daki .svg
 * dosyası da aynı kilidi çiziyor ama oradaki metin sistem yazı tipine bağlı
 * olduğu için tarayıcıdan tarayıcıya kayabiliyor. Başlıkta gerçek metin
 * kullanmak hem her yerde aynı görünmesini sağlıyor hem de rengi token'lardan
 * almasına izin veriyor.
 *
 * Emerald yalnızca kalkmış kolda ve "402" hecesinde: logo, arayüzün geri
 * kalanıyla aynı kuralı izliyor — emerald "geçişe izin verildi" demek.
 */
export function LogoMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="TollChit402"
      fill="none"
    >
      {/* Zemin çizgisi */}
      <path
        d="M8 50h48"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Kalkmış bariyer kolu — geçiş verilmiş durum */}
      <g transform="rotate(-38 18 34)">
        <rect x="18" y="30" width="36" height="8" rx="2" fill="var(--color-accent)" />
        <path d="M27 30v8M36 30v8M45 30v8" stroke="var(--color-bg)" strokeWidth="3" />
      </g>

      {/* Menteşe */}
      <circle
        cx="18"
        cy="34"
        r="3"
        fill="var(--color-surface)"
        stroke="var(--color-accent)"
        strokeWidth="2"
      />

      {/* Direk üstündeki kontrol kutusu */}
      <rect
        x="10"
        y="14"
        width="16"
        height="14"
        rx="2"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.5"
      />
      <text
        x="18"
        y="24"
        fontSize="8"
        fontWeight="700"
        fill="var(--color-text)"
        textAnchor="middle"
        letterSpacing="0.5"
      >
        402
      </text>

      {/* Direk */}
      <rect
        x="15"
        y="28"
        width="6"
        height="22"
        fill="var(--color-surface-2)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Yatay kilit: işaret + kelime markası. */
export default function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="w-8 h-8 shrink-0" />
      <span className="text-subhead font-bold tracking-tight text-text">
        TollChit<span className="text-accent">402</span>
      </span>
    </span>
  );
}
