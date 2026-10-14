import { Link } from 'react-router-dom';

// The AgapSense brand, shown once per page in the red top bar of every
// portal (the sidebars are navigation only). Links to the portal's home.
export const BrandMark = ({ homePath }: { homePath: string }) => (
  <Link to={homePath} className="flex items-center gap-2 min-w-0 shrink-0" aria-label="AgapSense home">
    <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
      <svg width="16" height="20" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
        <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
      </svg>
    </span>
    <span className="text-white font-bold text-xl sm:text-2xl md:text-[28px] leading-7 tracking-[-0.03em] whitespace-nowrap">
      AgapSense
    </span>
    <span className="hidden lg:inline-block w-px h-5 bg-white/40 mx-3"></span>
    <span className="hidden lg:inline text-white/80 font-bold text-[10px] tracking-[0.1em] uppercase whitespace-nowrap">
      Smarter detection, faster response
    </span>
  </Link>
);
