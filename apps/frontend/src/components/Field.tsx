import type { InputHTMLAttributes } from "react";
import "./Field.css";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: string;
  label: string;
  name: string;
};

export function Field({ icon, label, ...inputProps }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <img className="field__icon" src={icon} alt="" />
        <input className="field__input" {...inputProps} />
      </span>
    </label>
  );
}
