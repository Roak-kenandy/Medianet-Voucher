export default function Logo({ size = 40, className = '', framed = false }) {
  const img = (
    <img
      src="/medianet-logo.png"
      alt="Medianet"
      width={size}
      height={size}
      className={`brand-logo ${className}`}
    />
  );

  if (framed) {
    return <div className="logo-frame">{img}</div>;
  }

  return img;
}
