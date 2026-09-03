import { JetBrains_Mono, Outfit } from 'next/font/google';
import { cn } from '@/lib/utils';

/**
 * The v4 brand-surface shell, shared by every converted page: the scoped
 * `.bd` design layer (app/globals.css) with Outfit/JetBrains Mono wired
 * through the CSS variables the layer's tokens read. Server-safe — fonts are
 * module-scope constants and the shell renders plain elements.
 */

const bdSans = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bd-sans',
});
const bdMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-bd-mono',
});

export function BdShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bd', bdSans.variable, bdMono.variable, className)}>
      {children}
    </div>
  );
}

/** The v4 masthead: eyebrow, title, facts line, optional right-side actions. */
export function BdPageHead({
  eyebrow = 'Brand workspace',
  title,
  facts,
  actions,
  ruled = false,
  rise = 0,
}: {
  eyebrow?: string;
  title: string;
  /** The quiet line under the h1 — a sentence or a stat run. */
  facts?: React.ReactNode;
  actions?: React.ReactNode;
  /** Hairline under the masthead, for pages whose body starts immediately. */
  ruled?: boolean;
  rise?: number;
}) {
  return (
    <header
      className={cn('bd-pagehead bd-rise', ruled && 'bd-pagehead--ruled')}
      style={{ '--i': rise } as React.CSSProperties}
    >
      <div>
        <p className="bd-eyebrow">{eyebrow}</p>
        <h1 className="bd-h1">{title}</h1>
        {facts ? <p className="bd-idfacts">{facts}</p> : null}
      </div>
      {actions ? <div className="bd-headact">{actions}</div> : null}
    </header>
  );
}
