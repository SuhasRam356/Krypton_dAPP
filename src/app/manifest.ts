import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Krypton dApp',
    short_name: 'Krypton',
    description: 'A decentralized encrypted messenger and crypto wallet demo.',
    start_url: '/chat',
    display: 'standalone',
    background_color: '#0d1117',
    theme_color: '#58a6ff',
    icons: [
      {
        src: '/window.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
