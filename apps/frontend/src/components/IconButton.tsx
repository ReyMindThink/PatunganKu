import type { ButtonHTMLAttributes } from "react";
import "./IconButton.css";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: string;
  label: string;
};

export function IconButton({ icon, label, className = "", type = "button", ...props }: IconButtonProps) {
  return (
    <button className={`icon-button ${className}`.trim()} type={type} aria-label={label} {...props}>
      <img src={icon} alt="" />
    </button>
  );
}
