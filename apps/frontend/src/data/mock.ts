import type { Group, ReceiptItem, User } from "../types";

// Data contoh untuk tampilan. Ganti dengan data dari API backend jika sudah terhubung.

export const currentUser: User = { name: "Cici" };

export const receiptItems: ReceiptItem[] = [
  { quantity: 2, name: "Sabun Cuci Piring", price: 30000 },
  { quantity: 1, name: "Detergen Bubuk", price: 45000 },
  { quantity: 2, name: "Minyak Goreng (2 Liter)", price: 70000 },
  { quantity: 1, name: "Beras Premium (5 kg)", price: 75000 },
  { quantity: 3, name: "Tisu Wajah", price: 36000 },
  { quantity: 1, name: "Pembersih Lantai", price: 18000 },
  { quantity: 2, name: "Pasta Gigi", price: 24000 },
  { quantity: 1, name: "Sabun Mandi Cair", price: 32000 },
  { quantity: 2, name: "Galon", price: 40000 },
];

export const groups: Group[] = [
  {
    id: "trip-jogja-solo",
    name: "Trip Jogja - Solo",
    members: ["Cici", "Bintang", "Rasyid"],
    balance: 125000,
  },
  {
    id: "kos-putri",
    name: "Kos Putri",
    members: ["Cici", "Nisrina", "Rindu"],
    balance: -48000,
  },
  {
    id: "kkn-banda-neira",
    name: "KKN Banda Neira",
    members: ["Cici", "Anton", "Jojo", "Valen", "Nada"],
    balance: 0,
  },
  {
    id: "open-trip-bromo",
    name: "Open Trip Bromo",
    members: ["Cici", "Kayla", "Jojo"],
    balance: -215000,
  },
  {
    id: "belanja-bulanan",
    name: "Belanja Bulanan Kos",
    members: ["Cici", "Aya", "Nasya", "Chloe"],
    balance: 67500,
  },
];
