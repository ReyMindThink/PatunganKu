import { useEffect, useRef, useState } from "react";
import { GroupRow } from "../components/GroupRow";
import { IconButton } from "../components/IconButton";
import { currentUser, groups } from "../data/mock";
import type { NavigateFn } from "../types";
import "./HomePage.css";

export function HomePage({ navigate }: { navigate: NavigateFn }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Tutup menu saat klik di luar atau menekan Escape.
  useEffect(() => {
    if (!isMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!addRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <main className="home">
      <header className="home__header">
        <div className="home__brand">
          <img src="/assets/logo.svg" alt="" width={16} height={16} />
          <span>PatunganKu</span>
        </div>

        <div className="home__title-row">
          <h1 className="home__title">Hai, {currentUser.name}!</h1>

          <div className="home__add" ref={addRef}>
            <IconButton
              icon="/assets/plus-button.svg"
              label="Tambah grup"
              aria-expanded={isMenuOpen}
              aria-haspopup="true"
              onClick={() => setIsMenuOpen((open) => !open)}
            />
            <div className={`add-menu${isMenuOpen ? " is-open" : ""}`}>
              <button type="button" onClick={() => navigate("join", "down")}>
                Gabung ke grup
              </button>
              <button type="button" onClick={() => navigate("new", "down")}>
                Buat grup
              </button>
            </div>
          </div>
        </div>
      </header>

      {groups.length > 0 ? (
        <ul className="home__list" aria-label="Daftar grup">
          {groups.map((group) => (
            <GroupRow group={group} key={group.id} />
          ))}
        </ul>
      ) : (
        <div className="home__empty">
          <h2>Belum ada grup</h2>
          <p>Tekan tombol + untuk membuat grup baru atau gabung dengan kode dari temanmu.</p>
        </div>
      )}
    </main>
  );
}
