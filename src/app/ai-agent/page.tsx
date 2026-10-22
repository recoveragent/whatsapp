import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Languages,
  MessageCircleQuestion,
  PackageSearch,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserRoundCheck,
  Workflow,
} from 'lucide-react';
import { BrandLogo, BRAND_NAME } from '@/components/brand/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Public marketing page for the WhatsApp AI agent, aimed at Shopify
// brands. Not behind auth (src/proxy.ts only guards app paths) and,
// unlike the app, indexable. Every claim here maps to shipped behaviour
// in src/lib/ai — keep it that way when editing copy.

const TITLE = 'AI agent for Shopify brands on WhatsApp';
const DESCRIPTION =
  'An AI agent that answers product, policy and order questions on WhatsApp, recommends products with checkout links, and hands the chat to your team when it should. Trained on your Shopify store.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: { title: `${TITLE} — ${BRAND_NAME}`, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary', title: `${TITLE} — ${BRAND_NAME}`, description: DESCRIPTION },
};

const dashboardUrl = (
  process.env.NEXT_PUBLIC_RECOVER_AGENT_DASHBOARD_URL || 'https://dashboard.recoveragent.ai'
).replace(/\/+$/, '');
const GET_STARTED_URL = `${dashboardUrl}/?sso=wa`;
const DEMO_URL = process.env.NEXT_PUBLIC_AI_AGENT_DEMO_URL || null;

const FEATURES = [
  {
    icon: ShoppingBag,
    title: 'Sells from your catalog',
    body: 'Asks about occasion, recipient and budget, then sends a swipeable WhatsApp carousel of matching products with one-tap checkout links. Budgets and sizes are enforced against your synced Shopify catalog, never guessed.',
  },
  {
    icon: PackageSearch,
    title: 'Answers “where is my order?”',
    body: 'Looks up the customer’s recent Shopify orders, matched to the WhatsApp number they’re messaging from, and shares status and tracking links. It never reveals another customer’s order.',
  },
  {
    icon: MessageCircleQuestion,
    title: 'Knows your policies',
    body: 'Import your published Shopify policies in one click and add your own FAQs. Shipping times, COD, returns, refunds and exchanges are answered from your words, not invented.',
  },
  {
    icon: Languages,
    title: 'Speaks your customer’s language',
    body: 'Replies in the language the customer writes in, including Hindi, Tamil and the mixed Hinglish or Tanglish your customers actually use.',
  },
  {
    icon: UserRoundCheck,
    title: 'Hands off at the right moment',
    body: 'Damaged parcel, refund request, an upset customer, or a question it can’t answer? The customer is told a person is coming, the chat goes to your team, and the agent leaves a summary.',
  },
  {
    icon: Workflow,
    title: 'Works inside your flows',
    body: 'Add a “Hand to AI agent” step to any flow. Send your abandoned-checkout template, then let the agent answer whatever is stopping the customer from buying.',
  },
];

const STEPS = [
  {
    title: 'Connect your store',
    body: 'Link Shopify and WhatsApp. Your catalog and order data sync automatically.',
  },
  {
    title: 'Train it in minutes',
    body: 'Import your store policies, add FAQs and set the tone. Test real questions in the Playground.',
  },
  {
    title: 'Go live',
    body: 'Work through the go-live checklist and switch on auto-replies. Take over any chat at any time.',
  },
];

const GUARDRAILS = [
  'Never claims a refund, cancellation or address change was done. It routes those to your team.',
  'Never invents prices, stock, discounts or delivery dates.',
  'Ignores customers who try to change its instructions.',
  'Stops after a reply limit you set per conversation, and stays out of chats a teammate has picked up.',
  'Never asks for passwords, OTPs or card details.',
];

const FAQS = [
  {
    q: 'Do I need to write a script or decision tree?',
    a: 'No. The agent reads your store policies, FAQs and catalog. Flows are still there when you want a fixed path, like a checkout reminder, and the agent can take over at the end of one.',
  },
  {
    q: 'What happens when the agent can’t help?',
    a: 'It tells the customer someone from your team will reply, pauses itself on that chat, assigns it to the teammate you choose (or your shared inbox) and leaves a short summary.',
  },
  {
    q: 'Can it process refunds or cancel orders?',
    a: 'Not by itself. It explains your policy and hands the request to your team, so nothing changes in your store without a person approving it.',
  },
  {
    q: 'Can I try it before customers see it?',
    a: 'Yes. The Playground runs the same agent your customers get, including product carousels and handoffs, without sending anything on WhatsApp.',
  },
];

export default function AiAgentLandingPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border/60 bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/ai-agent" aria-label={BRAND_NAME} className="block w-44">
            <BrandLogo variant="sidebar" className="h-11 max-h-11" priority />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#features" className="text-muted-foreground hover:text-foreground hidden px-3 py-2 text-sm sm:inline">
              Features
            </a>
            <a href="#how" className="text-muted-foreground hover:text-foreground hidden px-3 py-2 text-sm sm:inline">
              How it works
            </a>
            <a href={GET_STARTED_URL} className={cn(buttonVariants({ size: 'sm' }))}>
              Get started
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(ellipse_at_top,var(--primary-soft),transparent_70%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
            <div>
              <span className="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" /> New · AI agent for Shopify
              </span>
              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Your best sales rep, now answering every WhatsApp message.
              </h1>
              <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
                An AI agent trained on your Shopify store. It recommends products, answers
                policy and order questions, and hands the chat to your team when a person
                should step in, day or night.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={GET_STARTED_URL} className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
                  Get started <ArrowRight className="h-4 w-4" />
                </a>
                {DEMO_URL && (
                  <a href={DEMO_URL} className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>
                    Book a demo
                  </a>
                )}
              </div>
              <ul className="text-muted-foreground mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {['Official WhatsApp Business API', 'Built for Shopify', 'Human handoff built in'].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <BadgeCheck className="text-primary h-4 w-4" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <ChatPreview />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-border/60 border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading
              eyebrow="What it does"
              title="Support and sales in one conversation"
              body="Customers don't separate “where's my order?” from “what else do you have?”. Neither does the agent."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="border-border bg-card rounded-2xl border p-6">
                  <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="bg-card border-border/60 border-y">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="How it works" title="Live in an afternoon" />
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative">
                  <span className="bg-primary text-primary-foreground flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-6">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Guardrails */}
        <section>
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionHeading
                align="left"
                eyebrow="Guardrails"
                title="Helpful without going off-script"
                body="The agent works inside rules your customers can trust and your team can rely on."
              />
            </div>
            <ul className="space-y-3">
              {GUARDRAILS.map((item) => (
                <li key={item} className="border-border bg-card flex items-start gap-3 rounded-xl border p-4 text-sm">
                  <ShieldCheck className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-border/60 border-t">
          <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="FAQ" title="Questions brands ask us" />
            <div className="mt-10 space-y-3">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="group border-border bg-card rounded-xl border p-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold">
                    {q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="text-muted-foreground mt-3 text-sm leading-6">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="bg-primary text-primary-foreground mx-auto max-w-6xl rounded-3xl px-6 py-14 text-center sm:px-12">
            <Bot className="mx-auto h-10 w-10 opacity-90" />
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
              Turn every WhatsApp chat into a sale or a solved ticket
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-base opacity-90">
              Connect your Shopify store, train the agent on your policies, and go live when
              you’re happy with its answers.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={GET_STARTED_URL}
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'bg-background text-foreground hover:bg-background/90 gap-2'
                )}
              >
                Get started <ArrowRight className="h-4 w-4" />
              </a>
              {DEMO_URL && (
                <a
                  href={DEMO_URL}
                  className={cn(
                    buttonVariants({ size: 'lg', variant: 'outline' }),
                    'border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10 bg-transparent'
                  )}
                >
                  Book a demo
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs sm:px-6">
          <span>© {new Date().getFullYear()} {BRAND_NAME}</span>
          <Link href="/login" className="hover:text-foreground">
            Log in
          </Link>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      <p className="text-primary text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {body && <p className="text-muted-foreground mt-4 text-base text-pretty">{body}</p>}
    </div>
  );
}

/** Static illustration of a guided-selling conversation. */
function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-label="Example WhatsApp conversation with the AI agent">
      <div className="border-border bg-card overflow-hidden rounded-[2rem] border shadow-2xl shadow-black/10">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
            <Bot className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Your store</p>
            <p className="text-[11px] opacity-80">AI agent · replies instantly</p>
          </div>
        </div>
        <div className="space-y-2.5 bg-[#efeae2] px-3 py-4 text-[13px] leading-5 text-[#111b21] dark:bg-[#0b141a] dark:text-[#e9edef]">
          <Bubble from="customer">Hi! Need an anniversary gift for my wife, under ₹1000</Bubble>
          <Bubble from="agent">
            Lovely! Does she prefer something personalised with your photos, or a keepsake
            she can wear?
          </Bubble>
          <Bubble from="customer">Personalised please 😊</Bubble>
          <Bubble from="agent">Here are a few she’ll love, all under ₹1000 👇</Bubble>
          <div className="flex gap-2 overflow-hidden pl-1">
            {[
              { name: 'Photo standee', price: '₹690' },
              { name: 'Engraved frame', price: '₹990' },
            ].map((p) => (
              <div key={p.name} className="w-[140px] shrink-0 overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#202c33]">
                <div className="flex h-20 items-center justify-center bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/40 dark:to-emerald-800/20">
                  <ShoppingBag className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                </div>
                <div className="p-2">
                  <p className="text-[12px] font-semibold">{p.name}</p>
                  <p className="text-[11px] opacity-70">{p.price}</p>
                  <p className="mt-1.5 rounded-md border border-emerald-600/30 py-1 text-center text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    Buy now
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Bubble from="customer">Is COD available?</Bubble>
          <Bubble from="agent">
            Yes, COD is available on all orders. Prepaid orders ship free 🚚
          </Bubble>
        </div>
      </div>
      <div className="border-border bg-card absolute -bottom-5 -left-4 hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg sm:flex">
        <CheckCircle2 className="text-primary h-4 w-4" /> Answers from your store policies
      </div>
    </div>
  );
}

function Bubble({ from, children }: { from: 'customer' | 'agent'; children: React.ReactNode }) {
  return (
    <div className={cn('flex', from === 'customer' ? 'justify-end' : 'justify-start')}>
      <p
        className={cn(
          'max-w-[82%] rounded-lg px-3 py-1.5 shadow-sm',
          from === 'customer' ? 'bg-[#d9fdd3] dark:bg-[#005c4b]' : 'bg-white dark:bg-[#202c33]'
        )}
      >
        {children}
      </p>
    </div>
  );
}
