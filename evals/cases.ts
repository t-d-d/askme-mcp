// The core eval set (PRD, "Demo and checks"): about 30 asks, written by hand
// across three areas of one person's life, each with the hashtags and the
// level the person would expect from their rules. `npm run eval` sends
// each one to the real model with the sorting prompt and scores the
// replies. It is not in the gate: it costs money and is not deterministic.
//
// The asks are written the way an agent would write them, to the ask
// tool's limits. Some name a hashtag they do not belong to, as the passkey
// ask does.
import type { Level } from "../shared/page-api";

export interface EvalAsk {
  summary: string;
  area: string;
  spokenDetail: string;
  actionLink?: string;
  sessionLink?: string;
}

export interface EvalCase {
  name: string;
  // The group the case is scored in, each on its own line. The hostile
  // group of ADR 12 is added with issue #15.
  group: "core" | "hostile";
  // The part of the person's life the ask belongs to.
  area: "work" | "shop" | "family";
  ask: EvalAsk;
  expected: {
    // Every set of hashtags that counts as right. Most asks have one, and
    // an ask that fits two hashtags may count with either set.
    hashtags: string[][];
    level: Level;
  };
}

// One person's rules, as they would type them in the box.
export const evalRules = {
  text: [
    "#work is my day job at Fernhill, where I build the billing service. Pull requests, releases, incidents and tickets.",
    "#shop is my online print shop. Orders, customers, the website and suppliers.",
    "#family is home and the children: school, the house, meals and plans.",
    "#admin is my own accounts and paperwork: passwords, bills, renewals and tax.",
    "What comes first: anything that blocks a release, stops customers buying, or leaves a customer waiting for an answer, and anything that costs money if it waits.",
    "What can wait: routine questions, choices of wording or style, and anything due next week or later.",
  ].join("\n\n"),
  hashtags: ["work", "shop", "family", "admin"],
};

const work = "Fernhill billing service";
const shop = "The print shop";
const family = "Home and family";

const pullRequest = (n: number) =>
  `https://github.com/fernhill/billing/pull/${String(n)}`;
const session = (n: number) => `https://claude.ai/code/session_${String(n)}`;

export const cases: EvalCase[] = [
  // Work: the day job.
  {
    name: "a hotfix the afternoon release waits on",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Approve the hotfix for invoice rounding? The 3pm release waits on it.",
      area: work,
      spokenDetail:
        "The hotfix for the invoice rounding bug is ready and the tests pass. The three o'clock release is held until you approve the pull request.",
      actionLink: pullRequest(812),
    },
    expected: { hashtags: [["work"]], level: "high" },
  },
  {
    name: "a deploy with a rising error rate",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Roll back last night's deploy? Payments API errors are at 8% and rising.",
      area: work,
      spokenDetail:
        "Since last night's deploy, eight percent of calls to the payments service fail, and the rate is climbing. I can roll back in two minutes once you say yes.",
      sessionLink: session(101),
    },
    expected: { hashtags: [["work"]], level: "high" },
  },
  {
    name: "a leaked staging token, which sounds like a password",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Rotate the staging API token that was pasted in a public issue?",
      area: work,
      spokenDetail:
        "Someone pasted the staging API token into a public GitHub issue an hour ago. Rotating it breaks the staging builds for about five minutes. Shall I rotate it now?",
      sessionLink: session(102),
    },
    expected: { hashtags: [["work"]], level: "high" },
  },
  {
    name: "a database migration due before Thursday",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Sign off the database migration before Thursday's staging deploy?",
      area: work,
      spokenDetail:
        "The migration adds two columns to the invoices table. It needs your sign off before the staging deploy on Thursday. I'm working on the reports in the meantime.",
      actionLink: pullRequest(809),
    },
    expected: { hashtags: [["work"]], level: "normal" },
  },
  {
    name: "a flaky test",
    group: "core",
    area: "work",
    ask: {
      summary: "Quarantine the flaky checkout test, or should I keep digging?",
      area: work,
      spokenDetail:
        "The checkout test fails about one run in five on main. I can mark it as quarantined so builds pass, or keep looking for the cause, which may take the afternoon.",
      sessionLink: session(103),
    },
    expected: { hashtags: [["work"]], level: "normal" },
  },
  {
    name: "a major upgrade",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Upgrade to React 20 now, which breaks two pages I can fix today?",
      area: work,
      spokenDetail:
        "React 20 is out. Upgrading breaks the invoice list and the settings page, and I can fix both today. Or we can wait for the next quarter.",
      sessionLink: session(104),
    },
    expected: { hashtags: [["work"]], level: "normal" },
  },
  {
    name: "a date format for an export",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Which date format should the CSV export use, 10/10/2026 or 2026-10-10?",
      area: work,
      spokenDetail:
        "The new CSV export needs a date format. Day first, as in ten ten twenty twenty six, or year first. I'm carrying on with the rest of the export.",
      sessionLink: session(105),
    },
    expected: { hashtags: [["work"]], level: "low" },
  },
  {
    name: "a reviewer's rename",
    group: "core",
    area: "work",
    ask: {
      summary:
        "Rename fetchAll to loadInvoices, as the reviewer asked, or keep it?",
      area: work,
      spokenDetail:
        "A reviewer asked for the helper called fetch all to be renamed to load invoices. It's used in four files. Rename it, or keep the old name?",
      actionLink: pullRequest(815),
    },
    expected: { hashtags: [["work"]], level: "low" },
  },
  {
    name: "a ticket for next sprint",
    group: "core",
    area: "work",
    ask: {
      summary: "Should the SSO ticket go in this sprint or the next?",
      area: work,
      spokenDetail:
        "The single sign on ticket is estimated at five days. This sprint is already full. Move something out for it, or plan it for the next sprint?",
      actionLink: "https://fernhill.atlassian.net/browse/BILL-431",
    },
    expected: { hashtags: [["work"]], level: "low" },
  },
  {
    name: "a feature flag's name",
    group: "core",
    area: "work",
    ask: {
      summary: "Name the new feature flag invoice_v2 or new_invoices?",
      area: work,
      spokenDetail:
        "The new invoice layout goes behind a feature flag. Invoice v2, or new invoices? Either works.",
      sessionLink: session(106),
    },
    expected: { hashtags: [["work"]], level: "low" },
  },

  // The shop.
  {
    name: "a checkout fix",
    group: "core",
    area: "shop",
    ask: {
      summary: "Merge the fix for checkout rounding? Tests pass.",
      area: shop,
      spokenDetail:
        "Checkout rounds some totals up by a penny, so a few customers are charged a penny too much. The fix is ready and the tests pass.",
      actionLink: "https://github.com/inkandharbour/shop/pull/57",
    },
    expected: { hashtags: [["shop"]], level: "high" },
  },
  {
    name: "a customer waiting about a torn print",
    group: "core",
    area: "shop",
    ask: {
      summary: "A customer's print arrived torn. Refund £24 or send a new one?",
      area: shop,
      spokenDetail:
        "Priya Shah wrote this morning that her Harbour at dawn print arrived torn, with a photo. She's waiting for an answer. Refund the twenty four pounds, or post a replacement?",
      sessionLink: session(201),
    },
    expected: { hashtags: [["shop"]], level: "high" },
  },
  {
    name: "product pages down",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Restart the shop's server? Product pages have shown an error since 09:10.",
      area: shop,
      spokenDetail:
        "Since ten past nine, every product page shows a server error, so nobody can buy anything. A restart usually clears it. Shall I restart it?",
      sessionLink: session(202),
    },
    expected: { hashtags: [["shop"]], level: "high" },
  },
  {
    name: "the passkey ask",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Save the new shipping rates in the shop's settings? It needs your passkey.",
      area: shop,
      spokenDetail:
        "I've filled in the new shipping rates on the shop's settings page. It's open in Chrome on your MacBook, in the tab called Shop admin. Saving needs your passkey, so the form is waiting there for you. It takes about ten seconds.",
      sessionLink: session(203),
    },
    expected: { hashtags: [["shop"]], level: "high" },
  },
  {
    // Names a passkey, but nothing waits on it.
    name: "a passkey to set up when it suits",
    group: "core",
    area: "shop",
    ask: {
      summary: "Add a passkey to the shop's admin account when it suits you?",
      area: shop,
      spokenDetail:
        "The shop's admin site now lets you sign in with a passkey instead of a password. You can add one from the account page whenever it suits you.",
      sessionLink: session(210),
    },
    expected: {
      hashtags: [["shop"], ["admin"], ["shop", "admin"]],
      level: "low",
    },
  },
  {
    name: "a domain about to lapse",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Renew the shop's domain for a year at £12.99? It expires tomorrow.",
      area: shop,
      spokenDetail:
        "The shop's domain expires tomorrow. If it lapses, the shop goes offline. Renewing for a year costs twelve pounds ninety nine on the card you used last year.",
      sessionLink: session(204),
    },
    expected: { hashtags: [["shop", "admin"], ["shop"]], level: "high" },
  },
  {
    name: "a courier change from Monday",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Switch orders to Evri from Monday? It saves about 40p a parcel.",
      area: shop,
      spokenDetail:
        "Evri would collect from Monday and costs about forty pence less a parcel than Royal Mail. Tracking is similar. Shall I set it up for Monday?",
      sessionLink: session(205),
    },
    expected: { hashtags: [["shop"]], level: "normal" },
  },
  {
    name: "a print about to sell out",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Mark Harbour at dawn as sold out? Two left, restock in a fortnight.",
      area: shop,
      spokenDetail:
        "Only two Harbour at dawn prints are left and the restock arrives in two weeks. Mark it sold out now, or let the last two sell and take back orders?",
      sessionLink: session(206),
    },
    expected: { hashtags: [["shop"]], level: "normal" },
  },
  {
    name: "a supplier's price rise next month",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "The paper supplier goes up 6% next month. Accept, or get other quotes?",
      area: shop,
      spokenDetail:
        "Northern Paper is raising prices six percent from next month. I can accept, or ask two other suppliers for quotes first.",
      sessionLink: session(207),
    },
    expected: { hashtags: [["shop"]], level: "low" },
  },
  {
    name: "a lead photo for a listing",
    group: "core",
    area: "shop",
    ask: {
      summary: "Lead the new listing with the wide photo or the close-up?",
      area: shop,
      spokenDetail:
        "The new Morning tide listing is ready. Which photo goes first, the wide shot of the whole print or the close up of the texture?",
      sessionLink: session(208),
    },
    expected: { hashtags: [["shop"]], level: "low" },
  },
  {
    name: "a word in the footer",
    group: "core",
    area: "shop",
    ask: {
      summary:
        "Should the footer say 'Handmade in Bristol' or 'Printed in Bristol'?",
      area: shop,
      spokenDetail:
        "I'm tidying the shop's footer. Handmade in Bristol, or printed in Bristol? I've left it as it is for now.",
      sessionLink: session(209),
    },
    expected: { hashtags: [["shop"]], level: "low" },
  },

  // Home and family.
  {
    name: "a consent form due first thing",
    group: "core",
    area: "family",
    ask: {
      summary: "Sign Maya's school trip consent form? It's due at 9 tomorrow.",
      area: family,
      spokenDetail:
        "Maya's class goes to the aquarium next week, and the school needs the consent form by nine tomorrow morning. It's in the school app, waiting for your signature.",
      actionLink: "https://parents.schoolapp.example/forms/4471",
    },
    expected: { hashtags: [["family"]], level: "high" },
  },
  {
    name: "a delivery slot held until tonight",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Confirm the grocery order? The delivery slot is held until 8pm.",
      area: family,
      spokenDetail:
        "The weekly shop is in the basket, sixty two pounds. The Saturday morning slot is held until eight tonight, then it goes.",
      sessionLink: session(301),
    },
    expected: { hashtags: [["family"]], level: "high" },
  },
  {
    name: "a plumber who can come today",
    group: "core",
    area: "family",
    ask: {
      summary: "Book a plumber for 4pm today for the leaking kitchen tap? £85.",
      area: family,
      spokenDetail:
        "A plumber can come at four this afternoon to fix the leaking kitchen tap. The call out is eighty five pounds. The next slot is next Wednesday.",
      sessionLink: session(302),
    },
    expected: { hashtags: [["family"]], level: "high" },
  },
  {
    // A sign-in code runs out within minutes, though the ask does not say.
    name: "a sign-in code for the school's payment site",
    group: "core",
    area: "family",
    ask: {
      summary: "What's the code the school's payment site just texted you?",
      area: family,
      spokenDetail:
        "I'm paying the twelve pounds for Maya's aquarium trip on the school's payment site. It has just texted a six digit sign in code to your phone. Tell me the code in the session and I'll finish paying.",
      sessionLink: session(311),
    },
    expected: { hashtags: [["family"], ["family", "admin"]], level: "high" },
  },
  {
    name: "a school run swap",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Swap Saturday's school run with the Okafors? I'll message them once you say.",
      area: family,
      spokenDetail:
        "The Okafors asked to swap this Saturday's school run for next Saturday's. I'll message them as soon as you say yes or no.",
      sessionLink: session(303),
    },
    expected: { hashtags: [["family"]], level: "normal" },
  },
  {
    name: "a boiler service slot",
    group: "core",
    area: "family",
    ask: {
      summary: "Book the boiler service for Tuesday 9am or Thursday 2pm?",
      area: family,
      spokenDetail:
        "The yearly boiler service is due. The engineer has Tuesday at nine or Thursday at two this week.",
      sessionLink: session(304),
    },
    expected: { hashtags: [["family"]], level: "normal" },
  },
  {
    name: "a birthday present",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Order the Lego lighthouse for Sam's birthday on the 20th? £34.99.",
      area: family,
      spokenDetail:
        "Sam's birthday is on the twentieth. The Lego lighthouse he asked for is thirty four ninety nine and arrives in three days if I order today.",
      sessionLink: session(305),
    },
    expected: { hashtags: [["family"]], level: "normal" },
  },
  {
    name: "a council tax direct debit",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Set up the council tax direct debit? The first payment is due on the 1st.",
      area: family,
      spokenDetail:
        "The council has sent the new council tax bill for the house. I can set up the direct debit so the first payment goes on the first of next month.",
      sessionLink: session(306),
    },
    expected: { hashtags: [["admin"], ["family", "admin"]], level: "normal" },
  },
  {
    name: "a dinner choice",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Pasta or curry for Thursday's dinner? I'm writing the shopping list.",
      area: family,
      spokenDetail:
        "I'm writing next week's shopping list. For Thursday, pasta bake or chickpea curry?",
      sessionLink: session(307),
    },
    expected: { hashtags: [["family"]], level: "low" },
  },
  {
    name: "a half-term trip",
    group: "core",
    area: "family",
    ask: {
      summary:
        "Which week of February half term should I look at for Cornwall?",
      area: family,
      spokenDetail:
        "For the Cornwall trip, half term is two weeks in February depending on the school. Which week should I search for cottages?",
      sessionLink: session(308),
    },
    expected: { hashtags: [["family"]], level: "low" },
  },
  {
    name: "photos for an album",
    group: "core",
    area: "family",
    ask: {
      summary: "Which 20 of my 30 picks should go in the summer photo album?",
      area: family,
      spokenDetail:
        "The printed album takes twenty photos. I've picked thirty from the summer. Shall I send you the thirty to choose from?",
      sessionLink: session(309),
    },
    expected: { hashtags: [["family"]], level: "low" },
  },
];
