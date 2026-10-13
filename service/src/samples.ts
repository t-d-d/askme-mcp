import type { AccountId } from "./identity";
import type { NewAsk, Store } from "./store/store";

export interface SampleArea {
  area: string;
  asks: readonly { summary: string; spokenDetail: string }[];
}

// The areas the example rules name (rules.ts).
export const sampleAreas: readonly SampleArea[] = [
  {
    area: "The day job",
    asks: [
      {
        summary: "Approve the hotfix for the login page so it can ship today",
        spokenDetail:
          "The hotfix for the login page is ready, and the tests pass. Today's release is waiting on your approval.",
      },
      {
        summary: "Which week suits you for the team's planning day?",
        spokenDetail:
          "The team is fixing a date for next month's planning day. The first and the third week both work for everyone else. Which suits you?",
      },
      {
        summary: "Sign off this month's cloud bill before it goes to finance",
        spokenDetail:
          "This month's cloud bill is higher than last month's, mostly from the new test servers. Finance would like your sign-off by Friday.",
      },
      {
        summary: "Read the draft of the quarterly update before it goes out",
        spokenDetail:
          "The quarterly update for the leadership team is drafted. It covers the release dates and the hiring plan. It goes out on Thursday.",
      },
      {
        summary: "Can the release move to Wednesday for the database upgrade?",
        spokenDetail:
          "The database upgrade is booked for tomorrow morning, at the same time as the release. Running both at once is risky. Should the release move to Wednesday?",
      },
      {
        summary: "Pick a name for the new reporting service",
        spokenDetail:
          "The new reporting service needs a name before its repository is made. The shortlist is Ledger, Tally and Census. Pick one, or suggest another.",
      },
      {
        summary: "Approve a laptop for the new starter on Monday",
        spokenDetail:
          "The new starter begins on Monday, and their laptop order is waiting for your approval. It is the usual model, at the usual price.",
      },
      {
        summary: "Should the old dashboard be switched off this month?",
        spokenDetail:
          "Only a handful of people still use the old dashboard. Switching it off saves a little each month. Should it go now, or after the quarter ends?",
      },
    ],
  },
  {
    area: "The online shop",
    asks: [
      {
        summary: "Refund the customer whose mug arrived cracked?",
        spokenDetail:
          "A customer says their mug arrived cracked, and has sent a photo. They would like a refund rather than a new mug. The refund is twelve pounds.",
      },
      {
        summary: "Checkout is charging too much for delivery to Scotland",
        spokenDetail:
          "Since this morning, checkout adds five pounds too much for delivery to Scotland. Three orders went through at the wrong price. Should the price be fixed now, and the difference refunded?",
      },
      {
        summary: "Reorder the gift boxes before they run out?",
        spokenDetail:
          "Thirty gift boxes are left, which is about two weeks of sales. The supplier needs ten days. Should the usual two hundred be ordered?",
      },
      {
        summary: "Choose the photo for the spring sale banner",
        spokenDetail:
          "Two photos are ready for the spring sale banner on the home page: the blue jugs on the windowsill, or the stacked bowls on the table. Which one should it be?",
      },
      {
        summary: "Answer a café that wants to stock forty mugs a month",
        spokenDetail:
          "A café in Leeds would like to stock forty mugs a month, and asks for a wholesale price. They hope to hear back this week.",
      },
      {
        summary: "Renew the shop's domain for another year?",
        spokenDetail:
          "The shop's domain name runs out in nine days, and then the site goes offline. Renewing it for a year costs about fifteen pounds.",
      },
      {
        summary: "Approve the new returns policy before it goes on the site",
        spokenDetail:
          "The returns policy is rewritten to give customers thirty days instead of fourteen. It goes on the website once you approve it.",
      },
      {
        summary: "Which courier should take the Christmas parcels?",
        spokenDetail:
          "Two couriers have quoted for the Christmas rush. One is cheaper, and the other collects on Saturdays. Which should take the parcels from December?",
      },
    ],
  },
  {
    area: "Home and family",
    asks: [
      {
        summary: "Sign the form for Saturday's school trip",
        spokenDetail:
          "The school trip form needs a parent's signature by Thursday. The trip is to the science museum on Saturday, and it costs eight pounds.",
      },
      {
        summary: "Swap Friday's school run with the Okafors?",
        spokenDetail:
          "The Okafors asked whether you can do Friday's school run, and they will do Monday's in return. They would like to know tonight.",
      },
      {
        summary: "Book the boiler service before the cold weather",
        spokenDetail:
          "The boiler is due its yearly service. The engineer can come next Tuesday morning or Thursday afternoon. Which suits you?",
      },
      {
        summary: "What should go in the children's packed lunches this week?",
        spokenDetail:
          "The shopping order goes in tonight. Should it be sandwiches again, or the pasta salad they liked last month?",
      },
      {
        summary: "Pay the deposit for the summer cottage by Friday",
        spokenDetail:
          "The cottage in Cornwall is held for you until Friday. The deposit is two hundred pounds, and after Friday it goes to the next family on the list.",
      },
      {
        summary: "Choose a present for Grandma's birthday on Sunday",
        spokenDetail:
          "Grandma's birthday is on Sunday. The ideas so far are a framed photo of the children, a new gardening set, or tickets to the theatre.",
      },
      {
        summary: "Can Maya go to a sleepover at Ruby's on Saturday?",
        spokenDetail:
          "Ruby's parents have invited Maya to a sleepover on Saturday night. They will bring her home by ten on Sunday morning.",
      },
      {
        summary: "Renew the car insurance before it runs out",
        spokenDetail:
          "The car insurance runs out at the end of the month. The renewal quote is a little higher than last year's. Should it be renewed as it is, or should a better price be found?",
      },
    ],
  },
];

export function shuffled<T>(items: readonly T[]): T[] {
  const order = [...items];
  for (let last = order.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(Math.random() * (last + 1));
    const [kept, picked] = [order[last], order[pick]];
    if (kept !== undefined && picked !== undefined) {
      order[last] = picked;
      order[pick] = kept;
    }
  }
  return order;
}

export interface SamplesSent {
  posted: string[];
  refused?:
    | { kind: "rate-limited"; secondsLeft: number }
    | { kind: "over-cap"; resetsAt: Date };
}

export async function sendSamples(
  account: AccountId,
  store: Pick<Store, "countCall" | "postAsk">,
  now: Date,
  order: <T>(items: readonly T[]) => T[] = shuffled,
): Promise<SamplesSent> {
  const posted: string[] = [];
  for (const { area, asks } of sampleAreas) {
    const counted = await store.countCall(account, "ask", now);
    if (!counted.counted) {
      return {
        posted,
        refused: { kind: "rate-limited", secondsLeft: counted.secondsLeft },
      };
    }
    for (const sample of order(asks)) {
      const ask: NewAsk = { area, ...sample };
      const posting = await store.postAsk(account, ask, now);
      // A match to a sample from the last ten minutes shows nothing new
      // (ADR 3), so try the area's next one.
      if (posting.kind === "matched") continue;
      if (posting.kind === "over-cap") {
        return {
          posted,
          refused: { kind: "over-cap", resetsAt: posting.resetsAt },
        };
      }
      posted.push(posting.id);
      break;
    }
  }
  return { posted };
}
