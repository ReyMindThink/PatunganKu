// Posisi (x) dan lebar tiap batang pada kanvas 200 x 48.
const BARS: ReadonlyArray<readonly [number, number]> = [
  [0, 4.31], [11.207, 1.724], [18.965, 5.172], [31.897, 1.724], [40.517, 6.034],
  [50.862, 4.31], [59.483, 8.621], [70.69, 4.31], [81.034, 1.724], [91.379, 4.31],
  [101.724, 6.897], [113.793, 1.724], [120.69, 5.172], [130.172, 2.587], [138.793, 2.586],
  [147.414, 10.345], [163.793, 6.897], [176.724, 0.862], [183.621, 5.172], [192.241, 1.725],
  [198.276, 1.724],
];

/** Barcode dekoratif; warnanya mengikuti `color` elemen induk. */
export function Barcode({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 48"
      preserveAspectRatio="none"
      fill="currentColor"
      aria-hidden="true"
    >
      {BARS.map(([x, width]) => (
        <rect key={x} x={x} y={0} width={width} height={48} />
      ))}
    </svg>
  );
}
