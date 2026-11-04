import { EmptyState, LinkButton, Page } from "@/components/ui";

export default function NotFound() {
  return (
    <Page narrow>
      <EmptyState title="Nothing surveyed here" action={<LinkButton href="/check" variant="primary">Check a unit</LinkButton>}>
        This page doesn&apos;t exist. If someone sent you a unit link, check the unit name instead.
      </EmptyState>
    </Page>
  );
}
