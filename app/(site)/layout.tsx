import MenuSite from '@/components/MenuSite';

export default function LayoutSite({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MenuSite />
      {children}
    </>
  );
}
