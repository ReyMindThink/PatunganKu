import { formatRupiah } from "../lib/format";
import type { ReceiptItem } from "../types";
import { Barcode } from "./Barcode";
import "./Receipt.css";

export function Receipt({ items }: { items: ReceiptItem[] }) {
  const total = items.reduce((sum, item) => sum + item.price, 0);

  return (
    <div className="receipt" role="img" aria-label="Ilustrasi struk belanja">
      <div className="receipt__paper" />
      <div className="receipt__content">
        <ul className="receipt__items">
          {items.map((item) => (
            <li className="receipt__row" key={item.name}>
              <span>{item.quantity}</span>
              <span className="receipt__name">{item.name}</span>
              <span>{formatRupiah(item.price)}</span>
            </li>
          ))}
        </ul>

        <hr className="receipt__rule receipt__rule--double receipt__rule--after-items" />

        <div className="receipt__total">
          <strong>TOTAL:</strong>
          <strong className="receipt__amount">{formatRupiah(total)}</strong>
        </div>

        <hr className="receipt__rule receipt__rule--after-total" />
        <Barcode className="receipt__barcode" />
        <hr className="receipt__rule receipt__rule--double receipt__rule--end" />
      </div>
    </div>
  );
}
