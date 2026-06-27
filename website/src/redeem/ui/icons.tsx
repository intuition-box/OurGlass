// OurGlass icon set — lightweight stroke icons. Ported from the design system.
import type { SVGProps } from 'react'

type IcProps = { d: string | string[]; size?: number; sw?: number } & Omit<SVGProps<SVGSVGElement>, 'd'>

const Ic = ({ d, size = 18, sw = 1.6, fill = 'none', ...p }: IcProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {Array.isArray(d) ? d.map((x, i) => <path key={i} d={x} />) : <path d={d} />}
  </svg>
)

type P = Partial<IcProps>

export const IconRepeat = (p: P) => <Ic d={['M3 7h12a4 4 0 0 1 4 4', 'M16 4l3 3-3 3', 'M21 17H9a4 4 0 0 1-4-4', 'M8 20l-3-3 3-3']} {...p} />
export const IconLock = (p: P) => <Ic d={['M6 10V8a6 6 0 0 1 12 0v2', 'M5 10h14v10H5z', 'M12 14v3']} {...p} />
export const IconCube = (p: P) => <Ic d={['M12 2 3 7v10l9 5 9-5V7l-9-5Z', 'M3 7l9 5 9-5', 'M12 12v10']} {...p} />
export const IconCheck = (p: P) => <Ic d="M5 12.5 10 17l9-10" {...p} />
export const IconArrowL = (p: P) => <Ic d={['M19 12H5', 'M11 6l-6 6 6 6']} {...p} />
export const IconExt = (p: P) => <Ic d={['M14 4h6v6', 'M20 4l-9 9', 'M18 13v6H5V6h6']} {...p} />
export const IconAlert = (p: P) => <Ic d={['M12 3 2 20h20L12 3Z', 'M12 10v4', 'M12 17h.01']} {...p} />
export const IconDoc = (p: P) => <Ic d={['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6M10 17h6']} {...p} />
