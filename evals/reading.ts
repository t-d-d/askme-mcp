// The reading eval: sets of rules, each with the hashtags and the hours a
// person would expect askme to read from them. `npm run eval` reads each one
// with the real model, through the service's own call, and scores what came
// back. Like the sorting eval, it is not in the gate.
//
// Hours are scored by what they mean, not how they are written: two
// readings agree when every hashtag shows in the same minutes of the week.
// So "weekends, all day" and two windows, one for each day, are the same.
import type { Weekday } from "../shared/page-api";
import type { HashtagWindow } from "../service/src/rules";
import { evalRules } from "./cases";

export interface ReadingCase {
  name: string;
  text: string;
  expected: {
    // The hashtags, in the order the rules first write them.
    hashtags: string[];
    // The windows the rules limit hashtags to. A hashtag with none shows at
    // any time.
    hours: HashtagWindow[];
  };
}

const weekdaysOnly: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const weekend: Weekday[] = ["sat", "sun"];
const everyDay: Weekday[] = [...weekdaysOnly, ...weekend];

export const readingCases: ReadingCase[] = [
  {
    name: "the rules on the design's rules screen",
    text: [
      "#work is my day job. Only show it on weekdays between 8am and 6pm.",
      "#shop is my online shop. Anything a customer can see comes first.",
      "#family is home and the children. Show it at any time.",
      "Anything that blocks a release or costs money ranks high. Routine questions rank low.",
    ].join("\n\n"),
    expected: {
      hashtags: ["work", "shop", "family"],
      hours: [
        { hashtag: "work", days: weekdaysOnly, from: "08:00", to: "18:00" },
      ],
    },
  },
  {
    name: "the sorting eval's rules, which give no hours",
    text: evalRules.text,
    expected: { hashtags: evalRules.hashtags, hours: [] },
  },
  {
    name: "a time that ranks an ask, not one that limits a hashtag",
    text: [
      "#work is my day job. Anything due before 5pm today ranks high.",
      "#family is home. A school form due tomorrow morning comes first.",
    ].join("\n\n"),
    expected: { hashtags: ["work", "family"], hours: [] },
  },
  {
    name: "evenings in the week, and all day at weekends",
    text: [
      "#family is home and the children. Show it in the evenings from 6pm, and all day at weekends.",
      "#work is my day job.",
    ].join("\n\n"),
    expected: {
      hashtags: ["family", "work"],
      hours: [
        { hashtag: "family", days: weekdaysOnly, from: "18:00", to: "24:00" },
        { hashtag: "family", days: weekend, from: "00:00", to: "24:00" },
      ],
    },
  },
  {
    name: "a window that runs past midnight",
    text: "#oncall is the pager for the billing service. Only show it between 10pm and 7am.\n\n#work is everything else at work.",
    expected: {
      hashtags: ["oncall", "work"],
      hours: [
        { hashtag: "oncall", days: everyDay, from: "22:00", to: "07:00" },
      ],
    },
  },
  {
    name: "the 24-hour clock, and minutes",
    text: "#work: 09:00-17:30, Monday to Friday.\n#shop: any time.",
    expected: {
      hashtags: ["work", "shop"],
      hours: [
        { hashtag: "work", days: weekdaysOnly, from: "09:00", to: "17:30" },
      ],
    },
  },
  {
    name: "two windows for one hashtag",
    text: "#shop is my print shop. Show it from 7am to 9am and from 5pm to 10pm, every day.\n\n#family can come at any time.",
    expected: {
      hashtags: ["shop", "family"],
      hours: [
        { hashtag: "shop", days: everyDay, from: "07:00", to: "09:00" },
        { hashtag: "shop", days: everyDay, from: "17:00", to: "22:00" },
      ],
    },
  },
  {
    name: "weekends only, and one morning",
    text: "#family only at weekends.\n\n#admin is bills and paperwork, on Saturday mornings from 9 until noon.",
    expected: {
      hashtags: ["family", "admin"],
      hours: [
        { hashtag: "family", days: weekend, from: "00:00", to: "24:00" },
        { hashtag: "admin", days: ["sat"], from: "09:00", to: "12:00" },
      ],
    },
  },
];
