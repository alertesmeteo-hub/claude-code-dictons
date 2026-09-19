import MenuSite from '@/components/MenuSite';

export default function LayoutSite({ children }: { children: React.ReactNode }) {
  return (
    <>
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
