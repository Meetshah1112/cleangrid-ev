import type { Metadata } from 'next';
import { Azeret_Mono, Hedvig_Letters_Serif, Kalam, Schibsted_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/shell.css';
import './styles/scene.css';
import './styles/sections.css';
import './styles/charts.css';
import './styles/schedules.css';
import './styles/grid.css';
import './styles/impact.css';

/**
 * Four faces, each with one job. A sturdy serif for the headlines, a newsroom grotesk for
 * everything read, a mono only where the page shows what a machine received, and a hand for the
 * two notes written onto the forecast.
 */
const serif = Hedvig_Letters_Serif({ subsets: ['latin'], variable: '--font-hedvig', display: 'swap' });
const sans = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-schibsted', display: 'swap' });
const mono = Azeret_Mono({ subsets: ['latin'], variable: '--font-azeret', display: 'swap' });
const hand = Kalam({ subsets: ['latin'], weight: '400', variable: '--font-kalam', display: 'swap' });

export const metadata: Metadata = {
  title: 'CleanGrid console',
  description: 'Renewable-aware EV charging across a network of sites: the plan, the grid, and verified impact.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
