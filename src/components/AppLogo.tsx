import React, { useState } from 'react';
import freshVeggieLogoImg from '../assets/images/freshveggie_real_bag_logo_1795292735942.jpg';

interface AppLogoProps {
  size?: number;
  className?: string;
  roundedClassName?: string;
  alt?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  size = 40,
  className = '',
  roundedClassName = 'rounded-xl',
  alt = 'FreshVeggie real vegetable and fruit bag logo'
}) => {
  const [src, setSrc] = useState<string>('/app-logo.png');

  return (
    <div
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center overflow-hidden shrink-0 select-none ${roundedClassName} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => {
          if (src === '/app-logo.png') {
            setSrc('/pwa-512x512.png');
          } else if (src === '/pwa-512x512.png') {
            setSrc(freshVeggieLogoImg);
          }
        }}
        className="w-full h-full object-cover"
      />
    </div>
  );
};
