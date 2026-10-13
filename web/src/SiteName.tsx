import { Fragment } from "react";
import { siteParts } from "./links";

// The element around it sets the size, and lets a part longer than its line
// split.
export function SiteName({ site }: { site: string }) {
  return siteParts(site).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
