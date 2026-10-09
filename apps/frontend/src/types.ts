export type Route = "auth" | "home" | "join" | "new";
export type AuthScreen = "start" | "register" | "login";
export type PushDirection = "none" | "up" | "down";
export type NavigateFn = (route: Route, direction: PushDirection) => void;

export interface ReceiptItem {
  quantity: number;
  name: string;
  /** Harga total baris ini dalam rupiah. */
  price: number;
}

export interface Group {
  id: string;
  name: string;
  members: string[];
  /** Positif: orang lain berutang ke kamu. Negatif: kamu berutang. */
  balance: number;
}

export interface User {
  name: string;
}
