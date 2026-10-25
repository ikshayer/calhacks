import { MILLBROOK_SIZE } from '@/data/millbrook'

/**
 * What the answers are for, standing beside the questions.
 *
 * Onboarding asks for four things before showing anything in return, which is
 * the point at which people abandon a form. This panel is the return: it does
 * not change between steps, so it reads as the destination rather than as
 * commentary on the current field.
 *
 * The gradient is the one loud thing on these screens — everything else is
 * paper, hairlines and black text. Spending the colour here keeps the
 * questions themselves calm.
 *
 * The numbers are read from the resident data rather than written into the copy.
 */
export function NextPanel() {
  return (
    <aside className="relative overflow-hidden rounded-3xl text-white ring-1 ring-black/10 lg:sticky lg:top-12">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(115deg, #650030, #b3124a 55%, #ff4f17)' }}
      />
      {/* A little grain stops a large flat gradient reading as a default CSS
          wash. Cheap: one inline SVG turbulence, no shader, no extra request. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative px-6 pt-8 pb-7 md:px-8 md:pt-10">
        <h2 className="display text-[22px] leading-tight">What happens next</h2>

        <ul className="mt-5 space-y-4">
          <Item title={`${MILLBROOK_SIZE.total} residents react`}>
            Resident histories, personalities and habits inform each response in the digital simulation.
          </Item>
          <Item title="You watch it spread">
            See who shares it, who scrolls past, and where attention drops — second by second.
          </Item>
          <Item title="Nothing is published">
            Your video stays in this browser. No post, no upload, no audience that can see it.
          </Item>
        </ul>

        <p className="mt-6 border-t border-white/20 pt-4 text-[13.5px] leading-relaxed text-white/75">
          Explore predicted reactions in the digital simulation. You can change any of this later.
        </p>
      </div>
    </aside>
  )
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-[3px] grid size-6 shrink-0 place-items-center rounded-full bg-white/15 text-[12px] ring-1 ring-black/25"
      >
        ◦
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-relaxed text-white/80">{children}</span>
      </span>
    </li>
  )
}
