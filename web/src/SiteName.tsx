import { Fragment } from "react";
import { siteParts } from "./links";

// A site's name with a place to break after each dot, so a name too long
// for its line breaks there and not inside a word (docs/design.md). The
// element around it sets its size and lets a part longer than the line
// split.
export function SiteName({ site }: { site: string }) {
  return siteParts(site).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
