import { JetBrains_Mono, Outfit } from 'next/font/google';
import { CampaignBriefForm } from '@/components/campaign/campaign-brief-form';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Brand campaign creation page (KAN-26, US-003, AC-007, AC-008) — the v4
 * visual language shared with the dashboard and campaigns list. The shared
 * `CampaignBriefForm` is untouched; the `.bd-briefcard` shell reskins its
 * primitives through scoped CSS so the edit page keeps its own look until
 * it too moves to v4.
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

const STEPS: { title: string; note: string }[] = [
  {
    title: 'Draft the brief',
    note: 'Saved privately to your workspace — nothing is sent to creators yet.',
  },
  {
    title: 'Pick creators',
    note: 'Browse discovery and add creators to the campaign.',
  },
  {
    title: 'Send offers',
    note: 'Each creator receives the brief with your terms.',
  },
  {
    title: 'Fund accepted deals',
    note: 'Money is held until you approve the delivered work.',
  },
];

export default function NewCampaignPage() {
  return (
    <div className={cn('bd', bdSans.variable, bdMono.variable)}>
      <header
        className="bd-pagehead bd-pagehead--ruled bd-rise"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div>
          <p className="bd-eyebrow">Brand workspace</p>
          <h1 className="bd-h1">Create a campaign brief</h1>
          <p className="bd-idfacts">
            Set the budget, deliverables, and goal. You can add creators before
            sending offers.
          </p>
        </div>
      </header>

      <div
        className="bd-briefsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <section className="bd-briefcard">
          <CampaignBriefForm mode="create" />
        </section>

        <aside className="bd-caprail bd-briefrail">
          {STEPS.map((step, i) => (
            <div className="bd-railcell bd-briefstep" key={step.title}>
              <span className="bd-briefstepno bd-mono" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <span className="bd-briefsteptitle">{step.title}</span>
                <span className="bd-railn">{step.note}</span>
              </span>
            </div>
          ))}
          <p className="bd-railfoot">
            You can edit the brief any time before offers are sent.
          </p>
        </aside>
      </div>
    </div>
  );
}
