import type { ReactNode } from "react";

/** Display frame: petrol/cyan band on top, light surface below, panels overlap the edge. */
export default function Layout(props: { children: ReactNode }) {
  const logo = `${import.meta.env.BASE_URL}wri-logo-white.svg`;
  return (
    <div className="relative flex flex-col w-screen min-h-screen bg-wri-light text-wri-petrol overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[46vh] bg-wri-band">
        <div className="absolute inset-0 bg-blueprint" />
      </div>

      <header className="relative z-10 px-16 pt-10 flex items-center justify-between">
        <img src={logo} alt="Walter Reis Institut" className="h-14 w-auto" />
        <span className="text-2xl font-bold text-white/80">Vier Gewinnt gegen den RV6L</span>
      </header>
      <main className="relative z-10 flex-1 flex items-center justify-center px-16 pb-4">
        {props.children}
      </main>
      <footer className="relative z-10 px-16 py-6 text-xl text-wri-grey">
        Walter Reis Institut für Technologie, Obernburg
      </footer>
    </div>
  );
}
