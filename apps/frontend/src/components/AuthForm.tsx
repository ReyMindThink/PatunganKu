import { Button } from "./Button";
import { Field } from "./Field";
import "./AuthForm.css";

type AuthFormProps = {
  mode: "register" | "login";
  onComplete: () => void;
};

export function AuthForm({ mode, onComplete }: AuthFormProps) {
  const isRegister = mode === "register";

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onComplete();
      }}
    >
      {isRegister && (
        <Field
          icon="/assets/user-icon.svg"
          label="Nama"
          name="name"
          placeholder="Nama lengkap"
          autoComplete="name"
          required
        />
      )}
      <Field
        icon="/assets/email-icon.svg"
        label="Email"
        name="email"
        type="email"
        placeholder="nama@email.com"
        autoComplete="email"
        required
      />
      <Field
        icon="/assets/lock-icon.svg"
        label="Password"
        name="password"
        type="password"
        placeholder="Minimal 8 karakter"
        autoComplete={isRegister ? "new-password" : "current-password"}
        minLength={isRegister ? 8 : undefined}
        required
      />
      <Button className="auth-form__submit" type="submit">
        {isRegister ? "Gabung Sekarang" : "Masuk"}
      </Button>
    </form>
  );
}
