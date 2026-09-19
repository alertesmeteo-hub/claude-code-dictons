import Script from 'next/script';
import MenuSite from '@/components/MenuSite';

export default function LayoutSite({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Statistiques respectueuses de la vie privée (Plausible) : pas de cookie. Admin exclue (hors de ce layout). */}
      <Script src="https://plausible.io/js/pa-71D7QRsgjbqxfWZDL2rY_.js" strategy="afterInteractive" />
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
      </Script>
      <MenuSite />
      {children}
      <footer className="pied-site">
        Dictons et proverbes du jour — module v{process.env.NEXT_PUBLIC_VERSION} du {process.env.NEXT_PUBLIC_DATE_BUILD} · ©{' '}
        {new Date().getFullYear()}{' '}
        <a href="https://www.alertes-meteo.com" rel="noopener">
          www.alertes-meteo.com
        </a>
      </footer>
    </>
  );
}
