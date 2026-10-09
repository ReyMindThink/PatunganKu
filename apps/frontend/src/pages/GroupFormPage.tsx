import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { IconButton } from "../components/IconButton";
import { Rings } from "../components/Rings";
import "./GroupFormPage.css";

type GroupFormPageProps = {
  mode: "join" | "new";
  onBack: () => void;
};

export function GroupFormPage({ mode, onBack }: GroupFormPageProps) {
  const isJoin = mode === "join";

  return (
    <main className="group-form-page">
      <Rings />
      <IconButton
        className="group-form-page__back"
        icon="/assets/back-button.svg"
        label="Kembali"
        onClick={onBack}
      />

      <form className="group-form" onSubmit={(event) => event.preventDefault()}>
        <h1 className="group-form__title">{isJoin ? "Gabung ke Grup" : "Buat Grup"}</h1>
        <Field
          icon="/assets/group-icon.svg"
          label={isJoin ? "Kode Grup" : "Nama Grup"}
          name={isJoin ? "group-code" : "group-name"}
          placeholder={isJoin ? "Contoh: AB12CD" : "Contoh: Trip Jawa Bali"}
          autoCapitalize={isJoin ? "characters" : "words"}
          autoComplete="off"
          required
        />
        <Button type="submit">{isJoin ? "Gabung" : "Buat Grup"}</Button>
      </form>
    </main>
  );
}
