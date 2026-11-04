// SPEC §12.14 FAQ copy (shared by the landing page and /faq).

export const FAQ: [string, React.ReactNode][] = [
  ["Where is my money, exactly?", <>In your unit&apos;s own NEAR account, e.g. <span className="mono">a-4b.harmattan-court.plote.near</span>. Anyone can look it up.</>],
  ["Can Plote take my money?", "No. Plote's servers don't hold any key that can move it. Only the estate contract's rules can, and those rules are public."],
  ["What if the developer disappears?", "When a deadline passes without a verified stage, you can refund everything not yet released."],
  ["Doesn't the developer need money to start building?", "An estate can release a fixed mobilisation share (up to 10%) when a unit is allocated. Everything else waits for a proven stage."],
  ["What if I can't keep paying?", "Your unit is listed for what you've paid. When it sells, you get that back minus a fixed 5%."],
  ["What does it cost me?", "Nothing on top of the price during the pilot. You pay a small network fee for each transaction (fractions of a cent)."],
  ["Is my name public?", "Your account name and amounts are public. Your real name isn't stored on-chain."],
  ["Why one vote per unit and not per account?", "Each unit is one stake. Splitting units across accounts can't add votes, and units bought after a vote opens can't swing it."],
  ["Is this live?", "The hackathon build runs on NEAR testnet, with a real cross-chain payment demonstrated on mainnet."],
];

export const EXTRA_FAQ: [string, React.ReactNode][] = [
  ["Who can see what I paid?", "Your account name, the amounts and the status of your unit are public on NEAR, by design: that is what lets anyone check a unit. If you don't want this linked to your other activity, create a new NEAR account just for your home."],
  ["What does Plote store off-chain?", "Site photos (public, they are the proof), names and notes people type on a family wall, and an email address if you opt in to milestone emails. You can delete your email at any time."],
  ["What is the 0.05 NEAR when I reserve?", "Storage for your token and unit record, not part of the price. You get it back when the reservation ends or the unit is refunded."],
  ["What happens if my payment from another chain arrives late?", "If your reservation expired before it landed, the money waits on the unit as unclaimed. The payment status page has a \"Claim my late payment\" button that returns it to your NEAR account."],
  ["Who is the surveyor, and can they be bribed?", "A named quantity surveyor whose key can only sign milestones. Their photos must pass checks run in secure hardware, and holders can vote to replace them. Plote limits the damage; it doesn't remove the need to trust a person."],
];
