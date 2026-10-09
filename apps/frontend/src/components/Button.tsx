import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "link";
};

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return <button className={`btn btn--${variant} ${className}`.trim()} type={type} {...props} />;
}
