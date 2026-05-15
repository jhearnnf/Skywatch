// Shared backdrop for every CBAT scene — radar grid + amber radial wash.
// Pulled out so all 11+ scenes use one consistent foundation.
export default function CbatBg({ amber = false }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background:
          `radial-gradient(ellipse at 50% 55%, ${amber ? 'rgba(251,191,36,0.18)' : 'rgba(91,170,255,0.14)'}, transparent 70%),` +
          'linear-gradient(90deg, rgba(91,170,255,0.18) 1px, transparent 1px) 0 0/40px 40px,' +
          'linear-gradient(0deg, rgba(91,170,255,0.18) 1px, transparent 1px) 0 0/40px 40px,' +
          '#06101e',
      }}
    />
  )
}
