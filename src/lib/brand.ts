// Single source of truth for brand identity. Working name — change here only.
export const brand = {
  name: "EazyFlex",
  tagline: "Your time. Your skills. Your way to earn.",
  businessTagline: "Find the right people. Get the work done.",
  description: "Flexible work that fits your availability, skills and life — remote projects, local opportunities, short shifts and recurring assignments.",
  launchCity: "Calgary",
  launchRegion: "Alberta",
  supportEmail: "support@example.com",
  nav: [
    { label: "Find Work", href: "/find-work" },
    { label: "Hire Talent", href: "/hire-talent" },
    { label: "How It Works", href: "/how-it-works" },
    { label: "Explore Opportunities", href: "/opportunities" },
    { label: "About", href: "/about" },
  ],
  policyVersions: { terms: "2026-01", privacy: "2026-01" },
} as const;
