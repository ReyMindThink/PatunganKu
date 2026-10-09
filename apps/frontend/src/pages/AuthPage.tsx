import { useState } from "react";
import { AuthForm } from "../components/AuthForm";
import { Button } from "../components/Button";
import { Receipt } from "../components/Receipt";
import { Rings } from "../components/Rings";
import { receiptItems } from "../data/mock";
import type { AuthScreen } from "../types";
import "./AuthPage.css";

function Hero() {
  return (
    <section className="hero">
      <p className="hero__eyebrow">Snap, Split, Settle!</p>
      <h1 className="hero__title">PatunganKu</h1>
      <p className="hero__text">
        Split bill anti drama, dari struk sampai lunas, dihitung otomatis dan transparan buat semua.
      </p>
    </section>
  );
}

export function AuthPage({ onComplete }: { onComplete: () => void }) {
  const [screen, setScreen] = useState<AuthScreen>("start");

  const panelClass = (name: AuthScreen) =>
    `auth__panel auth__panel--${name}${screen === name ? " is-visible" : ""}`;

  return (
    <main className={`auth auth--${screen}`}>
      <Rings />

      <div className="auth__stage">
        <Receipt items={receiptItems} />
        <Hero />

        <div className="auth__panels">
          <div className={panelClass("start")}>
            <Button onClick={() => setScreen("register")}>Gabung Sekarang</Button>
            <Button variant="link" onClick={() => setScreen("login")}>
              Aku Sudah Punya Akun
            </Button>
          </div>

          <div className={panelClass("register")}>
            <AuthForm mode="register" onComplete={onComplete} />
          </div>

          <div className={panelClass("login")}>
            <AuthForm mode="login" onComplete={onComplete} />
          </div>
        </div>
      </div>
    </main>
  );
}
