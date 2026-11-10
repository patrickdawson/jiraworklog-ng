import type { AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

/**
 * Stand-in for `next/link`, so the components ported from the Next.js app keep
 * their `<Link href>` markup. External URLs stay plain anchors.
 */
export default function Link({ href, ...rest }: Props) {
  if (/^[a-z]+:/i.test(href)) return <a href={href} {...rest} />;
  return <RouterLink to={href} {...rest} />;
}
