import { useState } from "react";

type AuthScreen = "start" | "register" | "login";
type Route = "auth" | "home" | "join" | "new";
type PushDirection = "none" | "up" | "down";

const receiptItems = [
  ["2", "Sabun Cuci Piring", "Rp30.000"],
  ["1", "Detergen Bubuk", "Rp45.000"],
  ["2", "Minyak Goreng (2 Liter)", "Rp70.000"],
  ["1", "Beras Premium (5 kg)", "Rp75.000"],
  ["3", "Tisu Wajah", "Rp36.000"],
  ["1", "Pembersih Lantai", "Rp18.000"],
  ["2", "Pasta Gigi", "Rp24.000"],
  ["1", "Sabun Mandi Cair", "Rp32.000"],
  ["2", "Galon", "Rp40.000"],
];

const groups = [
  "Trip Jogja - Solo",
  "Nama Grup",
  "Nama Grup",
  "Nama Grup",
  "Nama Grup",
  "Nama Grup",
  "Nama Grup",
];

function Receipt() {
  return (
    <div className="receipt" aria-label="Struk belanja">
      <img className="receipt-paper" src="/assets/receipt.svg" alt="" />
      <div className="receipt-items">
        {receiptItems.map(([quantity, name, price]) => (
          <div className="receipt-row" key={name}>
            <span>{quantity}</span>
            <span>{name}</span>
            <span>{price}</span>
          </div>
        ))}
      </div>

      <img className="receipt-line receipt-line-top-a" src="/assets/receipt-line.svg" alt="" />
      <img className="receipt-line receipt-line-top-b" src="/assets/receipt-line.svg" alt="" />
      <div className="receipt-total">
        <strong>TOTAL:</strong>
        <strong>Rp456.000</strong>
      </div>
      <img className="receipt-line receipt-line-mid" src="/assets/receipt-line.svg" alt="" />
      <img className="barcode" src="/assets/barcode.svg" alt="" />
      <img className="receipt-line receipt-line-bottom-a" src="/assets/receipt-line.svg" alt="" />
      <img className="receipt-line receipt-line-bottom-b" src="/assets/receipt-line.svg" alt="" />
    </div>
  );
}

function Hero() {
  return (
    <section className="hero">
      <p className="eyebrow">Snap, Split, Settle!</p>
      <h1>PatunganKu</h1>
      <p className="description">
        Split bill anti drama, dari struk sampai lunas, dihitung otomatis dan transparan buat semua.
      </p>
    </section>
  );
}

type FieldProps = {
  icon: string;
  label: string;
  name: string;
  placeholder: string;
  type?: "email" | "password" | "text";
};

function Field({ icon, label, name, placeholder, type = "text" }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-shell">
        <img src={icon} alt="" />
        <input name={name} placeholder={placeholder} type={type} />
      </span>
    </label>
  );
}

function AuthForm({
  screen,
  onComplete,
}: {
  screen: Exclude<AuthScreen, "start">;
  onComplete: () => void;
}) {
  const isRegister = screen === "register";

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onComplete();
      }}
    >
      {isRegister && (
        <Field icon="/assets/user-icon.svg" label="Nama" name="name" placeholder="John Doe" />
      )}
      <Field
        icon="/assets/email-icon.svg"
        label="Email"
        name="email"
        placeholder="JohnDoe@gmail.com"
        type="email"
      />
      <Field
        icon="/assets/lock-icon.svg"
        label="Password"
        name="password"
        placeholder="********"
        type="password"
      />
      <button className="primary-button form-button" type="submit">
        {isRegister ? "Gabung Sekarang" : "Masuk"}
      </button>
    </form>
  );
}

function AuthPage({ onComplete }: { onComplete: () => void }) {
  const [screen, setScreen] = useState<AuthScreen>("start");

  return (
    <main className={`app app-${screen}`}>
      <img className="background-rings" src="/assets/background-rings.svg" alt="" />

      <div className="experience">
        <Receipt />
        <Hero />

        <div className={`panel start-panel ${screen === "start" ? "is-visible" : ""}`}>
          <button className="primary-button" type="button" onClick={() => setScreen("register")}>
            Gabung Sekarang
          </button>
          <button className="login-link" type="button" onClick={() => setScreen("login")}>
            Aku Sudah Punya Akun
          </button>
        </div>

        <div className={`panel form-panel register-panel ${screen === "register" ? "is-visible" : ""}`}>
          <AuthForm screen="register" onComplete={onComplete} />
        </div>

        <div className={`panel form-panel login-panel ${screen === "login" ? "is-visible" : ""}`}>
          <AuthForm screen="login" onComplete={onComplete} />
        </div>
      </div>
    </main>
  );
}

function GroupRow({ name }: { name: string }) {
  return (
    <article className="group-row">
      <div className="group-avatar" />
      <div className="group-copy">
        <div className="group-heading">
          <h2>{name}</h2>
          <span>+Rpx.xxx.xxx</span>
        </div>
        <p>Member 1, Member 2, Member 3</p>
      </div>
    </article>
  );
}

function HomePage({ navigate }: { navigate: (route: Route, direction: PushDirection) => void }) {
  const [isAddOpen, setIsAddOpen] = useState(false);

  return (
    <main className="home-page" onClick={() => isAddOpen && setIsAddOpen(false)}>
      <header className="home-header">
        <div className="brand">
          <img src="/assets/logo.svg" alt="" />
          <span>PatunganKu</span>
        </div>
        <h1>Hai, Aqidatul!</h1>
        <button
          className="round-icon plus-button"
          type="button"
          aria-label="Tambah grup"
          aria-expanded={isAddOpen}
          onClick={(event) => {
            event.stopPropagation();
            setIsAddOpen((open) => !open);
          }}
        >
          <img src="/assets/plus-button.svg" alt="" />
        </button>
      </header>

      <section className="group-list" aria-label="Daftar grup">
        {groups.map((group, index) => (
          <GroupRow name={group} key={`${group}-${index}`} />
        ))}
      </section>

      <div
        className={`add-menu ${isAddOpen ? "is-open" : ""}`}
        aria-hidden={!isAddOpen}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={() => navigate("join", "down")}>
          Gabung ke grup
        </button>
        <button type="button" onClick={() => navigate("new", "down")}>
          Buat grup
        </button>
      </div>
    </main>
  );
}

function GroupPage({
  mode,
  onBack,
}: {
  mode: "join" | "new";
  onBack: () => void;
}) {
  const isJoin = mode === "join";

  return (
    <main className="group-page">
      <img className="group-rings" src="/assets/group-rings.svg" alt="" />
      <button className="round-icon back-button" type="button" aria-label="Kembali" onClick={onBack}>
        <img src="/assets/back-button.svg" alt="" />
      </button>

      <form className="group-form" onSubmit={(event) => event.preventDefault()}>
        <h1>{isJoin ? "Gabung ke Grup" : "Buat Grup"}</h1>
        <Field
          icon="/assets/group-icon.svg"
          label={isJoin ? "Kode Grup" : "Nama Grup"}
          name={isJoin ? "group-code" : "group-name"}
          placeholder={isJoin ? "******" : "ex: Trip Jawa Bali"}
          type={isJoin ? "password" : "text"}
        />
        <button className="primary-button" type="submit">
          {isJoin ? "Gabung" : "Buat Grup"}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>("auth");
  const [direction, setDirection] = useState<PushDirection>("none");
  const [transitionKey, setTransitionKey] = useState(0);

  function navigate(nextRoute: Route, nextDirection: PushDirection) {
    setDirection(nextDirection);
    setTransitionKey((key) => key + 1);
    setRoute(nextRoute);
  }

  return (
    <div className="route-viewport">
      <div className={`route route-push-${direction}`} key={`${route}-${transitionKey}`}>
        {route === "auth" && <AuthPage onComplete={() => navigate("home", "up")} />}
        {route === "home" && <HomePage navigate={navigate} />}
        {route === "join" && <GroupPage mode="join" onBack={() => navigate("home", "up")} />}
        {route === "new" && <GroupPage mode="new" onBack={() => navigate("home", "up")} />}
      </div>
    </div>
  );
}
